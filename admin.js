"use strict";

const adminVideoList = document.getElementById("adminVideoList");
const adminChannelList = document.getElementById("adminChannelList");
const adminCommentList = document.getElementById("adminCommentList");
const adminReportList = document.getElementById("adminReportList");
const channelField = document.getElementById("adminChannelName");
const message = document.getElementById("adminMessage");
const uploadToggle = document.getElementById("toggleUploadsButton");
const uploadSettingStatus = document.getElementById("uploadSettingStatus");

const supabaseUrl = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
const anonKey = window.WAMS_SUPABASE_ANON_KEY || "";

let session = null;

try {
    session = JSON.parse(localStorage.getItem("wamsTubeSession") || "null");
} catch {
    session = null;
}

let videos = [];
let channels = [];
let comments = [];
let likes = [];
let follows = [];
let views = [];
let wallets = [];
let reports = [];

let remoteAdmin = false;
let uploadsEnabled = true;

const selectedVideos = new Set();
const selectedChannels = new Set();
const selectedComments = new Set();
const selectedReports = new Set();
let customBadgeTypes = [];

const badgeChoices = [
    ["admin", "Admin"],
    ["owner", "Owner"],
    ["co_owner", "Co-Owner"],
    ["partner", "Partner"],
    ["developer", "Developer"],
    ["moderator", "Moderator"],
    ["creator", "Creator"],
    ["early_supporter", "Early Supporter"],
    ["founding_member", "Founding Member"],
    ["premium", "Plus Member"]
];

function notify(text) {
    if (message) message.textContent = text;
}

function setModerationEnabled(enabled) {
    document
        .querySelectorAll(".admin-page button, .admin-page input, .admin-page select")
        .forEach(element => {
            element.disabled = !enabled;
        });
}

function renderUploadSetting() {
    if (uploadToggle) {
        uploadToggle.disabled = !remoteAdmin;
        uploadToggle.textContent = uploadsEnabled ? "Disable uploads" : "Enable uploads";
    }
    if (uploadSettingStatus) {
        uploadSettingStatus.textContent = uploadsEnabled
            ? "Uploads are enabled for everyone."
            : "Uploads are disabled for everyone.";
    }
}

async function loadUploadSetting() {
    const rows = await api(
        "platform_settings?setting=eq.uploads_enabled&select=enabled"
    );
    if (!rows?.length) {
        throw new Error("Upload setting is missing. Apply the latest supabase.sql schema first.");
    }
    uploadsEnabled = rows[0].enabled !== false;
    renderUploadSetting();
}

async function toggleUploads() {
    if (!remoteAdmin || !uploadToggle) return;
    uploadToggle.disabled = true;
    try {
        await api("platform_settings?setting=eq.uploads_enabled", {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Prefer: "return=minimal"
            },
            body: JSON.stringify({ enabled: !uploadsEnabled })
        });
        uploadsEnabled = !uploadsEnabled;
        renderUploadSetting();
        notify(`Uploads ${uploadsEnabled ? "enabled" : "disabled"} for everyone.`);
    } catch (error) {
        notify(error.message);
        uploadToggle.disabled = false;
    }
}

async function api(path, options = {}) {
    if (!supabaseUrl || !anonKey) {
        throw new Error("Supabase is not configured.");
    }

    const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
        ...options,
        headers: {
            apikey: anonKey,
            ...(session?.access_token
                ? { Authorization: `Bearer ${session.access_token}` }
                : {}),
            ...(options.headers || {})
        }
    });

    if (!response.ok) {
        const text = await response.text();
        let detail = text;

        try {
            const data = JSON.parse(text);
            detail = data.message || data.msg || data.hint || text;
        } catch {
            // Keep the original response text.
        }

        throw new Error(
            detail || `Supabase request failed (${response.status}).`
        );
    }

    if (response.status === 204) return null;

    const text = await response.text();
    return text ? JSON.parse(text) : null;
}

async function allRows(table, select, orderColumn = "created_at") {
    const rows = [];

    for (let start = 0; start < 10000; start += 500) {
        const batch = await api(
            `${table}?select=${encodeURIComponent(select)}&order=${orderColumn}.desc`,
            {
                headers: {
                    Range: `${start}-${start + 499}`
                }
            }
        );

        rows.push(...batch);

        if (batch.length < 500) break;
    }

    return rows;
}

async function storageDelete(path) {
    if (!path) return;

    const encoded = path
        .split("/")
        .map(encodeURIComponent)
        .join("/");

    const response = await fetch(
        `${supabaseUrl}/storage/v1/object/wams-media/${encoded}`,
        {
            method: "DELETE",
            headers: {
                apikey: anonKey,
                Authorization: `Bearer ${session.access_token}`
            }
        }
    );

    if (!response.ok && response.status !== 404) {
        throw new Error("Could not delete stored media.");
    }
}

async function checkAdmin() {
    if (!session?.access_token || !session.user?.id) {
        return false;
    }

    const rows = await api(
        `profiles?id=eq.${encodeURIComponent(
            session.user.id
        )}&select=is_admin,is_owner,is_banned,is_suspected`
    );

    return Boolean(rows[0]?.is_admin && !rows[0]?.is_banned && !rows[0]?.is_suspected);
}

function escapeFilter(value) {
    return encodeURIComponent(value);
}

function csvDownload(filename, rows) {
    if (!rows.length) {
        notify("There is no data to export.");
        return;
    }

    const keys = Object.keys(rows[0]);

    const quote = value =>
        `"${String(value ?? "").replaceAll('"', '""')}"`;

    const csv = [
        keys.map(quote).join(","),
        ...rows.map(row =>
            keys.map(key => quote(row[key])).join(",")
        )
    ].join("\r\n");

    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" })
    );

    link.href = objectUrl;
    link.download = filename;
    link.click();

    URL.revokeObjectURL(objectUrl);

    notify(`Exported ${rows.length} row(s) to ${filename}.`);
}

function button(text, action, className = "") {
    const element = document.createElement("button");

    element.type = "button";
    element.textContent = text;

    if (className) {
        element.className = className;
    }

    element.addEventListener("click", action);

    return element;
}

function checkbox(set, id) {
    const input = document.createElement("input");

    input.type = "checkbox";
    input.checked = set.has(id);
    input.setAttribute("aria-label", "Select row");

    input.addEventListener("change", () => {
        if (input.checked) {
            set.add(id);
        } else {
            set.delete(id);
        }
    });

    return input;
}

function stat(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = Number(value || 0).toLocaleString();
    }
}

