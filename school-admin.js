"use strict";

document.addEventListener("DOMContentLoaded", async () => {
    const panel = document.getElementById("adminSchoolCommunity");
    if (!panel) return;
    const session = window.currentSession?.();
    if (!session?.access_token || !session.user?.id) return;
    try {
        const profiles = await window.supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=is_admin,is_banned`);
        if (!profiles?.[0]?.is_admin || profiles[0].is_banned) return;
        panel.hidden = false;
    } catch {
        return;
    }

    const save = async (form, table, payload, success) => {
        const status = form.querySelector("[data-status]");
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        if (status) status.textContent = "Saving…";
        try {
            await window.supabaseRequest(`/rest/v1/${table}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
                body: JSON.stringify(payload)
            });
            if (status) status.textContent = success;
            form.reset();
        } catch (error) {
            if (status) status.textContent = error.message || "Could not save this item.";
        } finally {
            button.disabled = false;
        }
    };

    const eventForm = document.getElementById("schoolEventForm");
    eventForm.addEventListener("submit", event => {
        event.preventDefault();
        const data = new FormData(eventForm);
        const date = new Date(data.get("starts_at"));
        if (!Number.isFinite(date.getTime())) return;
        save(eventForm, "school_events", {
            title: String(data.get("title")).trim(),
            event_type: data.get("event_type"),
            starts_at: date.toISOString(),
            location: String(data.get("location") || "").trim() || null,
            description: String(data.get("description") || "").trim(),
            is_published: data.get("is_published") === "on",
            created_by: session.user.id
        }, "Event saved.");
    });

    const clubForm = document.getElementById("schoolClubForm");
    clubForm.addEventListener("submit", event => {
        event.preventDefault();
        const data = new FormData(clubForm);
        const channelId = String(data.get("channel_id") || "").trim();
        save(clubForm, "school_clubs", {
            name: String(data.get("name")).trim(),
            description: String(data.get("description") || "").trim(),
            channel_id: channelId || null,
            is_listed: true
        }, "Club channel listed.");
    });

    const highlightForm = document.getElementById("schoolHighlightForm");
    highlightForm.addEventListener("submit", event => {
        event.preventDefault();
        const data = new FormData(highlightForm);
        save(highlightForm, "weekly_highlights", {
            video_id: String(data.get("video_id")).trim(),
            week_start: data.get("week_start"),
            position: Number(data.get("position") || 0)
        }, "Weekly highlight added.");
    });

    const playlistForm = document.getElementById("schoolPlaylistForm");
    playlistForm.addEventListener("submit", async event => {
        event.preventDefault();
        const data = new FormData(playlistForm);
        const status = playlistForm.querySelector("[data-status]");
        const button = playlistForm.querySelector('button[type="submit"]');
        const videoIds = String(data.get("video_ids") || "").split(",").map(id => id.trim()).filter(Boolean);
        button.disabled = true;
        if (status) status.textContent = "Publishing playlist…";
        try {
            const playlists = await window.supabaseRequest("/rest/v1/school_playlists?select=id", {
                method: "POST",
                headers: { "Content-Type": "application/json", Prefer: "return=representation" },
                body: JSON.stringify({
                    title: String(data.get("title")).trim(),
                    audience: data.get("audience"),
                    description: String(data.get("description") || "").trim(),
                    is_published: true
                })
            });
            const playlistId = playlists?.[0]?.id;
            if (playlistId && videoIds.length) {
                await window.supabaseRequest("/rest/v1/school_playlist_videos", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
                    body: JSON.stringify(videoIds.map((video_id, position) => ({ playlist_id: playlistId, video_id, position })))
                });
            }
            if (status) status.textContent = "School-safe playlist published.";
            playlistForm.reset();
        } catch (error) {
            if (status) status.textContent = error.message || "Could not publish this playlist.";
        } finally {
            button.disabled = false;
        }
    });
});
