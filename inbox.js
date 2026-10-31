"use strict";

function inboxSession() {
    try { return JSON.parse(localStorage.getItem("wamsTubeSession") || "null"); }
    catch { return null; }
}

async function inboxRequest(path, options = {}) {
    const url = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
    const key = window.WAMS_SUPABASE_ANON_KEY || "";
    const session = inboxSession();
    if (!url || !key) throw new Error("Supabase is not configured.");
    const response = await fetch(`${url}${path}`, {
        ...options,
        headers: {
            apikey: key,
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
            ...(options.headers || {})
        }
    });
    if (!response.ok) {
        const text = await response.text();
        let detail = text;
        try { const data = JSON.parse(text); detail = data.message || data.msg || data.hint || text; } catch {}
        throw new Error(detail || `Supabase request failed (${response.status}).`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
}

let inboxNotifications = [];
let inboxFilter = "all";

function renderInbox() {
    const list = document.getElementById("inboxList");
    const status = document.getElementById("inboxStatus");
    if (!list) return;
    const shown = inboxNotifications.filter(item => inboxFilter === "all" || !item.read_at);
    list.replaceChildren();
    if (!shown.length) {
        const empty = document.createElement("div");
        empty.className = "inbox-empty";
        const title = document.createElement("strong");
        title.textContent = inboxFilter === "unread" ? "You're all caught up" : "No notifications yet";
        const text = document.createElement("span");
        text.textContent = inboxFilter === "unread" ? "New updates will show here." : "When someone subscribes or likes your content, you'll see it here.";
        empty.append(title, text);
        list.appendChild(empty);
        if (status) status.textContent = "";
        return;
    }
    shown.forEach(item => {
        const link = document.createElement("a");
        link.className = `inbox-item${item.read_at ? "" : " unread"}${item.important ? " important" : ""}`;
        link.href = item.target_url || "#";
        if (!item.target_url) link.addEventListener("click", event => event.preventDefault());
        const icon = document.createElement("span");
        icon.className = `material-symbols-rounded inbox-icon ${item.type === "account_suspicion" ? "admin" : item.type === "admin_message" ? "admin" : item.type === "new_subscriber" ? "subscribe" : "like"}`;
        icon.textContent = item.type === "account_suspicion" ? "vpn_lock_2" : item.type === "admin_message" ? "campaign" : item.type === "new_subscriber" ? "subscriptions" : "thumb_up";
        const copy = document.createElement("div");
        copy.className = "inbox-copy";
        if (item.important) {
            const badge = document.createElement("span");
            badge.className = "inbox-important";
            badge.textContent = "Important";
            copy.appendChild(badge);
        }
        const heading = document.createElement("h2");
        heading.textContent = item.title;
        const body = document.createElement("p");
        body.textContent = item.body;
        copy.append(heading, body);
        const time = document.createElement("time");
        time.className = "inbox-time";
        time.dateTime = item.created_at;
        time.textContent = new Date(item.created_at).toLocaleString();
        link.append(icon, copy, time);
        link.addEventListener("click", async event => {
            if (item.read_at) return;
            event.preventDefault();
            item.read_at = new Date().toISOString();
            link.classList.remove("unread");
            try {
                await inboxRequest(`/rest/v1/inbox_notifications?id=eq.${encodeURIComponent(item.id)}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
                    body: JSON.stringify({ read_at: item.read_at })
                });
                updateInboxBadge();
            } catch (error) { console.warn("Could not mark inbox notification read.", error); }
            if (item.target_url) window.location.href = item.target_url;
        });
        list.appendChild(link);
    });
    if (status) status.textContent = `${shown.length} notification${shown.length === 1 ? "" : "s"}`;
}

async function updateInboxBadge() {
    const badge = document.getElementById("inboxUnreadCount");
    const session = inboxSession();
    if (!badge || !session?.access_token || !session.user?.id) return;
    try {
        const rows = await inboxRequest(`/rest/v1/inbox_notifications?recipient_id=eq.${encodeURIComponent(session.user.id)}&read_at=is.null&select=id&limit=99`);
        badge.textContent = rows.length > 99 ? "99+" : String(rows.length);
        badge.hidden = rows.length === 0;
    } catch (error) { console.warn("Could not load inbox badge.", error); }
}

async function loadInbox() {
    const status = document.getElementById("inboxStatus");
    const session = inboxSession();
    if (!session?.access_token || !session.user?.id) {
        if (status) status.textContent = "Sign in to see your notifications.";
        const list = document.getElementById("inboxList");
        if (list) {
            const empty = document.createElement("div");
            empty.className = "inbox-empty";
            const title = document.createElement("strong");
            title.textContent = "Sign in to open your inbox";
            const link = document.createElement("a");
            link.href = "login.html";
            link.textContent = "Sign in";
            empty.append(title, link);
            list.replaceChildren(empty);
        }
        return;
    }
    try {
        inboxNotifications = await inboxRequest(`/rest/v1/inbox_notifications?recipient_id=eq.${encodeURIComponent(session.user.id)}&select=id,type,title,body,actor_id,target_url,important,read_at,created_at&order=created_at.desc&limit=200`);
        renderInbox();
        updateInboxBadge();
    } catch (error) {
        if (status) status.textContent = error.message || "Could not load your inbox.";
    }
}

async function markAllInboxRead() {
    const session = inboxSession();
    if (!session?.access_token || !session.user?.id) return;
    const unread = inboxNotifications.filter(item => !item.read_at);
    if (!unread.length) return;
    const timestamp = new Date().toISOString();
    try {
        await inboxRequest(`/rest/v1/inbox_notifications?recipient_id=eq.${encodeURIComponent(session.user.id)}&read_at=is.null`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify({ read_at: timestamp })
        });
        unread.forEach(item => { item.read_at = timestamp; });
        renderInbox();
        updateInboxBadge();
    } catch (error) {
        const status = document.getElementById("inboxStatus");
        if (status) status.textContent = error.message || "Could not update notifications.";
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".inbox-tab").forEach(tab => tab.addEventListener("click", () => {
        inboxFilter = tab.dataset.filter || "all";
        document.querySelectorAll(".inbox-tab").forEach(button => button.classList.toggle("active", button === tab));
        renderInbox();
    }));
    document.getElementById("inboxMarkAll")?.addEventListener("click", markAllInboxRead);
    loadInbox();
});