function updateStats() {
    stat("statChannels", channels.length);
    stat("statBanned", channels.filter(row => row.is_banned).length);
    stat("statVideos", videos.length);

    stat(
        "statPublic",
        videos.filter(row => row.visibility === "public" && !row.is_deleted).length
    );

    stat(
        "statPrivate",
        videos.filter(row => row.visibility === "private" && !row.is_deleted).length
    );

    stat(
        "statRemoved",
        videos.filter(row => row.is_deleted).length
    );

    stat("statShorts", videos.filter(row => row.is_short).length);
    stat("statComments", comments.length);
    stat("statLikes", likes.length);
    stat("statFollows", follows.length);
    stat("statViews", views.length);
    stat("statVerified", channels.filter(row => row.admin_verified).length);
    stat("statReports", reports.length);
    stat(
        "statPendingReports",
        reports.filter(row => row.status === "pending").length
    );
    stat("statSuspicious", channels.filter(row => row.is_suspected).length);
}

async function loadDashboard() {
    notify("Loading platform data…");

    [
        videos,
        channels,
        comments,
        likes,
        follows,
        views,
        wallets,
        reports
    ] = await Promise.all([
        allRows(
            "videos",
            "id,title,owner_id,storage_path,visibility,is_short,is_deleted,takedown_reason,takedown_by,created_at"
        ),

        allRows(
            "profiles",
            "id,channel_name,is_admin,is_banned,is_suspected,admin_verified,created_at"
        ),

        allRows(
            "video_comments",
            "id,video_id,user_id,body,created_at"
        ),

        allRows(
            "video_likes",
            "video_id,user_id,created_at"
        ),

        allRows(
            "channel_follows",
            "channel_id,follower_id,created_at"
        ),

        allRows(
            "video_views",
            "video_id,viewer_id,viewed_at",
            "viewed_at"
        ),

        allRows(
            "wams_wallets",
            "user_id,balance",
            "updated_at"
        ),

        allRows(
            "video_reports",
            "id,video_id,reporter_id,reason,details,status,reviewed_by,reviewed_at,created_at"
        )
    ]);

    updateStats();
    renderInboxRecipients();
    renderVideos();
    renderChannels();
    renderComments();
    renderReports();

    notify(
        `Dashboard refreshed · ${videos.length} videos, ${channels.length} channels, ${comments.length} comments, ${reports.length} reports.`
    );
    refreshActivitySpikes();
}

function filteredVideos() {
    const searchInput = document.getElementById("videoSearch");
    const visibilityInput = document.getElementById("videoVisibilityFilter");
    const statusInput = document.getElementById("videoStatusFilter");
    const sortInput = document.getElementById("videoSort");

    const term = searchInput?.value.trim().toLowerCase() || "";
    const visibility = visibilityInput?.value || "all";
    const status = statusInput?.value || "all";
    const sort = sortInput?.value || "newest";

    const names = new Map(
        channels.map(row => [row.id, row.channel_name])
    );

    let result = videos.filter(video => {
        const searchable =
            `${video.title} ${names.get(video.owner_id) || ""}`.toLowerCase();

        const matchesStatus =
            status === "all" ||
            (status === "active" && !video.is_deleted) ||
            (status === "removed" && video.is_deleted) ||
            (status === "shorts" && video.is_short) ||
            (status === "regular" && !video.is_short);

        return (
            (!term || searchable.includes(term)) &&
            (visibility === "all" || video.visibility === visibility) &&
            matchesStatus
        );
    });

    if (sort === "oldest") {
        result = [...result].reverse();
    }

    if (sort === "title") {
        result.sort((a, b) =>
            String(a.title || "").localeCompare(String(b.title || ""))
        );
    }

    return result;
}

function renderVideos() {
    if (!adminVideoList) return;

    const result = filteredVideos();
    adminVideoList.replaceChildren();

    const count = document.getElementById("videoResultCount");

    if (count) {
        count.textContent = `${result.length} matching video(s)`;
    }

    result.forEach(video => {
        const row = document.createElement("article");
        row.className = "admin-video-row admin-record";

        const selection = checkbox(selectedVideos, video.id);

        const info = document.createElement("div");
        info.className = "admin-record-info";

        const title = document.createElement("strong");
        title.textContent = video.title;

        const owner =
            channels.find(channel => channel.id === video.owner_id)
                ?.channel_name || "Unknown channel";

        const videoReports = reports.filter(
            report => report.video_id === video.id
        );

        const pendingReports = videoReports.filter(
            report => report.status === "pending"
        ).length;

        const detail = document.createElement("span");

        const reportSummary = videoReports.length
            ? ` · ${videoReports.length} report${
                  videoReports.length === 1 ? "" : "s"
              }`
            : "";

        const pendingSummary = pendingReports
            ? ` · ${pendingReports} pending`
            : "";

        detail.textContent =
            `${owner} · ${video.visibility} · ` +
            `${video.is_short ? "Short" : "Video"} · ` +
            `${
                video.is_deleted
                    ? `Taken down: ${
                          video.takedown_reason || "no reason recorded"
                      }`
                    : "Active"
            }` +
            reportSummary +
            pendingSummary;

        info.append(title, detail);

        const actions = document.createElement("div");
        actions.className = "admin-record-actions";

        actions.append(
            button("Edit title", () => editVideoTitle(video)),

            button(
                video.visibility === "public"
                    ? "Make private"
                    : "Make public",
                () =>
                    patchVideo(video, {
                        visibility:
                            video.visibility === "public"
                                ? "private"
                                : "public"
                    })
            ),

            button(
                video.is_short ? "Mark regular" : "Mark Short",
                () => patchVideo(video, { is_short: !video.is_short })
            ),

            button(
                video.is_deleted ? "Restore" : "Take down",
                () => toggleVideoRemoval(video)
            ),

            button(
                `View reports${
                    pendingReports ? ` (${pendingReports})` : ""
                }`,
                () => focusReportsForVideo(video.id),
                pendingReports ? "admin-report-attention" : ""
            ),

            button(
                "Delete permanently",
                () => deleteVideo(video),
                "danger"
            )
        );

        row.append(selection, info, actions);
        adminVideoList.appendChild(row);
    });
}

