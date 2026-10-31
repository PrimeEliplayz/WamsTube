"use strict";

(() => {
    const defs = [
        { id: "welcome", title: "Welcome to WamsTube", description: "Create your WamsTube channel.", reward: 10, icon: "waving_hand" },
        { id: "subscriber_1", title: "First subscriber", description: "Subscribe to your first channel.", reward: 10, icon: "person_add" },
        { id: "subscriber_5", title: "Community explorer", description: "Subscribe to 5 channels.", reward: 20, icon: "groups" },
        { id: "first_upload", title: "First upload", description: "Publish your first video.", reward: 20, icon: "video_library" },
        { id: "uploads_5", title: "Creator in the making", description: "Publish 5 videos.", reward: 35, icon: "movie_edit" },
        { id: "first_comment", title: "Join the conversation", description: "Post your first comment.", reward: 10, icon: "chat" },
        { id: "comments_10", title: "Conversation starter", description: "Post 10 comments.", reward: 25, icon: "forum" },
        { id: "first_like", title: "Show some love", description: "Like your first video.", reward: 10, icon: "favorite" },
        { id: "likes_10", title: "Video fan", description: "Like 10 videos.", reward: 25, icon: "thumb_up" },
        { id: "plus_member", title: "WamsTube Plus", description: "Purchase any active WamsTube Plus plan.", reward: 50, icon: "workspace_premium" },
        { id: "verified_channel", title: "Verified creator", description: "Get your channel verified by an administrator or reach 101 subscribers.", reward: 75, icon: "verified" },
        { id: "first_follower", title: "Creator milestone", description: "Get your first subscriber on your channel.", reward: 20, icon: "trending_up" },
        { id: "500_subscribers", title: "Five hundred subscribers", description: "Hit 500 subscribers on your channel. (In developement.)", reward: 20000, icon: "" }
    ];
    const url = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
    const key = window.WAMS_SUPABASE_ANON_KEY || "";
    const grid = document.getElementById("achievementGrid");
    const status = document.getElementById("achievementStatus");
    const balance = document.getElementById("achievementBalance");
    const signInLink = document.getElementById("achievementSignIn");
    let session = null;
    try { session = JSON.parse(localStorage.getItem("wamsTubeSession") || "null"); } catch {}

    async function api(path, options = {}) {
        if (!url || !key) throw new Error("Supabase is not configured.");
        const response = await fetch(`${url}/rest/v1/${path}`, {
            ...options,
            headers: { apikey: key, ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}), ...(options.headers || {}) }
        });
        if (!response.ok) {
            const text = await response.text();
            let message = text;
            try { const body = JSON.parse(text); message = body.message || body.msg || text; } catch {}
            throw new Error(message || `Request failed (${response.status}).`);
        }
        if (response.status === 204) return null;
        const text = await response.text();
        return text ? JSON.parse(text) : null;
    }

    function card(def, claimed, eligible) {
        const article = document.createElement("article");
        article.className = `achievement-card${claimed ? " is-claimed" : eligible ? " is-ready" : " is-locked"}`;
        const icon = document.createElement("span");
        icon.className = "material-symbols-rounded achievement-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = def.icon;
        const copy = document.createElement("div");
        copy.className = "achievement-copy";
        const title = document.createElement("h2");
        title.textContent = def.title;
        const desc = document.createElement("p");
        desc.textContent = def.description;
        const reward = document.createElement("span");
        reward.className = "achievement-reward";
        reward.textContent = `${def.reward} Wams Bucks`;
        copy.append(title, desc, reward);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "achievement-claim";
        button.textContent = claimed ? "Claimed" : eligible ? "Claim reward" : "Not yet";
        button.disabled = claimed || !eligible;
        if (eligible && !claimed) button.addEventListener("click", () => claim(def, button));
        article.append(icon, copy, button);
        return article;
    }

    async function load() {
        if (!session?.access_token || !session.user?.id) {
            if (signInLink) signInLink.hidden = false;
            balance.textContent = "Sign in required";
            status.textContent = "Sign in to track progress and claim rewards. Here are the achievements you can work toward.";
            grid.replaceChildren(...defs.map(def => card(def, false, false)));
            return;
        }
        if (signInLink) signInLink.hidden = true;
        try {
            const uid = encodeURIComponent(session.user.id);
            const [wallets, profiles, follows, uploads, comments, likes, subscribers, claims] = await Promise.all([
                api(`wams_wallets?user_id=eq.${uid}&select=balance`),
                api(`profiles?id=eq.${uid}&select=created_at,plus_plan,plus_expires_at,admin_verified`),
                api(`channel_follows?follower_id=eq.${uid}&select=channel_id`),
                api(`videos?owner_id=eq.${uid}&is_deleted=eq.false&select=id`),
                api(`video_comments?user_id=eq.${uid}&select=id`),
                api(`video_likes?user_id=eq.${uid}&select=video_id`),
                api(`channel_follows?channel_id=eq.${uid}&select=follower_id`),
                api(`wams_achievement_claims?user_id=eq.${uid}&select=achievement_key`)
            ]);
            const profile = profiles[0] || {};
            const ownPlus = profile.plus_plan === "lifetime" || Boolean(profile.plus_expires_at && new Date(profile.plus_expires_at) > new Date());
            const checks = {
                welcome: true,
                subscriber_1: follows.length >= 1,
                subscriber_5: follows.length >= 5,
                first_upload: uploads.length >= 1,
                uploads_5: uploads.length >= 5,
                first_comment: comments.length >= 1,
                comments_10: comments.length >= 10,
                first_like: likes.length >= 1,
                likes_10: likes.length >= 10,
                plus_member: ownPlus,
                verified_channel: Boolean(profile.admin_verified) || subscribers.length > 100,
                first_follower: subscribers.length >= 1
            };
            const claimed = new Set(claims.map(row => row.achievement_key));
            balance.textContent = `${Number(wallets[0]?.balance || 0).toLocaleString()} Wams Bucks`;
            grid.replaceChildren(...defs.map(def => card(def, claimed.has(def.id), checks[def.id])));
            status.textContent = `${claimed.size} of ${defs.length} achievements claimed. Complete milestones to unlock rewards.`;
        } catch (error) {
            status.textContent = error.message || "Could not load achievements. Apply supabase.sql and achievements-channel.sql first.";
            balance.textContent = "Unavailable";
        }
    }

    async function claim(def, button) {
        button.disabled = true;
        button.textContent = "Claiming…";
        status.textContent = `Claiming ${def.title}…`;
        try {
            const response = await api("rpc/claim_wams_achievement", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ requested_achievement: def.id })
            });
            const result = Array.isArray(response) ? response[0] : response;
            status.textContent = result?.claimed ? `Achievement claimed! ${def.reward} Wams Bucks added.` : "You have already claimed that achievement.";
            await load();
        } catch (error) {
            status.textContent = error.message || "Could not claim this achievement.";
            button.disabled = false;
            button.textContent = "Claim reward";
        }
    }
    load();
})();
