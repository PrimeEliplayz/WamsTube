"use strict";

(() => {
    const groups = [
        { title: "Playback", icon: "play_circle", items: [
            "Autoplay next video", "Start videos muted", "Remember playback position", "Prefer higher video quality", "Use data-saving playback", "Show playback controls", "Skip silent parts", "Enable loop playback", "Use keyboard media shortcuts", "Keep player theater-sized"
        ] },
        { title: "Appearance", icon: "palette", items: [
            "Use dark appearance", "Use compact video cards", "Show video thumbnails", "Show channel avatars", "Show video dates", "Use larger text", "Use reduced motion", "Use high contrast", "Keep sidebar expanded", "Show animations"
        ] },
        { title: "Privacy", icon: "lock", items: [
            "Pause watch history", "Pause search history", "Keep liked videos private", "Keep subscriptions private", "Hide my online activity", "Limit personalized recommendations", "Clear search when leaving", "Hide my channel from suggestions", "Allow channel mentions", "Allow video embeds"
        ] },
        { title: "Notifications", icon: "notifications", items: [
            "New subscriber alerts", "Video like alerts", "Comment like alerts", "New comment alerts", "Creator upload alerts", "Important admin messages", "Inbox badge count", "Quiet notification sounds", "Weekly activity summary", "Product update announcements"
        ] },
        { title: "Accessibility", icon: "accessibility_new", items: [
            "Prefer captions when available", "Show caption background", "Use larger captions", "Use keyboard navigation hints", "Announce page changes to screen readers", "Reduce flashing content", "Use clear focus outlines", "Prefer simple language", "Enable extra-readable spacing", "Keep controls easy to reach"
        ] },
        { title: "Search", icon: "manage_search", items: [
            "Show search suggestions", "Include channels in search", "Include videos in search", "Remember recent searches", "Show spelling suggestions", "Prefer newest search results", "Show video dates in results", "Search descriptions", "Keep search filters", "Open selected result directly"
        ] },
        { title: "Content", icon: "video_library", items: [
            "Show Shorts in recommendations", "Show live videos in recommendations", "Show subscriber-only labels", "Show verified badges", "Show creator badges", "Show video descriptions", "Show community content", "Filter sensitive titles", "Hide videos already watched", "Prioritize subscribed channels"
        ] },
        { title: "Data and playback", icon: "data_usage", items: [
            "Prefer Wi-Fi for high quality", "Preload video previews", "Preload next video", "Use lower quality on slow connections", "Show data-saving reminders", "Pause previews when off screen", "Avoid animated previews", "Load fewer videos at once", "Keep images optimized", "Ask before using mobile data"
        ] },
        { title: "Channel", icon: "account_circle", items: [
            "Show subscriber count on my channel", "Show my public uploads", "Show my public playlists", "Show my channel description", "Allow subscribers-only videos", "Allow video comments by default", "Notify me about new subscribers", "Show channel activity", "Display my Plus badge", "Show monetization status"
        ] },
        { title: "General", icon: "tune", items: [
            "Open links in the same tab", "Confirm before leaving an upload", "Remember this device", "Show helpful tips", "Show keyboard shortcuts", "Use 24-hour time", "Use relative dates", "Keep settings search text", "Show save confirmations", "Send anonymous diagnostics"
        ] }
    ];

    const securityCategory = { title: "Security", icon: "security", keywords: "account security password change passcode lock delete account authenticator totp two factor 2fa" };
    const storageKey = "wamsTubePreferences";
    const nav = document.getElementById("settingsCategoryNav");
    const container = document.getElementById("settingsCategories");
    const securityPanel = document.getElementById("settingsSecurity");
    const search = document.getElementById("settingsSearch");
    const status = document.getElementById("settingsStatus");
    const count = document.getElementById("settingsCount");
    const reset = document.getElementById("settingsReset");
    let preferences = loadPreferences();
    let selectedCategory = groups[0].title;

    function loadPreferences() {
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
            return saved && typeof saved === "object" ? saved : {};
        } catch {
            return {};
        }
    }

    function savePreferences() {
        try {
            localStorage.setItem(storageKey, JSON.stringify(preferences));
            status.textContent = "All changes saved on this device.";
            status.classList.remove("is-error");
        } catch {
            status.textContent = "Could not save settings. Check this browser's storage permissions.";
            status.classList.add("is-error");
        }
    }

    function matchesGroup(group, query) {
        return !query || group.title.toLocaleLowerCase().includes(query) ||
            group.items.some(item => item.toLocaleLowerCase().includes(query));
    }

    function render() {
        const query = search.value.trim().toLocaleLowerCase();
        const available = groups.filter(group => matchesGroup(group, query));
        const securityMatches = !query || `${securityCategory.title} ${securityCategory.keywords}`.toLocaleLowerCase().includes(query);
        if (securityMatches) available.push(securityCategory);

        if (!available.some(category => category.title === selectedCategory)) {
            selectedCategory = available[0]?.title || "";
        }

        nav.replaceChildren();
        available.forEach(category => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "settings-category-button";
            button.setAttribute("aria-current", String(category.title === selectedCategory));
            const icon = document.createElement("span");
            icon.className = "material-symbols-rounded";
            icon.setAttribute("aria-hidden", "true");
            icon.textContent = category.icon;
            const label = document.createElement("span");
            label.textContent = category.title;
            button.append(icon, label);
            button.addEventListener("click", () => {
                selectedCategory = category.title;
                render();
            });
            nav.appendChild(button);
        });

        container.replaceChildren();
        securityPanel.hidden = selectedCategory !== securityCategory.title;
        reset.disabled = selectedCategory === securityCategory.title;

        if (selectedCategory === securityCategory.title) {
            count.textContent = "Account security";
            return;
        }

        const group = groups.find(item => item.title === selectedCategory);
        if (!group) {
            count.textContent = "0 settings";
            const empty = document.createElement("p");
            empty.className = "settings-empty";
            empty.textContent = "No categories match your search.";
            container.appendChild(empty);
            return;
        }

        const matchingItems = group.items
            .map((label, itemIndex) => ({ label, itemIndex }))
            .filter(item => !query || `${group.title} ${item.label}`.toLocaleLowerCase().includes(query));
        const section = document.createElement("section");
        section.className = "settings-section";
        const heading = document.createElement("h2");
        heading.className = "settings-section-heading";
        const icon = document.createElement("span");
        icon.className = "material-symbols-rounded";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = group.icon;
        const title = document.createElement("span");
        title.textContent = group.title;
        heading.append(icon, title);
        section.appendChild(heading);

        matchingItems.forEach(({ label, itemIndex }) => {
            const key = `${groups.indexOf(group)}-${itemIndex}`;
            const row = document.createElement("label");
            row.className = "settings-row";
            const copy = document.createElement("span");
            copy.className = "settings-row-copy";
            const name = document.createElement("strong");
            name.textContent = label;
            const description = document.createElement("small");
            description.textContent = "Stored in this browser; account sync is not enabled.";
            copy.append(name, description);
            const toggle = document.createElement("input");
            toggle.className = "settings-toggle-input";
            toggle.type = "checkbox";
            toggle.checked = preferences[key] ?? defaultValue(groups.indexOf(group), itemIndex);
            toggle.setAttribute("aria-label", label);
            const switchUI = document.createElement("span");
            switchUI.className = "settings-switch";
            row.append(copy, toggle, switchUI);
            toggle.addEventListener("change", () => {
                preferences[key] = toggle.checked;
                savePreferences();
            });
            section.appendChild(row);
        });
        container.appendChild(section);
        count.textContent = `${matchingItems.length} ${matchingItems.length === 1 ? "setting" : "settings"}`;
    }

    function defaultValue(groupIndex, itemIndex) {
        if (groupIndex === 2) return itemIndex >= 6;
        if (groupIndex === 9) return itemIndex !== 9;
        return true;
    }

    search.addEventListener("input", render);
    reset.addEventListener("click", () => {
        if (!window.confirm("Reset all 100 preferences to their defaults?")) return;
        preferences = {};
        savePreferences();
        render();
    });

    document.getElementById("passwordChangeForm").addEventListener("submit", async event => {
        event.preventDefault();
        const message = document.getElementById("passwordChangeStatus");
        const currentPassword = document.getElementById("currentPassword").value;
        const newPassword = document.getElementById("newPassword").value;
        const confirmPassword = document.getElementById("confirmPassword").value;
        const session = (() => {
            try { return JSON.parse(localStorage.getItem("wamsTubeSession") || "null"); }
            catch { return null; }
        })();
        const supabaseUrl = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
        const anonKey = window.WAMS_SUPABASE_ANON_KEY || "";
        const form = event.currentTarget;
        const submit = form.querySelector('button[type="submit"]');
        message.textContent = "";
        message.classList.remove("is-error");

        if (!session?.user?.email || !session?.access_token || !supabaseUrl || !anonKey) {
            message.textContent = "Sign in with a configured account before changing your password.";
            message.classList.add("is-error");
            return;
        }
        if (newPassword.length < 8) {
            message.textContent = "Choose a password with at least 8 characters.";
            message.classList.add("is-error");
            return;
        }
        if (newPassword !== confirmPassword) {
            message.textContent = "The new passwords do not match.";
            message.classList.add("is-error");
            return;
        }

        submit.disabled = true;
        submit.textContent = "Updating…";
        try {
            const verified = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
                method: "POST",
                headers: { apikey: anonKey, "Content-Type": "application/json" },
                body: JSON.stringify({ email: session.user.email, password: currentPassword })
            });
            const verifiedData = await verified.json();
            if (!verified.ok || !verifiedData.access_token) {
                throw new Error(verifiedData.msg || verifiedData.message || "Current password could not be verified.");
            }

            const updated = await fetch(`${supabaseUrl}/auth/v1/user`, {
                method: "PUT",
                headers: {
                    apikey: anonKey,
                    Authorization: `Bearer ${session.access_token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ password: newPassword })
            });
            const updatedData = await updated.json();
            if (!updated.ok) {
                throw new Error(updatedData.msg || updatedData.message || "Password update failed.");
            }
            form.reset();
            message.textContent = "Password updated. Supabase stores it as a server-side hash; it is not saved in this browser.";
        } catch (error) {
            message.textContent = error.message || "Could not update the password. Please try again.";
            message.classList.add("is-error");
        } finally {
            submit.disabled = false;
            submit.textContent = "Change password";
        }
    });

    function getSecuritySession() {
        try { return JSON.parse(localStorage.getItem("wamsTubeSession") || "null"); }
        catch { return null; }
    }

    async function refreshSecuritySession() {
        const url = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
        const anonKey = window.WAMS_SUPABASE_ANON_KEY || "";
        const session = getSecuritySession();
        if (!url || !anonKey || !session?.refresh_token) {
            throw new Error("Your sign-in session expired. Sign out and sign in again, then retry the 2FA action.");
        }

        const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
            method: "POST",
            headers: { apikey: anonKey, "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: session.refresh_token })
        });
        const text = await response.text();
        let payload = {};
        try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
        if (!response.ok || !payload.access_token) {
            throw new Error("Your sign-in session expired. Sign out and sign in again, then retry the 2FA action.");
        }

        const refreshed = { ...session, ...payload, user: payload.user || session.user };
        localStorage.setItem("wamsTubeSession", JSON.stringify(refreshed));
        return refreshed.access_token;
    }

    async function securityRequest(path, options = {}, token = getSecuritySession()?.access_token, canRefresh = true) {
        const url = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
        const anonKey = window.WAMS_SUPABASE_ANON_KEY || "";
        if (!url || !anonKey || !token) throw new Error("Sign in with a configured Supabase account first.");
        const response = await fetch(`${url}${path}`, {
            ...options,
            headers: {
                apikey: anonKey,
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                ...(options.headers || {})
            }
        });
        if (response.status === 401 && canRefresh) {
            const refreshedToken = await refreshSecuritySession();
            return securityRequest(path, options, refreshedToken, false);
        }
        const text = await response.text();
        let payload = {};
        try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
        if (!response.ok) throw new Error(payload.msg || payload.message || payload.error_description || text || `Request failed (${response.status}).`);
        return payload;
    }

    const totpStatus = document.getElementById("totpStatus");
    const totpSetupButton = document.getElementById("totpSetupButton");
    const totpSetupArea = document.getElementById("totpSetupArea");
    const totpQrCode = document.getElementById("totpQrCode");
    const totpSecret = document.getElementById("totpSecret");
    const totpVerifyForm = document.getElementById("totpVerifyForm");
    const totpDisableForm = document.getElementById("totpDisableForm");
    let totpFactorId = "";
    let verifiedTotpFactorId = "";

    function getTotpQrSource(value) {
        if (typeof value !== "string" || !value.trim()) return "";
        const qr = value.trim();
        const svgDataUrl = /^data:image\/svg\+xml/i.test(qr);
        let svg = qr;

        if (svgDataUrl) {
            const comma = qr.indexOf(",");
            if (comma < 0) return "";
            const metadata = qr.slice(0, comma);
            if (/;base64/i.test(metadata)) return qr;
            svg = qr.slice(comma + 1);
            try {
                svg = decodeURIComponent(svg);
            } catch {
                // Some providers return a partially encoded SVG; try it as-is.
            }
        }

        // Supabase may return raw SVG, encoded SVG, or an SVG data URL. Normalize
        // all markup forms so characters such as # and spaces cannot break the URL.
        if (/<svg[\s>]/i.test(svg)) {
            const start = svg.search(/<svg[\s>]/i);
            const end = svg.toLowerCase().lastIndexOf("</svg>");
            if (start < 0 || end < start) return "";
            const markup = svg.slice(start, end + 6);
            return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
        }

        // Allow already usable non-SVG image data URLs from compatible providers.
        if (/^data:image\/(?:png|jpeg|webp);base64,/i.test(qr)) return qr;
        return "";
    }

    totpQrCode?.addEventListener("error", () => {
        totpQrCode.hidden = true;
        if (totpStatus) {
            totpStatus.textContent = "The QR image could not be displayed. Enter the setup key manually in your authenticator app.";
            totpStatus.classList.add("is-error");
        }
    });

    function rememberElevatedSession(data) {
        if (!data?.access_token) return;
        const previous = getSecuritySession() || {};
        localStorage.setItem("wamsTubeSession", JSON.stringify({
            ...previous,
            ...data,
            user: data.user || previous.user
        }));
    }

    async function loadTotpStatus() {
        try {
            const user = await securityRequest("/auth/v1/user");
            const factors = Array.isArray(user.factors) ? user.factors : [];
            const verified = factors.find(factor => factor.factor_type === "totp" && factor.status === "verified");
            const pending = factors.find(factor => factor.factor_type === "totp" && factor.status !== "verified");
            verifiedTotpFactorId = verified?.id || "";
            if (totpStatus) totpStatus.textContent = verified
                ? "Two-step verification is enabled for this account."
                : pending ? "An unfinished authenticator setup exists. Remove it in Supabase Auth or finish setting it up." : "Two-step verification is not enabled.";
            if (totpSetupButton) totpSetupButton.hidden = Boolean(verified || pending);
            if (totpDisableForm) totpDisableForm.hidden = !verified;
            return factors;
        } catch (error) {
            if (totpStatus) {
                totpStatus.textContent = error.message || "Could not load authenticator status.";
                totpStatus.classList.add("is-error");
            }
            if (totpSetupButton) totpSetupButton.disabled = true;
            return [];
        }
    }

    totpSetupButton?.addEventListener("click", async () => {
        totpSetupButton.disabled = true;
        if (totpStatus) totpStatus.textContent = "Starting authenticator setup…";
        try {
            const factor = await securityRequest("/auth/v1/factors", {
                method: "POST",
                body: JSON.stringify({ factor_type: "totp", friendly_name: "WamsTube authenticator" })
            });
            totpFactorId = factor.id;
            const qr = getTotpQrSource(factor.totp?.qr_code);
            if (totpQrCode) {
                totpQrCode.hidden = true;
                totpQrCode.removeAttribute("src");
                if (qr) {
                    totpQrCode.src = qr;
                    totpQrCode.hidden = false;
                }
            }
            if (totpSecret) totpSecret.textContent = factor.totp?.secret || "Check the setup response in Supabase Auth.";
            if (totpSetupArea) totpSetupArea.hidden = false;
            if (totpStatus) totpStatus.textContent = qr
                ? "Scan the QR code or enter the setup key, then verify a current code."
                : "A QR image was not provided. Enter the setup key manually in your authenticator app.";
            totpSetupButton.hidden = true;
        } catch (error) {
            if (totpStatus) {
                totpStatus.textContent = error.message || "Could not start authenticator setup.";
                totpStatus.classList.add("is-error");
            }
            totpSetupButton.disabled = false;
        }
    });

    totpVerifyForm?.addEventListener("submit", async event => {
        event.preventDefault();
        const code = document.getElementById("totpCode").value.trim();
        if (!totpFactorId || !/^\d{6}$/.test(code)) {
            if (totpStatus) totpStatus.textContent = "Enter the six-digit code from your authenticator app.";
            return;
        }
        const button = totpVerifyForm.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            const challenge = await securityRequest(`/auth/v1/factors/${encodeURIComponent(totpFactorId)}/challenge`, { method: "POST", body: "{}" });
            const verified = await securityRequest(`/auth/v1/factors/${encodeURIComponent(totpFactorId)}/verify`, {
                method: "POST",
                body: JSON.stringify({ challenge_id: challenge.id, code })
            });
            rememberElevatedSession(verified);
            totpVerifyForm.reset();
            if (totpSetupArea) totpSetupArea.hidden = true;
            if (totpStatus) {
                totpStatus.textContent = "Two-step verification is enabled.";
                totpStatus.classList.remove("is-error");
            }
            await loadTotpStatus();
        } catch (error) {
            if (totpStatus) {
                totpStatus.textContent = error.message || "Could not verify the authenticator code.";
                totpStatus.classList.add("is-error");
            }
        } finally {
            button.disabled = false;
        }
    });

    totpDisableForm?.addEventListener("submit", async event => {
        event.preventDefault();
        const code = document.getElementById("totpDisableCode").value.trim();
        const button = totpDisableForm.querySelector('button[type="submit"]');
        if (!verifiedTotpFactorId || !/^\d{6}$/.test(code)) return;
        button.disabled = true;
        try {
            const challenge = await securityRequest(`/auth/v1/factors/${encodeURIComponent(verifiedTotpFactorId)}/challenge`, { method: "POST", body: "{}" });
            const verified = await securityRequest(`/auth/v1/factors/${encodeURIComponent(verifiedTotpFactorId)}/verify`, {
                method: "POST",
                body: JSON.stringify({ challenge_id: challenge.id, code })
            });
            rememberElevatedSession(verified);
            const token = verified.access_token || getSecuritySession()?.access_token;
            await securityRequest(`/auth/v1/factors/${encodeURIComponent(verifiedTotpFactorId)}`, { method: "DELETE" }, token);
            totpDisableForm.reset();
            if (totpStatus) {
                totpStatus.textContent = "Two-step verification has been disabled.";
                totpStatus.classList.remove("is-error");
            }
            await loadTotpStatus();
        } catch (error) {
            if (totpStatus) {
                totpStatus.textContent = error.message || "Could not disable authenticator verification.";
                totpStatus.classList.add("is-error");
            }
        } finally {
            button.disabled = false;
        }
    });

    loadTotpStatus();

    const passcodeForm = document.getElementById("passcodeSetupForm");
    const passcodeStatus = document.getElementById("passcodeStatus");
    passcodeForm.addEventListener("submit", async event => {
        event.preventDefault();
        const first = document.getElementById("passcodeValue").value;
        const second = document.getElementById("passcodeConfirm").value;
        const session = getSecuritySession();
        if (!session?.user?.id) {
            passcodeStatus.textContent = "Sign in before setting a device passcode.";
            passcodeStatus.classList.add("is-error");
            return;
        }
        if (!/^\d{6,12}$/.test(first) || first !== second) {
            passcodeStatus.textContent = "Use matching passcodes containing 6–12 digits.";
            passcodeStatus.classList.add("is-error");
            return;
        }
        try {
            const salt = crypto.getRandomValues(new Uint8Array(16));
            const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(first), "PBKDF2", false, ["deriveBits"]);
            const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" }, material, 256);
            const encode = bytes => btoa(String.fromCharCode(...bytes));
            localStorage.setItem("wamsTubePasscodeLock", JSON.stringify({ userId: session.user.id, salt: encode(salt), hash: encode(new Uint8Array(bits)), locked: false }));
            passcodeForm.reset();
            passcodeStatus.textContent = "Device passcode saved. Use “Lock this device now” when you want to lock this browser.";
            passcodeStatus.classList.remove("is-error");
        } catch {
            passcodeStatus.textContent = "Could not save the passcode in this browser.";
            passcodeStatus.classList.add("is-error");
        }
    });

    document.getElementById("passcodeLockNow").addEventListener("click", () => {
        try {
            const lock = JSON.parse(localStorage.getItem("wamsTubePasscodeLock") || "null");
            const session = getSecuritySession();
            if (!lock?.hash || lock.userId !== session?.user?.id) throw new Error("Set a device passcode first.");
            lock.locked = true;
            localStorage.setItem("wamsTubePasscodeLock", JSON.stringify(lock));
            window.location.reload();
        } catch (error) {
            passcodeStatus.textContent = error.message || "Could not lock this device.";
            passcodeStatus.classList.add("is-error");
        }
    });

    document.getElementById("passcodeRemove").addEventListener("click", () => {
        localStorage.removeItem("wamsTubePasscodeLock");
        passcodeStatus.textContent = "The device passcode was removed from this browser.";
        passcodeStatus.classList.remove("is-error");
    });

    document.getElementById("deleteAccountForm").addEventListener("submit", async event => {
        event.preventDefault();
        const message = document.getElementById("deleteAccountStatus");
        const button = event.currentTarget.querySelector('button[type="submit"]');
        const session = getSecuritySession();
        if (document.getElementById("deleteAccountConfirm").value.trim() !== "DELETE") {
            message.textContent = 'Type DELETE exactly to confirm account deletion.';
            message.classList.add("is-error");
            return;
        }
        if (!session?.access_token) {
            message.textContent = "Sign in before deleting your account.";
            message.classList.add("is-error");
            return;
        }
        if (!window.confirm("Permanently delete your account and all associated WamsTube profile data? This cannot be undone.")) return;
        button.disabled = true;
        message.textContent = "";
        try {
            await securityRequest("/rest/v1/rpc/delete_my_wams_account", { method: "POST", body: "{}" });
            localStorage.removeItem("wamsTubeSession");
            localStorage.removeItem("wamsTubePasscodeLock");
            window.location.href = "login.html";
        } catch (error) {
            message.textContent = error.message;
            message.classList.add("is-error");
        } finally {
            button.disabled = false;
        }
    });

    render();
})();
