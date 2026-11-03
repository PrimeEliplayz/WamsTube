(function () {
    let signupMode =
        document.body.dataset.authMode === "signup";

    const supabaseUrl =
        (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");

    const supabaseAnonKey =
        window.WAMS_SUPABASE_ANON_KEY || "";
    let turnstileWidgetId = null;
    let turnstileToken = "";

    window.wamsTurnstileLoaded = function () {
        renderSignupCaptcha();
    };

    function renderSignupCaptcha() {
        const container = document.getElementById("signupTurnstile");
        if (!container) return;
        const overlay = container.closest(".auth-overlay");
        if (overlay && !overlay.classList.contains("show")) return;

        const siteKey = window.WAMS_TURNSTILE_SITE_KEY || "";
        const help = document.getElementById("signupCaptchaHelp");
        if (!siteKey) {
            if (help) help.textContent = "Authentication is not configured yet: add the Cloudflare Turnstile site key.";
            return;
        }
        if (!window.turnstile) return;
        if (turnstileWidgetId !== null) return;

        if (help) help.textContent = "Complete the Cloudflare check to continue.";
        turnstileWidgetId = window.turnstile.render(container, {
            sitekey: siteKey,
            callback(token) {
                turnstileToken = token;
            },
            "expired-callback"() {
                turnstileToken = "";
            },
            "error-callback"() {
                turnstileToken = "";
            }
        });
    }

    function resetSignupCaptcha() {
        turnstileToken = "";
        if (window.turnstile && turnstileWidgetId !== null) {
            window.turnstile.reset(turnstileWidgetId);
        }
    }

    function getSavedSession() {
        try {
            return JSON.parse(
                localStorage.getItem("wamsTubeSession") ||
                    "null"
            );
        } catch {
            return null;
        }
    }

    function getLockScreen() {
        return document.getElementById(
            "wamsBannedAccountScreen"
        );
    }

    function removeLockScreen() {
        getLockScreen()?.remove();
        document.body.classList.remove(
            "wams-account-is-banned"
        );
    }

    async function getAdminName(profile, accessToken) {
        if (!profile?.banned_by) {
            return "a WamsTube administrator";
        }

        try {
            const response = await fetch(
                `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(
                    profile.banned_by
                )}&select=channel_name`,
                {
                    headers: {
                        apikey: supabaseAnonKey,
                        Authorization: `Bearer ${accessToken}`
                    }
                }
            );

            if (!response.ok) {
                return "a WamsTube administrator";
            }

            const profiles = await response.json();

            return (
                profiles[0]?.channel_name ||
                "a WamsTube administrator"
            );
        } catch {
            return "a WamsTube administrator";
        }
    }

    async function showBannedAccountScreen(profile) {
        removeLockScreen();

        const session = getSavedSession();
        const lockedBy = await getAdminName(
            profile,
            session?.access_token
        );

        const screen = document.createElement("main");

        screen.id = "wamsBannedAccountScreen";
        screen.className =
            "wams-banned-account-screen";
        screen.setAttribute("role", "alert");

        const icon = document.createElement("div");
        icon.className = "wams-banned-lock";
        icon.setAttribute("aria-hidden", "true");

        const iconText = document.createElement("span");
        iconText.className =
            "material-symbols-rounded";
        iconText.textContent = "lock";

        icon.appendChild(iconText);

        const heading = document.createElement("h1");
        heading.textContent =
            "This account has been banned for ∞ years";

        const message = document.createElement("p");
        message.append(
            document.createTextNode(
                "This account has been banned by "
            )
        );

        const lockedByName = document.createElement("strong");
        lockedByName.textContent = lockedBy;

        const middle = document.createTextNode(
            ". Please contact "
        );

        const contactName = document.createElement("strong");
        contactName.textContent = lockedBy;

        const ending = document.createTextNode(
            " if you think this is a mistake. HAH Imagine getting banned, couldn't be me LOL. If you contact us we ain't doing nothing Bro.😭🥀. And better yet, we are wiping your account so even if you get unbanned you will have nothing SONIO."
        );

        message.append(
            lockedByName,
            middle,
            contactName,
            ending
        );

        const reason = profile.ban_reason
            ? document.createElement("p")
            : null;

        if (reason) {
            reason.className =
                "wams-banned-account-reason";
            reason.textContent =
                `Reason: ${profile.ban_reason}`;
        }

        const signOutButton =
            document.createElement("button");

        signOutButton.id =
            "wamsBannedSignOut";

        signOutButton.type = "button";
        signOutButton.className =
            "wams-banned-sign-out";
        signOutButton.textContent = "Log out";

        signOutButton.addEventListener(
            "click",
            signOut
        );

        screen.append(icon, heading, message);

        if (reason) {
            screen.appendChild(reason);
        }

        screen.appendChild(signOutButton);
        document.body.appendChild(screen);

        document.body.classList.add(
            "wams-account-is-banned"
        );
    }

    function syncAccountButton() {
        const button =
            document.getElementById("accountButton");

        if (!button) {
            return;
        }

        const session = getSavedSession();

        const signedIn = Boolean(
            session &&
                session.access_token &&
                session.user
        );

        button.textContent = signedIn
            ? "Sign out"
            : "Sign in";

        button.onclick = signedIn
            ? signOut
            : () => {
                  window.location.href =
                      "login.html";
              };
    }

    async function signOut() {
        const session = getSavedSession();

        if (
            session?.access_token &&
            supabaseUrl &&
            supabaseAnonKey
        ) {
            try {
                await fetch(
                    `${supabaseUrl}/auth/v1/logout`,
                    {
                        method: "POST",
                        headers: {
                            apikey: supabaseAnonKey,
                            Authorization:
                                `Bearer ${session.access_token}`
                        }
                    }
                );
            } catch {
                // Continue local sign out.
            }
        }

        localStorage.removeItem(
            "wamsTubeSession"
        );

        removeLockScreen();

        const adminEntry = document.getElementById(
            "adminSidebarEntry"
        );

        if (adminEntry) {
            adminEntry.style.display = "none";
        }

        syncAccountButton();
        window.wamsQuietHoursRefresh?.();
        window.location.href = "login.html";
    }

    async function loadProfile() {
        const session = getSavedSession();

        if (
            !session?.access_token ||
            !session.user?.id
        ) {
            throw new Error(
                "Your sign-in session is incomplete. Please sign in again."
            );
        }

        const response = await fetch(
            `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(
                session.user.id
            )}&select=id,channel_name,is_admin,is_banned,banned_by,ban_reason,admin_verified`,
            {
                headers: {
                    apikey: supabaseAnonKey,
                    Authorization:
                        `Bearer ${session.access_token}`
                }
            }
        );

        if (!response.ok) {
            const text = await response.text();

            let payload = {};

            try {
                payload = JSON.parse(text);
            } catch {
                payload = {};
            }

            throw new Error(
                payload.message ||
                    payload.msg ||
                    payload.error_description ||
                    text ||
                    `Profile request failed (${response.status}).`
            );
        }

        const profiles = await response.json();
        const profile = profiles[0];

        if (!profile) {
            throw new Error(
                "Your account profile is missing. Run the updated supabase.sql, then sign in again."
            );
        }

        if (profile.is_banned) {
            await showBannedAccountScreen(
                profile
            );

            return profile;
        }

        removeLockScreen();

        return profile;
    }

    document.addEventListener(
        "DOMContentLoaded",
        async () => {
            syncAccountButton();

            const session = getSavedSession();

            if (
                session?.access_token &&
                session.user?.id &&
                supabaseUrl &&
                supabaseAnonKey
            ) {
                try {
                    await loadProfile();
                } catch {
                    localStorage.removeItem(
                        "wamsTubeSession"
                    );

                    syncAccountButton();
                }
            }
        }
    );

    if (supabaseUrl && supabaseAnonKey) {
        window.wamsAuthContext = {
            supabaseUrl,
            supabaseAnonKey,
            configured: () => true,

            setSession(session) {
                localStorage.setItem(
                    "wamsTubeSession",
                    JSON.stringify(session)
                );
            },

            loadProfile,

            async refreshFeed() {},

            syncAccountButton
        };
    }

    function updateAuthMode() {
        const heading =
            document.getElementById("authHeading");

        const help =
            document.getElementById("authHelp");

        const channelField =
            document.getElementById(
                "signupChannelField"
            );

        const submit =
            document.getElementById("authSubmit");

        const modeButton =
            document.getElementById(
                "authModeButton"
            );

        if (heading) {
            heading.textContent = signupMode
                ? "Create your channel"
                : "Sign in to Wams Tube";
        }

        if (help) {
            help.textContent = signupMode
                ? "Only @mtps.us email addresses can create an account."
                : "Use your @mtps.us email to like, comment, and follow channels.";
        }

        if (channelField) {
            channelField.style.display =
                signupMode ? "block" : "none";
        }

        const termsField = document.getElementById("signupTermsField");
        const captchaField = document.getElementById("signupCaptchaField");
        const captchaHelp = document.getElementById("signupCaptchaHelp");
        if (termsField) termsField.style.display = signupMode ? "flex" : "none";
        if (captchaField) captchaField.style.display = "block";
        if (captchaHelp) captchaHelp.textContent = signupMode
            ? "Complete the Cloudflare check to create an account."
            : "Complete the Cloudflare check to sign in.";
        if (!signupMode) {
            const terms = document.getElementById("signupTerms");
            if (terms) terms.checked = false;
        }
        resetSignupCaptcha();
        renderSignupCaptcha();

        if (submit) {
            submit.textContent = signupMode
                ? "Create account"
                : "Sign in";
        }

        if (modeButton) {
            modeButton.textContent = signupMode
                ? "Sign in instead"
                : "Create account";
        }
    }

    window.openAuth = function () {
        signupMode = false;
        updateAuthMode();

        const error =
            document.getElementById("authError");

        const overlay =
            document.getElementById("authOverlay");

        if (error) {
            error.textContent = "";
        }

        overlay?.classList.add("show");
        renderSignupCaptcha();
    };

    window.closeAuth = function () {
        const overlay =
            document.getElementById("authOverlay");

        if (overlay) {
            overlay.classList.remove("show");
        } else {
            window.location.href = "index.html";
        }
    };

    window.toggleAuthMode = function () {
        signupMode = !signupMode;
        updateAuthMode();

        const error =
            document.getElementById("authError");

        if (error) {
            error.textContent = "";
        }
    };

    window.submitAuth = async function () {
        const context = window.wamsAuthContext;
        const error = document.getElementById("authError");
        const submit = document.getElementById("authSubmit");
        if (error) error.textContent = "";

        if (!context || !context.configured()) {
            if (error) error.textContent = "Add your Supabase project URL and anon key in supabase-config.js first.";
            return;
        }

        const api = async (path, options = {}) => {
            const method = (options.method || "GET").toUpperCase();
            const response = await fetch(context.supabaseUrl + path, {
                ...options,
                headers: {
                    apikey: context.supabaseAnonKey,
                    "Content-Type": "application/json",
                    ...(options.headers || {})
                }
            });
            const text = await response.text();
            let payload = {};
            try {
                payload = text ? JSON.parse(text) : {};
            } catch {
                payload = {};
            }
            if (!response.ok) {
                const detail = payload.msg || payload.message ||
                    payload.error_description ||
                    (typeof payload.error === "string" ? payload.error : payload.error?.message) ||
                    payload.code ||
                    text.slice(0, 240);
                throw new Error(
                    `${method} ${path} failed (HTTP ${response.status})${detail ? `: ${detail}` : "."}`
                );
            }
            return payload;
        };

        try {
            submit.disabled = true;
            const email = document.getElementById("authEmail")?.value.trim().toLowerCase() || "";
            const password = document.getElementById("authPassword")?.value || "";
            if (!/^[^\s@]+@mtps\.us$/.test(email)) throw new Error("Use an email ending exactly in @mtps.us.");
            if (!password) throw new Error("Enter your password.");
            if (signupMode && !document.getElementById("signupTerms")?.checked) {
                throw new Error("Please agree to the Terms of Service before creating an account.");
            }
            if (!window.WAMS_TURNSTILE_SITE_KEY) {
                throw new Error("Cloudflare Turnstile is not configured yet. Add your public site key first.");
            }
            if (!turnstileToken) {
                throw new Error("Complete the Cloudflare 'I am human' check before continuing.");
            }

            submit.textContent = signupMode ? "Creating account…" : "Signing in…";
            const body = {
                email,
                password,
                gotrue_meta_security: {
                    captcha_token: turnstileToken
                }
            };
            const path = signupMode ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password";
            if (signupMode) {
                body.data = {
                    channel_name: document.getElementById("signupChannel")?.value.trim() || email.split("@")[0]
                };
            }
            const data = await api(path, { method: "POST", body: JSON.stringify(body) });
            if (!data.access_token) {
                if (error) error.textContent = "Check your school email to confirm your account, then sign in.";
                return;
            }

            let authenticatedSession = data;
            if (!signupMode) {
                let user = data.user;
                if (!Array.isArray(user?.factors)) {
                    user = await api("/auth/v1/user", {
                        headers: { Authorization: `Bearer ${data.access_token}` }
                    });
                }
                const totpFactor = (user.factors || []).find(factor => factor.factor_type === "totp" && factor.status === "verified");
                if (totpFactor) {
                    sessionStorage.setItem("wamsTubePendingTotpLogin", JSON.stringify({
                        session: data,
                        factorId: totpFactor.id
                    }));
                    window.location.href = "two-factor.html";
                    return;
                }
            }

            await finishAuth(context, authenticatedSession);
        } catch (authError) {
            if (error) error.textContent = authError.message || "Authentication failed.";
        } finally {
            resetSignupCaptcha();
            submit.disabled = false;
            submit.textContent = signupMode ? "Create account" : "Sign in";
        }
    };

    async function finishAuth(context, session) {
        context.setSession(session);
        const profile = await context.loadProfile();
        window.closeAuth();
        context.syncAccountButton();
        if (!profile.is_banned) {
            await window.wamsQuietHoursRefresh?.();
            await context.refreshFeed();
        }
    }

    window.wamsFinishAuth = finishAuth;
})();
