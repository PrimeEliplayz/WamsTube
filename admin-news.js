"use strict";

(() => {
    const baseUrl = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
    const apiKey = window.WAMS_SUPABASE_ANON_KEY || "";
    const titleField = document.getElementById("whatsNewTitle");
    const bodyField = document.getElementById("whatsNewBody");
    const imageField = document.getElementById("whatsNewImage");
    const publishButton = document.getElementById("publishWhatsNew");
    const status = document.getElementById("whatsNewAdminStatus");
    const postList = document.getElementById("whatsNewAdminList");
    if (!publishButton || !postList) return;

    let session = null;
    let isAdmin = false;
    try { session = JSON.parse(localStorage.getItem("wamsTubeSession") || "null"); } catch {}

    function headers(extra = {}) {
        return {
            apikey: apiKey,
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
            ...extra
        };
    }

    async function request(path, options = {}) {
        const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
            ...options,
            headers: headers(options.headers || {})
        });
        const text = await response.text();
        if (!response.ok) {
            let detail = text;
            try {
                const data = JSON.parse(text);
                detail = data.message || data.msg || data.hint || data.details || text;
            } catch {}
            throw new Error(detail || `Request failed (${response.status}).`);
        }
        return text ? JSON.parse(text) : null;
    }

    function encodedPath(path) {
        return path.split("/").map(encodeURIComponent).join("/");
    }

    async function storageRequest(path, options = {}) {
        const response = await fetch(`${baseUrl}/storage/v1/object/wams-news/${encodedPath(path)}`, {
            ...options,
            headers: headers(options.headers || {})
        });
        if (!response.ok && response.status !== 404) {
            const text = await response.text();
            let reason = text;
            try { reason = JSON.parse(text).message || text; } catch {}
            throw new Error(reason || "Could not update the What’s New image.");
        }
    }

    function setEnabled(enabled) {
        [titleField, bodyField, imageField, publishButton].forEach(element => {
            if (element) element.disabled = !enabled;
        });
    }

    function makeButton(label, callback) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", callback);
        return button;
    }

    async function loadPosts() {
        const posts = await request("wams_news?select=id,title,body,image_path,created_at&order=created_at.desc");
        postList.replaceChildren();
        if (!posts.length) {
            const empty = document.createElement("p");
            empty.className = "admin-empty-state";
            empty.textContent = "No What’s New posts yet.";
            postList.appendChild(empty);
            return;
        }
        posts.forEach(post => {
            const row = document.createElement("article");
            row.className = "admin-video-row admin-record";
            const info = document.createElement("div");
            info.className = "admin-record-info";
            const title = document.createElement("strong");
            title.textContent = post.title;
            const detail = document.createElement("span");
            detail.textContent = `${new Date(post.created_at).toLocaleString()}${post.image_path ? " · image attached" : ""}`;
            info.append(title, detail);
            row.append(info, makeButton("Delete post", async () => {
                if (!window.confirm(`Delete “${post.title}” from What’s New?`)) return;
                try {
                    await request(`wams_news?id=eq.${encodeURIComponent(post.id)}`, {
                        method: "DELETE",
                        headers: { Prefer: "return=minimal" }
                    });
                    if (post.image_path) await storageRequest(post.image_path, { method: "DELETE" });
                    status.textContent = "Update deleted.";
                    await loadPosts();
                } catch (error) {
                    status.textContent = error.message;
                }
            }));
            postList.appendChild(row);
        });
    }

    async function publish() {
        const title = titleField.value.trim();
        const body = bodyField.value.trim();
        const image = imageField.files?.[0] || null;
        if (!title || !body) {
            status.textContent = "Add a title and update text before publishing.";
            return;
        }
        if (title.length > 120 || body.length > 5000) {
            status.textContent = "The title or update text is too long.";
            return;
        }
        if (image && (!image.type.startsWith("image/") || image.size > 10 * 1024 * 1024)) {
            status.textContent = "Choose an image no larger than 10 MB.";
            return;
        }

        publishButton.disabled = true;
        status.textContent = "Publishing update…";
        let imagePath = null;
        try {
            if (image) {
                const safeName = image.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(-100) || "image";
                imagePath = `${session.user.id}/${crypto.randomUUID()}-${safeName}`;
                await storageRequest(imagePath, {
                    method: "POST",
                    headers: {
                        "Content-Type": image.type,
                        "x-upsert": "false"
                    },
                    body: image
                });
            }
            await request("wams_news", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Prefer: "return=minimal"
                },
                body: JSON.stringify({
                    title,
                    body,
                    image_path: imagePath,
                    published: true,
                    created_by: session.user.id
                })
            });
            titleField.value = "";
            bodyField.value = "";
            imageField.value = "";
            status.textContent = "Update published on the public What’s New page.";
            await loadPosts();
        } catch (error) {
            if (imagePath) {
                try { await storageRequest(imagePath, { method: "DELETE" }); } catch {}
            }
            status.textContent = `${error.message} Confirm the What’s New schema and wams-news bucket are set up.`;
        } finally {
            publishButton.disabled = !isAdmin;
        }
    }

    async function initialize() {
        setEnabled(false);
        if (!baseUrl || !apiKey || !session?.access_token || !session.user?.id) {
            status.textContent = "Sign in with an administrator account to publish updates.";
            return;
        }
        try {
            const profiles = await request(`profiles?id=eq.${encodeURIComponent(session.user.id)}&select=is_admin,is_banned,is_suspected`);
            isAdmin = Boolean(profiles[0]?.is_admin && !profiles[0]?.is_banned && !profiles[0]?.is_suspected);
            if (!isAdmin) {
                status.textContent = "Administrator access is required to manage What’s New posts.";
                return;
            }
            setEnabled(true);
            status.textContent = "Loading published updates…";
            await loadPosts();
            status.textContent = "Publish updates for everyone to see on the What’s New page.";
        } catch (error) {
            status.textContent = `${error.message} Apply the What’s New schema in supabase.sql.`;
        }
    }

    publishButton.addEventListener("click", publish);
    initialize();
})();
