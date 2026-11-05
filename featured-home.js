"use strict";

document.addEventListener("DOMContentLoaded", async () => {
    const section = document.getElementById("featuredHomeSection");
    const grid = document.getElementById("featuredHomeGrid");
    if (!section || !grid) return;
    try {
        const rows = await window.supabaseRequest(
            "/rest/v1/videos?select=id,owner_id,title,description,visibility,storage_path,media_type,is_short,created_at,category,is_draft,is_deleted&is_featured=eq.true&visibility=eq.public&is_deleted=eq.false&is_draft=eq.false&limit=1"
        );
        const video = rows?.[0];
        if (!video) return;
        const [profiles, mediaUrl] = await Promise.all([
            window.supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(video.owner_id)}&select=id,channel_name,admin_verified`),
            window.signedMediaUrl(video.storage_path)
        ]);
        const profile = profiles?.[0];
        const card = window.createVideoCard(video, profile?.channel_name || "WamsTube channel", mediaUrl, Boolean(profile?.admin_verified));
        grid.replaceChildren(card);
        section.hidden = false;
    } catch (error) {
        console.warn("Could not load the featured homepage video.", error);
    }
});