async function patchVideo(video, patch) {
    try {
        await api(`videos?id=eq.${escapeFilter(video.id)}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Prefer: "return=minimal"
            },
            body: JSON.stringify(patch)
        });

        await loadDashboard();
    } catch (error) {
        notify(error.message);
    }
}

async function editVideoTitle(video) {
    const value = window.prompt("Edit video title:", video.title);

    if (value === null) return;

    const title = value.trim();

    if (!title) {
        notify("A video title cannot be empty.");
        return;
    }

    await patchVideo(video, {
        title: title.slice(0, 100)
    });
}

async function toggleVideoRemoval(video) {
    const reason = video.is_deleted
        ? ""
        : window.prompt("Why is this video being taken down?");

    if (!video.is_deleted && !reason?.trim()) {
        return;
    }

    await patchVideo(
        video,
        video.is_deleted
            ? {
                  is_deleted: false,
                  takedown_reason: null,
                  takedown_by: null
              }
            : {
                  is_deleted: true,
                  takedown_reason: reason.trim(),
                  takedown_by: session.user.id
              }
    );
}

async function deleteVideo(video) {
    const confirmed = window.confirm(
        `Permanently delete “${video.title}” and its media? This cannot be undone.`
    );

    if (!confirmed) return;

    try {
        await storageDelete(video.storage_path);

        await api(`videos?id=eq.${escapeFilter(video.id)}`, {
            method: "DELETE",
            headers: {
                Prefer: "return=minimal"
            }
        });

        notify("Video and stored media permanently deleted.");
        await loadDashboard();
    } catch (error) {
        notify(error.message);
    }
}

async function bulkVideoAction(action) {
    const chosen = videos.filter(row => selectedVideos.has(row.id));

    if (!chosen.length) {
        notify("Select at least one visible video.");
        return;
    }

    if (
        action === "delete" &&
        !window.confirm(
            `Permanently delete ${chosen.length} selected video(s) and their media?`
        )
    ) {
        return;
    }

    if (
        action === "remove" &&
        !window.confirm(
            `Take down ${chosen.length} selected video(s)?`
        )
    ) {
        return;
    }

    try {
        for (const video of chosen) {
            if (action === "delete") {
                await storageDelete(video.storage_path);

                await api(
                    `videos?id=eq.${escapeFilter(video.id)}`,
                    {
                        method: "DELETE"
                    }
                );
            } else if (action === "remove") {
                await api(
                    `videos?id=eq.${escapeFilter(video.id)}`,
                    {
                        method: "PATCH",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            is_deleted: true,
                            takedown_reason: "Removed by administrator",
                            takedown_by: session.user.id
                        })
                    }
                );
            } else {
                await api(
                    `videos?id=eq.${escapeFilter(video.id)}`,
                    {
                        method: "PATCH",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            is_deleted: false,
                            takedown_reason: null,
                            takedown_by: null
                        })
                    }
                );
            }
        }

        selectedVideos.clear();

        notify(
            `Finished ${action} action for ${chosen.length} video(s).`
        );

        await loadDashboard();
    } catch (error) {
        notify(error.message);
    }
}

function filteredChannels() {
    const searchInput = document.getElementById("channelSearch");
    const statusInput = document.getElementById("channelStatusFilter");
    const sortInput = document.getElementById("channelSort");

    const term = searchInput?.value.trim().toLowerCase() || "";
    const status = statusInput?.value || "all";
    const sort = sortInput?.value || "newest";

    let result = channels.filter(row => {
        const name = String(row.channel_name || "").toLowerCase();

        return (
            (!term || name.includes(term)) &&
            (status === "all" ||
                (status === "active" && !row.is_banned && !row.is_suspected) ||
                (status === "banned" && row.is_banned) ||
                (status === "suspected" && row.is_suspected) ||
                (status === "verified" && row.admin_verified) ||
                (status === "admins" && row.is_admin))
        );
    });

    if (sort === "oldest") {
        result = [...result].reverse();
    }

    if (sort === "name") {
        result.sort((a, b) =>
            String(a.channel_name || "").localeCompare(
                String(b.channel_name || "")
            )
        );
    }

    return result;
}

function renderInboxRecipients() {
    const select = document.getElementById("inboxRecipient");
    if (!select) return;
    const selected = select.value;
    select.replaceChildren();
    const all = document.createElement("option");
    all.value = "all";
    all.textContent = "All channels";
    select.appendChild(all);
    channels.forEach(profile => {
        const option = document.createElement("option");
        option.value = profile.id;
        option.textContent = profile.channel_name;
        select.appendChild(option);
    });
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
}

async function sendInboxMessage() {
    const recipient = document.getElementById("inboxRecipient");
    const titleField = document.getElementById("inboxMessageTitle");
    const bodyField = document.getElementById("inboxMessageBody");
    const sendButton = document.getElementById("sendInboxMessage");
    const title = titleField?.value.trim() || "";
    const body = bodyField?.value.trim() || "";
    if (!title || !body) {
        notify("Enter a subject and message before sending.");
        return;
    }
    if (title.length > 120 || body.length > 2000) {
        notify("The subject or message is too long.");
        return;
    }
    if (sendButton) sendButton.disabled = true;
    try {
        const result = await api("rpc/admin_send_inbox_message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                target: recipient?.value === "all" ? null : recipient?.value,
                message_title: title,
                message_body: body
            })
        });
        notify(`Important message sent to ${Number(result || 0).toLocaleString()} channel(s).`);
        if (bodyField) bodyField.value = "";
    } catch (error) {
        notify(error.message);
    } finally {
        if (sendButton) sendButton.disabled = !remoteAdmin;
    }
}

function renderChannels() {
    if (!adminChannelList) return;

    const result = filteredChannels();
    adminChannelList.replaceChildren();

    const count = document.getElementById("channelResultCount");

    if (count) {
        count.textContent = `${result.length} matching channel(s)`;
    }

    result.forEach(profile => {
        const row = document.createElement("article");
        row.className = "admin-video-row admin-record";

        const selection = checkbox(selectedChannels, profile.id);

        const info = document.createElement("div");
        info.className = "admin-record-info";

        const title = document.createElement("strong");
        title.textContent = profile.channel_name;

        const bucks =
            wallets.find(wallet => wallet.user_id === profile.id)?.balance || 0;

        const detail = document.createElement("span");

        detail.textContent =
            `${profile.is_banned ? "Banned" : profile.is_suspected ? "Under suspicion" : "Active"}` +
            `${profile.admin_verified ? " · Admin-verified" : ""}` +
            `${profile.is_admin ? " · Administrator" : ""}` +
            ` · ${Number(bucks).toLocaleString()} Wams Bucks` +
            ` · Joined ${new Date(
                profile.created_at
            ).toLocaleDateString()}`;

        info.append(title, detail);

        const actions = document.createElement("div");
        actions.className = "admin-record-actions";

        actions.append(
            button(
                profile.is_banned ? "Unban" : "Ban",
                () =>
                    patchChannel(profile, {
                        is_banned: !profile.is_banned
                    })
            ),

            button(
                profile.admin_verified
                    ? "Remove verification"
                    : "Verify",
                () =>
                    patchChannel(profile, {
                        admin_verified: !profile.admin_verified
                    })
            ),

            button("Rename", () => renameChannel(profile)),
            button("Grant Wams Bucks", () => grantWamsBucks(profile)),
            button("Grant Game USD", () => grantGameUsd(profile)),
            button("Delete all videos", () => deleteChannelVideos(profile)),
            button(
                "Delete account profile",
                () => deleteChannelProfile(profile),
                "danger"
            )
        );

        const suspicionButton = document.createElement("button");
        suspicionButton.type = "button";
        suspicionButton.className = profile.is_suspected ? "admin-suspicion-button is-locked" : "admin-suspicion-button";
        suspicionButton.setAttribute("aria-label", profile.is_suspected ? "Clear account suspicion" : "Put account under suspicion");
        suspicionButton.title = profile.is_suspected ? "Clear account suspicion" : "Put account under suspicion";
        const suspicionIcon = document.createElement("span");
        suspicionIcon.className = "material-symbols-rounded";
        suspicionIcon.setAttribute("aria-hidden", "true");
        suspicionIcon.textContent = "vpn_lock_2";
        suspicionButton.append(suspicionIcon, document.createTextNode(profile.is_suspected ? "Clear suspicion" : "Put under suspicion"));
        suspicionButton.addEventListener("click", () => setChannelSuspicion(profile));
        actions.appendChild(suspicionButton);

        const badgeSelect = document.createElement("select");
        badgeSelect.className = "admin-badge-select";

        const promptOption = document.createElement("option");
        promptOption.value = "";
        promptOption.textContent = "Choose badge…";
        badgeSelect.appendChild(promptOption);

        badgeChoices.forEach(([value, label]) => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            badgeSelect.appendChild(option);
        });
        customBadgeTypes.forEach(badge => {
            const option = document.createElement("option");
            option.value = badge.badge_type;
            option.textContent = badge.label;
            badgeSelect.appendChild(option);
        });

        actions.append(
            badgeSelect,
            button(
                "Grant badge",
                () => setChannelBadge(profile, badgeSelect.value, true)
            ),
            button(
                "Remove badge",
                () => setChannelBadge(profile, badgeSelect.value, false)
            )
        );

        row.append(selection, info, actions);
        adminChannelList.appendChild(row);
    });
}

async function grantWamsBucks(profile) {
    const rawAmount = window.prompt(
        `How many Wams Bucks should be granted to ${profile.channel_name}? (1–100000)`
    );

    if (rawAmount === null) return;

    const amount = Number(rawAmount);

    if (
        !Number.isInteger(amount) ||
        amount < 1 ||
        amount > 100000
    ) {
        notify("Enter a whole number from 1 to 100000.");
        return;
    }

    const note = window.prompt(
        "Reason for this grant:",
        "Administrator grant"
    );

    if (note === null) return;

    try {
        const result = await api("rpc/admin_grant_wams_bucks", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                target: profile.id,
                bucks: amount,
                note
            })
        });

        notify(
            `Granted ${amount.toLocaleString()} Wams Bucks to ${
                profile.channel_name
            }. New balance: ${Number(result).toLocaleString()}.`
        );

        await loadDashboard();
    } catch (error) {
        notify(error.message);
    }
}

async function grantGameUsd(profile) {
    const rawAmount = window.prompt(
        `How many Game USD should be granted to ${profile.channel_name}? Enter dollars and cents (maximum $1,000,000.00).`,
        "1.00"
    );
    if (rawAmount === null) return;
    const amountText = rawAmount.trim();
    if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(amountText)) {
        notify("Enter a valid Game USD amount with up to two decimal places.");
        return;
    }
    const cents = Math.round(Number(amountText) * 100);
    if (!Number.isSafeInteger(cents) || cents < 1 || cents > 100000000) {
        notify("Grant between $0.01 and $1,000,000.00 Game USD.");
        return;
    }
    const note = window.prompt("Reason for this Game USD grant:", "Administrator grant");
    if (note === null) return;
    try {
        const result = await api("rpc/admin_grant_game_usd", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target: profile.id, cents, note })
        });
        notify(`Granted $${(cents / 100).toFixed(2)} Game USD to ${profile.channel_name}. New balance: $${(Number(result || 0) / 100).toFixed(2)}.`);
    } catch (error) {
        notify(error.message || "Could not grant Game USD. Apply wams-game-wallet.sql first.");
    }
}

async function setChannelSuspicion(profile) {
    const suspicious = !profile.is_suspected;
    if (suspicious && !window.confirm(`Put ${profile.channel_name} under suspicion? Wams Bucks, uploads, channel discovery, and posting will be restricted until an admin clears the review.`)) return;
    const reason = suspicious ? window.prompt("Reason for this review:", "Unusual account activity") : null;
    if (suspicious && reason === null) return;
    try {
        await api("rpc/admin_set_account_suspicion", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target: profile.id, suspicious, reason })
        });
        notify(suspicious
            ? `${profile.channel_name} is now under suspicion. A notification was sent and restricted features are locked.`
            : `Suspicion cleared for ${profile.channel_name}.`);
        await loadDashboard();
    } catch (error) {
        notify(error.message);
    }
}

async function refreshActivitySpikes() {
    const list = document.getElementById("activitySpikeList");
    const status = document.getElementById("activityRiskStatus");
    if (!list || !remoteAdmin) return;
    const refreshButton = document.getElementById("refreshActivitySpikes");
    if (refreshButton) refreshButton.disabled = true;
    if (status) status.textContent = "Checking Wams Bucks and subscriber activity…";
    try {
        const candidates = await api("rpc/admin_activity_spike_candidates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}"
        });
        list.replaceChildren();
        if (!candidates.length) {
            const empty = document.createElement("p");
            empty.className = "admin-empty-state";
            empty.textContent = "No unusual hourly activity spikes found.";
            list.appendChild(empty);
        }
        candidates.forEach(candidate => {
            const row = document.createElement("article");
            row.className = "admin-video-row admin-record";
            const info = document.createElement("div");
            info.className = "admin-record-info";
            const name = document.createElement("strong");
            name.textContent = candidate.channel_name;
            const detail = document.createElement("span");
            detail.textContent = `Last hour: ${Number(candidate.bucks_last_hour).toLocaleString()} Wams Bucks (prior-hour average ${Number(candidate.bucks_hourly_baseline).toFixed(1)}); ${candidate.follows_last_hour} new subscribers (prior-hour average ${Number(candidate.follows_hourly_baseline).toFixed(1)}).${candidate.is_suspected ? " Already under suspicion." : ""}`;
            info.append(name, detail);
            const actions = document.createElement("div");
            actions.className = "admin-record-actions";
            actions.appendChild(button("Review channel", () => {
                const search = document.getElementById("channelSearch");
                const filter = document.getElementById("channelStatusFilter");
                if (search) search.value = candidate.channel_name;
                if (filter) filter.value = "all";
                renderChannels();
                document.getElementById("adminChannelList")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }));
            row.append(info, actions);
            list.appendChild(row);
        });
        if (status) status.textContent = `Activity checked ${new Date().toLocaleString()}. Spike matches are review signals only.`;
    } catch (error) {
        if (status) status.textContent = error.message || "Could not check activity spikes. Apply the updated database schema first.";
    } finally {
        if (refreshButton) refreshButton.disabled = !remoteAdmin;
    }
}

async function patchChannel(profile, patch) {
    try {
        await api(
            `profiles?id=eq.${escapeFilter(profile.id)}`,
            {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Prefer: "return=minimal"
                },
                body: JSON.stringify(patch)
            }
        );

        await loadDashboard();
    } catch (error) {
        notify(error.message);
    }
}

async function renameChannel(profile) {
    const name = window.prompt(
        "New channel name (up to 40 characters):",
        profile.channel_name
    );

    if (name === null) return;

    if (!name.trim()) {
        notify("Channel name cannot be blank.");
        return;
    }

    await patchChannel(profile, {
        channel_name: name.trim().slice(0, 40)
    });
}

async function setChannelBadge(profile, badge, grant) {
    if (!badge) {
        notify("Choose a badge first.");
        return;
    }

    try {
        const query =
            `profile_badges?profile_id=eq.${escapeFilter(
                profile.id
            )}&badge_type=eq.${escapeFilter(badge)}`;

        if (grant) {
            await api(
                "profile_badges?on_conflict=profile_id,badge_type",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Prefer:
                            "resolution=ignore-duplicates,return=minimal"
                    },
                    body: JSON.stringify({
                        profile_id: profile.id,
                        badge_type: badge,
                        granted_by: session.user.id
                    })
                }
            );
        } else {
            await api(query, {
                method: "DELETE",
                headers: {
                    Prefer: "return=minimal"
                }
            });
        }

        notify(
            `${badge.replaceAll("_", " ")} badge ${
                grant ? "granted to" : "removed from"
            } ${profile.channel_name}.`
        );
    } catch (error) {
        notify(error.message);
    }
}

async function deleteChannelVideos(profile) {
    const owned = videos.filter(
        video => video.owner_id === profile.id
    );

    if (!owned.length) {
        notify("This channel has no videos to delete.");
        return;
    }

    if (
        !window.confirm(
            `Permanently delete ${owned.length} video(s) belonging to ${profile.channel_name}?`
        )
    ) {
        return;
    }

    try {
        for (const video of owned) {
            await storageDelete(video.storage_path);

            await api(
                `videos?id=eq.${escapeFilter(video.id)}`,
                {
                    method: "DELETE"
                }
            );
        }

        notify(
            `Deleted ${owned.length} video(s) for ${profile.channel_name}.`
        );

        await loadDashboard();
    } catch (error) {
        notify(error.message);
    }
}

async function deleteChannelProfile(profile) {
    if (profile.id === session.user.id) {
        notify("You cannot delete your own administrator profile here.");
        return;
    }

    if (
        !window.confirm(
            `Delete ${profile.channel_name}'s profile and all of their videos? Their Supabase Auth login remains, but the channel data and uploaded media will be removed.`
        )
    ) {
        return;
    }

    try {
        const ownedVideos = videos.filter(
            video => video.owner_id === profile.id
        );

        for (const video of ownedVideos) {
            await storageDelete(video.storage_path);

            await api(
                `videos?id=eq.${escapeFilter(video.id)}`,
                {
                    method: "DELETE"
                }
            );
        }

        await api(
            `profiles?id=eq.${escapeFilter(profile.id)}`,
            {
                method: "DELETE",
                headers: {
                    Prefer: "return=minimal"
                }
            }
        );

        notify(
            `Channel profile and ${ownedVideos.length} video(s) deleted. Supabase Auth account was not deleted.`
        );

        await loadDashboard();
    } catch (error) {
        notify(error.message);
    }
}

