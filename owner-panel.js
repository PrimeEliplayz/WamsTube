"use strict";

(() => {
    const panel = document.getElementById("ownerPanel");
    if (!panel) return;

    let session;
    try {
        session = JSON.parse(localStorage.getItem("wamsTubeSession") || "null");
    } catch {
        session = null;
    }

    const baseUrl = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
    const apiKey = window.WAMS_SUPABASE_ANON_KEY || "";
    const status = document.getElementById("ownerAccessStatus");
    const lockdownStatus = document.getElementById("lockdownStatus");
    const accountSelect = document.getElementById("ownerAccountSelect");
    const closureChannelSelect = document.getElementById("closureChannelSelect");
    const closureMessage = document.getElementById("closureChannelMessage");
    const closureStatus = document.getElementById("channelClosureStatus");
    const subscriptionAccountSelect = document.getElementById("subscriptionAccountSelect");
    const subscriptionChannelSelect = document.getElementById("subscriptionChannelSelect");
    const subscriptionStatus = document.getElementById("ownerSubscriptionStatus");
    const closeChannelButton = document.getElementById("closeSelectedChannel");
    const lockButton = document.getElementById("toggleSiteLockdown");
    const ownerGameForm = document.getElementById("ownerGameForm");
    const ownerGamesList = document.getElementById("ownerGamesList");
    const ownerGamesStatus = document.getElementById("ownerGamesStatus");
    let lockdownEnabled = false;
    let ownerProfiles = [];
    let announcementEnabled = false;
    let uploadsEnabled = true;

    async function request(path, options = {}) {
        if (!baseUrl || !apiKey) throw new Error("Supabase is not configured.");
        const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
            ...options,
            headers: {
                apikey: apiKey,
                ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
                ...(options.headers || {})
            }
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.message || payload.msg || "Owner action could not be completed.");
        }
        if (response.status === 204) return null;
        const text = await response.text();
        return text ? JSON.parse(text) : null;
    }

    function setButtons(enabled) {
        panel.querySelectorAll("button, input, select, textarea").forEach(control => {
            control.disabled = !enabled;
        });
    }

    function renderAccounts() {
        if (!accountSelect) return;
        const previous = accountSelect.value;
        accountSelect.replaceChildren();
        const prompt = document.createElement("option");
        prompt.value = "";
        prompt.textContent = "Choose a channel…";
        accountSelect.appendChild(prompt);
        ownerProfiles.forEach(profile => {
            const option = document.createElement("option");
            option.value = profile.id;
            option.textContent = `${profile.channel_name}${profile.is_owner ? " · Owner" : profile.is_admin ? " · Admin" : ""}${profile.is_banned ? " · Banned" : ""}`;
            accountSelect.appendChild(option);
        });
        if (ownerProfiles.some(profile => profile.id === previous)) accountSelect.value = previous;
        renderClosureChannels();
    }

    function renderClosureChannels() {
        if (!closureChannelSelect) return;
        const previous = closureChannelSelect.value;
        closureChannelSelect.replaceChildren();
        const prompt = document.createElement("option");
        prompt.value = "";
        prompt.textContent = "Choose a channel…";
        closureChannelSelect.appendChild(prompt);
        ownerProfiles.forEach(profile => {
            const option = document.createElement("option");
            option.value = profile.id;
            option.textContent = `${profile.channel_name}${profile.channel_closed ? " · Closed" : ""}`;
            closureChannelSelect.appendChild(option);
        });
        if (ownerProfiles.some(profile => profile.id === previous)) closureChannelSelect.value = previous;
        updateClosureStatus();
        renderSubscriptionChoices();
    }

    function renderSubscriptionChoices() {
        const populate = (select, promptText, profiles) => {
            if (!select) return;
            const previous = select.value;
            select.replaceChildren();
            const prompt = document.createElement("option");
            prompt.value = "";
            prompt.textContent = promptText;
            select.appendChild(prompt);
            profiles.forEach(profile => {
                const option = document.createElement("option");
                option.value = profile.id;
                option.textContent = profile.channel_name;
                select.appendChild(option);
            });
            if (profiles.some(profile => profile.id === previous)) select.value = previous;
        };
        const activeProfiles = ownerProfiles.filter(profile => !profile.is_banned && !profile.is_suspected);
        populate(subscriptionAccountSelect, "Choose an account…", activeProfiles);
        populate(subscriptionChannelSelect, "Choose a channel…", activeProfiles.filter(profile => !profile.channel_closed));
    }

    function updateClosureStatus() {
        const profile = ownerProfiles.find(item => item.id === closureChannelSelect?.value);
        if (!profile) {
            if (closureStatus) closureStatus.textContent = "Choose a channel to view its status.";
            if (closureMessage) closureMessage.value = "";
            if (closeChannelButton) closeChannelButton.disabled = true;
            const reopen = document.getElementById("reopenSelectedChannel");
            if (reopen) reopen.disabled = true;
            return;
        }
        if (closureMessage) closureMessage.value = profile.channel_closed_message || "";
        if (closureStatus) closureStatus.textContent = profile.channel_closed
            ? `Channel is closed${profile.channel_closed_message ? ` · ${profile.channel_closed_message}` : ""}`
            : "Channel is open to visitors.";
        if (closeChannelButton) closeChannelButton.disabled = Boolean(profile.channel_closed);
        const reopen = document.getElementById("reopenSelectedChannel");
        if (reopen) reopen.disabled = !profile.channel_closed;
    }

    function renderLockdown(row) {
        lockdownEnabled = Boolean(row?.enabled);
        const reason = document.getElementById("lockdownReason");
        if (lockButton) {
            const icon = lockButton.querySelector(".material-symbols-rounded");
            const label = lockButton.querySelector("span:last-child");
            if (label) label.textContent = lockdownEnabled ? "Restore public access" : "Lock down site";
            if (icon) icon.textContent = lockdownEnabled ? "lock_open" : "vpn_lock";
            lockButton.classList.toggle("is-locked", lockdownEnabled);
        }
        if (lockdownStatus) {
            lockdownStatus.textContent = lockdownEnabled
                ? `Site lockdown is ACTIVE${row.reason ? ` · ${row.reason}` : ""}`
                : "Site is open to visitors.";
        }
        if (reason && row?.reason) reason.value = row.reason;
    }

    async function loadOwnerData() {
        const [profiles, lockRows, announcements, auditRows, metricsRows, uploadRows] = await Promise.all([
            request("profiles?select=id,channel_name,is_owner,is_admin,is_banned,is_suspected,channel_closed,channel_closed_message&order=channel_name.asc"),
            request("site_lockdown?singleton=eq.true&select=enabled,reason"),
            request("site_announcement?singleton=eq.true&select=enabled,title,body"),
            request("owner_audit_log?select=action,details,created_at&order=created_at.desc&limit=20"),
            request("rpc/owner_platform_metrics", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
            request("platform_settings?setting=eq.uploads_enabled&select=enabled")
        ]);
        ownerProfiles = profiles || [];
        renderAccounts();
        renderLockdown(lockRows?.[0]);
        renderAnnouncement(announcements?.[0]);
        renderAuditLog(auditRows || []);
        renderOwnerMetrics(Array.isArray(metricsRows) ? metricsRows[0] : metricsRows);
        renderUploadSetting(uploadRows?.[0]);
    }

    function renderAnnouncement(row) {
        announcementEnabled = Boolean(row?.enabled);
        const title = document.getElementById("ownerAnnouncementTitle");
        const body = document.getElementById("ownerAnnouncementBody");
        const statusText = document.getElementById("ownerAnnouncementStatus");
        if (title && row?.title) title.value = row.title;
        if (body && row?.body) body.value = row.body;
        if (statusText) statusText.textContent = announcementEnabled
            ? `Announcement is live: ${row.title}`
            : "No owner announcement is currently published.";
    }

    function renderOwnerMetrics(metrics) {
        const number = value => Number(value || 0).toLocaleString();
        const fields = {
            ownerMetricChannels: metrics?.channels_total,
            ownerMetricActive: metrics?.active_accounts,
            ownerMetricBanned: metrics?.banned_accounts,
            ownerMetricReview: metrics?.accounts_under_review,
            ownerMetricOwners: metrics?.active_owners,
            ownerMetricVideos: metrics?.videos_total,
            ownerMetricViews: metrics?.views_total,
            ownerMetricEngagement: Number(metrics?.comments_total || 0) + Number(metrics?.likes_total || 0),
            ownerMetricSubscriptions: metrics?.subscriptions_total,
            ownerMetricReports: metrics?.pending_reports
        };
        Object.entries(fields).forEach(([id, value]) => {
            const output = document.getElementById(id);
            if (output) output.textContent = number(value);
        });
        const updated = document.getElementById("ownerMetricsUpdated");
        if (updated) updated.textContent = `Updated ${new Date().toLocaleString()}`;
    }

    function renderUploadSetting(row) {
        uploadsEnabled = row?.enabled !== false;
        const button = document.getElementById("toggleOwnerUploads");
        const statusText = document.getElementById("ownerOperationsStatus");
        if (button) button.textContent = uploadsEnabled ? "Disable uploads" : "Enable uploads";
        if (statusText) statusText.textContent = uploadsEnabled
            ? "Uploads are enabled."
            : "Uploads are paused site-wide; existing videos remain available.";
    }

    async function toggleOwnerUploads() {
        const enabled = !uploadsEnabled;
        const prompt = enabled
            ? "Resume video uploads across WamsTube?"
            : "Pause new video uploads across WamsTube? Existing videos will remain available.";
        if (!window.confirm(prompt)) return;
        const button = document.getElementById("toggleOwnerUploads");
        const statusText = document.getElementById("ownerOperationsStatus");
        if (button) button.disabled = true;
        if (statusText) statusText.textContent = enabled ? "Resuming uploads…" : "Pausing uploads…";
        try {
            await request("rpc/owner_set_uploads_enabled", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled })
            });
            uploadsEnabled = enabled;
            renderUploadSetting({ enabled });
            await loadOwnerData();
        } catch (error) {
            if (statusText) statusText.textContent = error.message;
        } finally {
            if (button) button.disabled = false;
        }
    }

    function renderAuditLog(entries) {
        const list = document.getElementById("ownerAuditLog");
        if (!list) return;
        list.replaceChildren();
        if (!entries.length) {
            list.textContent = "No owner actions have been recorded yet.";
            return;
        }
        entries.forEach(entry => {
            const item = document.createElement("article");
            item.className = "owner-audit-entry";
            const heading = document.createElement("strong");
            heading.textContent = String(entry.action || "Owner action").replaceAll("_", " ");
            const detail = document.createElement("span");
            const description = Object.values(entry.details || {}).filter(Boolean).join(" · ");
            detail.textContent = `${description ? `${description} · ` : ""}${new Date(entry.created_at).toLocaleString()}`;
            item.append(heading, detail);
            list.appendChild(item);
        });
    }

    async function saveAnnouncement(enabled) {
        const title = document.getElementById("ownerAnnouncementTitle")?.value.trim() || "";
        const body = document.getElementById("ownerAnnouncementBody")?.value.trim() || "";
        const result = document.getElementById("ownerAnnouncementStatus");
        if (enabled && (!title || !body)) {
            if (result) result.textContent = "Enter a title and message before publishing.";
            return;
        }
        const publishButton = document.getElementById("publishOwnerAnnouncement");
        const clearButton = document.getElementById("clearOwnerAnnouncement");
        if (publishButton) publishButton.disabled = true;
        if (clearButton) clearButton.disabled = true;
        if (result) result.textContent = enabled ? "Publishing announcement…" : "Removing announcement…";
        try {
            await request("rpc/owner_set_site_announcement", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled, announcement_title: enabled ? title : null, announcement_body: enabled ? body : null })
            });
            if (!enabled) {
                const titleField = document.getElementById("ownerAnnouncementTitle");
                const bodyField = document.getElementById("ownerAnnouncementBody");
                if (titleField) titleField.value = "";
                if (bodyField) bodyField.value = "";
            }
            if (result) result.textContent = enabled ? "Announcement published across the site." : "Announcement removed.";
            await loadOwnerData();
        } catch (error) {
            if (result) result.textContent = error.message;
        } finally {
            if (publishButton) publishButton.disabled = false;
            if (clearButton) clearButton.disabled = false;
        }
    }

    async function setOwnerAccess(makeOwner) {
        const target = accountSelect?.value;
        if (!target) {
            if (status) status.textContent = "Choose a channel first.";
            return;
        }
        if (target === session?.user?.id && !makeOwner) {
            if (status) status.textContent = "You cannot remove your own Owner access.";
            return;
        }
        const profile = ownerProfiles.find(item => item.id === target);
        if (!profile) return;
        const actionText = makeOwner ? "grant Owner access to" : "remove Owner access from";
        if (!window.confirm(`Are you sure you want to ${actionText} ${profile.channel_name}?`)) return;
        setButtons(false);
        if (status) status.textContent = "Saving Owner access…";
        try {
            await request("rpc/admin_set_owner", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ target, make_owner: makeOwner })
            });
            if (status) status.textContent = `${makeOwner ? "Owner access granted to" : "Owner access removed from"} ${profile.channel_name}.`;
            await loadOwnerData();
        } catch (error) {
            if (status) status.textContent = error.message;
        } finally {
            setButtons(true);
        }
    }

    async function setChannelClosure(closed) {
        const target = closureChannelSelect?.value;
        if (!target) {
            if (closureStatus) closureStatus.textContent = "Choose a channel first.";
            return;
        }
        const profile = ownerProfiles.find(item => item.id === target);
        const message = closureMessage?.value.trim() || "";
        if (closed && !message) {
            if (closureStatus) closureStatus.textContent = "Add the message visitors should see before closing this channel.";
            return;
        }
        if (!window.confirm(closed
            ? `Close ${profile?.channel_name || "this channel"} and show your message to visitors?`
            : `Reopen ${profile?.channel_name || "this channel"} to visitors?`)) return;
        const buttons = [closeChannelButton, document.getElementById("reopenSelectedChannel")].filter(Boolean);
        buttons.forEach(button => { button.disabled = true; });
        if (closureStatus) closureStatus.textContent = closed ? "Closing channel…" : "Reopening channel…";
        try {
            await request("rpc/owner_set_channel_closure", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ target, closed, visitor_message: closed ? message : null })
            });
            if (profile) {
                profile.channel_closed = closed;
                profile.channel_closed_message = closed ? message : null;
            }
            renderClosureChannels();
            if (closureStatus) closureStatus.textContent = closed
                ? `Channel closed. Visitors will see your message.`
                : "Channel reopened to visitors.";
        } catch (error) {
            if (closureStatus) closureStatus.textContent = error.message;
            buttons.forEach(button => { button.disabled = false; });
        }
    }

    async function subscribeAccountToChannel() {
        const targetAccount = subscriptionAccountSelect?.value;
        const targetChannel = subscriptionChannelSelect?.value;
        const account = ownerProfiles.find(profile => profile.id === targetAccount);
        const channel = ownerProfiles.find(profile => profile.id === targetChannel);
        if (!account || !channel) {
            if (subscriptionStatus) subscriptionStatus.textContent = "Choose both an account and a channel.";
            return;
        }
        if (targetAccount === targetChannel) {
            if (subscriptionStatus) subscriptionStatus.textContent = "An account cannot subscribe to its own channel.";
            return;
        }
        if (!window.confirm(`Subscribe ${account.channel_name} to ${channel.channel_name}?`)) return;
        const button = document.getElementById("ownerSubscribeAccount");
        if (button) button.disabled = true;
        if (subscriptionStatus) subscriptionStatus.textContent = "Updating subscription…";
        try {
            const result = await request("rpc/owner_subscribe_account", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ target_account: targetAccount, target_channel: targetChannel })
            });
            if (subscriptionStatus) subscriptionStatus.textContent = result
                ? `${account.channel_name} is now subscribed to ${channel.channel_name}.`
                : `${account.channel_name} was already subscribed to ${channel.channel_name}.`;
            await loadOwnerData();
        } catch (error) {
            if (subscriptionStatus) subscriptionStatus.textContent = error.message;
        } finally {
            if (button) button.disabled = false;
        }
    }

    function clearOwnerGameForm() {
        ownerGameForm?.reset();
        const id = document.getElementById("ownerGameId");
        const save = document.getElementById("saveOwnerGame");
        const cancel = document.getElementById("cancelOwnerGameEdit");
        if (id) id.value = "";
        if (save) save.textContent = "Add game";
        if (cancel) cancel.hidden = true;
    }

    function editOwnerGame(game) {
        document.getElementById("ownerGameId").value = game.id;
        document.getElementById("ownerGameTitle").value = game.title || "";
        document.getElementById("ownerGameWebsiteUrl").value = game.website_url || "";
        document.getElementById("ownerGameEmbedUrl").value = game.embed_url || "";
        document.getElementById("ownerGameDescription").value = game.description || "";
        document.getElementById("ownerGameControls").value = game.controls || "";
        document.getElementById("saveOwnerGame").textContent = "Save changes";
        document.getElementById("cancelOwnerGameEdit").hidden = false;
        ownerGameForm.scrollIntoView({ behavior: "smooth", block: "center" });
        document.getElementById("ownerGameTitle").focus();
    }

    async function loadOwnerGames() {
        if (!ownerGamesList) return;
        if (ownerGamesStatus) ownerGamesStatus.textContent = "Loading games catalog…";
        const games = await request("arcade_games?select=id,title,website_url,embed_url,description,controls,position,is_closed&order=position.asc,created_at.asc");
        ownerGamesList.replaceChildren();
        if (!games?.length) {
            ownerGamesList.textContent = "No games have been added yet.";
            if (ownerGamesStatus) ownerGamesStatus.textContent = "Add a game above to publish it on the Games page.";
            return;
        }
        games.forEach(game => {
            const row = document.createElement("article");
            row.className = "owner-audit-entry";
            const details = document.createElement("span");
            details.textContent = `${game.title}${game.is_closed ? " · CLOSED" : ""} · ${game.website_url}${game.embed_url ? ` · Embed: ${game.embed_url}` : ""}`;
            const actions = document.createElement("div");
            actions.className = "admin-actions";
            const edit = document.createElement("button");
            edit.type = "button";
            edit.textContent = "Edit";
            edit.addEventListener("click", () => editOwnerGame(game));
            const toggleClosed = document.createElement("button");
            toggleClosed.type = "button";
            toggleClosed.textContent = game.is_closed ? "Reopen game" : "Close game";
            toggleClosed.addEventListener("click", async () => {
                toggleClosed.disabled = true;
                if (ownerGamesStatus) ownerGamesStatus.textContent = game.is_closed ? `Reopening ${game.title}…` : `Closing ${game.title}…`;
                try {
                    await request(`arcade_games?id=eq.${encodeURIComponent(game.id)}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
                        body: JSON.stringify({ is_closed: !game.is_closed })
                    });
                    await loadOwnerGames();
                } catch (error) {
                    toggleClosed.disabled = false;
                    if (ownerGamesStatus) ownerGamesStatus.textContent = error.message;
                }
            });
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "danger";
            remove.textContent = "Remove";
            remove.addEventListener("click", async () => {
                if (!window.confirm(`Remove “${game.title}” from the Games page?`)) return;
                remove.disabled = true;
                if (ownerGamesStatus) ownerGamesStatus.textContent = `Removing ${game.title}…`;
                try {
                    await request(`arcade_games?id=eq.${encodeURIComponent(game.id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
                    await loadOwnerGames();
                } catch (error) {
                    remove.disabled = false;
                    if (ownerGamesStatus) ownerGamesStatus.textContent = error.message;
                }
            });
            actions.append(edit, toggleClosed, remove);
            row.append(details, actions);
            ownerGamesList.appendChild(row);
        });
        if (ownerGamesStatus) ownerGamesStatus.textContent = `${games.length} game${games.length === 1 ? "" : "s"} published.`;
    }

    async function loadOwnerGameSuggestions() {
        const list = document.getElementById("ownerGameSuggestions");
        const result = document.getElementById("ownerGameSuggestionsStatus");
        if (!list) return;
        if (result) result.textContent = "Loading Plus member suggestions…";
        const suggestions = await request("arcade_game_suggestions?status=eq.pending&select=id,title,website_url,embed_url,description,controls,created_at,profiles!arcade_game_suggestions_submitter_id_fkey(channel_name)&order=created_at.asc");
        list.replaceChildren();
        if (!suggestions?.length) {
            list.textContent = "No pending game suggestions.";
            if (result) result.textContent = "Suggestions from active Plus members will appear here.";
            return;
        }
        suggestions.forEach(suggestion => {
            const row = document.createElement("article");
            row.className = "owner-audit-entry";
            const details = document.createElement("span");
            const submitter = Array.isArray(suggestion.profiles) ? suggestion.profiles[0]?.channel_name : suggestion.profiles?.channel_name;
            details.textContent = `${suggestion.title} · suggested by ${submitter || "WamsTube Plus member"} · ${suggestion.website_url}${suggestion.embed_url ? ` · Embed: ${suggestion.embed_url}` : ""}${suggestion.description ? ` · ${suggestion.description}` : ""}`;
            const actions = document.createElement("div");
            actions.className = "admin-actions";
            [
                { decision: "approve", label: "Approve and add", className: "" },
                { decision: "reject", label: "Reject", className: "danger" }
            ].forEach(action => {
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = action.label;
                if (action.className) button.className = action.className;
                button.addEventListener("click", async () => {
                    if (action.decision === "approve" && !window.confirm(`Approve “${suggestion.title}” and add it to the public Games page?`)) return;
                    button.disabled = true;
                    if (result) result.textContent = action.decision === "approve" ? `Adding ${suggestion.title} to Games…` : `Rejecting ${suggestion.title}…`;
                    try {
                        await request("rpc/owner_review_game_suggestion", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ suggestion_id: suggestion.id, decision: action.decision })
                        });
                        if (result) result.textContent = action.decision === "approve" ? `${suggestion.title} approved and published in Games.` : `${suggestion.title} suggestion rejected.`;
                        await Promise.all([loadOwnerGameSuggestions(), loadOwnerGames()]);
                    } catch (error) {
                        button.disabled = false;
                        if (result) result.textContent = error.message;
                    }
                });
                actions.appendChild(button);
            });
            row.append(details, actions);
            list.appendChild(row);
        });
        if (result) result.textContent = `${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"} awaiting review.`;
    }

    function validateGameUrl(value, label, required = false) {
        const trimmed = value.trim();
        if (!trimmed && !required) return null;
        let url;
        try { url = new URL(trimmed); } catch { throw new Error(`Enter a valid ${label}.`); }
        if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
        return url.href;
    }

    async function saveOwnerGame(event) {
        event.preventDefault();
        const save = document.getElementById("saveOwnerGame");
        try {
            const gameId = document.getElementById("ownerGameId").value;
            const game = {
                title: document.getElementById("ownerGameTitle").value.trim(),
                website_url: validateGameUrl(document.getElementById("ownerGameWebsiteUrl").value, "website URL", true),
                embed_url: validateGameUrl(document.getElementById("ownerGameEmbedUrl").value, "embed URL"),
                description: document.getElementById("ownerGameDescription").value.trim(),
                controls: document.getElementById("ownerGameControls").value.trim()
            };
            if (!game.title) throw new Error("Enter a game title.");
            if (save) save.disabled = true;
            if (ownerGamesStatus) ownerGamesStatus.textContent = gameId ? "Saving game changes…" : "Adding game…";
            await request(gameId ? `arcade_games?id=eq.${encodeURIComponent(gameId)}` : "arcade_games", {
                method: gameId ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
                body: JSON.stringify(game)
            });
            clearOwnerGameForm();
            await loadOwnerGames();
        } catch (error) {
            if (ownerGamesStatus) ownerGamesStatus.textContent = error.message || "Could not save this game.";
        } finally {
            if (save) save.disabled = false;
        }
    }

    async function toggleLockdown() {
        const reason = document.getElementById("lockdownReason")?.value.trim() || "";
        if (!lockdownEnabled && !reason) {
            if (lockdownStatus) lockdownStatus.textContent = "Enter a reason to show visitors before locking the site.";
            return;
        }
        const confirmation = lockdownEnabled
            ? "Restore public access to WamsTube?"
            : `Lock down the public site with this visitor message?\n\n${reason}`;
        if (!window.confirm(confirmation)) return;
        if (lockButton) lockButton.disabled = true;
        if (lockdownStatus) lockdownStatus.textContent = "Updating site availability…";
        try {
            const rows = await request("rpc/admin_set_site_lockdown", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ locked: !lockdownEnabled, lockdown_reason: lockdownEnabled ? null : reason })
            });
            const row = Array.isArray(rows) ? rows[0] : rows;
            renderLockdown(row);
        } catch (error) {
            if (lockdownStatus) lockdownStatus.textContent = error.message;
        } finally {
            if (lockButton) lockButton.disabled = false;
        }
    }

    async function initialize() {
        const warning = document.querySelector(".admin-warning");
        setButtons(false);
        if (!session?.access_token || !session.user?.id) {
            if (warning) warning.textContent = "Sign in with an approved Owner account to use these controls.";
            return;
        }
        try {
            const profiles = await request(`profiles?id=eq.${encodeURIComponent(session.user.id)}&select=is_owner,is_banned,is_suspected`);
            const profile = profiles?.[0];
            if (!profile?.is_owner || profile.is_banned || profile.is_suspected) {
                if (warning) warning.textContent = "This account does not have active Owner access.";
                return;
            }
            panel.hidden = false;
            setButtons(true);
            if (warning) warning.textContent = "Verified as an active Owner. These controls are separate from Administrator moderation tools.";
            await loadOwnerData();
            try {
                await loadOwnerGames();
                await loadOwnerGameSuggestions();
            } catch (error) {
                if (ownerGamesStatus) ownerGamesStatus.textContent = `${error.message} Apply the arcade games database migration to enable this section.`;
                const suggestionsStatus = document.getElementById("ownerGameSuggestionsStatus");
                if (suggestionsStatus) suggestionsStatus.textContent = `${error.message} Apply the arcade games database migration to enable suggestions.`;
            }
        } catch (error) {
            if (warning) warning.textContent = `Could not verify Owner access: ${error.message}`;
            if (lockdownStatus) lockdownStatus.textContent = error.message;
        }
    }

    document.getElementById("grantOwnerAccess")?.addEventListener("click", () => setOwnerAccess(true));
    document.getElementById("removeOwnerAccess")?.addEventListener("click", () => setOwnerAccess(false));
    document.getElementById("toggleOwnerUploads")?.addEventListener("click", toggleOwnerUploads);
    document.getElementById("refreshOwnerDashboard")?.addEventListener("click", async () => {
        const button = document.getElementById("refreshOwnerDashboard");
        const statusText = document.getElementById("ownerOperationsStatus");
        if (button) button.disabled = true;
        if (statusText) statusText.textContent = "Refreshing owner dashboard…";
        try {
            await loadOwnerData();
            await loadOwnerGames();
            await loadOwnerGameSuggestions();
            if (statusText) statusText.textContent = "Owner dashboard refreshed.";
        } catch (error) {
            if (statusText) statusText.textContent = error.message;
        } finally {
            if (button) button.disabled = false;
        }
    });
    document.getElementById("publishOwnerAnnouncement")?.addEventListener("click", () => saveAnnouncement(true));
    document.getElementById("clearOwnerAnnouncement")?.addEventListener("click", () => saveAnnouncement(false));
    closureChannelSelect?.addEventListener("change", updateClosureStatus);
    closeChannelButton?.addEventListener("click", () => setChannelClosure(true));
    document.getElementById("reopenSelectedChannel")?.addEventListener("click", () => setChannelClosure(false));
    document.getElementById("ownerSubscribeAccount")?.addEventListener("click", subscribeAccountToChannel);
    lockButton?.addEventListener("click", toggleLockdown);
    ownerGameForm?.addEventListener("submit", saveOwnerGame);
    document.getElementById("cancelOwnerGameEdit")?.addEventListener("click", clearOwnerGameForm);
    initialize();
})();
