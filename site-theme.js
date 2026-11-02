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

    function applyDevicePasscodeLock() {
        const pageName = window.location.pathname.split("/").pop().toLowerCase();
        if (pageName === "login.html") return;
        let session;
        let lock;
        try {
            session = JSON.parse(localStorage.getItem("wamsTubeSession") || "null");
            lock = JSON.parse(localStorage.getItem("wamsTubePasscodeLock") || "null");
        } catch {
            return;
        }
        if (!session?.user?.id || !lock?.locked || lock.userId !== session.user.id) return;

        const gate = document.createElement("div");
        gate.className = "site-lockdown-gate device-passcode-gate";
        gate.setAttribute("role", "dialog");
        gate.setAttribute("aria-modal", "true");
        const card = document.createElement("section");
        card.className = "site-lockdown-card";
        const icon = document.createElement("span");
        icon.className = "material-symbols-rounded site-lockdown-icon";
        icon.textContent = "lock";
        const heading = document.createElement("h1");
        heading.textContent = "This device is locked";
        const description = document.createElement("p");
        description.className = "site-lockdown-message";
        description.textContent = "Enter your device passcode to continue.";
        const form = document.createElement("form");
        form.className = "device-passcode-form";
        const input = document.createElement("input");
        input.type = "password";
        input.inputMode = "numeric";
        input.autocomplete = "current-password";
        input.maxLength = 12;
        input.pattern = "[0-9]{6,12}";
        input.required = true;
        input.setAttribute("aria-label", "Device passcode");
        const message = document.createElement("p");
        message.className = "device-passcode-error";
        message.setAttribute("role", "alert");
        const unlock = document.createElement("button");
        unlock.className = "site-lockdown-button";
        unlock.type = "submit";
        unlock.textContent = "Unlock";
        form.append(input, message, unlock);
        const signOut = document.createElement("button");
        signOut.className = "device-passcode-signout";
        signOut.type = "button";
        signOut.textContent = "Log out instead";
        signOut.addEventListener("click", async () => {
            try {
                const url = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
                const key = window.WAMS_SUPABASE_ANON_KEY || "";
                if (url && key && session.access_token) {
                    await fetch(`${url}/auth/v1/logout`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${session.access_token}` } });
                }
            } catch { /* Clear the local session even if remote logout fails. */ }
            localStorage.removeItem("wamsTubeSession");
            window.location.href = "login.html";
        });
        form.addEventListener("submit", async event => {
            event.preventDefault();
            message.textContent = "";
            unlock.disabled = true;
            try {
                const decode = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
                const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(input.value), "PBKDF2", false, ["deriveBits"]);
                const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: decode(lock.salt), iterations: 310000, hash: "SHA-256" }, key, 256);
                const computed = btoa(String.fromCharCode(...new Uint8Array(bits)));
                if (computed !== lock.hash) throw new Error("That passcode didn’t match. Try again.");
                lock.locked = false;
                localStorage.setItem("wamsTubePasscodeLock", JSON.stringify(lock));
                gate.remove();
                document.documentElement.style.overflow = "";
            } catch (error) {
                message.textContent = error.message || "Passcode verification is unavailable in this browser.";
                input.select();
            } finally {
                unlock.disabled = false;
            }
        });
        card.append(icon, heading, description, form, signOut);
        gate.appendChild(card);
        document.body.appendChild(gate);
        document.documentElement.style.overflow = "hidden";
        input.focus();
    }

    async function applySidebarButtonLocks() {
        const sidebarItems = document.querySelectorAll(".sidebar .sidebar-item");
        if (!sidebarItems.length) return;
        const url = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
        const key = window.WAMS_SUPABASE_ANON_KEY || "";
        if (!url || !key) return;
        try {
            const response = await fetch(`${url}/rest/v1/site_sidebar_locks?enabled=eq.true&select=button_key,reason`, {
                headers: { apikey: key }
            });
            if (!response.ok) return;
            const locks = await response.json();
            let session;
            try { session = JSON.parse(localStorage.getItem("wamsTubeSession") || "null"); } catch { session = null; }
            let privileged = false;
            if (session?.access_token && session.user?.id) {
                const profileResponse = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=is_owner,is_admin,is_banned,is_suspected`, {
                    headers: { apikey: key, Authorization: `Bearer ${session.access_token}` }
                });
                if (profileResponse.ok) {
                    const [profile] = await profileResponse.json();
                    privileged = Boolean((profile?.is_owner || profile?.is_admin) && !profile.is_banned && !profile.is_suspected);
                }
            }
            const lockMap = new Map((locks || []).map(lock => [lock.button_key, lock]));
            sidebarItems.forEach(button => {
                const onclick = button.getAttribute("onclick") || "";
                const destination = button.dataset.sidebarLockKey || onclick.match(/(?:href\s*=\s*|location\.href\s*=\s*)['\"]([^'\"]+)['\"]/)?.[1];
                const lockKey = destination === "owner-panel.html"
                    ? "k8m4q2x9.html"
                    : destination || (/openAdminPanel\s*\(/.test(onclick) ? "admin-panel" : null);
                const lock = lockKey ? lockMap.get(lockKey) : null;
                if (lock && !privileged) {
                    const reason = lock.reason || "This section is temporarily unavailable.";
                    button.classList.add("sidebar-item-locked");
                    button.setAttribute("aria-disabled", "true");
                    button.title = `Locked: ${reason}`;
                    button.dataset.sidebarLockReason = reason;
                } else {
                    button.classList.remove("sidebar-item-locked");
                    button.removeAttribute("aria-disabled");
                    if (button.dataset.sidebarLockReason) {
                        button.removeAttribute("title");
                        delete button.dataset.sidebarLockReason;
                    }
                }
            });
        } catch {
            // A missing locks table should never prevent sidebar navigation.
        }
    }

    document.addEventListener("click", event => {
        const button = event.target.closest?.(".sidebar .sidebar-item.sidebar-item-locked");
        if (!button) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        window.alert(button.dataset.sidebarLockReason || "This section is temporarily unavailable.");
    }, true);

    async function applySiteLockdown() {
        const pageName = window.location.pathname.split("/").pop().toLowerCase();
        // Keep the sign-in page available so visitors can authenticate during lockdown.
        if (pageName === "login.html") {
            document.querySelector(".site-lockdown-gate")?.remove();
            document.documentElement.style.overflow = "";
            return;
        }

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
            let privileged = false;
            if (session?.access_token && session.user?.id) {
                const profileResponse = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=is_owner,is_admin,is_banned,is_suspected`, {
                    headers: { apikey: key, Authorization: `Bearer ${session.access_token}` }
                });
                if (profileResponse.ok) {
                    const [profile] = await profileResponse.json();
                    privileged = Boolean((profile?.is_owner || profile?.is_admin) && !profile.is_banned && !profile.is_suspected);
                }
            }
            if (privileged) return;

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
            reason.className = "site-lockdown-message";
            reason.textContent = lockdown.reason || "WamsTube is temporarily unavailable. Please check back soon.";
            const accessNote = document.createElement("p");
            accessNote.className = "site-lockdown-access-note";
            accessNote.textContent = "Only active owners and administrators can access the site during lockdown.";
            card.append(icon, eyebrow, title, reason, accessNote);

            const actions = document.createElement("div");
            actions.className = "site-lockdown-actions";
            if (session?.access_token) {
                const signOutButton = document.createElement("button");
                signOutButton.type = "button";
                signOutButton.className = "site-lockdown-button";
                signOutButton.textContent = "Log out";
                signOutButton.addEventListener("click", async () => {
                    signOutButton.disabled = true;
                    try {
                        await fetch(`${url}/auth/v1/logout`, {
                            method: "POST",
                            headers: { apikey: key, Authorization: `Bearer ${session.access_token}` }
                        });
                    } catch {
                        // Clear the local session even if remote logout is unavailable.
                    }
                    localStorage.removeItem("wamsTubeSession");
                    window.location.href = "login.html";
                });
                actions.appendChild(signOutButton);
            } else {
                const signInLink = document.createElement("a");
                signInLink.className = "site-lockdown-button";
                signInLink.href = "login.html";
                signInLink.textContent = "Sign in";
                actions.appendChild(signInLink);
            }
            card.appendChild(actions);
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

    applyDevicePasscodeLock();
    applySidebarButtonLocks();
    window.setInterval(applySidebarButtonLocks, 30000);
    applySiteTheme();
    applyOwnerAnnouncement();
    applySiteLockdown();
    window.setInterval(applySiteLockdown, 30000);
    window.setInterval(applyOwnerAnnouncement, 60000);
})();