async function bulkChannelAction(banned) {
    const chosen = channels.filter(row =>
        selectedChannels.has(row.id)
    );

    if (!chosen.length) {
        notify("Select at least one visible channel.");
        return;
    }

    try {
        for (const profile of chosen) {
            await api(
                `profiles?id=eq.${escapeFilter(profile.id)}`,
                {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        is_banned: banned
                    })
                }
            );
        }

        selectedChannels.clear();

        notify(
            `${banned ? "Banned" : "Unbanned"} ${chosen.length} channel(s).`
        );

        await loadDashboard();
    } catch (error) {
        notify(error.message);
    }
}

function filteredComments() {
    const searchInput = document.getElementById("commentSearch");
    const sortInput = document.getElementById("commentSort");

    const term = searchInput?.value.trim().toLowerCase() || "";
    const sort = sortInput?.value || "newest";

    const names = new Map(
        channels.map(row => [row.id, row.channel_name])
    );

    let result = comments.filter(comment => {
        const searchable =
            `${comment.body} ${names.get(comment.user_id) || ""} ${
                videos.find(video => video.id === comment.video_id)?.title || ""
            }`.toLowerCase();

        return searchable.includes(term);
    });

    if (sort === "oldest") {
        result = [...result].reverse();
    }

    return result;
}

