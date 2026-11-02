(() => {
    const pendingKey = "wamsTubePendingTotpLogin";
    const form = document.getElementById("twoFactorForm");
    const codeInput = document.getElementById("twoFactorCode");
    const status = document.getElementById("twoFactorStatus");
    const submit = document.getElementById("twoFactorSubmit");
    const cancel = document.getElementById("twoFactorCancel");

    function readPendingLogin() {
        try {
            return JSON.parse(sessionStorage.getItem(pendingKey) || "null");
        } catch {
            return null;
        }
    }

    function showError(message) {
        status.textContent = message;
        status.classList.add("is-error");
    }

    cancel.addEventListener("click", () => {
        sessionStorage.removeItem(pendingKey);
        window.location.href = "login.html";
    });

    form.addEventListener("submit", async event => {
        event.preventDefault();
        status.textContent = "";
        status.classList.remove("is-error");

        const pending = readPendingLogin();
        const context = window.wamsAuthContext;
        const code = codeInput.value.trim();
        if (!pending?.session?.access_token || !pending.factorId) {
            showError("Your sign-in attempt expired. Return to sign in and try again.");
            submit.disabled = true;
            return;
        }
        if (!context?.configured()) {
            showError("Supabase is not configured. Check the project URL and anon key.");
            return;
        }
        if (!/^\d{6}$/.test(code)) {
            showError("Enter the six-digit code from your authenticator app.");
            codeInput.focus();
            return;
        }

        submit.disabled = true;
        cancel.disabled = true;
        submit.textContent = "Verifying…";
        try {
            const factorPath = `/auth/v1/factors/${encodeURIComponent(pending.factorId)}`;
            const request = async (path, body) => {
                const response = await fetch(`${context.supabaseUrl}${path}`, {
                    method: "POST",
                    headers: {
                        apikey: context.supabaseAnonKey,
                        Authorization: `Bearer ${pending.session.access_token}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(body)
                });
                const text = await response.text();
                let payload = {};
                try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
                if (!response.ok) {
                    throw new Error(payload.msg || payload.message || payload.error_description || `Verification failed (${response.status}).`);
                }
                return payload;
            };

            const challenge = await request(`${factorPath}/challenge`, {});
            const verifiedSession = await request(`${factorPath}/verify`, {
                challenge_id: challenge.id,
                code
            });
            if (!verifiedSession.access_token) {
                throw new Error("The authenticator code was not accepted. Check the code and try again.");
            }

            sessionStorage.removeItem(pendingKey);
            await window.wamsFinishAuth(context, verifiedSession);
        } catch (error) {
            showError(error.message || "Could not verify the authenticator code. Try again.");
            submit.disabled = false;
            cancel.disabled = false;
            submit.textContent = "Verify and sign in";
            codeInput.select();
        }
    });

    if (!readPendingLogin()) {
        showError("No pending sign-in was found. Return to sign in and try again.");
        submit.disabled = true;
    } else {
        codeInput.focus();
    }
})();
