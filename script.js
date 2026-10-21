const SUPABASE_URL = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY = window.WAMS_SUPABASE_ANON_KEY || "";
const MEDIA_BUCKET = "wams-media";

function currentSession() {
    try { return JSON.parse(localStorage.getItem("wamsTubeSession") || "null"); }
    catch { return null; }
}

function openVideo(videoId, title, channel, stats) {
    const params = new URLSearchParams({ videoId, title, channel, stats });
    window.location.href = "watch.html?" + params.toString();
}
window.openVideo = openVideo;
window.openAdminPanel = function() { window.location.href = "admin.html"; };

async function setupAdminSidebar() {
    const entry = document.getElementById("adminSidebarEntry");
    const session = currentSession();
    if (!entry || !session?.access_token || !session.user?.id) return;
    try {
        const profiles = await supabaseRequest(
            `/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=is_admin,is_banned`
        );
        if (profiles[0]?.is_admin && !profiles[0]?.is_banned) {
            entry.style.display = "flex";
        }
    } catch (error) {
        console.warn("Could not verify admin navigation access.", error);
    }
}

async function supabaseRequest(path, options = {}) {
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Supabase is not configured.");
    const session = currentSession();
    const headers = {
        apikey: SUPABASE_KEY,
        ...(session && session.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...(options.headers || {})
    };
    const response = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
    if (!response.ok) {
        const text = await response.text();
        let message = text;
        try { const data = JSON.parse(text); message = data.message || data.msg || data.error_description || text; } catch {}
        throw new Error(message || `Supabase request failed (${response.status}).`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
}

async function signedMediaUrl(storagePath) {
    const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/");
    const result = await supabaseRequest(`/storage/v1/object/sign/${MEDIA_BUCKET}/${encodedPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: 3600 })
    });
    const url = result.signedURL || result.signedUrl;
    if (!url) throw new Error("Supabase did not return a media URL.");
    if (url.startsWith("http")) return url;
    const relativeUrl = url.startsWith("/") ? url : `/${url}`;
    return `${SUPABASE_URL}${relativeUrl.startsWith("/storage/v1/") ? "" : "/storage/v1"}${relativeUrl}`;
}

function createVideoCard(video, channelName, mediaUrl, verified) {
    const card = document.createElement("article");
    card.className = "video-preview";
    card.dataset.title = video.title;
    card.dataset.author = channelName;

    const thumbnail = document.createElement("div");
    thumbnail.className = "thumbnail-wrapper";
    if (video.is_deleted) {
        thumbnail.classList.add("video-taken-down-thumbnail");
        const notice = document.createElement("span");
        notice.className = "video-taken-down-badge";
        notice.textContent = "Taken down — details";
        thumbnail.appendChild(notice);
    } else if ((video.media_type || "").startsWith("image/")) {
        const image = document.createElement("img");
        image.className = "thumbnail";
        image.src = mediaUrl;
        image.alt = video.title;
        thumbnail.appendChild(image);
    } else {
        const player = document.createElement("video");
        player.className = "thumbnail local-video-preview";
        player.src = mediaUrl;
        player.muted = true;
        player.preload = "metadata";
        thumbnail.appendChild(player);
    }

    const details = document.createElement("div");
    details.className = "video-details";
    const info = document.createElement("div");
    info.className = "video-info";
    const title = document.createElement("p");
    title.className = "video-title";
    title.textContent = video.title;
    const author = document.createElement("p");
    author.className = "video-author";
    author.textContent = channelName;
    if (verified) {
        const badge = document.createElement("span");
        badge.className = "verified-badge";
        badge.setAttribute("aria-label", "Verified");
        badge.textContent = "✓";
        author.append(" ", badge);
    }
    const stats = document.createElement("p");
    stats.className = "video-stats";
    stats.textContent = new Date(video.created_at).toLocaleDateString();
    info.append(title, author, stats);
    details.appendChild(info);
    card.append(thumbnail, details);
    card.addEventListener("click", () => openVideo(video.id, video.title, channelName, stats.textContent));
    return card;
}

async function renderSupabaseVideos() {
    const grid = document.getElementById("videoGrid");
    if (!grid) return;
    const channelPage = window.location.pathname.endsWith("channel.html") || window.location.pathname.endsWith("subscriptions.html");
    const requestedChannel = new URLSearchParams(window.location.search).get("channel");
    const session = currentSession();
    const ownerId = channelPage ? (requestedChannel || session?.user?.id) : null;
    const isOwnChannel = Boolean(session?.user?.id && ownerId === session.user.id);
    const emptyState = document.querySelector(".empty-channel");
    try {
        let query = "videos?select=id,owner_id,title,visibility,storage_path,media_type,is_short,is_deleted,takedown_reason,takedown_by,created_at&order=created_at.desc&limit=24";
        if (channelPage) {
            if (!ownerId) {
                if (emptyState) emptyState.textContent = "Sign in to see your channel and uploads.";
                return;
            }
            query += `&owner_id=eq.${encodeURIComponent(ownerId)}`;
            if (!isOwnChannel) query += "&visibility=eq.public&is_deleted=eq.false";
        } else {
            query += "&visibility=eq.public&is_deleted=eq.false";
        }
        const videos = await supabaseRequest(`/rest/v1/${query}`);
        const ids = [...new Set(videos.map(video => video.owner_id))];
        const profiles = ids.length
            ? await supabaseRequest(`/rest/v1/profiles?select=id,channel_name,admin_verified&id=in.(${ids.map(encodeURIComponent).join(",")})`)
            : [];
        const profileById = new Map(profiles.map(profile => [profile.id, profile]));
        grid.replaceChildren();
        const cards = await Promise.all(videos.map(async video => {
            try {
                const profile = profileById.get(video.owner_id);
                const url = video.is_deleted ? "" : await signedMediaUrl(video.storage_path);
                return createVideoCard(video, profile?.channel_name || "WamsTube channel", url, Boolean(profile?.admin_verified));
            } catch (error) {
                console.warn("Could not load a Supabase video.", error);
                return null;
            }
        }));
        grid.append(...cards.filter(Boolean));
        if (emptyState) emptyState.hidden = videos.length > 0;
    } catch (error) {
        console.error("Could not load videos from Supabase.", error);
        if (emptyState) {
            emptyState.hidden = false;
            emptyState.textContent = "Could not load videos from Supabase. Check your project configuration and database policies.";
        }
    }
}

const CHANNEL_BADGE_INFO = {
    verified: { label: "Verified", description: "This channel is verified by WamsTube through an admin grant or by reaching more than 100 followers." },
    admin: { label: "Admin", description: "A WamsTube administrator who helps manage the platform." },
    owner: { label: "Owner", description: "A WamsTube platform owner." },
    co_owner: { label: "Co-Owner", description: "A trusted co-owner who helps lead the WamsTube platform." },
    partner: { label: "Partner", description: "An officially recognized WamsTube partner." },
    developer: { label: "Developer", description: "A developer who builds or maintains WamsTube." },
    moderator: { label: "Moderator", description: "A moderator who helps keep the community safe." },
    creator: { label: "Creator", description: "A creator recognized for contributing videos to the community." },
    early_supporter: { label: "Early Supporter", description: "A supporter who joined and helped WamsTube in its early days." },
    founding_member: { label: "Founding Member", description: "A member recognized for helping establish the WamsTube community." },
    premium: { label: "Plus Member", description: "A WamsTube Plus member supporting the platform and enjoying the Plus experience." }
};

function showBadgeInfo(key) {
    const info = CHANNEL_BADGE_INFO[key];
    if (!info) return;
    const dialog = document.getElementById("badgeInfoDialog");
    const title = document.getElementById("badgeInfoTitle");
    const description = document.getElementById("badgeInfoDescription");
    if (!dialog || !title || !description) return;
    title.textContent = info.label;
    description.textContent = info.description;
    if (!dialog.open) dialog.showModal();
}

function renderChannelBadges(profile, followerCount) {
    const heading = document.getElementById("channelName");
    const container = document.getElementById("channelBadges");
    if (!heading || !container) return;
    const isVerified = Boolean(profile.admin_verified) || followerCount > 100;
    if (isVerified) {
        const verified = document.createElement("button");
        verified.type = "button";
        verified.className = "channel-badge badge-verified";
        verified.textContent = "✓ Verified";
        verified.setAttribute("aria-label", "Verified badge. Click for details.");
        verified.addEventListener("click", () => showBadgeInfo("verified"));
        heading.append(" ", verified);
    }
    container.replaceChildren();
    (profile.badges || []).forEach(key => {
        if (key === "premium" && profile.plus_expires_at && new Date(profile.plus_expires_at) <= new Date()) return;
        const info = CHANNEL_BADGE_INFO[key];
        if (!info || key === "verified") return;
        const badge = document.createElement("button");
        badge.type = "button";
        badge.className = `channel-badge badge-${key}`;
        badge.textContent = info.label;
        badge.setAttribute("aria-label", `${info.label} badge. Click for details.`);
        badge.addEventListener("click", () => showBadgeInfo(key));
        container.appendChild(badge);
    });
}

async function loadChannelHeader() {
    const isOwnChannelPage = window.location.pathname.endsWith("channel.html") || window.location.pathname.endsWith("subscriptions.html");
    if (!isOwnChannelPage) return;
    const heading = document.getElementById("channelName");
    const handle = document.getElementById("channelHandle");
    const subscribers = document.getElementById("channelSubscribers");
    const picture = document.getElementById("channelPicture");
    const pictureUpload = document.getElementById("channelPictureUpload");
    const session = currentSession();
    const requestedChannel = new URLSearchParams(window.location.search).get("channel");
    const profileId = requestedChannel || session?.user?.id;
    const isOwnChannel = Boolean(session?.user?.id && profileId === session.user.id);
    if (!profileId) {
        if (heading) heading.textContent = "Sign in to view your channel";
        if (handle) handle.textContent = "";
        if (subscribers) subscribers.textContent = "";
        return;
    }
    if (pictureUpload && isOwnChannel) pictureUpload.hidden = false;
    try {
        const profiles = await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(profileId)}&select=id,channel_name,avatar_path,admin_verified,plus_expires_at`);
        if (!profiles.length) throw new Error("Your Supabase profile could not be found.");
        const profile = profiles[0];
        if (picture && profile.avatar_path) {
            const encodedPath = profile.avatar_path.split("/").map(encodeURIComponent).join("/");
            picture.src = `${SUPABASE_URL}/storage/v1/object/public/wams-avatars/${encodedPath}`;
        }
        if (heading) heading.textContent = profile.channel_name;
        if (handle) handle.textContent = `@${profile.channel_name}`;
        const videosHeading = document.getElementById("channelVideosHeading");
        if (videosHeading) videosHeading.textContent = isOwnChannel ? "Your videos" : `${profile.channel_name}'s videos`;
        document.title = `${profile.channel_name} - WamsTube`;
        const [follows, badgeRows] = await Promise.all([
            supabaseRequest(`/rest/v1/channel_follows?channel_id=eq.${encodeURIComponent(profile.id)}&select=follower_id`),
            supabaseRequest(`/rest/v1/profile_badges?profile_id=eq.${encodeURIComponent(profile.id)}&select=badge_type`)
        ]);
        if (subscribers) subscribers.textContent = `${follows.length} subscribers`;
        profile.badges = badgeRows.map(row => row.badge_type);
        renderChannelBadges(profile, follows.length);
    } catch (error) {
        if (heading) heading.textContent = "Could not load channel";
        if (handle) handle.textContent = error.message;
    }
}

function setupBadgeDialog() {
    const dialog = document.getElementById("badgeInfoDialog");
    const close = document.getElementById("badgeInfoClose");
    if (dialog && close) close.addEventListener("click", () => dialog.close());
    if (dialog) dialog.addEventListener("click", event => {
        if (event.target === dialog) dialog.close();
    });
}

function setupChannelPictureUpload() {
    const input = document.getElementById("channelPictureFile");
    const image = document.getElementById("channelPicture");
    const status = document.getElementById("channelPictureStatus");
    if (!input || !image) return;

    input.addEventListener("change", async () => {
        const file = input.files?.[0];
        const session = currentSession();
        if (!file) return;
        if (!session?.access_token || !session.user?.id) {
            if (status) status.textContent = "Sign in to change your channel picture.";
            return;
        }
        if (!file.type.startsWith("image/")) {
            if (status) status.textContent = "Choose an image file.";
            input.value = "";
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            if (status) status.textContent = "Profile pictures must be 5 MB or smaller.";
            input.value = "";
            return;
        }

        const extension = (file.name.split(".").pop() || "jpg").replace(/[^a-zA-Z0-9]/g, "") || "jpg";
        const path = `${session.user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
        const encodedPath = path.split("/").map(encodeURIComponent).join("/");
        if (status) status.textContent = "Uploading picture…";
        input.disabled = true;
        try {
            await supabaseRequest(`/storage/v1/object/wams-avatars/${encodedPath}`, {
                method: "POST",
                headers: { "Content-Type": file.type, "x-upsert": "false" },
                body: file
            });
            await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
                body: JSON.stringify({ avatar_path: path })
            });
            image.src = `${SUPABASE_URL}/storage/v1/object/public/wams-avatars/${encodedPath}?v=${Date.now()}`;
            if (status) status.textContent = "Channel picture updated.";
        } catch (error) {
            if (status) status.textContent = error.message || "Could not upload the channel picture.";
        } finally {
            input.disabled = false;
            input.value = "";
        }
    });
}

function searchMatchScore(query, text) {
    const words = text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
    const queryWords = query.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
    if (!words.length || !queryWords.length) return 0;
    const normalizedText = words.join(" ");
    const normalizedQuery = queryWords.join(" ");
    if (normalizedText.includes(normalizedQuery)) return 1;

    const similarity = (left, right) => {
        if (left.length === right.length) {
            const mismatches = [];
            for (let index = 0; index < left.length; index++) {
                if (left[index] !== right[index]) mismatches.push(index);
            }
            if (mismatches.length === 2 && mismatches[1] === mismatches[0] + 1 &&
                left[mismatches[0]] === right[mismatches[1]] && left[mismatches[1]] === right[mismatches[0]]) return 0.85;
        }
        const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
        for (let i = 1; i <= left.length; i++) {
            let diagonal = previous[0];
            previous[0] = i;
            for (let j = 1; j <= right.length; j++) {
                const above = previous[j];
                previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
                diagonal = above;
            }
        }
        return 1 - previous[right.length] / Math.max(left.length, right.length, 1);
    };
    const scores = queryWords.map(queryWord => Math.max(...words.map(word => {
        if (word.startsWith(queryWord)) return 0.94;
        if (queryWord.startsWith(word)) return Math.min(queryWord.length, word.length) / Math.max(queryWord.length, word.length);
        return similarity(queryWord, word);
    })));
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function setupSearch() {
    const form = document.getElementById("searchForm");
    const input = document.getElementById("searchInput");
    const grid = document.getElementById("videoGrid");
    const empty = document.getElementById("noResults");
    const panel = document.getElementById("searchSuggestions");
    if (!input || !grid || !panel) return;
    let requestNumber = 0;
    let activeIndex = -1;
    let searchTimer;

    const filter = () => {
        const query = input.value.trim().toLowerCase();
        let visible = 0;
        grid.querySelectorAll(".video-preview").forEach(card => {
            const matches = !query || ((card.dataset.title || "") + " " + (card.dataset.author || "")).toLowerCase().includes(query);
            card.hidden = !matches;
            if (matches) visible++;
        });
        if (empty) empty.style.display = visible ? "none" : "block";
    };
    const hidePanel = () => { panel.hidden = true; activeIndex = -1; };
    const goToResult = result => {
        hidePanel();
        if (result.kind === "video") openVideo(result.id, result.title, result.channel, new Date(result.created_at).toLocaleDateString());
        else window.location.href = `channel.html?channel=${encodeURIComponent(result.id)}`;
    };

    const showSuggestions = results => {
        panel.replaceChildren();
        activeIndex = -1;
        if (!results.length) { hidePanel(); return; }
        results.forEach((result, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "search-suggestion";
            button.setAttribute("role", "option");
            button.dataset.index = String(index);
            const icon = document.createElement("span");
            icon.className = "material-symbols-rounded search-suggestion-icon";
            icon.textContent = result.kind === "video" ? "play_circle" : "account_circle";
            const copy = document.createElement("span");
            copy.className = "search-suggestion-copy";
            const title = document.createElement("strong");
            title.textContent = result.kind === "video" ? result.title : result.name;
            const subtitle = document.createElement("small");
            subtitle.textContent = result.kind === "video" ? `Video · ${result.channel}` : "Channel";
            copy.append(title, subtitle);
            button.append(icon, copy);
            button.addEventListener("mousedown", event => event.preventDefault());
            button.addEventListener("click", () => goToResult(result));
            panel.appendChild(button);
        });
        panel.hidden = false;
    };

    const loadSuggestions = async rawQuery => {
        const query = rawQuery.trim();
        const thisRequest = ++requestNumber;
        if (query.length < 2) { hidePanel(); return; }
        const params = new URLSearchParams();
        params.set("select", "id,title,owner_id,created_at");
        params.set("visibility", "eq.public");
        params.set("is_deleted", "eq.false");
        params.set("order", "created_at.desc");
        params.set("limit", "120");
        const videoMatchParams = new URLSearchParams(params);
        videoMatchParams.set("title", `ilike.*${query}*`);
        videoMatchParams.set("limit", "12");
        const profileParams = new URLSearchParams({ select: "id,channel_name", order: "created_at.desc", limit: "500" });
        const profileMatchParams = new URLSearchParams(profileParams);
        profileMatchParams.set("channel_name", `ilike.*${query}*`);
        profileMatchParams.set("limit", "12");
        try {
            const [recentVideos, matchingVideos, profiles, matchingProfiles] = await Promise.all([
                supabaseRequest(`/rest/v1/videos?${params}`),
                supabaseRequest(`/rest/v1/videos?${videoMatchParams}`),
                supabaseRequest(`/rest/v1/profiles?${profileParams}`),
                supabaseRequest(`/rest/v1/profiles?${profileMatchParams}`)
            ]);
            if (thisRequest !== requestNumber) return;
            const videos = [...new Map([...matchingVideos, ...recentVideos].map(video => [video.id, video])).values()];
            const allProfiles = [...new Map([...matchingProfiles, ...profiles].map(profile => [profile.id, profile])).values()];
            const profileById = new Map(allProfiles.map(profile => [profile.id, profile]));
            const candidates = [];
            videos.forEach(video => {
                const score = searchMatchScore(query, video.title);
                if (score >= (query.length < 4 ? 0.75 : 0.58)) {
                    candidates.push({ kind: "video", id: video.id, title: video.title, created_at: video.created_at, channel: profileById.get(video.owner_id)?.channel_name || "WamsTube channel", score });
                }
            });
            allProfiles.forEach(profile => {
                const score = searchMatchScore(query, profile.channel_name || "");
                if (score >= (query.length < 4 ? 0.75 : 0.58)) {
                    candidates.push({ kind: "channel", id: profile.id, name: profile.channel_name, score });
                }
            });
            candidates.sort((a, b) => b.score - a.score || (a.kind === b.kind ? 0 : a.kind === "video" ? -1 : 1));
            showSuggestions(candidates.slice(0, 8));
        } catch (error) {
            if (thisRequest === requestNumber) hidePanel();
            console.warn("Could not load search suggestions.", error);
        }
    };

    input.addEventListener("input", () => {
        filter();
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => loadSuggestions(input.value), 180);
    });
    input.addEventListener("keydown", event => {
        const options = [...panel.querySelectorAll(".search-suggestion")];
        if (event.key === "Escape") { hidePanel(); return; }
        if (!options.length) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            activeIndex = (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
            options.forEach((option, index) => option.classList.toggle("active", index === activeIndex));
        } else if (event.key === "Enter" && activeIndex >= 0) {
            event.preventDefault();
            options[activeIndex].click();
        }
    });
    input.addEventListener("focus", () => { if (input.value.trim().length >= 2) loadSuggestions(input.value); });
    document.addEventListener("click", event => { if (!form.contains(event.target)) hidePanel(); });
    if (form) form.addEventListener("submit", event => {
        event.preventDefault();
        const first = panel.querySelector(".search-suggestion");
        if (first && !panel.hidden) first.click();
        else filter();
    });
}

function setupUpload() {
    const open = document.getElementById("uploadButton");
    const overlay = document.getElementById("uploadOverlay");
    const close = document.getElementById("uploadClose");
    const publish = document.getElementById("publishButton");
    if (!open || !overlay || !publish) return;
    const error = document.getElementById("uploadError");
    const hide = () => overlay.classList.remove("show");
    open.addEventListener("click", () => {
        if (!currentSession()?.access_token) {
            window.location.href = "login.html";
            return;
        }
        overlay.classList.add("show");
    });
    if (close) close.addEventListener("click", hide);
    overlay.addEventListener("click", event => { if (event.target === overlay) hide(); });
    publish.addEventListener("click", async () => {
        const file = document.getElementById("videoFile")?.files[0];
        const title = document.getElementById("videoName")?.value.trim();
        const session = currentSession();
        const visibility = document.getElementById("videoVisibility")?.value || "public";
        if (!session?.access_token || !session.user?.id) {
            if (error) error.textContent = "Sign in before uploading.";
            return;
        }
        if (!file || !title) {
            if (error) error.textContent = "Choose a video or image and enter a title.";
            return;
        }
        if (file.size > 100 * 1024 * 1024) {
            if (error) error.textContent = "Files must be 100 MB or smaller.";
            return;
        }
        publish.disabled = true;
        if (error) error.textContent = "Uploading to Supabase…";
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const uniqueId = window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const storagePath = `${session.user.id}/${uniqueId}-${safeName}`;
        let uploaded = false;
        try {
            const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/");
            await supabaseRequest(`/storage/v1/object/${MEDIA_BUCKET}/${encodedPath}`, {
                method: "POST",
                headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" },
                body: file
            });
            uploaded = true;
            await supabaseRequest("/rest/v1/videos", {
                method: "POST",
                headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
                body: JSON.stringify({
                    owner_id: session.user.id,
                    title: title.slice(0, 100),
                    visibility,
                    storage_path: storagePath,
                    media_type: file.type || "application/octet-stream",
                    is_short: Boolean(document.getElementById("isShortUpload")?.checked)
                })
            });
            hide();
            window.location.reload();
        } catch (uploadError) {
            if (uploaded) {
                const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/");
                supabaseRequest(`/storage/v1/object/${MEDIA_BUCKET}/${encodedPath}`, { method: "DELETE" }).catch(() => {});
            }
            if (error) error.textContent = uploadError.message || "The upload could not be saved to Supabase.";
        } finally {
            publish.disabled = false;
        }
    });
}

function setupClock() {
    const element = document.getElementById("currentTime");
    if (!element) return;
    const update = () => { element.textContent = new Date().toUTCString(); };
    update();
    window.setInterval(update, 1000);
}

document.addEventListener("DOMContentLoaded", () => {
    setupClock();
    setupAdminSidebar();
    setupSearch();
    setupUpload();
    setupBadgeDialog();
    setupChannelPictureUpload();
    loadChannelHeader();
    renderSupabaseVideos();
});