function renderComments() {
    if (!adminCommentList) return;

    const result = filteredComments();
    adminCommentList.replaceChildren();

    const count = document.getElementById("commentResultCount");

    if (count) {
        count.textContent = `${result.length} matching comment(s)`;
    }

    result.forEach(comment => {
        const row = document.createElement("article");
        row.className = "admin-video-row admin-record";

        const selection = checkbox(selectedComments, comment.id);

        const info = document.createElement("div");
        info.className = "admin-record-info";

        const author =
            channels.find(channel => channel.id === comment.user_id)
                ?.channel_name || "Unknown channel";

        const video =
            videos.find(item => item.id === comment.video_id)?.title ||
            "Unknown video";

        const title = document.createElement("strong");
        title.textContent = `${author} on ${video}`;

        const body = document.createElement("span");
        body.textContent =
            `${comment.body} · ` +
            `${new Date(comment.created_at).toLocaleString()}`;

        info.append(title, body);

        row.append(
            selection,
            info,
            button(
                "Delete comment",
                () => deleteComment(comment),
                "danger"
            )
        );

        adminCommentList.appendChild(row);
    });
}

async function deleteComment(comment) {
    if (!window.confirm("Delete this comment?")) return;

    try {
        await api(
            `video_comments?id=eq.${escapeFilter(comment.id)}`,
            {
                method: "DELETE",
                headers: {
                    Prefer: "return=minimal"
                }
            }
        );

        notify("Comment deleted.");
        await loadDashboard();
    } catch (error) {
        notify(error.message);
    }
}

