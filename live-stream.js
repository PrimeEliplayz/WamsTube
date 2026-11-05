"use strict";

(() => {
    const $ = id => document.getElementById(id);
    const status = $("liveStatus");
    const streamList = $("liveStreamList");
    const emptyState = $("liveEmpty");
    const session = window.currentSession?.() || null;
    const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
    let hostStreamId = null;
    let hostMedia = null;
    let viewerStreamId = null;
    let viewerHostId = null;
    let viewerPeer = null;
    let viewerSignalCursor = 0;
    let hostSignalCursor = 0;
    let hostPolling = false;
    let viewerPolling = false;
    let hostTimer = 0;
    let hostHeartbeatTimer = 0;
    let viewerTimer = 0;
    let listTimer = 0;
    let chatTimer = 0;
    let chatBusy = false;
    const hostPeers = new Map();
    const hostCandidateQueues = new Map();
    const viewerCandidateQueue = [];
    const seenComments = new Set();
    let chatProfileNames = new Map();

    async function rpc(name, values = {}) {
        return window.supabaseRequest(`/rest/v1/rpc/${name}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(values)
        });
    }

    function setStatus(text) {
        if (status) status.textContent = text;
    }

    function isSignedIn() {
        return Boolean(session?.access_token && session.user?.id);
    }

    function closeHostPeer(viewerId) {
        const peer = hostPeers.get(viewerId);
        if (peer) peer.close();
        hostPeers.delete(viewerId);
        hostCandidateQueues.delete(viewerId);
    }

    async function sendSignal(streamId, recipientId, kind, payload = {}) {
        await rpc("live_send_signal", {
            target_stream: streamId,
            target_user: recipientId,
            signal_kind: kind,
            signal_data: payload
        });
    }

    async function hostSignal(signal) {
        if (signal.signal_type === "join") {
            if (hostPeers.has(signal.from_user) || !hostMedia) return;
            const peer = new RTCPeerConnection(rtcConfig);
            hostPeers.set(signal.from_user, peer);
            hostCandidateQueues.set(signal.from_user, []);
            hostMedia.getTracks().forEach(track => peer.addTrack(track, hostMedia));
            peer.onicecandidate = event => {
                if (event.candidate && hostStreamId) {
                    sendSignal(hostStreamId, signal.from_user, "candidate", event.candidate.toJSON()).catch(error => console.warn("Could not send live connection data.", error));
                }
            };
            peer.onconnectionstatechange = () => {
                if (["failed", "closed"].includes(peer.connectionState)) closeHostPeer(signal.from_user);
            };
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            await sendSignal(hostStreamId, signal.from_user, "offer", peer.localDescription.toJSON());
            return;
        }

        const peer = hostPeers.get(signal.from_user);
        if (!peer) return;
        if (signal.signal_type === "answer") {
            await peer.setRemoteDescription(signal.payload);
            const queued = hostCandidateQueues.get(signal.from_user) || [];
            for (const candidate of queued) await peer.addIceCandidate(candidate);
            hostCandidateQueues.set(signal.from_user, []);
        } else if (signal.signal_type === "candidate" && signal.payload?.candidate) {
            if (peer.remoteDescription) await peer.addIceCandidate(signal.payload);
            else hostCandidateQueues.get(signal.from_user)?.push(signal.payload);
        } else if (signal.signal_type === "leave") {
            closeHostPeer(signal.from_user);
        }
    }

    async function pollHostSignals() {
        if (!hostStreamId || hostPolling) return;
        hostPolling = true;
        try {
            const rows = await rpc("live_get_signals", { target_stream: hostStreamId, after_signal: hostSignalCursor });
            for (const signal of rows || []) {
                hostSignalCursor = Math.max(hostSignalCursor, Number(signal.id));
                try { await hostSignal(signal); }
                catch (error) { console.warn("Could not process a viewer connection.", error); }
            }
        } catch (error) {
            if (hostStreamId) setStatus(error.message || "Live connection signaling stopped.");
        } finally { hostPolling = false; }
    }

    async function stopHost(showMessage = true) {
        const streamId = hostStreamId;
        hostStreamId = null;
        window.clearInterval(hostTimer);
        window.clearInterval(hostHeartbeatTimer);
        hostPeers.forEach(peer => peer.close());
        hostPeers.clear();
        hostCandidateQueues.clear();
        hostMedia?.getTracks().forEach(track => track.stop());
        hostMedia = null;
        const video = $("liveVideo");
        if (video) { video.srcObject = null; video.muted = false; }
        $("liveViewer").hidden = true;
        $("startLiveButton").disabled = false;
        $("startLiveButton").textContent = "Start streaming";
        $("liveHostPanel").hidden = false;
        if (streamId) {
            try { await rpc("live_end_stream", { target_stream: streamId }); }
            catch (error) { setStatus(error.message || "Could not end the live stream in the database."); }
        }
        if (showMessage) setStatus("Your live stream has ended.");
        await loadLiveStreams();
    }

    async function startHost() {
        const button = $("startLiveButton");
        const title = $("liveTitle").value.trim();
        if (!isSignedIn()) {
            setStatus("Sign in before starting a live stream.");
            window.location.href = "login.html";
            return;
        }
        if (!title) { setStatus("Enter a title for your live stream."); $("liveTitle").focus(); return; }
        if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
            setStatus("Live streaming is not supported by this browser.");
            return;
        }
        button.disabled = true;
        button.textContent = "Requesting capture permission…";
        let capture;
        try {
            capture = $("liveSource").value === "screen"
                ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
                : await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            const result = await rpc("live_start_stream", { stream_title: title });
            hostStreamId = typeof result === "string" ? result : result?.live_start_stream;
            if (!hostStreamId) throw new Error("The database did not return a live stream ID.");
            hostMedia = capture;
            hostSignalCursor = 0;
            $("liveHostPanel").hidden = true;
            $("liveViewer").hidden = false;
            $("liveVideo").srcObject = hostMedia;
            $("liveVideo").muted = true;
            $("liveVideo").play().catch(() => {});
            $("liveStreamTitle").textContent = title;
            $("liveStreamHost").textContent = "You are broadcasting";
            $("liveIndicator").hidden = false;
            $("leaveLiveButton").textContent = "End live stream";
            $("liveChatInput").disabled = false;
            $("liveChatForm").querySelector("button").disabled = false;
            setStatus("You are live. Keep this page open while you broadcast.");
            capture.getVideoTracks().forEach(track => track.addEventListener("ended", () => {
                if (hostStreamId) stopHost();
            }, { once: true }));
            hostTimer = window.setInterval(pollHostSignals, 700);
            hostHeartbeatTimer = window.setInterval(async () => {
                if (!hostStreamId) return;
                try { await rpc("live_heartbeat", { target_stream: hostStreamId }); }
                catch (error) {
                    setStatus(error.message || "The live stream heartbeat failed.");
                    await stopHost(false);
                }
            }, 15000);
            startChat(hostStreamId);
            await loadLiveStreams();
        } catch (error) {
            capture?.getTracks().forEach(track => track.stop());
            hostStreamId = null;
            hostMedia = null;
            button.disabled = false;
            button.textContent = "Start streaming";
            setStatus(error.message || "Could not start the live stream.");
        }
    }

    async function viewerSignal(signal) {
        if (!viewerPeer || signal.from_user !== viewerHostId) return;
        if (signal.signal_type === "offer") {
            await viewerPeer.setRemoteDescription(signal.payload);
            while (viewerCandidateQueue.length) await viewerPeer.addIceCandidate(viewerCandidateQueue.shift());
            const answer = await viewerPeer.createAnswer();
            await viewerPeer.setLocalDescription(answer);
            await sendSignal(viewerStreamId, viewerHostId, "answer", viewerPeer.localDescription.toJSON());
        } else if (signal.signal_type === "candidate" && signal.payload?.candidate) {
            if (viewerPeer.remoteDescription) await viewerPeer.addIceCandidate(signal.payload);
            else viewerCandidateQueue.push(signal.payload);
        }
    }

    async function pollViewerSignals() {
        if (!viewerStreamId || viewerPolling) return;
        viewerPolling = true;
        try {
            const rows = await rpc("live_get_signals", { target_stream: viewerStreamId, after_signal: viewerSignalCursor });
            for (const signal of rows || []) {
                viewerSignalCursor = Math.max(viewerSignalCursor, Number(signal.id));
                try { await viewerSignal(signal); }
                catch (error) { console.warn("Could not process the live video connection.", error); }
            }
        } catch (error) {
            if (viewerStreamId) {
                setStatus(error.message || "The live connection ended.");
                await leaveViewer(false);
            }
        } finally { viewerPolling = false; }
    }

    async function joinLive(stream) {
        if (!isSignedIn()) {
            setStatus("Sign in to watch and chat in a live stream.");
            window.location.href = "login.html";
            return;
        }
        if (hostStreamId) { setStatus("End your own broadcast before joining another stream."); return; }
        if (!window.RTCPeerConnection) { setStatus("Live viewing is not supported by this browser."); return; }
        setStatus("Connecting to live stream…");
        try {
            viewerHostId = await rpc("live_join_stream", { target_stream: stream.id });
            viewerStreamId = stream.id;
            viewerSignalCursor = 0;
            viewerCandidateQueue.length = 0;
            viewerPeer = new RTCPeerConnection(rtcConfig);
            viewerPeer.addTransceiver("video", { direction: "recvonly" });
            viewerPeer.ontrack = event => {
                const video = $("liveVideo");
                if (event.streams?.[0]) video.srcObject = event.streams[0];
                video.muted = false;
                video.play().catch(() => {});
            };
            viewerPeer.onicecandidate = event => {
                if (event.candidate && viewerStreamId) {
                    sendSignal(viewerStreamId, viewerHostId, "candidate", event.candidate.toJSON()).catch(error => console.warn("Could not send live connection data.", error));
                }
            };
            viewerPeer.onconnectionstatechange = () => {
                if (viewerPeer && ["failed", "disconnected"].includes(viewerPeer.connectionState)) {
                    setStatus("The video connection was interrupted. Try joining again.");
                }
            };
            $("liveHostPanel").hidden = true;
            $("liveViewer").hidden = false;
            $("liveStreamTitle").textContent = stream.title;
            $("liveStreamHost").textContent = `Live from ${stream.channel_name || "WamsTube channel"}`;
            $("liveIndicator").hidden = false;
            $("leaveLiveButton").textContent = "Leave stream";
            $("liveVideo").srcObject = null;
            await sendSignal(viewerStreamId, viewerHostId, "join", {});
            viewerTimer = window.setInterval(pollViewerSignals, 700);
            startChat(viewerStreamId);
            await pollViewerSignals();
            setStatus("Connected to live stream.");
        } catch (error) {
            await leaveViewer(false);
            setStatus(error.message || "Could not join this live stream.");
        }
    }

    async function leaveViewer(notifyHost = true) {
        const streamId = viewerStreamId;
        const hostId = viewerHostId;
        viewerStreamId = null;
        viewerHostId = null;
        window.clearInterval(viewerTimer);
        window.clearInterval(chatTimer);
        viewerPeer?.close();
        viewerPeer = null;
        viewerCandidateQueue.length = 0;
        $("liveVideo").srcObject = null;
        $("liveViewer").hidden = true;
        $("liveHostPanel").hidden = false;
        $("liveChatMessages").replaceChildren();
        seenComments.clear();
        if (streamId) {
            if (notifyHost && hostId) {
                try { await sendSignal(streamId, hostId, "leave", {}); } catch {}
            }
            try { await rpc("live_leave_stream", { target_stream: streamId }); } catch {}
        }
        setStatus("You left the live stream.");
    }

    function appendChatMessage(comment) {
        if (seenComments.has(comment.id)) return;
        seenComments.add(comment.id);
        const row = document.createElement("div");
        row.className = "live-chat-message";
        const name = document.createElement("strong");
        name.textContent = chatProfileNames.get(comment.user_id) || "WamsTube channel";
        const text = document.createElement("span");
        text.textContent = comment.body;
        row.append(name, text);
        $("liveChatMessages").appendChild(row);
        const messages = $("liveChatMessages");
        messages.scrollTop = messages.scrollHeight;
    }

    async function loadChat() {
        if (!viewerStreamId && !hostStreamId) return;
        const streamId = viewerStreamId || hostStreamId;
        if (chatBusy) return;
        chatBusy = true;
        try {
            const comments = await window.supabaseRequest(`/rest/v1/live_stream_comments?stream_id=eq.${encodeURIComponent(streamId)}&select=id,user_id,body,created_at&order=created_at.desc&limit=100`);
            const ids = [...new Set((comments || []).map(comment => comment.user_id).filter(id => !chatProfileNames.has(id)))];
            if (ids.length) {
                const profiles = await window.supabaseRequest(`/rest/v1/profiles?select=id,channel_name&id=in.(${ids.map(encodeURIComponent).join(",")})`);
                profiles.forEach(profile => chatProfileNames.set(profile.id, profile.channel_name));
            }
            (comments || []).slice().reverse().forEach(appendChatMessage);
        } catch (error) {
            console.warn("Could not refresh live chat.", error);
        } finally { chatBusy = false; }
    }

    function startChat(streamId) {
        window.clearInterval(chatTimer);
        seenComments.clear();
        chatProfileNames = new Map();
        $("liveChatMessages").replaceChildren();
        const form = $("liveChatForm");
        const input = $("liveChatInput");
        const sendButton = form.querySelector("button");
        input.disabled = !isSignedIn();
        sendButton.disabled = !isSignedIn();
        input.placeholder = isSignedIn() ? "Say something…" : "Sign in to chat";
        loadChat();
        chatTimer = window.setInterval(() => {
            if (viewerStreamId === streamId || hostStreamId === streamId) loadChat();
        }, 1800);
    }

    async function sendChat(event) {
        event.preventDefault();
        const input = $("liveChatInput");
        const body = input.value.trim();
        const streamId = viewerStreamId || hostStreamId;
        if (!streamId || !body || !isSignedIn()) return;
        const button = $("liveChatForm").querySelector("button");
        button.disabled = true;
        try {
            await window.supabaseRequest("/rest/v1/live_stream_comments", {
                method: "POST",
                headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
                body: JSON.stringify({ stream_id: streamId, user_id: session.user.id, body: body.slice(0, 500) })
            });
            input.value = "";
            await loadChat();
        } catch (error) {
            setStatus(error.message || "Could not send your chat message.");
        } finally { button.disabled = !isSignedIn(); }
    }

    async function loadLiveStreams() {
        try {
            const streams = await window.supabaseRequest("/rest/v1/live_streams?select=id,host_id,title,created_at&status=eq.live&order=created_at.desc&limit=50");
            const hostIds = [...new Set((streams || []).map(stream => stream.host_id))];
            const profiles = hostIds.length
                ? await window.supabaseRequest(`/rest/v1/profiles?select=id,channel_name&id=in.(${hostIds.map(encodeURIComponent).join(",")})`)
                : [];
            const names = new Map(profiles.map(profile => [profile.id, profile.channel_name]));
            streamList.replaceChildren();
            (streams || []).forEach(stream => {
                const card = document.createElement("article");
                card.className = "live-stream-card";
                const live = document.createElement("span");
                live.className = "live-kicker";
                live.textContent = "LIVE NOW";
                const title = document.createElement("h3");
                title.textContent = stream.title;
                const hostName = names.get(stream.host_id) || "WamsTube channel";
                const host = document.createElement("p");
                host.textContent = `Hosted by ${hostName}`;
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = stream.host_id === session?.user?.id ? "Your live stream" : "Watch live";
                button.disabled = stream.host_id === session?.user?.id;
                button.addEventListener("click", () => joinLive({ ...stream, channel_name: hostName }));
                card.append(live, title, host, button);
                streamList.appendChild(card);
            });
            emptyState.hidden = Boolean(streams?.length);
        } catch (error) {
            setStatus(`${error.message || "Could not load live streams."} Apply live-stream.sql in Supabase to enable live streaming.`);
        }
    }

    $("startLiveButton").addEventListener("click", startHost);
    $("leaveLiveButton").addEventListener("click", () => hostStreamId ? stopHost() : leaveViewer());
    $("liveChatForm").addEventListener("submit", sendChat);
    loadLiveStreams();
    listTimer = window.setInterval(loadLiveStreams, 5000);
    window.addEventListener("beforeunload", () => {
        hostMedia?.getTracks().forEach(track => track.stop());
        viewerPeer?.close();
        hostPeers.forEach(peer => peer.close());
    });
})();
