"use strict";

(() => {
    const palettes = {
        aurora: 164, berry: 326, blue: 215, coral: 12, cosmic: 258,
        emerald: 145, gold: 43, lavender: 275, mint: 155, ocean: 194,
        orchid: 292, peach: 24, pink: 340, plum: 305, rainbow: 285,
        ruby: 350, sapphire: 225, sunset: 18, teal: 180, violet: 268
    };

    async function applySiteTheme() {
        let session;
        try {
            session = JSON.parse(localStorage.getItem("wamsTubeSession") || "null");
        } catch {
            return;
        }
        const url = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
        const key = window.WAMS_SUPABASE_ANON_KEY || "";
        if (!session?.access_token || !session?.user?.id || !url || !key) return;

        try {
            const headers = {
                apikey: key,
                Authorization: `Bearer ${session.access_token}`
            };
            const uid = encodeURIComponent(session.user.id);
            const inventoryResponse = await fetch(
                `${url}/rest/v1/game_usd_cosmetic_inventory?user_id=eq.${uid}&equipped=eq.true&select=item_sku&limit=1`,
                { headers }
            );
            if (!inventoryResponse.ok) return;
            const inventory = await inventoryResponse.json();
            const equippedSku = inventory[0]?.item_sku;
            if (!equippedSku) return;

            const catalogResponse = await fetch(
                `${url}/rest/v1/game_usd_cosmetics?sku=eq.${encodeURIComponent(equippedSku)}&select=palette,pattern&limit=1`,
                { headers }
            );
            if (!catalogResponse.ok) return;
            const [theme] = await catalogResponse.json();
            const hue = palettes[theme?.palette];
            if (!theme || hue === undefined) return;

            const root = document.documentElement;
            root.dataset.wamsTheme = theme.palette;
            root.dataset.wamsThemePattern = String(theme.pattern);
            root.style.setProperty("--wams-theme-accent", `hsl(${hue} 68% 43%)`);
            root.style.setProperty("--wams-theme-soft", `hsl(${hue} 70% 95%)`);
            root.style.setProperty("--wams-theme-hue", String(hue));
        } catch {
            // The site remains usable if theme data is unavailable.
        }
    }

    async function applySiteLockdown() {
        const url = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
        const key = window.WAMS_SUPABASE_ANON_KEY || "";
        if (!url || !key) return;
        try {
            const response = await fetch(`${url}/rest/v1/site_lockdown?singleton=eq.true&select=enabled,reason`, {
                headers: { apikey: key }
            });
            if (!response.ok) return;
            const [lockdown] = await response.json();
            const existingGate = document.querySelector(".site-lockdown-gate");
            if (!lockdown?.enabled) {
                existingGate?.remove();
                document.documentElement.style.overflow = "";
                return;
            }
            if (existingGate) return;

            let session;
            try { session = JSON.parse(localStorage.getItem("wamsTubeSession") || "null"); } catch { session = null; }
            let activeOwner = false;
            if (session?.access_token && session.user?.id) {
                const profileResponse = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=is_owner,is_banned,is_suspected`, {
                    headers: { apikey: key, Authorization: `Bearer ${session.access_token}` }
                });
                if (profileResponse.ok) {
                    const [profile] = await profileResponse.json();
                    activeOwner = Boolean(profile?.is_owner && !profile.is_banned && !profile.is_suspected);
                }
            }
            if (activeOwner) return;

            const gate = document.createElement("div");
            gate.className = "site-lockdown-gate";
            gate.setAttribute("role", "alertdialog");
            gate.setAttribute("aria-modal", "true");
            gate.setAttribute("aria-labelledby", "siteLockdownTitle");
            const card = document.createElement("section");
            card.className = "site-lockdown-card";
            const icon = document.createElement("span");
            icon.className = "material-symbols-rounded site-lockdown-icon";
            icon.setAttribute("aria-hidden", "true");
            icon.textContent = "vpn_lock";
            const eyebrow = document.createElement("p");
            eyebrow.className = "site-lockdown-eyebrow";
            eyebrow.textContent = "WAMSTUBE MAINTENANCE";
            const title = document.createElement("h1");
            title.id = "siteLockdownTitle";
            title.textContent = "The site is temporarily locked";
            const reason = document.createElement("p");
            reason.textContent = lockdown.reason || "WamsTube is temporarily unavailable. Please check back soon.";
            card.append(icon, eyebrow, title, reason);
            gate.appendChild(card);
            document.body.appendChild(gate);
            document.documentElement.style.overflow = "hidden";
        } catch {
            // If the status endpoint is unavailable, leave the site usable.
        }
    }

    async function applyOwnerAnnouncement() {
        const url = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
        const key = window.WAMS_SUPABASE_ANON_KEY || "";
        if (!url || !key) return;
        try {
            const response = await fetch(`${url}/rest/v1/site_announcement?singleton=eq.true&select=enabled,title,body`, {
                headers: { apikey: key }
            });
            if (!response.ok) return;
            const [announcement] = await response.json();
            const existing = document.querySelector(".owner-announcement-banner");
            if (!announcement?.enabled) {
                existing?.remove();
                return;
            }
            const banner = existing || document.createElement("aside");
            banner.className = "owner-announcement-banner";
            banner.setAttribute("role", "status");
            const title = document.createElement("strong");
            title.textContent = announcement.title || "WamsTube notice";
            const body = document.createElement("p");
            body.textContent = announcement.body || "";
            banner.replaceChildren(title, body);
            if (!existing) document.body.prepend(banner);
        } catch {
            // Public announcement loading is optional; keep the page usable.
        }
    }

    applySiteTheme();
    applyOwnerAnnouncement();
    applySiteLockdown();
    window.setInterval(applySiteLockdown, 30000);
    window.setInterval(applyOwnerAnnouncement, 60000);
})();