async function bulkDeleteComments() {
    const chosen = comments.filter(row =>
        selectedComments.has(row.id)
    );

    if (!chosen.length) {
        notify("Select at least one visible comment.");
        return;
    }

    if (
        !window.confirm(
            `Permanently delete ${chosen.length} selected comments?`
        )
    ) {
        return;
    }

    try {
        for (const comment of chosen) {
            await api(
                `video_comments?id=eq.${escapeFilter(comment.id)}`,
                {
                    method: "DELETE"
                }
            );
        }

        selectedComments.clear();

        notify(`Deleted ${chosen.length} comment(s).`);
        await loadDashboard();
    } catch (error) {
        notify(error.message);
    }
}

function filteredReports() {
    const searchInput = document.getElementById("reportSearch");
    const statusInput = document.getElementById("reportStatusFilter");
    const sortInput = document.getElementById("reportSort");

    const term = searchInput?.value.trim().toLowerCase() || "";
    const status = statusInput?.value || "pending";
    const sort = sortInput?.value || "newest";

    let result = reports.filter(report => {
        const video =
            videos.find(item => item.id === report.video_id);

        const reporter =
            channels.find(item => item.id === report.reporter_id);

        const searchable =
            `${video?.title || ""} ${report.reason} ${
                report.details || ""
            } ${reporter?.channel_name || ""}`.toLowerCase();

        return (
            (!term || searchable.includes(term)) &&
            (status === "all" || report.status === status)
        );
    });

    if (sort === "oldest") {
        result = [...result].reverse();
    }

    return result;
}

function renderReports() {
    if (!adminReportList) return;

    const result = filteredReports();
    adminReportList.replaceChildren();

    const count = document.getElementById("reportResultCount");

    if (count) {
        count.textContent = `${result.length} matching report(s)`;
    }

    if (!result.length) {
        const empty = document.createElement("p");
        empty.className = "admin-empty-state";
        empty.textContent = "No reports match the selected filter.";
        adminReportList.appendChild(empty);
        return;
    }

    result.forEach(report => {
        const video =
            videos.find(item => item.id === report.video_id);

        const reporter =
            channels.find(item => item.id === report.reporter_id);

        const reviewer =
            channels.find(item => item.id === report.reviewed_by);

        const row = document.createElement("article");
        row.className = "admin-video-row admin-record";

        const selection = checkbox(selectedReports, report.id);

        const info = document.createElement("div");
        info.className = "admin-record-info";

        const title = document.createElement("strong");
        title.textContent = video?.title || "Unknown video";

        const metadata = document.createElement("span");
        metadata.textContent =
            `${reporter?.channel_name || "Unknown reporter"} · ` +
            `${report.reason} · ` +
            `${new Date(report.created_at).toLocaleString()} · ` +
            `Status: ${report.status}`;

        info.append(title, metadata);

        if (report.details) {
            const details = document.createElement("p");
            details.className = "admin-report-details";
            details.textContent = report.details;
            info.appendChild(details);
        }

        const actions = document.createElement("div");
        actions.className = "admin-record-actions";

        if (report.status === "pending") {
            actions.append(
                button(
                    "Accept and take down",
                    () => acceptReport(report),
                    "danger"
                ),
                button(
                    "Reject report",
                    () => rejectReport(report)
                )
            );
        } else {
            const reviewed = document.createElement("span");
            reviewed.className = "admin-report-review-status";
            reviewed.textContent =
                `${report.status === "accepted" ? "Accepted" : "Rejected"}` +
                `${reviewer ? ` by ${reviewer.channel_name}` : ""}`;

            actions.appendChild(reviewed);
        }

        if (video) {
            actions.appendChild(
                button(
                    "Open video controls",
                    () => focusVideo(video)
                )
            );
        }

        row.append(selection, info, actions);
        adminReportList.appendChild(row);
    });
}

async function reviewReport(report, decision) {
    const video =
        videos.find(item => item.id === report.video_id);

    if (decision === "accepted") {
        const confirmed = window.confirm(
            `Accept this report and take down “${
                video?.title || "this video"
            }”?`
        );

        if (!confirmed) return;
    }

    let takedownNote = null;

    if (decision === "accepted") {
        takedownNote = window.prompt(
            "Takedown reason:",
            report.reason
        );

        if (takedownNote === null) return;

        takedownNote =
            takedownNote.trim() || report.reason;
    }

    try {
        await api("rpc/review_video_report", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                report_id: report.id,
                decision,
                takedown_note: takedownNote
            })
        });

        notify(
            decision === "accepted"
                ? "Report accepted. The video was taken down."
                : "Report rejected."
        );

        selectedReports.delete(report.id);
        await loadDashboard();
    } catch (error) {
        notify(error.message);
    }
}

function acceptReport(report) {
    return reviewReport(report, "accepted");
}

function rejectReport(report) {
    return reviewReport(report, "rejected");
}

async function bulkReviewReports(decision) {
    const chosen = reports.filter(
        report =>
            selectedReports.has(report.id) &&
            report.status === "pending"
    );

    if (!chosen.length) {
        notify("Select at least one pending report.");
        return;
    }

    if (decision === "accepted") {
        const confirmed = window.confirm(
            `Accept ${chosen.length} report(s) and take down the affected video(s)?`
        );

        if (!confirmed) return;
    }

    try {
        for (const report of chosen) {
            await api("rpc/review_video_report", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    report_id: report.id,
                    decision,
                    takedown_note:
                        decision === "accepted"
                            ? report.reason
                            : null
                })
            });
        }

        selectedReports.clear();

        notify(
            decision === "accepted"
                ? `Accepted ${chosen.length} report(s) and took down the affected video(s).`
                : `Rejected ${chosen.length} report(s).`
        );

        await loadDashboard();
    } catch (error) {
        notify(error.message);
    }
}

function focusReportsForVideo(videoId) {
    const section = document.getElementById("adminReportsSection");
    const searchInput = document.getElementById("reportSearch");
    const video = videos.find(item => item.id === videoId);

    if (!video) return;

    if (searchInput) {
        searchInput.value = video.title;
    }

    renderReports();
    section?.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}

function focusVideo(video) {
    const searchInput = document.getElementById("videoSearch");
    const section = document.getElementById("adminVideoList");

    if (searchInput) {
        searchInput.value = video.title;
    }

    renderVideos();

    section?.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}

function selectVisible(set, filtered) {
    filtered().forEach(row => set.add(row.id));
    renderAll();
}

function renderAll() {
    renderVideos();
    renderChannels();
    renderComments();
    renderReports();
}

function matchingChannel() {
    return (channelField?.value || "").trim();
}

async function findChannel(name) {
    const row = channels.find(
        profile =>
            String(profile.channel_name || "").toLowerCase() ===
            name.toLowerCase()
    );

    if (!row) {
        throw new Error(
            "No channel found with that exact name."
        );
    }

    return row;
}

