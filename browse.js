"use strict";

(() => {
    const page = document.body.dataset.browsePage;
    const grid = document.getElementById("browseVideoGrid");
    const empty = document.getElementById("browseEmpty");
    const status = document.getElementById("browseStatus");
    const HISTORY_KEY = "wamsTubeWatchHistory";
    const LATER_KEY = "wamsTubeWatchLater";
    const PLAYLIST_KEY = "wamsTubePlaylists";
    const WATCH_LATER_FOLDERS_KEY = "wamsTubeWatchLaterFolders";
    let availableVideos = [];
    let plusActive = false;

    async function hasActivePlus() {
        const user = session();
        if (!user?.access_token || !user.user?.id) return false;
        try {
            const profiles = await api(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.user.id)}&select=plus_plan,plus_expires_at`);
            const profile = profiles?.[0];
            const active = profile?.plus_plan === "lifetime" || Boolean(profile?.plus_expires_at && new Date(profile.plus_expires_at) > new Date());
            return active && ["day", "week", "month", "year", "lifetime"].includes(profile.plus_plan);
        } catch (error) {
            console.warn("Could not check Plus access for watch-later tools.", error);
            return false;
        }
    }

    function watchLaterFolders() {
        return [...new Set(["Unsorted", ...readList(WATCH_LATER_FOLDERS_KEY).filter(name => typeof name === "string" && name.trim()).map(name => name.trim())])];
    }

    function refreshWatchLaterFolderOptions() {
        const select = document.getElementById("watchLaterFolderFilter");
        if (!select) return;
        const selected = select.value || "all";
        select.replaceChildren(new Option("All folders", "all"));
        watchLaterFolders().forEach(folder => select.add(new Option(folder, folder)));
        select.value = [...select.options].some(option => option.value === selected) ? selected : "all";
    }

    function setupWatchLaterPlusTools() {
        if (page !== "watch-later" || !plusActive) return;
        const tools = document.getElementById("watchLaterPlusTools");
        const create = document.getElementById("watchLaterCreateFolder");
        const filter = document.getElementById("watchLaterFolderFilter");
        const sort = document.getElementById("watchLaterSort");
        if (tools) tools.hidden = false;
        refreshWatchLaterFolderOptions();
        if (tools?.dataset.bound === "true") return;
        if (tools) tools.dataset.bound = "true";
        create?.addEventListener("click", () => {
            const name = window.prompt("Name your watch-later folder:");
            if (name === null) return;
            const folder = name.trim().slice(0, 40);
            if (!folder) return;
            const folders = watchLaterFolders();
            if (!folders.some(item => item.toLocaleLowerCase() === folder.toLocaleLowerCase())) folders.push(folder);
            writeList(WATCH_LATER_FOLDERS_KEY, folders.filter(item => item !== "Unsorted"));
            refreshWatchLaterFolderOptions();
            filter.value = folder;
            render();
        });
        filter?.addEventListener("change", render);
        sort?.addEventListener("change", render);
    }

    function moveWatchLaterVideo(video) {
        const entries = readList(LATER_KEY);
        const entry = entries.find(item => item.id === video.id);
        if (!entry) return;
        const folderNames = watchLaterFolders();
        const requested = window.prompt(`Move to a folder (${folderNames.join(", ")}). You can type a new folder name:`, entry.folder || "Unsorted");
        if (requested === null) return;
        const folder = requested.trim().slice(0, 40);
        if (!folder) return;
        if (!folderNames.some(item => item.toLocaleLowerCase() === folder.toLocaleLowerCase())) {
            writeList(WATCH_LATER_FOLDERS_KEY, [...readList(WATCH_LATER_FOLDERS_KEY), folder]);
        }
        entry.folder = folder;
        writeList(LATER_KEY, entries);
        refreshWatchLaterFolderOptions();
        render();
    }

    const readList = key => {
        try {
            const value = JSON.parse(localStorage.getItem(key) || "[]");
            return Array.isArray(value) ? value : [];
        } catch {
            return [];
        }
    };
    const writeList = (key, value) => {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            if (status) status.textContent = "Saved on this device.";
        } catch {
            if (status) status.textContent = "Could not save this item in browser storage.";
        }
    };
    const session = () => window.currentSession?.();
    const api = (path, options) => window.supabaseRequest(path, options);

    function showEmpty(message) {
        if (empty) {
            empty.hidden = false;
            empty.querySelector(".empty-channel-title").textContent = message;
        }
        if (grid) grid.replaceChildren();
    }

    function videoCard(video, channel, mediaUrl, verified) {
        const card = window.createVideoCard(video, channel, mediaUrl, verified);
        const actions = card.querySelector(".browse-card-actions");

        if (page === "watch-later" && plusActive) {
            const organize = document.createElement("button");
            organize.type = "button";
            organize.textContent = "Organize";
            organize.addEventListener("click", event => {
                event.stopPropagation();
                moveWatchLaterVideo(video);
            });
            actions.appendChild(organize);
        }
        if (page === "playlists") {
            const add = document.createElement("button");
            add.type = "button";
            add.textContent = "Add to playlist";
            add.addEventListener("click", event => {
                event.stopPropagation();
                const playlists = readList(PLAYLIST_KEY);
                if (!playlists.length) {
                    if (status) status.textContent = "Create a playlist above first.";
                    return;
                }
                const picker = document.getElementById("playlistPicker");
                const playlist = playlists.find(item => item.id === picker?.value) || playlists[0];
                const limit = plusActive ? 500 : 20;
                if (!playlist.videoIds.includes(video.id) && playlist.videoIds.length >= limit) {
                    if (status) status.textContent = plusActive
                        ? "This playlist has reached its 500-video limit."
                        : "Standard playlists hold up to 20 videos. Plus unlocks playlists with up to 500 videos.";
                    return;
                }
                if (!playlist.videoIds.includes(video.id)) playlist.videoIds.push(video.id);
                writeList(PLAYLIST_KEY, playlists);
                if (status) status.textContent = `Added to “${playlist.title}”.`;
            });
            actions.appendChild(add);
        }
        card.appendChild(actions);
        return card;
    }

    function filterVideos(videos) {
        const keywordGroups = {
            music: /\b(music|song|songs|album|concert|piano|guitar|sing)\b/i,
            movies: /\b(movie|film|trailer|cinema|short film)\b/i,
            live: /\b(live|stream|streaming)\b/i,
            gaming: /\b(game|gaming|gameplay|gamer|minecraft|roblox|fortnite)\b/i
        };
        if (page === "shorts") return videos.filter(video => video.is_short);
        if (keywordGroups[page]) return videos.filter(video => keywordGroups[page].test(`${video.title} ${video.description || ""}`));
        return videos;
    }

    let shortsObserver;
    let activeShortVideoId = null;

    function currentShortIndex() {
        if (!grid) return -1;
        const cards = [...grid.querySelectorAll(".shorts-card")];
        if (!cards.length) return -1;
        const feedCenter = grid.getBoundingClientRect().top + grid.clientHeight / 2;
        return cards.reduce((closestIndex, card, index) => {
            const rect = card.getBoundingClientRect();
            const distance = Math.abs(rect.top + rect.height / 2 - feedCenter);
            const closest = cards[closestIndex].getBoundingClientRect();
            return distance < Math.abs(closest.top + closest.height / 2 - feedCenter) ? index : closestIndex;
        }, 0);
    }

    function updateShortsNavigation() {
        const previous = document.getElementById("shortsPreviousButton");
        const next = document.getElementById("shortsNextButton");
        const cards = grid ? grid.querySelectorAll(".shorts-card") : [];
        const index = currentShortIndex();
        if (previous) previous.disabled = index <= 0;
        if (next) next.disabled = index < 0 || index >= cards.length - 1;
    }

    function scrollToShort(offset) {
        if (!grid) return;
        const cards = [...grid.querySelectorAll(".shorts-card")];
        const nextIndex = currentShortIndex() + offset;
        if (nextIndex < 0 || nextIndex >= cards.length) return;
        const feedTop = grid.getBoundingClientRect().top;
        const cardTop = cards[nextIndex].getBoundingClientRect().top;
        grid.scrollTo({ top: grid.scrollTop + cardTop - feedTop, behavior: "smooth" });
    }

    let followedChannels = new Set();
    let currentUserId = null;

    function createShortsCard(video, mediaUrl) {
        const card = document.createElement("article");
        card.className = "shorts-card";
        card.dataset.videoId = video.id;

        let media;
        if ((video.media_type || "").startsWith("image/")) {
            media = document.createElement("img");
            media.alt = video.title;
        } else {
            media = document.createElement("video");
            media.autoplay = true;
            media.loop = true;
            media.muted = true;
            media.playsInline = true;
            media.preload = "metadata";
            media.addEventListener("click", () => {
                if (media.paused) media.play().catch(() => {});
                else media.pause();
                card.classList.toggle("is-paused", media.paused);
            });
            media.addEventListener("play", () => card.classList.remove("is-paused"));
            media.addEventListener("pause", () => card.classList.add("is-paused"));
        }
        media.className = "shorts-card-media";
        media.src = mediaUrl;

        const gradient = document.createElement("div");
        gradient.className = "shorts-card-gradient";
        const info = document.createElement("div");
        info.className = "shorts-card-info";
        const title = document.createElement("h2");
        title.className = "shorts-card-title";
        title.textContent = video.title;
        const channelRow = document.createElement("div");
        channelRow.className = "shorts-card-channel-row";
        const channel = document.createElement("a");
        channel.className = "shorts-card-channel";
        channel.href = `channel.html?channel=${encodeURIComponent(video.owner_id)}`;
        const avatar = document.createElement("span");
        avatar.className = "shorts-card-avatar";
        avatar.textContent = (video.channelName || "W").trim().charAt(0).toUpperCase() || "W";
        const channelName = document.createElement("span");
        channelName.textContent = video.channelName || "WamsTube channel";
        channel.append(avatar, channelName);
        const subscribe = document.createElement("button");
        subscribe.type = "button";
        subscribe.className = "shorts-subscribe-button";
        subscribe.textContent = followedChannels.has(video.owner_id) ? "Subscribed" : "Subscribe";
        subscribe.setAttribute("aria-pressed", String(followedChannels.has(video.owner_id)));
        subscribe.hidden = currentUserId === video.owner_id;
        subscribe.addEventListener("click", async event => {
            event.preventDefault();
            event.stopPropagation();
            const user = session();
            if (!user?.user?.id) {
                window.location.href = "login.html";
                return;
            }
            subscribe.disabled = true;
            const isFollowing = subscribe.getAttribute("aria-pressed") === "true";
            try {
                if (isFollowing) {
                    await api(`/rest/v1/channel_follows?channel_id=eq.${encodeURIComponent(video.owner_id)}&follower_id=eq.${encodeURIComponent(user.user.id)}`, { method: "DELETE" });
                    followedChannels.delete(video.owner_id);
                } else {
                    await api("/rest/v1/channel_follows", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ channel_id: video.owner_id, follower_id: user.user.id })
                    });
                    followedChannels.add(video.owner_id);
                }
                const nowFollowing = !isFollowing;
                subscribe.textContent = nowFollowing ? "Subscribed" : "Subscribe";
                subscribe.setAttribute("aria-pressed", String(nowFollowing));
            } catch (error) {
                if (status) status.textContent = error.message || "Could not update your subscription.";
            } finally {
                subscribe.disabled = false;
            }
        });
        channelRow.append(channel, subscribe);
        info.append(title, channelRow);

        const actions = document.createElement("div");
        actions.className = "shorts-card-actions";
        const makeAction = (iconText, label, className) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `shorts-action ${className || ""}`;
            button.setAttribute("aria-label", label);
            const icon = document.createElement("span");
            icon.className = "shorts-action-icon material-symbols-rounded";
            icon.textContent = iconText;
            const count = document.createElement("span");
            count.className = "shorts-action-count";
            count.textContent = "0";
            button.append(icon, count);
            button.addEventListener("click", event => event.stopPropagation());
            return { button, count };
        };
        const like = makeAction("thumb_up", "Like", "shorts-like-button");
        like.button.setAttribute("aria-pressed", "false");
        const comments = makeAction("mode_comment", "Comments", "shorts-comments-button");
        const share = makeAction("share", "Share", "shorts-share-button");
        actions.append(like.button, comments.button, share.button);
        const playIndicator = document.createElement("div");
        playIndicator.className = "shorts-play-indicator";
        playIndicator.textContent = "▶";

        card.append(media, gradient, info, actions, playIndicator);

        like.button.addEventListener("click", async () => {
            const user = session();
            if (!user?.user?.id) {
                window.location.href = "login.html";
                return;
            }
            like.button.disabled = true;
            const wasLiked = like.button.getAttribute("aria-pressed") === "true";
            try {
                if (wasLiked) {
                    await api(`/rest/v1/video_likes?video_id=eq.${encodeURIComponent(video.id)}&user_id=eq.${encodeURIComponent(user.user.id)}`, { method: "DELETE" });
                    like.count.textContent = String(Math.max(0, Number(like.count.textContent) - 1));
                } else {
                    await api("/rest/v1/video_likes", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ video_id: video.id, user_id: user.user.id })
                    });
                    like.count.textContent = String(Number(like.count.textContent) + 1);
                }
                like.button.setAttribute("aria-pressed", String(!wasLiked));
            } catch (error) {
                if (status) status.textContent = error.message || "Could not update your like.";
            } finally {
                like.button.disabled = false;
            }
        });

        comments.button.addEventListener("click", () => openShortsComments(video));
        share.button.addEventListener("click", async () => {
            const url = new URL("watch.html", window.location.href);
            url.searchParams.set("videoId", video.id);
            url.searchParams.set("title", video.title);
            url.searchParams.set("channel", video.channelName || "WamsTube channel");
            try {
                if (navigator.share) await navigator.share({ title: video.title, url: url.toString() });
                else if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(url.toString());
                    if (status) status.textContent = "Short link copied.";
                }
            } catch (error) {
                if (error.name !== "AbortError" && status) status.textContent = "Could not share this Short.";
            }
        });

        if (shortsObserver) shortsObserver.observe(card);
        loadShortEngagement(video, like, comments).catch(error => console.warn("Could not load Shorts engagement.", error));
        return card;
    }

    async function loadShortEngagement(video, like, comments) {
        const userId = session()?.user?.id;
        const [likes, commentRows] = await Promise.all([
            api(`/rest/v1/video_likes?video_id=eq.${encodeURIComponent(video.id)}&select=user_id&limit=1000`),
            api(`/rest/v1/video_comments?video_id=eq.${encodeURIComponent(video.id)}&select=id&limit=1000`)
        ]);
        like.count.textContent = String(likes.length);
        comments.count.textContent = String(commentRows.length);
        if (userId) like.button.setAttribute("aria-pressed", String(likes.some(row => row.user_id === userId)));
    }

    async function openShortsComments(video) {
        activeShortVideoId = video.id;
        const panel = document.getElementById("shortsCommentPanel");
        const backdrop = document.getElementById("shortsCommentBackdrop");
        const list = document.getElementById("shortsCommentList");
        const count = document.getElementById("shortsCommentCount");
        const form = document.getElementById("shortsCommentForm");
        const auth = document.getElementById("shortsCommentAuth");
        const userId = session()?.user?.id;
        panel?.classList.add("is-open");
        panel?.setAttribute("aria-hidden", "false");
        backdrop?.classList.add("is-open");
        if (form) form.hidden = !userId;
        if (auth) auth.hidden = Boolean(userId);
        if (list) list.textContent = "Loading comments…";
        try {
            const [comments, likes] = await Promise.all([
                api(`/rest/v1/video_comments?video_id=eq.${encodeURIComponent(video.id)}&select=id,user_id,body,created_at&order=created_at.desc&limit=100`),
                api(`/rest/v1/video_comments?video_id=eq.${encodeURIComponent(video.id)}&select=id&limit=1000`)
            ]);
            if (activeShortVideoId !== video.id) return;
            if (count) count.textContent = String(likes.length);
            list.replaceChildren();
            if (!comments.length) {
                list.textContent = "Be the first to comment.";
                return;
            }
            const ids = [...new Set(comments.map(comment => comment.user_id))];
            const profiles = ids.length ? await api(`/rest/v1/profiles?select=id,channel_name&id=in.${encodeURIComponent(`(${ids.join(",")})`)}`) : [];
            const names = new Map(profiles.map(profile => [profile.id, profile.channel_name]));
            comments.forEach(comment => {
                const row = document.createElement("article");
                row.className = "shorts-comment";
                const avatar = document.createElement("div");
                avatar.className = "shorts-comment-avatar";
                const name = names.get(comment.user_id) || "WamsTube user";
                avatar.textContent = name.trim().charAt(0).toUpperCase() || "W";
                const body = document.createElement("div");
                body.className = "shorts-comment-body";
                const meta = document.createElement("div");
                meta.className = "shorts-comment-meta";
                const author = document.createElement("strong");
                author.textContent = name;
                const time = document.createElement("time");
                time.dateTime = comment.created_at;
                time.textContent = new Date(comment.created_at).toLocaleDateString();
                meta.append(author, time);
                const text = document.createElement("p");
                text.textContent = comment.body;
                body.append(meta, text);
                row.append(avatar, body);
                list.appendChild(row);
            });
        } catch (error) {
            if (list) list.textContent = error.message || "Could not load comments.";
        }
    }

    function setupShortsControls() {
        const close = () => {
            document.getElementById("shortsCommentPanel")?.classList.remove("is-open");
            document.getElementById("shortsCommentPanel")?.setAttribute("aria-hidden", "true");
            document.getElementById("shortsCommentBackdrop")?.classList.remove("is-open");
            activeShortVideoId = null;
        };
        document.getElementById("shortsCommentClose")?.addEventListener("click", close);
        document.getElementById("shortsCommentBackdrop")?.addEventListener("click", close);
        document.getElementById("shortsPreviousButton")?.addEventListener("click", () => scrollToShort(-1));
        document.getElementById("shortsNextButton")?.addEventListener("click", () => scrollToShort(1));
        grid?.addEventListener("scroll", () => {
            window.requestAnimationFrame(updateShortsNavigation);
        }, { passive: true });
        const mute = document.getElementById("shortsMuteButton");
        const muteIcon = document.getElementById("shortsMuteIcon");
        mute?.addEventListener("click", () => {
            const muted = mute.getAttribute("aria-pressed") !== "true";
            mute.setAttribute("aria-pressed", String(muted));
            if (muteIcon) muteIcon.textContent = muted ? "volume_off" : "volume_up";
            mute.setAttribute("aria-label", muted ? "Unmute videos" : "Mute videos");
            document.querySelectorAll(".shorts-card video").forEach(player => { player.muted = muted; });
        });
        const form = document.getElementById("shortsCommentForm");
        form?.addEventListener("submit", async event => {
            event.preventDefault();
            const user = session();
            const input = document.getElementById("shortsCommentInput");
            const submit = document.getElementById("shortsCommentSubmit");
            const body = input?.value.trim();
            if (!user?.user?.id || !activeShortVideoId || !body) return;
            submit.disabled = true;
            try {
                await api("/rest/v1/video_comments", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ video_id: activeShortVideoId, user_id: user.user.id, body })
                });
                input.value = "";
                const video = availableVideos.find(item => item.id === activeShortVideoId);
                if (video) await openShortsComments(video);
            } catch (error) {
                if (status) status.textContent = error.message || "Could not post your comment.";
            } finally {
                submit.disabled = false;
            }
        });
    }

    async function renderShorts(videos) {
        if (!grid) return;
        const user = session();
        currentUserId = user?.user?.id || null;
        followedChannels = new Set();
        if (currentUserId) {
            try {
                const follows = await api(`/rest/v1/channel_follows?follower_id=eq.${encodeURIComponent(currentUserId)}&select=channel_id`);
                followedChannels = new Set(follows.map(row => row.channel_id));
            } catch (error) {
                console.warn("Could not load your subscriptions for Shorts.", error);
            }
        }
        if (!shortsObserver) {
            shortsObserver = new IntersectionObserver(entries => {
                entries.forEach(entry => {
                    const player = entry.target.querySelector("video");
                    if (!player) return;
                    if (entry.isIntersecting && entry.intersectionRatio >= 0.65) {
                        document.querySelectorAll(".shorts-card video").forEach(other => { if (other !== player) other.pause(); });
                        player.play().catch(() => {});
                    } else player.pause();
                });
                updateShortsNavigation();
            }, { root: grid, threshold: [0, 0.65, 1] });
            setupShortsControls();
        }
        const cards = await Promise.all(videos.map(async video => {
            try {
                const url = await window.signedMediaUrl(video.storage_path);
                return createShortsCard(video, url);
            } catch (error) {
                console.warn("Could not load a Short.", error);
                return null;
            }
        }));
        grid.replaceChildren(...cards.filter(Boolean));
        updateShortsNavigation();
        if (empty) empty.hidden = cards.some(Boolean);
        if (status) status.textContent = videos.length ? `${videos.length} Short${videos.length === 1 ? "" : "s"}` : "";
    }

    async function fetchVideos() {
        const limit = ["history", "watch-later"].includes(page) && plusActive ? 1000 : 100;
        const rows = await api(`/rest/v1/videos?select=id,owner_id,title,description,visibility,storage_path,media_type,is_short,is_deleted,created_at&visibility=eq.public&is_deleted=eq.false&order=created_at.desc&limit=${limit}`);
        const ids = [...new Set(rows.map(video => video.owner_id))];
        const profiles = ids.length
            ? await api(`/rest/v1/profiles?select=id,channel_name,admin_verified&id=in.(${ids.map(encodeURIComponent).join(",")})`)
            : [];
        const profileById = new Map(profiles.map(profile => [profile.id, profile]));
        return rows.map(video => ({ ...video, channelName: profileById.get(video.owner_id)?.channel_name || "WamsTube channel", verified: Boolean(profileById.get(video.owner_id)?.admin_verified) }));
    }

    async function selectPageVideos(allVideos) {
        if (page === "history") {
            const entries = readList(HISTORY_KEY);
            const byId = new Map(allVideos.map(video => [video.id, video]));
            return entries.map(entry => byId.get(entry.id)).filter(Boolean);
        }
        if (page === "watch-later") {
            let entries = readList(LATER_KEY);
            const selectedFolder = plusActive ? document.getElementById("watchLaterFolderFilter")?.value : "all";
            if (selectedFolder && selectedFolder !== "all") entries = entries.filter(entry => (entry.folder || "Unsorted") === selectedFolder);
            const byId = new Map(allVideos.map(video => [video.id, video]));
            return entries.map(entry => byId.get(entry.id)).filter(Boolean);
        }
        if (page === "subscriptions") {
            const user = session();
            if (!user?.user?.id) throw new Error("Sign in to see videos from your subscriptions.");
            const follows = await api(`/rest/v1/channel_follows?follower_id=eq.${encodeURIComponent(user.user.id)}&select=channel_id`);
            const ownerIds = follows.map(row => row.channel_id);
            return allVideos.filter(video => ownerIds.includes(video.owner_id));
        }
        if (page === "liked-videos") {
            const user = session();
            if (!user?.user?.id) throw new Error("Sign in to see your liked videos.");
            const likes = await api(`/rest/v1/video_likes?user_id=eq.${encodeURIComponent(user.user.id)}&select=video_id&limit=500`);
            const likedIds = new Set(likes.map(row => row.video_id));
            return allVideos.filter(video => likedIds.has(video.id));
        }
        let videos = filterVideos(allVideos);
        if (page === "trending") {
            try {
                const likes = await api("/rest/v1/video_likes?select=video_id&limit=2000");
                const counts = new Map();
                likes.forEach(row => counts.set(row.video_id, (counts.get(row.video_id) || 0) + 1));
                videos = [...videos].sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0) || new Date(b.created_at) - new Date(a.created_at));
            } catch (error) {
                console.warn("Could not rank trending videos by likes; showing newest first.", error);
            }
        }
        return videos;
    }

    function setupPlaylistTools() {
        if (page !== "playlists") return;
        const form = document.getElementById("playlistCreateForm");
        const input = document.getElementById("playlistName");
        const picker = document.getElementById("playlistPicker");
        const list = document.getElementById("playlistList");
        const refresh = () => {
            const playlists = readList(PLAYLIST_KEY);
            picker.replaceChildren();
            list.replaceChildren();
            playlists.forEach(playlist => {
                const option = document.createElement("option");
                option.value = playlist.id;
                option.textContent = playlist.title;
                picker.appendChild(option);
                const row = document.createElement("article");
                row.className = "browse-playlist-row";
                const label = document.createElement("strong");
                label.textContent = playlist.title;
                const count = document.createElement("span");
                count.textContent = `${playlist.videoIds.length} videos`;
                const remove = document.createElement("button");
                remove.type = "button";
                remove.textContent = "Delete";
                remove.addEventListener("click", () => {
                    writeList(PLAYLIST_KEY, readList(PLAYLIST_KEY).filter(item => item.id !== playlist.id));
                    refresh();
                });
                const savedVideoLinks = document.createElement("div");
                savedVideoLinks.className = "browse-playlist-video-links";
                playlist.videoIds.forEach(videoId => {
                    const savedVideo = availableVideos.find(video => video.id === videoId);
                    if (!savedVideo) return;
                    const link = document.createElement("a");
                    const params = new URLSearchParams({ videoId: savedVideo.id, title: savedVideo.title, channel: savedVideo.channelName || "WamsTube channel" });
                    link.href = `watch.html?${params.toString()}`;
                    link.textContent = savedVideo.title;
                    savedVideoLinks.appendChild(link);
                });
                row.append(label, count, remove, savedVideoLinks);
                list.appendChild(row);
            });
        };
        if (form.dataset.bound === "true") {
            refresh();
            return;
        }
        form.dataset.bound = "true";
        form.addEventListener("submit", event => {
            event.preventDefault();
            const title = input.value.trim();
            if (!title) return;
            const playlists = readList(PLAYLIST_KEY);
            playlists.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, title: title.slice(0, 60), videoIds: [] });
            writeList(PLAYLIST_KEY, playlists);
            input.value = "";
            refresh();
        });
        refresh();
    }

    async function render() {
        if (!grid) return;
        if (["watch-later", "history", "playlists"].includes(page)) plusActive = await hasActivePlus();
        if (page === "watch-later") setupWatchLaterPlusTools();
        setupPlaylistTools();
        if (["history", "watch-later", "playlists"].includes(page)) {
            const clearButton = document.getElementById("clearCollection");
            if (clearButton && clearButton.dataset.bound !== "true") {
                clearButton.dataset.bound = "true";
                clearButton.addEventListener("click", () => {
                    const key = page === "history" ? HISTORY_KEY : page === "watch-later" ? LATER_KEY : PLAYLIST_KEY;
                    if (page === "playlists" && !window.confirm("Delete all playlists stored on this device?")) return;
                    writeList(key, []);
                    render();
                });
            }
        }
        if (status) status.textContent = "Loading videos…";
        try {
            const allVideos = await fetchVideos();
            availableVideos = allVideos;
            if (page === "playlists") setupPlaylistTools();
            let videos = await selectPageVideos(allVideos);
            if (page === "history") {
                const order = new Map(readList(HISTORY_KEY).map((item, index) => [item.id, index]));
                videos.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
            } else if (page === "watch-later") {
                const entries = readList(LATER_KEY);
                const order = new Map(entries.map((item, index) => [item.id, index]));
                const sortMode = plusActive ? document.getElementById("watchLaterSort")?.value : "saved";
                if (sortMode === "title") videos.sort((a, b) => a.title.localeCompare(b.title));
                else if (sortMode === "channel") videos.sort((a, b) => (a.channelName || "").localeCompare(b.channelName || ""));
                else if (sortMode === "oldest") videos.sort((a, b) => (order.get(b.id) ?? -1) - (order.get(a.id) ?? -1));
                else videos.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
            }
            if (page === "playlists" && !readList(PLAYLIST_KEY).length) {
                if (empty) empty.querySelector(".empty-channel-title").textContent = "Create a playlist to get started";
            }
            if (page === "shorts") {
                await renderShorts(videos);
                return;
            }
            const cards = await Promise.all(videos.map(async video => {
                try {
                    const url = await window.signedMediaUrl(video.storage_path);
                    return videoCard(video, video.channelName, url, video.verified);
                } catch (error) {
                    console.warn("Could not load a browse video.", error);
                    return null;
                }
            }));
            grid.replaceChildren(...cards.filter(Boolean));
            if (empty) empty.hidden = cards.some(Boolean);
            if (status) status.textContent = videos.length ? `${videos.length} video${videos.length === 1 ? "" : "s"}` : "";
        } catch (error) {
            showEmpty(error.message || "Could not load this collection.");
            if (status) status.textContent = "";
        }
    }

    document.addEventListener("DOMContentLoaded", render);
})();
