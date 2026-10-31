const SUPABASE_URL = window.WAMS_SUPABASE_URL = "https://ivlpfoaudibejeatidfe.supabase.co";
const SUPABASE_KEY = "sb_publishable_Yc_I9cOHI1-jb4V7ZTSyWA_CIXeFzkm";
const MEDIA_BUCKET = "wams-media";

function currentSession() {
    try { 
        const session = JSON.parse(localStorage.getItem("wamsTubeSession") || "null");
        if (!session || !session.access_token) return null;
        
        const base64Url = session.access_token.split('.')[1];
        if (!base64Url) return session;
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(window.atob(base64));
        const now = Math.floor(Date.now() / 1000);
        
        if (payload.exp && payload.exp < now) {
            localStorage.removeItem("wamsTubeSession");
            return null;
        }
        
        return session;
    }
    catch { 
        return null; 
    }
}

function openVideo(videoId, title, channel, stats) {
    const params = new URLSearchParams({ videoId, title, channel, stats });
    window.location.href = "watch.html?" + params.toString();
}
window.openVideo = openVideo;
window.openAdminPanel = function() { window.location.href = "admin.html"; };

async function setupAdminSidebar() {
    const entry = document.getElementById("adminSidebarEntry");
    const ownerEntry = document.getElementById("ownerSidebarEntry");
    const session = currentSession();
    if ((!entry && !ownerEntry) || !session?.access_token || !session.user?.id) return;
    try {
        const profiles = await supabaseRequest(
            `/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=is_admin,is_owner,is_banned,is_suspected`
        );
        const profile = profiles?.[0];
        const active = Boolean(profile && !profile.is_banned && !profile.is_suspected);
        if (entry && active && profile.is_admin) entry.style.display = "flex";
        if (ownerEntry && active && profile.is_owner) ownerEntry.style.display = "flex";
    } catch (error) {
        console.warn("Could not verify privileged navigation access.", error);
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
        
        if ((message && message.includes("JWT expired")) || response.status === 401) {
            localStorage.removeItem("wamsTubeSession");
            if (headers.Authorization) {
                const guestOptions = { ...options };
                if (guestOptions.headers) {
                    delete guestOptions.headers.Authorization;
                }
                return supabaseRequest(path, guestOptions);
            }
        }
        
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

function createVideoCard(video, channelName, mediaUrl, verified, canDelete = false) {
    const card = document.createElement("article");
    card.className = "video-preview";
    card.dataset.videoId = video.id;
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
    if (video.visibility === "subscribers") {
        const badge = document.createElement("span");
        badge.className = "subscriber-only-video-badge";
        badge.textContent = "Subscribers only";
        thumbnail.appendChild(badge);
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
    const savedActions = document.createElement("div");
    savedActions.className = "browse-card-actions";
    const laterButton = document.createElement("button");
    laterButton.type = "button";
    const laterKey = "wamsTubeWatchLater";
    const getLaterItems = () => {
        try {
            const items = JSON.parse(localStorage.getItem(laterKey) || "[]");
            return Array.isArray(items) ? items : [];
        } catch { return []; }
    };
    const updateLaterLabel = () => {
        laterButton.textContent = getLaterItems().some(item => item.id === video.id) ? "Saved for later" : "Watch later";
    };
    updateLaterLabel();
    laterButton.addEventListener("click", event => {
        event.stopPropagation();
        const items = getLaterItems();
        const index = items.findIndex(item => item.id === video.id);
        if (index >= 0) items.splice(index, 1);
        else items.unshift({ id: video.id, title: video.title, channel: channelName });
        try {
            localStorage.setItem(laterKey, JSON.stringify(items));
            updateLaterLabel();
        } catch (error) {
            console.warn("Could not save this video for later.", error);
        }
    });
    savedActions.appendChild(laterButton);
    if (canDelete) {
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.textContent = "Delete video";
        deleteButton.addEventListener("click", async event => {
            event.stopPropagation();
            if (!window.confirm(`Permanently delete “${video.title}”? This cannot be undone.`)) return;
            deleteButton.disabled = true;
            deleteButton.textContent = "Deleting…";
            try {
                await supabaseRequest(`/rest/v1/videos?id=eq.${encodeURIComponent(video.id)}&owner_id=eq.${encodeURIComponent(currentSession()?.user?.id || "")}`, {
                    method: "DELETE",
                    headers: { Prefer: "return=minimal" }
                });
                card.remove();
                const empty = document.querySelector(".empty-channel");
                if (empty && !document.getElementById("videoGrid")?.querySelector(".video-preview")) empty.hidden = false;
                const paths = [video.storage_path, video.caption_path].filter(Boolean);
                try {
                    await Promise.all(paths.map(path => {
                        const encodedPath = path.split("/").map(encodeURIComponent).join("/");
                        return supabaseRequest(`/storage/v1/object/${MEDIA_BUCKET}/${encodedPath}`, { method: "DELETE" });
                    }));
                } catch (cleanupError) {
                    console.warn("Video was deleted, but its stored media could not be fully cleaned up.", cleanupError);
                    window.alert("The video was deleted, but its stored media could not be fully cleaned up.");
                }
            } catch (deleteError) {
                deleteButton.disabled = false;
                deleteButton.textContent = "Delete video";
                window.alert(deleteError.message || "Could not delete this video.");
            }
        });
        savedActions.appendChild(deleteButton);
    }
    card.appendChild(savedActions);
    card.addEventListener("click", () => openVideo(video.id, video.title, channelName, stats.textContent));
    return card;
}

function showChannelClosedNotice(message) {
    const page = document.querySelector(".channel-page");
    const notice = document.getElementById("channelClosedNotice");
    const messageElement = document.getElementById("channelClosedMessage");
    if (page) page.hidden = true;
    if (messageElement) messageElement.textContent = message || "The owner has temporarily closed this channel.";
    if (notice) notice.hidden = false;
}

function showSuspiciousChannelNotice() {
    const header = document.querySelector(".channel-header-simple");
    const title = document.getElementById("channelVideosHeading");
    const grid = document.getElementById("videoGrid");
    const emptyState = document.querySelector(".empty-channel");
    if (header) header.hidden = true;
    if (title) title.hidden = true;
    if (grid) grid.replaceChildren();
    if (emptyState) {
        emptyState.hidden = false;
        emptyState.replaceChildren();
        const notice = document.createElement("div");
        notice.className = "suspicious-channel-notice";
        notice.textContent = "This channel is under suspicion. Come again later,";
        emptyState.appendChild(notice);
    }
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
        if (channelPage && ownerId) {
            const targetProfiles = await supabaseRequest(
                `/rest/v1/profiles?id=eq.${encodeURIComponent(ownerId)}&select=is_suspected,channel_closed,channel_closed_message`
            );
            if (targetProfiles?.[0]?.channel_closed && !isOwnChannel) {
                showChannelClosedNotice(targetProfiles[0].channel_closed_message);
                return;
            }
            if (targetProfiles?.[0]?.is_suspected) {
                const adminProfiles = session?.user?.id
                    ? await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=is_admin,is_banned,is_suspected`)
                    : [];
                if (!adminProfiles?.[0]?.is_admin || adminProfiles[0].is_banned || adminProfiles[0].is_suspected) {
                    showSuspiciousChannelNotice();
                    return;
                }
            }
        }
        let query = "videos?select=id,owner_id,title,visibility,storage_path,caption_path,media_type,is_short,is_deleted,takedown_reason,takedown_by,created_at&order=created_at.desc&limit=24";
        if (channelPage) {
            if (!ownerId) {
                if (emptyState) emptyState.textContent = "Sign in to see your channel and uploads.";
                return;
            }
            query += `&owner_id=eq.${encodeURIComponent(ownerId)}`;
            if (!isOwnChannel) query += "&or=(visibility.eq.public,visibility.eq.subscribers)&is_deleted=eq.false";
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
                return createVideoCard(video, profile?.channel_name || "WamsTube channel", url, Boolean(profile?.admin_verified), isOwnChannel);
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
        if (key === "premium" && profile.plus_plan !== "lifetime" && profile.plus_expires_at && new Date(profile.plus_expires_at) <= new Date()) return;
        const custom = profile.badgeDefinitions?.[key];
        const info = CHANNEL_BADGE_INFO[key] || custom;
        if (!info || key === "verified") return;
        const badge = document.createElement("button");
        badge.type = "button";
        badge.className = `channel-badge badge-${key}`;
        badge.textContent = info.label;
        badge.setAttribute("aria-label", `${info.label} badge. Click for details.`);
        if (custom) {
            const colors = [custom.badge_color, custom.badge_color_secondary, custom.badge_color_tertiary].filter(Boolean);
            if (custom.badge_style === "rainbow") badge.classList.add("badge-rainbow");
            else if (custom.badge_style === "gradient") {
                badge.style.background = `linear-gradient(115deg, ${colors.join(", ")})`;
                badge.classList.add("badge-gradient-animated");
            } else badge.style.background = colors[0] || "#7041b8";
            badge.addEventListener("click", () => showCustomBadgeInfo(info));
        } else badge.addEventListener("click", () => showBadgeInfo(key));
        container.appendChild(badge);
    });
}

function showCustomBadgeInfo(info) {
    const dialog = document.getElementById("badgeInfoDialog");
    const title = document.getElementById("badgeInfoTitle");
    const description = document.getElementById("badgeInfoDescription");
    if (!dialog || !title || !description) return;
    title.textContent = info.label;
    description.textContent = info.description || "A custom badge granted by a WamsTube administrator.";
    if (!dialog.open) dialog.showModal();
}

async function loadChannelHeader() {
    const isOwnChannelPage = window.location.pathname.endsWith("channel.html") || window.location.pathname.endsWith("subscriptions.html");
    if (!isOwnChannelPage) return;
    const heading = document.getElementById("channelName");
    const handle = document.getElementById("channelHandle");
    const subscribers = document.getElementById("channelSubscribers");
    const picture = document.getElementById("channelPicture");
    const pictureUpload = document.getElementById("channelPictureUpload");
    const channelSettingsPanel = document.getElementById("channelSettingsPanel");
    const monetizationSection = document.getElementById("channelMonetization");
    const monetizationToggle = document.getElementById("channelMonetizationEnabled");
    const monetizationStatus = document.getElementById("channelMonetizationStatus");
    const session = currentSession();
    const requestedChannel = new URLSearchParams(window.location.search).get("channel");
    const profileId = requestedChannel || session?.user?.id;
    const isOwnChannel = Boolean(session?.user?.id && profileId === session.user.id);
    if (monetizationSection) monetizationSection.hidden = !isOwnChannel;
    if (channelSettingsPanel) channelSettingsPanel.hidden = !isOwnChannel;
    if (!profileId) {
        if (heading) heading.textContent = "Sign in to view your channel";
        if (handle) handle.textContent = "";
        if (subscribers) subscribers.textContent = "";
        return;
    }
    if (pictureUpload && isOwnChannel) pictureUpload.hidden = false;
    try {
        const profiles = await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(profileId)}&select=id,channel_name,avatar_path,banner_path,admin_verified,plus_expires_at,plus_plan,monetization_enabled,is_suspected,is_admin,channel_closed,channel_closed_message`);
        if (!profiles || !profiles.length) throw new Error("Your Supabase profile could not be found.");
        const profile = profiles[0];
        if (channelSettingsPanel && isOwnChannel) {
            channelSettingsPanel.hidden = false;
            loadChannelSettingsVideos(profile.id);
        }
        if (profile.channel_closed && !isOwnChannel) {
            showChannelClosedNotice(profile.channel_closed_message);
            return;
        }
        if (profile.is_suspected) {
            const viewerProfiles = session?.user?.id
                ? await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=is_admin,is_banned,is_suspected`)
                : [];
            if (!viewerProfiles?.[0]?.is_admin || viewerProfiles[0].is_banned || viewerProfiles[0].is_suspected) {
                showSuspiciousChannelNotice();
                return;
            }
        }
        if (picture && profile.avatar_path) {
            const encodedPath = profile.avatar_path.split("/").map(encodeURIComponent).join("/");
            picture.src = `${SUPABASE_URL}/storage/v1/object/public/wams-avatars/${encodedPath}`;
        }
        const banner = document.getElementById("channelBanner");
        if (banner && profile.banner_path) {
            const encodedBannerPath = profile.banner_path.split("/").map(encodeURIComponent).join("/");
            banner.classList.add("has-custom-banner");
            banner.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, .25), rgba(0, 0, 0, .25)), url("${SUPABASE_URL}/storage/v1/object/public/wams-banners/${encodedBannerPath}")`;
        }
        if (heading) heading.textContent = profile.channel_name;
        if (handle) handle.textContent = `@${profile.channel_name}`;
        const videosHeading = document.getElementById("channelVideosHeading");
        if (videosHeading) videosHeading.textContent = isOwnChannel ? "Your videos" : `${profile.channel_name}'s videos`;
        document.title = `${profile.channel_name} - WamsTube`;
        const [follows, badgeRows, badgeTypes] = await Promise.all([
            supabaseRequest(`/rest/v1/channel_follows?channel_id=eq.${encodeURIComponent(profile.id)}&select=follower_id`),
            supabaseRequest(`/rest/v1/profile_badges?profile_id=eq.${encodeURIComponent(profile.id)}&select=badge_type`),
            supabaseRequest("/rest/v1/badge_types?select=badge_type,label,description,badge_style,badge_color,badge_color_secondary,badge_color_tertiary")
        ]);
        if (subscribers) subscribers.textContent = `${follows.length.toLocaleString()} subscribers`;
        profile.badges = badgeRows.map(row => row.badge_type);
        profile.badgeDefinitions = Object.fromEntries(badgeTypes.filter(row => row.badge_type !== "verified" && !CHANNEL_BADGE_INFO[row.badge_type]).map(row => [row.badge_type, row]));
        renderChannelBadges(profile, follows.length);
        const subscribeButton = document.getElementById("channelSubscribeButton");
        const transferButton = document.getElementById("channelTransferButton");
        if (subscribeButton) {
            subscribeButton.hidden = isOwnChannel;
            subscribeButton.textContent = follows.some(row => row.follower_id === session?.user?.id) ? "Subscribed" : "Subscribe";
            subscribeButton.classList.toggle("is-subscribed", subscribeButton.textContent === "Subscribed");
            subscribeButton.onclick = async () => {
                if (!session?.access_token) { window.location.href = "login.html"; return; }
                subscribeButton.disabled = true;
                try {
                    const subscribed = subscribeButton.classList.contains("is-subscribed");
                    const endpoint = `/rest/v1/channel_follows?channel_id=eq.${encodeURIComponent(profile.id)}&follower_id=eq.${encodeURIComponent(session.user.id)}`;
                    await supabaseRequest(subscribed ? endpoint : "/rest/v1/channel_follows", {
                        method: subscribed ? "DELETE" : "POST",
                        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
                        ...(subscribed ? {} : { body: JSON.stringify({ channel_id: profile.id, follower_id: session.user.id }) })
                    });
                    const updatedFollows = await supabaseRequest(`/rest/v1/channel_follows?channel_id=eq.${encodeURIComponent(profile.id)}&select=follower_id`);
                    const nowSubscribed = !subscribed;
                    subscribeButton.textContent = nowSubscribed ? "Subscribed" : "Subscribe";
                    subscribeButton.classList.toggle("is-subscribed", nowSubscribed);
                    if (subscribers) subscribers.textContent = `${updatedFollows.length.toLocaleString()} subscribers`;
                    if (heading) heading.textContent = profile.channel_name;
                    renderChannelBadges(profile, updatedFollows.length);
                } catch (error) {
                    const transferStatus = document.getElementById("channelTransferStatus");
                    if (transferStatus) transferStatus.textContent = error.message || "Could not update subscription.";
                } finally { subscribeButton.disabled = false; }
            };
        }
        if (transferButton) {
            transferButton.hidden = !isOwnChannel;
            transferButton.onclick = async () => {
                const recipientEmail = window.prompt("Enter the @mtps.us email of the channel’s new owner:");
                if (recipientEmail === null) return;
                if (!/^[^\s@]+@mtps\.us$/i.test(recipientEmail.trim())) {
                    const transferStatus = document.getElementById("channelTransferStatus");
                    if (transferStatus) transferStatus.textContent = "Enter a valid @mtps.us account email.";
                    return;
                }
                if (!window.confirm(`Transfer “${profile.channel_name}” to ${recipientEmail.trim()}? This moves the channel’s videos, subscribers, badges, and channel identity. This cannot be undone here.`)) return;
                transferButton.disabled = true;
                const transferStatus = document.getElementById("channelTransferStatus");
                if (transferStatus) transferStatus.textContent = "Transferring channel…";
                try {
                    await supabaseRequest("/rest/v1/rpc/transfer_wams_channel", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ target_email: recipientEmail.trim().toLowerCase() })
                    });
                    if (transferStatus) transferStatus.textContent = "Channel transferred. Reloading your new channel…";
                    window.setTimeout(() => window.location.reload(), 900);
                } catch (error) {
                    if (transferStatus) transferStatus.textContent = error.message || "Could not transfer the channel.";
                    transferButton.disabled = false;
                }
            };
        }
        const videoCount = document.getElementById("channelVideoCount");
        if (videoCount) {
            const countRows = await supabaseRequest(`/rest/v1/videos?owner_id=eq.${encodeURIComponent(profile.id)}&is_deleted=eq.false&select=id`);
            videoCount.textContent = `${countRows.length.toLocaleString()} videos`;
        }
        const bannerTitle = document.getElementById("channelBannerTitle");
        if (bannerTitle) bannerTitle.textContent = profile.channel_name.toUpperCase();
        const verified = Boolean(profile.admin_verified) || follows.length > 100;
        const plusActive = profile.plus_plan === "lifetime" || Boolean(profile.plus_expires_at && new Date(profile.plus_expires_at) > new Date());
        const monetizationPlan = plusActive && ["year", "lifetime"].includes(profile.plus_plan);
        if (monetizationToggle) {
            monetizationToggle.checked = Boolean(profile.monetization_enabled);
            monetizationToggle.disabled = (!verified || !monetizationPlan) && !monetizationToggle.checked;
            if (monetizationStatus) {
                monetizationStatus.textContent = !verified
                    ? monetizationToggle.checked
                        ? "Your channel is no longer verified. Donations and rewards are paused; you can turn monetization off here."
                        : "Monetization is available after your channel is verified (admin verification or more than 100 subscribers)."
                    : !monetizationPlan
                    ? monetizationToggle.checked
                        ? "Your current plan no longer includes monetization. Donations and rewards are paused; you can turn it off here."
                        : "A verified channel with an active Year or Lifetime Plus plan can enable monetization."
                    : "Earn 5 Wams Bucks for every 10 unique views on your public videos while monetization is enabled.";
            }
            monetizationToggle.addEventListener("change", async () => {
                monetizationToggle.disabled = true;
                if (monetizationStatus) monetizationStatus.textContent = "Saving monetization setting…";
                try {
                    await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(profile.id)}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
                        body: JSON.stringify({ monetization_enabled: monetizationToggle.checked })
                    });
                    if (monetizationStatus) monetizationStatus.textContent = monetizationToggle.checked
                        ? "Monetization is on. Eligible video donations and view rewards are enabled."
                        : "Monetization is off. Donations and view rewards are paused.";
                } catch (error) {
                    monetizationToggle.checked = !monetizationToggle.checked;
                    if (monetizationStatus) monetizationStatus.textContent = error.message || "Could not save monetization settings.";
                } finally {
                    monetizationToggle.disabled = (!verified || !monetizationPlan) && monetizationToggle.checked;
                }
            });
        }
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
        const file = input.files ? input.files[0] : null;
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
        if (file.type === "image/gif") {
            try {
                const rows = await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=plus_expires_at,plus_plan`);
                const profile = rows?.[0];
                const expiry = profile?.plus_expires_at ? new Date(profile.plus_expires_at) : null;
                if (profile?.plus_plan !== "lifetime" && (!expiry || expiry <= new Date())) {
                    throw new Error("Animated profile pictures require active WamsTube Plus.");
                }
            } catch (error) {
                if (status) status.textContent = error.message || "Could not check your WamsTube Plus membership.";
                input.value = "";
                return;
            }
        }
        if (file.size > 5 * 1024 * 1024) {
            if (status) status.textContent = "Profile pictures must be 5 MB or smaller.";
            input.value = "";
            return;
        }

        const extension = file.type === "image/gif"
            ? "gif"
            : (file.name.split(".").pop() || "jpg").replace(/[^a-zA-Z0-9]/g, "") || "jpg";
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

async function loadChannelSettingsVideos(ownerId) {
    const list = document.getElementById("channelSettingsVideoList");
    if (!list) return;
    list.textContent = "Loading your videos…";
    try {
        const videos = await supabaseRequest(`/rest/v1/videos?owner_id=eq.${encodeURIComponent(ownerId)}&select=id,title,created_at,storage_path,caption_path&order=created_at.desc`);
        list.replaceChildren();
        if (!videos.length) {
            list.textContent = "You haven’t uploaded any videos yet.";
            return;
        }
        videos.forEach(video => {
            const row = document.createElement("article");
            row.className = "channel-settings-video-row";
            const copy = document.createElement("div");
            const title = document.createElement("strong");
            title.textContent = video.title;
            const date = document.createElement("small");
            date.textContent = new Date(video.created_at).toLocaleDateString();
            copy.append(title, date);
            const button = document.createElement("button");
            button.type = "button";
            button.className = "channel-settings-delete";
            button.textContent = "Delete video";
            button.addEventListener("click", async () => {
                if (!window.confirm(`Permanently delete “${video.title}”? This cannot be undone.`)) return;
                button.disabled = true;
                button.textContent = "Deleting…";
                try {
                    await supabaseRequest(`/rest/v1/videos?id=eq.${encodeURIComponent(video.id)}&owner_id=eq.${encodeURIComponent(ownerId)}`, {
                        method: "DELETE",
                        headers: { Prefer: "return=minimal" }
                    });
                    const paths = [video.storage_path, video.caption_path].filter(Boolean);
                    let cleanupFailed = false;
                    try {
                        await Promise.all(paths.map(path => {
                            const encoded = path.split("/").map(encodeURIComponent).join("/");
                            return supabaseRequest(`/storage/v1/object/${MEDIA_BUCKET}/${encoded}`, { method: "DELETE" });
                        }));
                    } catch (cleanupError) {
                        cleanupFailed = true;
                        console.warn("Video row deleted, but some stored files could not be removed.", cleanupError);
                    }
                    await loadChannelSettingsVideos(ownerId);
                    document.querySelector(`#videoGrid .video-preview[data-video-id="${video.id}"]`)?.remove();
                    const empty = document.querySelector(".empty-channel");
                    if (cleanupFailed) window.alert("The video was deleted, but some stored media could not be fully cleaned up.");
                    if (empty && !document.getElementById("videoGrid")?.querySelector(".video-preview")) empty.hidden = false;
                } catch (error) {
                    button.disabled = false;
                    button.textContent = "Delete video";
                    window.alert(error.message || "Could not delete this video.");
                }
            });
            row.append(copy, button);
            list.appendChild(row);
        });
    } catch (error) {
        list.textContent = error.message || "Could not load your videos.";
    }
}