async function moderateChannel(action) {
    const name = matchingChannel();

    if (!name) {
        notify("Enter a channel name first.");
        return;
    }

    try {
        const profile = await findChannel(name);

        if (action === "delete") {
            await deleteChannelVideos(profile);
        } else if (action === "ban") {
            await patchChannel(profile, {
                is_banned: !profile.is_banned
            });
        } else {
            await patchChannel(profile, {
                admin_verified: !profile.admin_verified
            });
        }
    } catch (error) {
        notify(error.message);
    }
}

function updateStoreCodeFields() {
    const coupon = document.getElementById("storeCodeType")?.value === "coupon";
    const giftAmount = document.getElementById("storeGiftAmountField");
    const discountType = document.getElementById("storeDiscountTypeField");
    const discountValue = document.getElementById("storeDiscountValueField");
    if (giftAmount) giftAmount.hidden = coupon;
    if (discountType) discountType.hidden = !coupon;
    if (discountValue) discountValue.hidden = !coupon;
}

async function createStoreCode() {
    const status = document.getElementById("storeCodeStatus");
    const buttonElement = document.getElementById("createStoreCode");
    const code = document.getElementById("storeCodeValue")?.value.trim() || "";
    const code_type = document.getElementById("storeCodeType")?.value || "gift_card";
    const max_uses = Number(document.getElementById("storeCodeMaxUses")?.value);
    if (!/^[A-Za-z0-9-]{4,64}$/.test(code)) {
        if (status) status.textContent = "Use 4–64 letters, numbers, or hyphens for the code.";
        return;
    }
    if (!Number.isInteger(max_uses) || max_uses < 1 || max_uses > 100000) {
        if (status) status.textContent = "Maximum redemptions must be between 1 and 100000.";
        return;
    }
    const payload = { code, code_type, max_uses, created_by: session.user.id };
    if (code_type === "gift_card") {
        payload.gift_bucks = Number(document.getElementById("storeGiftAmount")?.value);
        payload.discount_type = null;
        payload.discount_value = null;
        if (!Number.isInteger(payload.gift_bucks) || payload.gift_bucks < 1 || payload.gift_bucks > 1000000) {
            if (status) status.textContent = "Gift-card value must be between 1 and 1000000 Wams Bucks.";
            return;
        }
    } else {
        payload.gift_bucks = null;
        payload.discount_type = document.getElementById("storeDiscountType")?.value || "fixed_cents";
        payload.discount_value = Number(document.getElementById("storeDiscountValue")?.value);
        if (!Number.isInteger(payload.discount_value) || payload.discount_value < 1 || payload.discount_value > 1000000 || (payload.discount_type === "percent" && payload.discount_value > 100)) {
            if (status) status.textContent = "Enter a valid discount (1–100 percent, or 1–1000000 cents).";
            return;
        }
    }
    if (buttonElement) buttonElement.disabled = true;
    if (status) status.textContent = "Creating code…";
    try {
        await api("wams_store_codes", {
            method: "POST",
            headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify(payload)
        });
        if (status) status.textContent = code_type === "gift_card"
            ? `Gift card ${code} created for ${payload.gift_bucks.toLocaleString()} Wams Bucks.`
            : `Coupon ${code} created. It can be applied once secure checkout is configured.`;
        document.getElementById("storeCodeValue").value = "";
    } catch (error) {
        if (status) status.textContent = error.message || "Could not create this code. Apply wams-store-codes.sql first.";
    } finally {
        if (buttonElement) buttonElement.disabled = !remoteAdmin;
    }
}

async function loadCustomBadgeTypes() {
    const allTypes = await api("badge_types?select=badge_type,label,description,badge_style,badge_color,badge_color_secondary,badge_color_tertiary&order=label.asc");
    const builtIns = new Set(["verified", ...badgeChoices.map(choice => choice[0])]);
    customBadgeTypes = allTypes.filter(badge => !builtIns.has(badge.badge_type) && !badge.badge_type.startsWith("achievement_"));
}

async function createCustomBadge() {
    const label = document.getElementById("customBadgeName")?.value.trim() || "";
    const rawKey = document.getElementById("customBadgeKey")?.value.trim() || label;
    const badge_type = rawKey.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
    const description = document.getElementById("customBadgeDescription")?.value.trim() || "A custom badge granted by a WamsTube administrator.";
    const badge_style = document.getElementById("customBadgeStyle")?.value || "solid";
    const status = document.getElementById("customBadgeStatus");
    if (!label || !badge_type) { if (status) status.textContent = "Enter a badge name and valid key."; return; }
    if (["verified", ...badgeChoices.map(choice => choice[0])].includes(badge_type) || badge_type.startsWith("achievement_")) { if (status) status.textContent = "That key is reserved for a built-in or achievement badge."; return; }
    const payload = {
        badge_type, label: label.slice(0, 32), description: description.slice(0, 160), badge_style,
        badge_color: document.getElementById("customBadgeColor")?.value || "#7c3aed",
        badge_color_secondary: document.getElementById("customBadgeColor2")?.value || "#ec4899",
        badge_color_tertiary: document.getElementById("customBadgeColor3")?.value || "#f59e0b"
    };
    const createButton = document.getElementById("createCustomBadge");
    if (createButton) createButton.disabled = true;
    if (status) status.textContent = "Creating badge…";
    try {
        await api("badge_types", {
            method: "POST",
            headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify(payload)
        });
        await loadCustomBadgeTypes();
        renderChannels();
        if (status) status.textContent = `“${payload.label}” is ready. Choose it from a channel’s badge menu to grant it.`;
        document.getElementById("customBadgeName").value = "";
        document.getElementById("customBadgeKey").value = "";
        document.getElementById("customBadgeDescription").value = "";
    } catch (error) { if (status) status.textContent = error.message || "Could not create the badge."; }
    finally { if (createButton) createButton.disabled = !remoteAdmin; }
}

function previewCustomBadge() {
    const preview = document.getElementById("customBadgePreview")?.querySelector(".channel-badge");
    if (!preview) return;
    const mode = document.getElementById("customBadgeStyle")?.value || "solid";
    const c1 = document.getElementById("customBadgeColor")?.value || "#7c3aed";
    const c2 = document.getElementById("customBadgeColor2")?.value || "#ec4899";
    const c3 = document.getElementById("customBadgeColor3")?.value || "#f59e0b";
    preview.textContent = document.getElementById("customBadgeName")?.value.trim() || "Badge preview";
    preview.style.background = mode === "rainbow" ? "linear-gradient(110deg, #ff0033, #ffb000, #39a852, #1684e8, #9b42c4, #ff0033)" : mode === "gradient" ? `linear-gradient(110deg, ${c1}, ${c2}, ${c3})` : c1;
    preview.classList.toggle("badge-rainbow", mode === "rainbow");
    preview.classList.toggle("badge-gradient-animated", mode === "gradient");
}

