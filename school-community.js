"use strict";

(() => {
    const status = document.getElementById("schoolCommunityStatus");
    const eventList = document.getElementById("schoolEventList");
    const clubList = document.getElementById("schoolClubList");
    const highlightGrid = document.getElementById("schoolHighlightGrid");
    const playlistList = document.getElementById("schoolPlaylistList");
    const videoGrid = document.getElementById("schoolVideoGrid");
    const categoryFilter = document.getElementById("schoolCategoryFilter");
    let highlights = [];
    let schoolVideos = [];

    function schoolApi(path) {
        return window.supabaseRequest(`/rest/v1/${path}`);
    }

    function eventCard(event) {
        const card = document.createElement("article");
        card.className = "school-event-card";
        const type = document.createElement("span");
        type.className = "school-event-type";
        type.textContent = event.event_type.replaceAll("_", " ");
        const title = document.createElement("h3");
        title.textContent = event.title;
        const time = document.createElement("time");
        time.dateTime = event.starts_at;
        time.textContent = new Date(event.starts_at).toLocaleString([], {
            weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
        });
        card.append(type, title, time);
        if (event.location) {
            const location = document.createElement("p");
            location.textContent = event.location;
            card.appendChild(location);
        }
        if (event.description) {
            const description = document.createElement("p");
            description.textContent = event.description;
            card.appendChild(description);
        }
        return card;
    }

    async function loadAnnouncements() {
        const announcements = await schoolApi("school_announcements?select=id,title,body,created_at&is_published=eq.true&order=created_at.desc&limit=30");
        const list = document.getElementById("schoolAnnouncementList");
        list.replaceChildren();
        announcements.forEach(announcement => {
            const card = document.createElement("article");
            card.className = "school-announcement-card";
            const title = document.createElement("h3");
            title.textContent = announcement.title;
            const body = document.createElement("p");
            body.textContent = announcement.body;
            const date = document.createElement("time");
            date.dateTime = announcement.created_at;
            date.textContent = new Date(announcement.created_at).toLocaleDateString();
            card.append(title, body, date);
            list.appendChild(card);
        });
        document.getElementById("schoolAnnouncementsEmpty").hidden = announcements.length > 0;
    }

    async function loadEvents() {
        const now = new Date().toISOString();
        const params = new URLSearchParams({
            select: "id,title,description,event_type,starts_at,ends_at,location",
            is_published: "eq.true",
            starts_at: `gte.${now}`,
            order: "starts_at.asc",
            limit: "30"
        });
        const events = await schoolApi(`school_events?${params}`);
        eventList.replaceChildren(...events.map(eventCard));
        document.getElementById("schoolEventsEmpty").hidden = events.length > 0;
    }

    async function loadClubs() {
        const params = new URLSearchParams({
            select: "id,name,description,channel_id",
            is_listed: "eq.true",
            order: "name.asc",
            limit: "100"
        });
        const clubs = await schoolApi(`school_clubs?${params}`);
        const channelIds = [...new Set(clubs.map(club => club.channel_id).filter(Boolean))];
        const profiles = channelIds.length
            ? await schoolApi(`profiles?select=id,channel_name&id=in.(${channelIds.map(encodeURIComponent).join(",")})`)
            : [];
        const names = new Map(profiles.map(profile => [profile.id, profile.channel_name]));
        clubList.replaceChildren();
        clubs.forEach(club => {
            const card = document.createElement("article");
            card.className = "school-club-card";
            const title = document.createElement("h3");
            title.textContent = club.name;
            const description = document.createElement("p");
            description.textContent = club.description || "A Wams school club channel.";
            card.append(title, description);
            if (club.channel_id) {
                const link = document.createElement("a");
                link.href = `channel.html?channel=${encodeURIComponent(club.channel_id)}`;
                link.textContent = `Visit ${names.get(club.channel_id) || "club channel"}`;
                card.appendChild(link);
            }
            clubList.appendChild(card);
        });
        document.getElementById("schoolClubsEmpty").hidden = clubs.length > 0;
    }

    async function loadSchoolPlaylists() {
        const playlists = await schoolApi("school_playlists?select=id,title,audience,description&is_published=eq.true&order=title.asc&limit=100");
        const items = playlists.length
            ? await schoolApi(`school_playlist_videos?select=playlist_id,video_id,position&playlist_id=in.(${playlists.map(item => encodeURIComponent(item.id)).join(",")})&order=position.asc`)
            : [];
        const videoIds = [...new Set(items.map(item => item.video_id))];
        const videos = videoIds.length
            ? await schoolApi(`videos?select=id,title,visibility,is_draft,is_deleted&id=in.(${videoIds.map(encodeURIComponent).join(",")})&visibility=eq.public&is_draft=eq.false&is_deleted=eq.false`)
            : [];
        const titles = new Map(videos.map(video => [video.id, video.title]));
        playlistList.replaceChildren();
        playlists.forEach(playlist => {
            const details = document.createElement("details");
            details.className = "school-playlist-card";
            const summary = document.createElement("summary");
            const title = document.createElement("strong");
            title.textContent = playlist.title;
            const audience = document.createElement("span");
            audience.textContent = playlist.audience;
            summary.append(title, audience);
            details.appendChild(summary);
            if (playlist.description) {
                const description = document.createElement("p");
                description.textContent = playlist.description;
                details.appendChild(description);
            }
            const links = document.createElement("ol");
            items.filter(item => item.playlist_id === playlist.id && titles.has(item.video_id)).forEach(item => {
                const entry = document.createElement("li");
                const link = document.createElement("a");
                link.href = `watch.html?videoId=${encodeURIComponent(item.video_id)}`;
                link.textContent = titles.get(item.video_id);
                entry.appendChild(link);
                links.appendChild(entry);
            });
            details.appendChild(links);
            playlistList.appendChild(details);
        });
        document.getElementById("schoolPlaylistsEmpty").hidden = playlists.length > 0;
    }

    async function loadSchoolVideos() {
        const videos = await schoolApi("videos?select=id,owner_id,title,description,visibility,storage_path,media_type,is_short,created_at,category,is_draft,is_deleted&visibility=eq.public&is_deleted=eq.false&is_draft=eq.false&order=created_at.desc&limit=100");
        const ownerIds = [...new Set(videos.map(video => video.owner_id))];
        const profiles = ownerIds.length
            ? await schoolApi(`profiles?select=id,channel_name,admin_verified&id=in.(${ownerIds.map(encodeURIComponent).join(",")})`)
            : [];
        const profileMap = new Map(profiles.map(profile => [profile.id, profile]));
        schoolVideos = videos.map(video => ({
            ...video,
            channelName: profileMap.get(video.owner_id)?.channel_name || "WamsTube channel",
            verified: Boolean(profileMap.get(video.owner_id)?.admin_verified)
        }));
        await renderVideos();
    }

    async function loadHighlights() {
        const rows = await schoolApi("weekly_highlights?select=week_start,video_id,position&order=week_start.desc,position.asc&limit=100");
        const currentWeek = new Date();
        const mondayOffset = (currentWeek.getDay() + 6) % 7;
        currentWeek.setDate(currentWeek.getDate() - mondayOffset);
        currentWeek.setHours(0, 0, 0, 0);
        const week = `${currentWeek.getFullYear()}-${String(currentWeek.getMonth() + 1).padStart(2, "0")}-${String(currentWeek.getDate()).padStart(2, "0")}`;
        const currentRows = rows.filter(row => row.week_start === week);
        const ids = currentRows.map(row => row.video_id);
        if (!ids.length) {
            highlights = [];
            renderHighlights();
            return;
        }
        const videos = await schoolApi(`videos?select=id,owner_id,title,description,visibility,storage_path,media_type,is_short,created_at,category,is_draft,is_deleted&id=in.(${ids.map(encodeURIComponent).join(",")})&visibility=eq.public&is_deleted=eq.false&is_draft=eq.false`);
        const ownerIds = [...new Set(videos.map(video => video.owner_id))];
        const profiles = ownerIds.length
            ? await schoolApi(`profiles?select=id,channel_name,admin_verified&id=in.(${ownerIds.map(encodeURIComponent).join(",")})`)
            : [];
        const profileMap = new Map(profiles.map(profile => [profile.id, profile]));
        const videoMap = new Map(videos.map(video => [video.id, {
            ...video,
            channelName: profileMap.get(video.owner_id)?.channel_name || "WamsTube channel",
            verified: Boolean(profileMap.get(video.owner_id)?.admin_verified)
        }]));
        highlights = ids.map(id => videoMap.get(id)).filter(Boolean);
        renderHighlights();
    }

    async function renderVideos() {
        const category = categoryFilter.value;
        const selected = schoolVideos.filter(video => category === "all" || video.category === category);
        const cards = await Promise.all(selected.map(async video => {
            try {
                const media = await window.signedMediaUrl(video.storage_path);
                return window.createVideoCard(video, video.channelName, media, video.verified);
            } catch (error) {
                console.warn("Could not load a school video.", error);
                return null;
            }
        }));
        videoGrid.replaceChildren(...cards.filter(Boolean));
        document.getElementById("schoolVideosEmpty").hidden = selected.length > 0;
    }

    async function renderHighlights() {
        const category = categoryFilter.value;
        const selected = highlights.filter(video => category === "all" || video.category === category);
        const cards = await Promise.all(selected.map(async video => {
            try {
                const media = await window.signedMediaUrl(video.storage_path);
                return window.createVideoCard(video, video.channelName, media, video.verified);
            } catch (error) {
                console.warn("Could not load a highlighted video.", error);
                return null;
            }
        }));
        highlightGrid.replaceChildren(...cards.filter(Boolean));
        document.getElementById("schoolHighlightsEmpty").hidden = selected.length > 0;
    }

    categoryFilter.addEventListener("change", () => {
        renderVideos();
        renderHighlights();
    });
    Promise.all([loadAnnouncements(), loadEvents(), loadClubs(), loadSchoolPlaylists(), loadSchoolVideos(), loadHighlights()])
        .then(() => { status.textContent = "School community updated."; })
        .catch(error => {
            console.error("Could not load school community content.", error);
            status.textContent = `${error.message || "Could not load school community content."} Apply school-community.sql to enable these sections.`;
        });
})();
