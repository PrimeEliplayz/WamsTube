"use strict";

(() => {
    const baseUrl = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
    const apiKey = window.WAMS_SUPABASE_ANON_KEY || "";
    const status = document.getElementById("whatsNewStatus");
    const feed = document.getElementById("whatsNewFeed");

    function emptyState(text) {
        const empty = document.createElement("p");
        empty.className = "whats-new-empty";
        empty.textContent = text;
        feed.replaceChildren(empty);
    }

    async function loadUpdates() {
        if (!baseUrl || !apiKey) {
            status.textContent = "WamsTube updates are temporarily unavailable.";
            return;
        }
        try {
            const response = await fetch(
                `${baseUrl}/rest/v1/wams_news?select=id,title,body,image_path,created_at&published=eq.true&order=created_at.desc`,
                { headers: { apikey: apiKey } }
            );
            if (!response.ok) throw new Error("Could not load updates.");
            const posts = await response.json();
            feed.replaceChildren();
            if (!posts.length) {
                emptyState("There aren’t any updates yet. Check back soon!");
            } else {
                posts.forEach(post => {
                    const card = document.createElement("article");
                    card.className = "whats-new-card";
                    if (post.image_path) {
                        const image = document.createElement("img");
                        image.src = `${baseUrl}/storage/v1/object/public/wams-news/${post.image_path.split("/").map(encodeURIComponent).join("/")}`;
                        image.alt = "";
                        image.loading = "lazy";
                        card.appendChild(image);
                    }
                    const copy = document.createElement("div");
                    copy.className = "whats-new-card-copy";
                    const date = document.createElement("time");
                    date.dateTime = post.created_at;
                    date.textContent = new Date(post.created_at).toLocaleDateString(undefined, {
                        year: "numeric", month: "long", day: "numeric"
                    });
                    const title = document.createElement("h2");
                    title.textContent = post.title;
                    const body = document.createElement("p");
                    body.textContent = post.body;
                    copy.append(date, title, body);
                    card.appendChild(copy);
                    feed.appendChild(card);
                });
            }
            status.textContent = posts.length ? `${posts.length} update${posts.length === 1 ? "" : "s"}` : "";
        } catch (error) {
            status.textContent = `${error.message} Apply the What’s New setup in supabase.sql if it has not been applied yet.`;
        }
    }

    loadUpdates();
})();