async function bootAdmin() {
    const warning = document.querySelector(".admin-warning");

    setModerationEnabled(false);

    if (!session?.access_token) {
        if (warning) {
            warning.textContent =
                "Sign in with a Supabase administrator account to use moderation.";
        }

        notify("You are signed out.");
        return;
    }

    try {
        remoteAdmin = await checkAdmin();

        if (!remoteAdmin) {
            if (warning) {
                warning.textContent =
                    "This account does not have Supabase administrator access.";
            }

            notify("Admin access is required.");
            return;
        }

        if (warning) {
            warning.textContent =
                "Connected to Supabase as an administrator. Changes apply to the shared site.";
        }

        setModerationEnabled(true);
        try {
            await loadCustomBadgeTypes();
        } catch (error) {
            notify(error.message);
        }
        try {
            await loadUploadSetting();
        } catch (error) {
            if (uploadSettingStatus) uploadSettingStatus.textContent = error.message;
            notify(error.message);
        }
        await loadDashboard();
    } catch (error) {
        if (warning) {
            warning.textContent =
                "Could not verify administrator access with Supabase.";
        }

        notify(error.message);
    }
}

document
    .getElementById("videoSearch")
    ?.addEventListener("input", renderVideos);

document
    .getElementById("videoVisibilityFilter")
    ?.addEventListener("input", renderVideos);

document
    .getElementById("videoStatusFilter")
    ?.addEventListener("input", renderVideos);

document
    .getElementById("videoSort")
    ?.addEventListener("input", renderVideos);

document
    .getElementById("channelSearch")
    ?.addEventListener("input", renderChannels);

document
    .getElementById("channelStatusFilter")
    ?.addEventListener("input", renderChannels);

document
    .getElementById("channelSort")
    ?.addEventListener("input", renderChannels);

document
    .getElementById("commentSearch")
    ?.addEventListener("input", renderComments);

document
    .getElementById("commentSort")
    ?.addEventListener("input", renderComments);

document
    .getElementById("reportSearch")
    ?.addEventListener("input", renderReports);

document
    .getElementById("reportStatusFilter")
    ?.addEventListener("input", renderReports);

document
    .getElementById("reportSort")
    ?.addEventListener("input", renderReports);

uploadToggle?.addEventListener("click", toggleUploads);
document.getElementById("sendInboxMessage")?.addEventListener("click", sendInboxMessage);
document.getElementById("createCustomBadge")?.addEventListener("click", createCustomBadge);
document.getElementById("createStoreCode")?.addEventListener("click", createStoreCode);
document.getElementById("storeCodeType")?.addEventListener("change", updateStoreCodeFields);
updateStoreCodeFields();
["customBadgeName", "customBadgeStyle", "customBadgeColor", "customBadgeColor2", "customBadgeColor3"].forEach(id => document.getElementById(id)?.addEventListener("input", previewCustomBadge));
previewCustomBadge();

document
    .getElementById("refreshAdmin")
    ?.addEventListener("click", () =>
        loadDashboard().catch(error => notify(error.message))
    );

document
    .getElementById("selectAllVideos")
    ?.addEventListener("click", () =>
        selectVisible(selectedVideos, filteredVideos)
    );

document
    .getElementById("clearVideoSelection")
    ?.addEventListener("click", () => {
        selectedVideos.clear();
        renderVideos();
    });

document
    .getElementById("bulkRemoveVideos")
    ?.addEventListener("click", () =>
        bulkVideoAction("remove")
    );

document
    .getElementById("bulkRestoreVideos")
    ?.addEventListener("click", () =>
        bulkVideoAction("restore")
    );

document
    .getElementById("bulkDeleteVideos")
    ?.addEventListener("click", () =>
        bulkVideoAction("delete")
    );

document
    .getElementById("selectAllChannels")
    ?.addEventListener("click", () =>
        selectVisible(selectedChannels, filteredChannels)
    );

document
    .getElementById("clearChannelSelection")
    ?.addEventListener("click", () => {
        selectedChannels.clear();
        renderChannels();
    });

document
    .getElementById("bulkBanChannels")
    ?.addEventListener("click", () =>
        bulkChannelAction(true)
    );

document
    .getElementById("bulkUnbanChannels")
    ?.addEventListener("click", () =>
        bulkChannelAction(false)
    );

document
    .getElementById("exportSelectedChannels")
    ?.addEventListener("click", () =>
        csvDownload(
            "wams-selected-channels.csv",
            channels.filter(row => selectedChannels.has(row.id))
        )
    );

document
    .getElementById("selectAllComments")
    ?.addEventListener("click", () =>
        selectVisible(selectedComments, filteredComments)
    );

document
    .getElementById("clearCommentSelection")
    ?.addEventListener("click", () => {
        selectedComments.clear();
        renderComments();
    });

document
    .getElementById("bulkDeleteComments")
    ?.addEventListener("click", bulkDeleteComments);

document
    .getElementById("selectAllReports")
    ?.addEventListener("click", () => {
        filteredReports()
            .filter(report => report.status === "pending")
            .forEach(report => selectedReports.add(report.id));

        renderReports();
    });

document
    .getElementById("clearReportSelection")
    ?.addEventListener("click", () => {
        selectedReports.clear();
        renderReports();
    });

document
    .getElementById("bulkAcceptReports")
    ?.addEventListener("click", () =>
        bulkReviewReports("accepted")
    );

document
    .getElementById("bulkRejectReports")
    ?.addEventListener("click", () =>
        bulkReviewReports("rejected")
    );

document
    .getElementById("exportVideos")
    ?.addEventListener("click", () =>
        csvDownload("wams-videos.csv", videos)
    );

document
    .getElementById("exportChannels")
    ?.addEventListener("click", () =>
        csvDownload("wams-channels.csv", channels)
    );

document
    .getElementById("exportComments")
    ?.addEventListener("click", () =>
        csvDownload("wams-comments.csv", comments)
    );

document
    .getElementById("exportReports")
    ?.addEventListener("click", () =>
        csvDownload("wams-video-reports.csv", reports)
    );

document
    .getElementById("deleteChannelButton")
    ?.addEventListener("click", () =>
        moderateChannel("delete")
    );

document
    .getElementById("banUserButton")
    ?.addEventListener("click", () =>
        moderateChannel("ban")
    );

document
    .getElementById("verifyChannelButton")
    ?.addEventListener("click", () =>
        moderateChannel("verify")
    );

document.getElementById("refreshActivitySpikes")?.addEventListener("click", refreshActivitySpikes);

bootAdmin();

// Recheck hourly while an administrator dashboard session remains open.
window.setInterval(() => {
    if (remoteAdmin) refreshActivitySpikes();
}, 60 * 60 * 1000);
