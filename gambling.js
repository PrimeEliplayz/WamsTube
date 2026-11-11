"use strict";

(() => {
    const apiUrl = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
    const apiKey = window.WAMS_SUPABASE_ANON_KEY || "";
    const balance = document.getElementById("gamblingBalance");
    const signIn = document.getElementById("gamblingSignIn");
    const plusRequired = document.getElementById("gamblingPlusRequired");
    const game = document.getElementById("gamblingGame");
    const form = document.getElementById("gamblingForm");
    const playButton = document.getElementById("gamblingPlay");
    const status = document.getElementById("gamblingStatus");
    const acknowledgements = [...document.querySelectorAll(".gambling-ack")];
    let session = null;
    let lifetimeMember = false;
    try { session = JSON.parse(localStorage.getItem("wamsTubeSession") || "null"); } catch {}

    async function request(path, options = {}) {
        const response = await fetch(`${apiUrl}/rest/v1/${path}`, {
            ...options,
            headers: {
                apikey: apiKey,
                ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
                ...(options.headers || {})
            }
        });
        const text = await response.text();
        if (!response.ok) {
            let message = text;
            try {
                const payload = JSON.parse(text);
                message = payload.message || payload.msg || payload.hint || text;
            } catch {}
            throw new Error(message || `Request failed (${response.status}).`);
        }
        return text ? JSON.parse(text) : [];
    }

    function refreshPlayState() {
        playButton.disabled = !lifetimeMember || acknowledgements.length !== 3 || !acknowledgements.every(box => box.checked);
        if (!playButton.disabled) status.textContent = "All three warnings acknowledged. Choose your wager and play responsibly.";
    }
    acknowledgements.forEach(box => box.addEventListener("change", refreshPlayState));

    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (!lifetimeMember || playButton.disabled) return;
        const wager = Number(document.getElementById("gamblingBet").value);
        if (!Number.isSafeInteger(wager) || wager < 1 || wager > 1000) {
            status.textContent = "Choose a wager from 1 to 1,000 Wams Bucks.";
            return;
        }
        const side = form.querySelector('input[name="gamblingSide"]:checked')?.value;
        if (!side) return;
        playButton.disabled = true;
        status.textContent = "Flipping the coin…";
        try {
            const result = await request("rpc/wams_play_coin_flip", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    requested_side: side,
                    requested_bet: wager,
                    warnings_acknowledged: acknowledgements.map(box => box.checked)
                })
            });
            const round = Array.isArray(result) ? result[0] : result;
            balance.textContent = Number(round.wams_balance).toLocaleString();
            if (round.won) {
                status.textContent = `You picked ${side}; the coin landed ${round.result_side}. You won ${Number(round.payout).toLocaleString()} Wams Bucks (2× your wager)!`;
            } else {
                status.textContent = `You picked ${side}; the coin landed ${round.result_side}. You lost your ${wager.toLocaleString()} Wams Bucks wager.`;
            }
        } catch (error) {
            status.textContent = error.message || "The coin flip could not be completed.";
        } finally {
            refreshPlayState();
        }
    });

    async function load() {
        if (!apiUrl || !apiKey) {
            status.textContent = "Wams Bucks Gamble is not configured yet.";
            return;
        }
        if (!session?.access_token || !session.user?.id) {
            signIn.hidden = false;
            balance.textContent = "Sign in to view";
            status.textContent = "Sign in with an account that has Lifetime WamsTube Plus to play.";
            return;
        }
        try {
            const eligibility = await request("rpc/has_wams_plus_feature", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ feature_name: "all" })
            });
            lifetimeMember = eligibility === true;
            if (!lifetimeMember) {
                plusRequired.hidden = false;
                balance.textContent = "Lifetime Plus required";
                status.textContent = "Wams Bucks Gamble is exclusively for active Lifetime WamsTube Plus members.";
                return;
            }
            game.hidden = false;
            const uid = encodeURIComponent(session.user.id);
            const wallet = await request(`wams_wallets?user_id=eq.${uid}&select=balance`);
            balance.textContent = Number(wallet[0]?.balance || 0).toLocaleString();
            refreshPlayState();
        } catch (error) {
            status.textContent = `${error.message || "Could not load Wams Bucks Gamble."} Apply wams-gambling.sql after investing.sql to enable this game.`;
        }
    }

    load();
})();