function setupChannelBannerUpload() {
    const input = document.getElementById("channelBannerFile");
    const banner = document.getElementById("channelBanner");
    const uploadLabel = document.getElementById("channelBannerUpload");
    const status = document.getElementById("channelBannerStatus");
    const dialog = document.getElementById("bannerCropDialog");
    const frame = document.getElementById("bannerCropFrame");
    const image = document.getElementById("bannerCropImage");
    const zoomControl = document.getElementById("bannerCropZoom");
    const cropHelp = document.getElementById("bannerCropHelp");
    const saveButton = document.getElementById("bannerCropSave");
    if (!input || !banner || !dialog || !frame || !image || !zoomControl || !saveButton) return;

    const session = currentSession();
    const profileId = new URLSearchParams(window.location.search).get("channel") || session?.user?.id;
    const isOwnChannel = Boolean(session?.user?.id && profileId === session.user.id);
    if (uploadLabel && isOwnChannel) uploadLabel.hidden = false;
    let objectUrl = "";
    let naturalWidth = 0;
    let naturalHeight = 0;
    let centerX = 0;
    let centerY = 0;
    let zoom = 1;
    let dragState = null;
    let animatedBanner = false;

    const closeCropper = () => {
        if (dialog.open) dialog.close();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = "";
        input.value = "";
    };
    const cropDimensions = () => {
        const width = Math.min(naturalWidth, naturalHeight * 16 / 9) / zoom;
        return { width, height: width * 9 / 16 };
    };
    const renderCropPreview = () => {
        if (!naturalWidth || !frame.clientWidth) return;
        const { width: cropWidth, height: cropHeight } = cropDimensions();
        centerX = Math.max(cropWidth / 2, Math.min(naturalWidth - cropWidth / 2, centerX));
        centerY = Math.max(cropHeight / 2, Math.min(naturalHeight - cropHeight / 2, centerY));
        const scale = frame.clientWidth / cropWidth;
        image.style.width = `${naturalWidth * scale}px`;
        image.style.height = `${naturalHeight * scale}px`;
        image.style.left = `${frame.clientWidth / 2 - centerX * scale}px`;
        image.style.top = `${frame.clientHeight / 2 - centerY * scale}px`;
    };

    input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        if (!session?.access_token || !session.user?.id || !isOwnChannel) {
            if (status) status.textContent = "Sign in to change your channel banner.";
            input.value = "";
            return;
        }
        if (!file.type.startsWith("image/")) {
            if (status) status.textContent = "Choose an image file.";
            input.value = "";
            return;
        }
        if (file.type === "image/gif") {
            try {
                const rows = await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=plus_expires_at,plus_plan`);
                const profile = rows?.[0];
                const expiry = profile?.plus_expires_at ? new Date(profile.plus_expires_at) : null;
                if (profile?.plus_plan !== "lifetime" && (!expiry || expiry <= new Date())) {
                    throw new Error("Animated banners require active WamsTube Plus.");
                }
            } catch (error) {
                if (status) status.textContent = error.message || "Could not check your WamsTube Plus membership.";
                input.value = "";
                return;
            }
        }
        if (file.size > 10 * 1024 * 1024) {
            if (status) status.textContent = "Banner images must be 10 MB or smaller.";
            input.value = "";
            return;
        }
        animatedBanner = file.type === "image/gif";
        if (zoomControl) zoomControl.disabled = animatedBanner;
        if (cropHelp) cropHelp.textContent = animatedBanner
            ? "Animated GIFs keep their motion and use a centered cover crop; repositioning is unavailable for animated files."
            : "Drag to reposition. The center guide shows what remains visible across devices.";
        if (animatedBanner && status) status.textContent = "Animated GIF selected. Its animation will be preserved; animated banners use a centered cover crop.";
        objectUrl = URL.createObjectURL(file);
        image.onload = () => {
            naturalWidth = image.naturalWidth;
            naturalHeight = image.naturalHeight;
            centerX = naturalWidth / 2;
            centerY = naturalHeight / 2;
            zoom = 1;
            zoomControl.value = "1";
            renderCropPreview();
            if (!dialog.open) dialog.showModal();
        };
        image.onerror = () => {
            if (status) status.textContent = "This image could not be opened.";
            closeCropper();
        };
        image.src = objectUrl;
    });

    zoomControl.addEventListener("input", () => {
        zoom = Number(zoomControl.value);
        renderCropPreview();
    });
    frame.addEventListener("pointerdown", event => {
        if (!naturalWidth || animatedBanner) return;
        dragState = { x: event.clientX, y: event.clientY, centerX, centerY };
        frame.setPointerCapture(event.pointerId);
    });
    frame.addEventListener("pointermove", event => {
        if (!dragState) return;
        const { width: cropWidth } = cropDimensions();
        const ratio = cropWidth / frame.clientWidth;
        centerX = dragState.centerX - (event.clientX - dragState.x) * ratio;
        centerY = dragState.centerY - (event.clientY - dragState.y) * ratio;
        renderCropPreview();
    });
    const endDrag = () => { dragState = null; };
    frame.addEventListener("pointerup", endDrag);
    frame.addEventListener("pointercancel", endDrag);
    window.addEventListener("resize", renderCropPreview);

    document.getElementById("bannerCropClose")?.addEventListener("click", closeCropper);
    document.getElementById("bannerCropCancel")?.addEventListener("click", closeCropper);
    dialog.addEventListener("click", event => { if (event.target === dialog) closeCropper(); });
    saveButton.addEventListener("click", async () => {
        if (!naturalWidth || !session?.user?.id) return;
        saveButton.disabled = true;
        if (status) status.textContent = "Preparing banner…";
        try {
            let bannerBlob;
            let contentType;
            let extension;
            if (animatedBanner) {
                bannerBlob = input.files?.[0];
                contentType = "image/gif";
                extension = "gif";
            } else {
                const { width: cropWidth, height: cropHeight } = cropDimensions();
                const canvas = document.createElement("canvas");
                canvas.width = 2560;
                canvas.height = 1440;
                const context = canvas.getContext("2d");
                context.drawImage(image, centerX - cropWidth / 2, centerY - cropHeight / 2, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
                bannerBlob = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not crop the banner image.")), "image/jpeg", 0.92));
                contentType = "image/jpeg";
                extension = "jpg";
            }
            const path = `${session.user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
            const encodedPath = path.split("/").map(encodeURIComponent).join("/");
            await supabaseRequest(`/storage/v1/object/wams-banners/${encodedPath}`, {
                method: "POST",
                headers: { "Content-Type": contentType, "x-upsert": "false" },
                body: bannerBlob
            });
            await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
                body: JSON.stringify({ banner_path: path })
            });
            banner.classList.add("has-custom-banner");
            banner.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, .25), rgba(0, 0, 0, .25)), url("${SUPABASE_URL}/storage/v1/object/public/wams-banners/${encodedPath}?v=${Date.now()}")`;
            if (status) status.textContent = "Channel banner updated.";
            closeCropper();
        } catch (error) {
            if (status) status.textContent = error.message || "Could not upload the channel banner.";
        } finally {
            saveButton.disabled = false;
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

async function applyUploadAvailability() {
    const open = document.getElementById("uploadButton");
    if (!open) return;
    try {
        const settings = await supabaseRequest(
            "/rest/v1/platform_settings?setting=eq.uploads_enabled&select=enabled"
        );
        const enabled = settings?.[0]?.enabled !== false;
        const session = currentSession();
        const profile = session?.user?.id
            ? await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=is_banned,is_suspected,plus_expires_at,plus_plan`)
            : [];
        const restricted = Boolean(profile?.[0]?.is_banned || profile?.[0]?.is_suspected);
        const plusActive = profile?.[0]?.plus_plan === "lifetime" || Boolean(profile?.[0]?.plus_expires_at && new Date(profile[0].plus_expires_at) > new Date());
        const sizeHelp = document.getElementById("uploadSizeHelp");
        if (sizeHelp) sizeHelp.textContent = `Maximum file size: ${plusActive ? "500 MB with Plus" : "100 MB on a standard account"}.`;
        open.disabled = !enabled || restricted;
        open.title = restricted
            ? "Uploads are locked while this account is restricted."
            : enabled ? "Upload Video" : "Uploads are currently disabled by an administrator.";
        open.setAttribute("aria-label", open.title);
    } catch (error) {
        console.warn("Could not load upload availability.", error);
    }
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
        const fileInput = document.getElementById("videoFile");
        const file = fileInput && fileInput.files ? fileInput.files[0] : null;
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
        let plusActive = false;
        try {
            const profiles = await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=plus_expires_at,plus_plan,is_banned,is_suspected`);
            const profile = profiles?.[0];
            if (!profile || profile.is_banned || profile.is_suspected) throw new Error("This account cannot upload videos.");
            plusActive = profile.plus_plan === "lifetime" || Boolean(profile.plus_expires_at && new Date(profile.plus_expires_at) > new Date());
        } catch (profileError) {
            if (error) error.textContent = profileError.message || "Could not verify upload access.";
            return;
        }
        const maxUploadSize = (plusActive ? 500 : 100) * 1024 * 1024;
        if (file.size > maxUploadSize) {
            if (error) error.textContent = `This file is too large. ${plusActive ? "WamsTube Plus" : "Standard accounts"} allow uploads up to ${plusActive ? "500 MB" : "100 MB"}.`;
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

async function setupInboxBadge() {
    const badge = document.getElementById("inboxUnreadCount");
    const session = currentSession();
    if (!badge || !session?.access_token || !session.user?.id) return;
    try {
        const rows = await supabaseRequest(`/rest/v1/inbox_notifications?recipient_id=eq.${encodeURIComponent(session.user.id)}&read_at=is.null&select=id&limit=99`);
        badge.textContent = rows.length > 99 ? "99+" : String(rows.length);
        badge.hidden = rows.length === 0;
    } catch (error) {
        console.warn("Could not load inbox badge.", error);
    }
}


function setupChannelVideoSearch() {
    const input = document.getElementById("channelVideoSearch");
    const grid = document.getElementById("videoGrid");
    if (!input || !grid) return;
    input.addEventListener("input", () => {
        const query = input.value.trim().toLowerCase();
        let visible = 0;
        grid.querySelectorAll(".video-preview").forEach(card => {
            const matches = !query || `${card.dataset.title || ""} ${card.dataset.author || ""}`.toLowerCase().includes(query);
            card.hidden = !matches;
            if (matches) visible++;
        });
        const empty = document.querySelector(".empty-channel");
        if (empty) {
            empty.hidden = visible > 0 || grid.querySelectorAll(".video-preview").length > 0;
            if (!visible && grid.querySelectorAll(".video-preview").length > 0) {
                empty.hidden = false;
                const title = empty.querySelector(".empty-channel-title");
                const text = empty.querySelector(".empty-channel-text");
                if (title) title.textContent = "No videos match that search";
                if (text) text.textContent = "Try a different title.";
            }
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
    setupInboxBadge();
    setupSearch();
    applyUploadAvailability();
    setupUpload();
    setupBadgeDialog();
    setupChannelPictureUpload();
    setupChannelBannerUpload();
    setupChannelVideoSearch();
    document.getElementById("refreshChannelSettingsVideos")?.addEventListener("click", () => {
        const session = currentSession();
        if (session?.user?.id) loadChannelSettingsVideos(session.user.id);
    });
    loadChannelHeader();
    renderSupabaseVideos();
});