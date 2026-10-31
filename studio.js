"use strict";

(() => {
    const apiUrl = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
    const apiKey = window.WAMS_SUPABASE_ANON_KEY || "";
    const bucket = "wams-media";
    const $ = id => document.getElementById(id);
    const status = $("studioAccessStatus");
    const session = (() => {
        try {
            const value = JSON.parse(localStorage.getItem("wamsTubeSession") || "null");
            if (!value?.access_token || !value.user?.id) return null;
            const payload = JSON.parse(atob(value.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
            return payload.exp && payload.exp * 1000 <= Date.now() ? null : value;
        } catch { return null; }
    })();
    let videos = [];
    let previewUrl = "";
    let captionPath = null;
    let uploadMaxBytes = 100 * 1024 * 1024;

    async function request(path, options = {}) {
        if (!apiUrl || !apiKey) throw new Error("Supabase is not configured.");
        const response = await fetch(`${apiUrl}${path}`, {
            ...options,
            headers: {
                apikey: apiKey,
                ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
                ...(options.headers || {})
            }
        });
        if (!response.ok) {
            const text = await response.text();
            let message = text;
            try { const data = JSON.parse(text); message = data.message || data.msg || data.details || text; } catch {}
            throw new Error(message || `Request failed (${response.status}).`);
        }
        if (response.status === 204) return null;
        const text = await response.text();
        return text ? JSON.parse(text) : null;
    }

    function storagePath(ownerId, filename) {
        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "upload";
        const unique = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        return `${ownerId}/${unique}-${safeName}`;
    }

    function encodedPath(path) {
        return path.split("/").map(encodeURIComponent).join("/");
    }

    async function uploadObject(path, file, type) {
        return request(`/storage/v1/object/${bucket}/${encodedPath(path)}`, {
            method: "POST",
            headers: { "Content-Type": type || "application/octet-stream", "x-upsert": "false" },
            body: file
        });
    }

    async function signedUrl(path) {
        const result = await request(`/storage/v1/object/sign/${bucket}/${encodedPath(path)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ expiresIn: 3600 })
        });
        const url = result.signedURL || result.signedUrl;
        if (!url) throw new Error("Supabase did not return a signed media URL.");
        if (url.startsWith("http")) return url;
        const relative = url.startsWith("/") ? url : `/${url}`;
        return `${apiUrl}${relative.startsWith("/storage/v1/") ? "" : "/storage/v1"}${relative}`;
    }

    async function removeObject(path) {
        if (path) await request(`/storage/v1/object/${bucket}/${encodedPath(path)}`, { method: "DELETE" });
    }

    function setStatus(message, isError = false) {
        const formStatus = $("studioFormStatus");
        if (formStatus) {
            formStatus.textContent = message;
            formStatus.classList.toggle("is-error", isError);
        }
    }

    function formatDuration(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return "—";
        const total = Math.floor(seconds);
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const remainder = total % 60;
        return hours
            ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
            : `${minutes}:${String(remainder).padStart(2, "0")}`;
    }

    function updateDuration() {
        const preview = $("studioPreview");
        const output = $("studioDuration");
        if (!preview || !output || !Number.isFinite(preview.duration)) return;
        const start = Math.max(0, Number($("studioTrimStart").value) || 0);
        const endValue = $("studioTrimEnd").value.trim();
        const end = endValue ? Math.min(preview.duration, Number(endValue)) : preview.duration;
        const selected = Math.max(0, end - Math.min(start, end));
        output.textContent = `Video duration: ${formatDuration(preview.duration)} · selected playback: ${formatDuration(selected)}`;
    }

    function clearPreview() {
        const imagePreview = $("studioImagePreview");
        if (imagePreview) {
            imagePreview.removeAttribute("src");
            imagePreview.hidden = true;
        }
        const preview = $("studioPreview");
        if (preview) {
            preview.pause();
            preview.removeAttribute("src");
            preview.replaceChildren();
            preview.hidden = true;
            preview.load();
        }
        const duration = $("studioDuration");
        if (duration) duration.textContent = "Select a video to see its duration.";
        if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
        previewUrl = "";
    }

    function setPreview(url, start = 0, end = "", isImage = false) {
        const preview = $("studioPreview");
        if (!preview || !url) return;
        clearPreview();
        previewUrl = url;
        if (isImage) {
            $("studioImagePreview").src = url;
            $("studioImagePreview").hidden = false;
            const duration = $("studioDuration");
            if (duration) duration.textContent = "Still image · no video duration.";
            return;
        }
        preview.src = url;
        preview.hidden = false;
        preview.onloadedmetadata = () => {
            const startInput = $("studioTrimStart");
            const endInput = $("studioTrimEnd");
            startInput.max = String(preview.duration);
            endInput.max = String(preview.duration);
            if (Number.isFinite(Number(start))) startInput.value = String(start || 0);
            endInput.value = end ?? "";
            updateDuration();
            const startAt = Math.min(Number(startInput.value) || 0, Math.max(0, preview.duration - 0.05));
            if (startAt > 0) preview.currentTime = startAt;
        };
        let previewTrimReached = false;
        preview.onplay = () => {
            const startAt = Number($("studioTrimStart").value) || 0;
            const endAt = Number($("studioTrimEnd").value);
            if (previewTrimReached || ($("studioTrimEnd").value && preview.currentTime >= endAt)) {
                previewTrimReached = false;
                preview.currentTime = startAt;
            } else if (preview.currentTime < startAt) {
                preview.currentTime = startAt;
            }
        };
        preview.onseeking = () => {
            const endAt = Number($("studioTrimEnd").value);
            if ($("studioTrimEnd").value && preview.currentTime < endAt - 0.1) previewTrimReached = false;
        };
        preview.ontimeupdate = () => {
            const endAt = Number($("studioTrimEnd").value);
            if (!previewTrimReached && $("studioTrimEnd").value && Number.isFinite(endAt) && preview.currentTime >= endAt) {
                previewTrimReached = true;
                preview.pause();
                preview.currentTime = endAt;
            }
        };
    }

    function validCaptions(text) {
        if (!text.trim()) return true;
        if (!/^WEBVTT(?:\s|$)/.test(text.trimStart())) return false;
        const cues = text.split(/\r?\n/).filter(line => line.includes("-->"));
        const time = /^(\d{2,}:)?\d{2}:\d{2}\.\d{3}\s+-->\s+(\d{2,}:)?\d{2}:\d{2}\.\d{3}(?:\s+.*)?$/;
        return cues.length > 0 && cues.every(line => time.test(line.trim()));
    }

    async function countRows(table, column, value) {
        const params = new URLSearchParams({ select: column, [column]: `eq.${value}` });
        const response = await fetch(`${apiUrl}/rest/v1/${table}?${params}`, {
            headers: {
                apikey: apiKey,
                Authorization: `Bearer ${session.access_token}`,
                Prefer: "count=exact",
                Range: "0-0"
            }
        });
        if (!response.ok) throw new Error(`Could not load ${table} analytics.`);
        const total = (response.headers.get("Content-Range") || "").split("/")[1];
        return total && total !== "*" ? Number(total) : 0;
    }

    function metricCard(video, counts) {
        const row = document.createElement("article");
        row.className = "studio-video-metric";
        const copy = document.createElement("div");
        copy.className = "studio-video-metric-copy";
        const title = document.createElement("strong");
        title.textContent = video.title;
        const meta = document.createElement("span");
        meta.textContent = `${video.is_short ? "Short · " : ""}${video.visibility === "subscribers" ? "Subscribers only" : video.visibility} · ${new Date(video.created_at).toLocaleDateString()}`;
        copy.append(title, meta);
        const stats = document.createElement("div");
        stats.className = "studio-video-stat-pills";
        [["Views", counts.views], ["Likes", counts.likes], ["Comments", counts.comments]].forEach(([label, count]) => {
            const pill = document.createElement("span");
            pill.textContent = `${Number(count).toLocaleString()} ${label}`;
            stats.appendChild(pill);
        });
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "studio-secondary-button";
        edit.textContent = "Edit";
        edit.addEventListener("click", () => {
            $("studioExistingVideo").value = video.id;
            $("studioExistingVideo").dispatchEvent(new Event("change"));
            $("editorTitle").scrollIntoView({ behavior: "smooth", block: "start" });
        });
        row.append(copy, stats, edit);
        return row;
    }

    async function loadVideos() {
        const params = new URLSearchParams({
            select: "id,owner_id,title,description,visibility,storage_path,media_type,caption_path,trim_start_seconds,trim_end_seconds,is_short,created_at,is_deleted",
            owner_id: `eq.${session.user.id}`,
            is_deleted: "eq.false",
            order: "created_at.desc",
            limit: "100"
        });
        videos = await request(`/rest/v1/videos?${params}`);
        const picker = $("studioExistingVideo");
        picker.replaceChildren(new Option("Create a new video", ""));
        videos.forEach(video => picker.add(new Option(video.title, video.id)));

        const resultList = $("studioAnalyticsList");
        resultList.replaceChildren();
        if ($("studioAnalytics").hidden) return;
        let totalViews = 0;
        let totalLikes = 0;
        let totalComments = 0;
        for (const video of videos) {
            const [views, likes, comments] = await Promise.all([
                countRows("video_views", "video_id", video.id),
                countRows("video_likes", "video_id", video.id),
                countRows("video_comments", "video_id", video.id)
            ]);
            totalViews += views;
            totalLikes += likes;
            totalComments += comments;
            resultList.appendChild(metricCard(video, { views, likes, comments }));
        }
        $("studioTotalViews").textContent = totalViews.toLocaleString();
        $("studioTotalLikes").textContent = totalLikes.toLocaleString();
        $("studioTotalComments").textContent = totalComments.toLocaleString();
        if (!videos.length) {
            const empty = document.createElement("p");
            empty.className = "studio-empty";
            empty.textContent = "Your channel has no published videos yet.";
            resultList.appendChild(empty);
        }
    }

    async function loadMembership() {
        if (!session) {
            status.textContent = "Sign in with an active WamsTube Plus account to use Studio. ";
            const link = document.createElement("a");
            link.href = "login.html";
            link.textContent = "Sign in";
            status.appendChild(link);
            status.classList.add("is-error");
            return false;
        }
        const profiles = await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=plus_expires_at,plus_plan,is_banned`);
        const profile = profiles[0];
        if (!profile || profile.is_banned) throw new Error("This account cannot use WamsTube Studio.");
        const plan = profile.plus_plan || "month";
        const levels = { day: 1, week: 2, month: 3, year: 4, lifetime: 5 };
        const level = levels[plan] || 0;
        const active = plan === "lifetime" || (profile.plus_expires_at && new Date(profile.plus_expires_at) > new Date());
        uploadMaxBytes = active ? 500 * 1024 * 1024 : 100 * 1024 * 1024;
        const sizeHelp = $("studioUploadSizeHelp");
        if (sizeHelp) sizeHelp.textContent = `Maximum file size: ${active ? "500 MB with WamsTube Plus" : "100 MB on a standard account"}.`;
        if (!active || level < 2) {
            status.textContent = "Studio editing is included with Week plans and above. Choose a qualifying Plus plan to unlock it.";
            const link = document.createElement("a");
            link.href = "plus.html";
            link.textContent = "View Plus plans";
            status.append(" ", link);
            return false;
        }
        $("studioAnalytics").hidden = level < 3;
        const subscriberOption = document.querySelector('#studioVisibility option[value="subscribers"]');
        if (subscriberOption && level < 3) {
            subscriberOption.disabled = true;
            subscriberOption.textContent = "Subscribers only (Month Plus and up)";
        }
        if (level < 3) {
            const analyticsLink = document.querySelector('.studio-nav-item[href="#studioAnalytics"]');
            if (analyticsLink) analyticsLink.hidden = true;
            status.textContent = "Week Plus is active. Studio editing is included; analytics are available with Month plans and above.";
        } else {
            status.textContent = plan === "lifetime"
                ? "Lifetime Plus active. All currently available Studio features are unlocked."
                : `${plan[0].toUpperCase()}${plan.slice(1)} Plus active until ${new Date(profile.plus_expires_at).toLocaleDateString()}.`;
        }
        status.classList.add("is-active");
        return true;
    }

    $("studioExistingVideo").addEventListener("change", async event => {
        const video = videos.find(item => item.id === event.target.value);
        $("studioVideoId").value = video?.id || "";
        $("studioPublish").textContent = video ? "Save video changes" : "Publish video";
        $("studioFile").value = "";
        $("studioTitle").value = video?.title || "";
        $("studioDescription").value = video?.description || "";
        $("studioVisibility").value = video?.visibility || "public";
        $("studioIsShort").checked = Boolean(video?.is_short);
        $("studioTrimStart").value = video?.trim_start_seconds || 0;
        $("studioTrimEnd").value = video?.trim_end_seconds ?? "";
        $("studioCaptions").value = "";
        captionPath = video?.caption_path || null;
        clearPreview();
        setStatus("");
        if (!video) return;
        const publishButton = $("studioPublish");
        publishButton.disabled = true;
        try {
            const [media, captions] = await Promise.all([
                signedUrl(video.storage_path),
                video.caption_path ? signedUrl(video.caption_path) : Promise.resolve(null)
            ]);
            setPreview(media, video.trim_start_seconds, video.trim_end_seconds, (video.media_type || "").startsWith("image/"));
            if (captions) {
                const response = await fetch(captions);
                if (!response.ok) throw new Error("Could not load the existing captions.");
                $("studioCaptions").value = await response.text();
            }
        } catch (error) {
            setStatus(error.message || "Could not load this video in the editor.", true);
        } finally {
            publishButton.disabled = false;
            publishButton.textContent = $("studioVideoId").value ? "Save video changes" : "Publish video";
        }
    });

    $("studioFile").addEventListener("change", () => {
        const file = $("studioFile").files?.[0];
        if (!file) return;
        clearPreview();
        setPreview(URL.createObjectURL(file), 0, "", file.type.startsWith("image/"));
    });

    $("studioCaptionFile").addEventListener("change", async () => {
        const file = $("studioCaptionFile").files?.[0];
        if (!file) return;
        if (file.size > 1024 * 1024) {
            setStatus("Caption files must be 1 MB or smaller.", true);
            $("studioCaptionFile").value = "";
            return;
        }
        $("studioCaptions").value = await file.text();
        setStatus(validCaptions($("studioCaptions").value) ? "Captions loaded. Review and save your changes." : "This does not look like a valid WebVTT file.", !validCaptions($("studioCaptions").value));
    });

    $("studioCaptions").addEventListener("input", () => {
        if (!$("studioCaptions").value.trim() || validCaptions($("studioCaptions").value)) setStatus("");
    });

    $("studioSetStart").addEventListener("click", () => {
        const player = $("studioPreview");
        if (Number.isFinite(player.currentTime)) $("studioTrimStart").value = player.currentTime.toFixed(1);
        updateDuration();
    });
    $("studioSetEnd").addEventListener("click", () => {
        const player = $("studioPreview");
        if (Number.isFinite(player.currentTime)) $("studioTrimEnd").value = player.currentTime.toFixed(1);
        updateDuration();
    });
    $("studioTrimStart").addEventListener("input", updateDuration);
    $("studioTrimEnd").addEventListener("input", updateDuration);

    $("studioClear").addEventListener("click", () => {
        $("studioExistingVideo").value = "";
        $("studioExistingVideo").dispatchEvent(new Event("change"));
        $("studioForm").reset();
        $("studioTrimStart").value = "0";
        $("studioVideoId").value = "";
        captionPath = null;
        clearPreview();
        setStatus("");
    });

    $("studioRefresh").addEventListener("click", async event => {
        event.currentTarget.disabled = true;
        try { await loadVideos(); }
        catch (error) { status.textContent = error.message; }
        finally { event.currentTarget.disabled = false; }
    });

    $("studioForm").addEventListener("submit", async event => {
        event.preventDefault();
        const button = $("studioPublish");
        const file = $("studioFile").files?.[0];
        const title = $("studioTitle").value.trim();
        const currentId = $("studioVideoId").value;
        const existing = videos.find(video => video.id === currentId);
        const visibility = $("studioVisibility").value;
        const captionText = $("studioCaptions").value;
        const start = Number($("studioTrimStart").value || 0);
        const endText = $("studioTrimEnd").value.trim();
        const end = endText ? Number(endText) : null;
        const isImage = file ? file.type.startsWith("image/") : (existing?.media_type || "").startsWith("image/");

        if (!title) return setStatus("Enter a video title.", true);
        if (!existing && !file) return setStatus("Choose a video or image to publish.", true);
        if (file && (!file.type.startsWith("video/") && !file.type.startsWith("image/"))) return setStatus("Choose a video or image file.", true);
        if (file && file.size > uploadMaxBytes) return setStatus(`This file is too large. Your upload limit is ${uploadMaxBytes / (1024 * 1024)} MB.`, true);
        if (!Number.isFinite(start) || start < 0 || (end !== null && (!Number.isFinite(end) || end <= start))) return setStatus("Trim end must be later than trim start.", true);
        if (captionText.length > 1024 * 1024 || !validCaptions(captionText)) return setStatus("Add valid WebVTT captions (WEBVTT header and at least one correctly timed cue), or leave captions empty.", true);
        if (isImage && (start > 0 || end !== null || captionText.trim())) return setStatus("Trim and caption tracks are only available for video files.", true);
        const duration = $("studioPreview").duration;
        if ((start > 0 || end !== null) && !Number.isFinite(duration) && (existing || file?.type.startsWith("video/"))) return setStatus("Wait for the video preview to load before setting trim points.", true);
        if (Number.isFinite(duration) && (start >= duration || (end !== null && end > duration))) return setStatus("Trim points must fall within the video duration.", true);

        button.disabled = true;
        button.textContent = existing ? "Saving changes…" : "Publishing…";
        setStatus("Saving your Studio changes…");
        let uploadedMedia = null;
        let uploadedCaption = null;
        try {
            let mediaPath = existing?.storage_path || "";
            let mediaType = existing?.media_type || "";
            if (file) {
                mediaPath = storagePath(session.user.id, file.name);
                mediaType = file.type || "application/octet-stream";
                uploadedMedia = mediaPath;
                await uploadObject(mediaPath, file, mediaType);
            }

            let nextCaptionPath = captionPath;
            if (captionText.trim()) {
                const captionBlob = new Blob([captionText.replace(/\r?\n/g, "\r\n")], { type: "text/vtt" });
                nextCaptionPath = storagePath(session.user.id, `${title.slice(0, 40)}.vtt`);
                uploadedCaption = nextCaptionPath;
                await uploadObject(nextCaptionPath, captionBlob, "text/vtt");
            } else {
                nextCaptionPath = null;
            }

            const payload = {
                owner_id: session.user.id,
                title: title.slice(0, 100),
                description: $("studioDescription").value.trim().slice(0, 5000),
                visibility,
                storage_path: mediaPath,
                media_type: mediaType,
                caption_path: nextCaptionPath,
                trim_start_seconds: isImage ? 0 : start,
                trim_end_seconds: isImage ? null : end,
                is_short: !isImage && $("studioIsShort").checked
            };
            if (existing) delete payload.owner_id;
            if (existing) {
                await request(`/rest/v1/videos?id=eq.${encodeURIComponent(existing.id)}&owner_id=eq.${encodeURIComponent(session.user.id)}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
                    body: JSON.stringify(payload)
                });
            } else {
                await request("/rest/v1/videos", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
                    body: JSON.stringify(payload)
                });
            }
            if (file && existing?.storage_path) removeObject(existing.storage_path).catch(() => {});
            if (existing?.caption_path && existing.caption_path !== nextCaptionPath) removeObject(existing.caption_path).catch(() => {});
            captionPath = nextCaptionPath;
            setStatus(existing ? "Video updated successfully." : "Video published successfully.");
            $("studioExistingVideo").value = "";
            $("studioForm").reset();
            $("studioTrimStart").value = "0";
            $("studioVideoId").value = "";
            captionPath = null;
            clearPreview();
            await loadVideos();
        } catch (error) {
            if (uploadedMedia) removeObject(uploadedMedia).catch(() => {});
            if (uploadedCaption) removeObject(uploadedCaption).catch(() => {});
            setStatus(error.message || "Could not save this video.", true);
        } finally {
            button.disabled = false;
            button.textContent = $("studioVideoId").value ? "Save video changes" : "Publish video";
        }
    });

    async function start() {
        try {
            const allowed = await loadMembership();
            if (!allowed) return;
            $("studioContent").hidden = false;
            if (!$("studioAnalytics").hidden) {
                const subs = await countRows("channel_follows", "channel_id", session.user.id);
                $("studioSubscribers").textContent = subs.toLocaleString();
            }
            await loadVideos();
        } catch (error) {
            status.textContent = error.message || "Could not verify Plus access.";
            status.classList.add("is-error");
        }
    }

    start();
})();
