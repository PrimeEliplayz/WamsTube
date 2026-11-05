"use strict";

(() => {
    const $ = id => document.getElementById(id);
    const status = $("communityManagerStatus");
    const content = $("communityManagerContent");

    async function api(path, options) {
        return window.supabaseRequest(`/rest/v1/${path}`, options);
    }

    function formStatus(form, text) {
        const output = form.querySelector("[data-status]");
        if (output) output.textContent = text;
    }

    function makeRow(primary, detail, actions = []) {
        const row = document.createElement("article");
        row.className = "community-manager-row";
        const copy = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = primary;
        const info = document.createElement("span");
        info.textContent = detail;
        copy.append(title, info);
        const buttons = document.createElement("div");
        buttons.className = "community-manager-actions";
        actions.forEach(({ label, run, danger }) => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            if (danger) button.className = "danger";
            button.addEventListener("click", async () => {
                button.disabled = true;
                try { await run(); }
                catch (error) {
                    status.textContent = error.message || "Could not update this community item.";
                    button.disabled = false;
                }
            });
            buttons.appendChild(button);
        });
        row.append(copy, buttons);
        return row;
    }

    async function updateRow(table, id, values) {
        await api(`${table}?id=eq.${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify(values)
        });
        await loadAll();
    }

    async function deleteRow(table, id, label) {
        if (!window.confirm(`Remove “${label}” from the school community?`)) return;
        await api(`${table}?id=eq.${encodeURIComponent(id)}`, {
            method: "DELETE",
            headers: { Prefer: "return=minimal" }
        });
        await loadAll();
    }

    async function loadAnnouncements() {
        const list = $("communityAnnouncementsManageList");
        const rows = await api("school_announcements?select=id,title,body,is_published,created_at&order=created_at.desc&limit=200");
        list.replaceChildren();
        if (!rows.length) list.textContent = "No school announcements have been posted.";
        rows.forEach(item => {
            const actions = [
                { label: "Edit", run: async () => {
                    const form = $("communityAnnouncementForm");
                    form.elements.id.value = item.id;
                    form.elements.title.value = item.title;
                    form.elements.body.value = item.body;
                    form.elements.is_published.checked = item.is_published;
                    form.scrollIntoView({ behavior: "smooth", block: "center" });
                } },
                { label: item.is_published ? "Unpublish" : "Publish", run: () => updateRow("school_announcements", item.id, { is_published: !item.is_published }) },
                { label: "Delete", danger: true, run: () => deleteRow("school_announcements", item.id, item.title) }
            ];
            list.appendChild(makeRow(item.title, `${item.is_published ? "Published" : "Unpublished"} · ${new Date(item.created_at).toLocaleString()}`, actions));
        });
    }

    async function saveAnnouncement(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const id = String(data.get("id") || "");
        const values = {
            title: String(data.get("title") || "").trim(),
            body: String(data.get("body") || "").trim(),
            is_published: data.get("is_published") === "on"
        };
        const button = form.querySelector('[type="submit"]');
        button.disabled = true;
        formStatus(form, "Saving announcement…");
        try {
            await api(id ? `school_announcements?id=eq.${encodeURIComponent(id)}` : "school_announcements", {
                method: id ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
                body: JSON.stringify(values)
            });
            form.reset();
            form.elements.id.value = "";
            form.elements.is_published.checked = true;
            formStatus(form, id ? "Announcement updated." : "Announcement published.");
            await loadAnnouncements();
        } catch (error) { formStatus(form, error.message || "Could not save this announcement."); }
        finally { button.disabled = false; }
    }

    async function loadEvents() {
        const list = $("communityEventsManageList");
        const rows = await api("school_events?select=id,title,event_type,starts_at,location,description,is_published&order=starts_at.desc&limit=200");
        list.replaceChildren();
        if (!rows.length) list.textContent = "No school events have been created.";
        rows.forEach(event => {
            const actions = [
                { label: "Edit", run: async () => {
                    const form = $("communityEventForm");
                    form.elements.id.value = event.id;
                    form.elements.title.value = event.title;
                    form.elements.event_type.value = event.event_type;
                    form.elements.starts_at.value = new Date(event.starts_at).toISOString().slice(0, 16);
                    form.elements.location.value = event.location || "";
                    form.elements.description.value = event.description || "";
                    form.elements.is_published.checked = event.is_published;
                    form.scrollIntoView({ behavior: "smooth", block: "center" });
                } },
                { label: event.is_published ? "Unpublish" : "Publish", run: () => updateRow("school_events", event.id, { is_published: !event.is_published }) },
                { label: "Delete", danger: true, run: () => deleteRow("school_events", event.id, event.title) }
            ];
            list.appendChild(makeRow(event.title, `${event.event_type} · ${new Date(event.starts_at).toLocaleString()} · ${event.is_published ? "Published" : "Unpublished"}`, actions));
        });
    }

    async function loadClubs() {
        const list = $("communityClubsManageList");
        const rows = await api("school_clubs?select=id,name,description,channel_id,is_listed&order=name.asc&limit=200");
        list.replaceChildren();
        if (!rows.length) list.textContent = "No club channels have been listed.";
        rows.forEach(club => {
            const actions = [
                { label: "Edit", run: async () => {
                    const form = $("communityClubForm");
                    form.elements.id.value = club.id;
                    form.elements.name.value = club.name;
                    form.elements.channel_id.value = club.channel_id || "";
                    form.elements.description.value = club.description || "";
                    form.elements.is_listed.checked = club.is_listed;
                    form.scrollIntoView({ behavior: "smooth", block: "center" });
                } },
                { label: club.is_listed ? "Unlist" : "List", run: () => updateRow("school_clubs", club.id, { is_listed: !club.is_listed }) },
                { label: "Delete", danger: true, run: () => deleteRow("school_clubs", club.id, club.name) }
            ];
            list.appendChild(makeRow(club.name, `${club.is_listed ? "Listed" : "Unlisted"}${club.channel_id ? ` · Channel ${club.channel_id}` : " · No channel linked"}`, actions));
        });
    }

    async function loadHighlights() {
        const list = $("communityHighlightsManageList");
        const rows = await api("weekly_highlights?select=id,week_start,video_id,position&order=week_start.desc,position.asc&limit=200");
        list.replaceChildren();
        if (!rows.length) list.textContent = "No weekly highlights have been selected.";
        rows.forEach(item => {
            list.appendChild(makeRow(`Week of ${item.week_start}`, `Video ${item.video_id} · position ${item.position}`, [
                { label: "Remove", danger: true, run: () => deleteRow("weekly_highlights", item.id, `highlight for ${item.week_start}`) }
            ]));
        });
    }

    async function loadPlaylists() {
        const list = $("communityPlaylistsManageList");
        const rows = await api("school_playlists?select=id,title,audience,description,is_published&order=title.asc&limit=200");
        list.replaceChildren();
        if (!rows.length) list.textContent = "No school-safe playlists have been created.";
        rows.forEach(playlist => {
            const actions = [
                { label: playlist.is_published ? "Unpublish" : "Publish", run: () => updateRow("school_playlists", playlist.id, { is_published: !playlist.is_published }) },
                { label: "Delete", danger: true, run: () => deleteRow("school_playlists", playlist.id, playlist.title) }
            ];
            list.appendChild(makeRow(playlist.title, `${playlist.audience} · ${playlist.is_published ? "Published" : "Unpublished"}`, actions));
        });
    }

    async function loadAll() {
        await Promise.all([loadAnnouncements(), loadEvents(), loadClubs(), loadHighlights(), loadPlaylists()]);
    }

    async function saveEvent(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const date = new Date(data.get("starts_at"));
        if (!Number.isFinite(date.getTime())) return formStatus(form, "Enter a valid event date and time.");
        const id = String(data.get("id") || "");
        const values = {
            title: String(data.get("title") || "").trim(),
            event_type: data.get("event_type"),
            starts_at: date.toISOString(),
            location: String(data.get("location") || "").trim() || null,
            description: String(data.get("description") || "").trim(),
            is_published: data.get("is_published") === "on"
        };
        const button = form.querySelector('[type="submit"]');
        button.disabled = true;
        formStatus(form, "Saving event…");
        try {
            await api(id ? `school_events?id=eq.${encodeURIComponent(id)}` : "school_events", {
                method: id ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
                body: JSON.stringify(values)
            });
            form.reset();
            form.elements.id.value = "";
            form.elements.is_published.checked = true;
            formStatus(form, id ? "Event updated." : "Event created.");
            await loadEvents();
        } catch (error) { formStatus(form, error.message || "Could not save this event."); }
        finally { button.disabled = false; }
    }

    async function saveClub(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const id = String(data.get("id") || "");
        const channelId = String(data.get("channel_id") || "").trim();
        const values = {
            name: String(data.get("name") || "").trim(),
            channel_id: channelId || null,
            description: String(data.get("description") || "").trim(),
            is_listed: data.get("is_listed") === "on"
        };
        const button = form.querySelector('[type="submit"]');
        button.disabled = true;
        formStatus(form, "Saving club…");
        try {
            await api(id ? `school_clubs?id=eq.${encodeURIComponent(id)}` : "school_clubs", {
                method: id ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
                body: JSON.stringify(values)
            });
            form.reset();
            form.elements.id.value = "";
            form.elements.is_listed.checked = true;
            formStatus(form, id ? "Club updated." : "Club created.");
            await loadClubs();
        } catch (error) { formStatus(form, error.message || "Could not save this club."); }
        finally { button.disabled = false; }
    }

    async function saveHighlight(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const button = form.querySelector('[type="submit"]');
        button.disabled = true;
        formStatus(form, "Adding highlight…");
        try {
            await api("weekly_highlights", {
                method: "POST",
                headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
                body: JSON.stringify({ video_id: String(data.get("video_id")).trim(), week_start: data.get("week_start"), position: Number(data.get("position") || 0) })
            });
            form.reset();
            formStatus(form, "Weekly highlight added.");
            await loadHighlights();
        } catch (error) { formStatus(form, error.message || "Could not add this highlight."); }
        finally { button.disabled = false; }
    }

    async function savePlaylist(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const videoIds = [...new Set(String(data.get("video_ids") || "").split(",").map(id => id.trim()).filter(Boolean))];
        const button = form.querySelector('[type="submit"]');
        button.disabled = true;
        formStatus(form, "Creating playlist…");
        let playlistId = null;
        try {
            const rows = await api("school_playlists?select=id", {
                method: "POST",
                headers: { "Content-Type": "application/json", Prefer: "return=representation" },
                body: JSON.stringify({
                    title: String(data.get("title") || "").trim(),
                    audience: data.get("audience"),
                    description: String(data.get("description") || "").trim(),
                    is_published: data.get("is_published") === "on"
                })
            });
            playlistId = rows?.[0]?.id;
            if (playlistId && videoIds.length) {
                await api("school_playlist_videos", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
                    body: JSON.stringify(videoIds.map((video_id, position) => ({ playlist_id: playlistId, video_id, position })))
                });
            }
            form.reset();
            form.elements.is_published.checked = true;
            formStatus(form, "School-safe playlist created.");
            await loadPlaylists();
        } catch (error) {
            formStatus(form, error.message || "Could not create this playlist.");
            if (playlistId) api(`school_playlists?id=eq.${encodeURIComponent(playlistId)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }).catch(() => {});
        } finally { button.disabled = false; }
    }

    async function start() {
        const session = window.currentSession?.();
        if (!session?.access_token || !session.user?.id) {
            status.textContent = "Sign in to use the school community manager.";
            return;
        }
        try {
            const [profiles, roles] = await Promise.all([
                api(`profiles?id=eq.${encodeURIComponent(session.user.id)}&select=is_admin,is_owner,is_banned,is_suspected`),
                api(`community_admins?user_id=eq.${encodeURIComponent(session.user.id)}&enabled=eq.true&select=user_id`)
            ]);
            const profile = profiles?.[0];
            if (!profile || profile.is_banned || profile.is_suspected || (!profile.is_admin && !profile.is_owner && !roles?.length)) {
                status.textContent = "You do not have access to manage school community content.";
                return;
            }
            content.hidden = false;
            status.textContent = "Community administrator access verified. Changes are limited to school community content.";
            await loadAll();
        } catch (error) {
            status.textContent = `${error.message || "Could not verify access."} Apply community-admin.sql and school-community.sql.`;
        }
    }

    $("communityAnnouncementForm").addEventListener("submit", saveAnnouncement);
    $("communityEventForm").addEventListener("submit", saveEvent);
    $("communityClubForm").addEventListener("submit", saveClub);
    $("communityHighlightForm").addEventListener("submit", saveHighlight);
    $("communityPlaylistForm").addEventListener("submit", savePlaylist);
    document.querySelectorAll("[data-reset]").forEach(button => button.addEventListener("click", () => {
        const form = $(button.dataset.reset);
        form.reset();
        if (form.elements.id) form.elements.id.value = "";
        const published = form.elements.is_published || form.elements.is_listed;
        if (published) published.checked = true;
        formStatus(form, "");
    }));
    start();
})();
