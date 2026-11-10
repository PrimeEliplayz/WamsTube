"use strict";

(() => {
    const apiUrl = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
    const apiKey = window.WAMS_SUPABASE_ANON_KEY || "";
    const status = document.getElementById("investingStatus");
    const balance = document.getElementById("investingBalance");
    const market = document.getElementById("investmentMarket");
    const signIn = document.getElementById("investingSignIn");
    const plusRequired = document.getElementById("investingPlusRequired");
    let session = null;
    let lifetimeMember = false;
    let holdings = new Map();
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

    function renderMarket(assets) {
        market.replaceChildren();
        assets.forEach(asset => {
            const card = document.createElement("article");
            card.className = "investment-card";
            const icon = document.createElement("span");
            icon.className = "investment-card-icon material-symbols-rounded";
            icon.setAttribute("aria-hidden", "true");
            icon.textContent = asset.icon;
            const title = document.createElement("h2");
            title.textContent = asset.title;
            const description = document.createElement("p");
            description.textContent = asset.description;
            const priceWrap = document.createElement("div");
            priceWrap.className = "investment-price";
            const label = document.createElement("small");
            label.textContent = "Today's price per share";
            const price = document.createElement("strong");
            price.textContent = `${Number(asset.price).toLocaleString()} Wams Bucks`;
            priceWrap.append(label, price);
            const holding = document.createElement("p");
            holding.className = "investment-holding";
            holding.dataset.holding = asset.asset_key;
            holding.textContent = `Your shares: ${Number(holdings.get(asset.asset_key) || 0).toLocaleString()}`;
            const trade = document.createElement("div");
            trade.className = "investment-trade";
            const input = document.createElement("input");
            input.type = "number";
            input.min = "1";
            input.max = "10000";
            input.step = "1";
            input.inputMode = "numeric";
            input.value = "1";
            input.setAttribute("aria-label", `Shares of ${asset.title}`);
            ["buy", "sell"].forEach(action => {
                const button = document.createElement("button");
                button.type = "button";
                button.dataset.action = action;
                button.dataset.asset = asset.asset_key;
                button.dataset.price = String(asset.price);
                button.textContent = action === "buy" ? "Buy" : "Sell";
                button.disabled = !session?.access_token || !lifetimeMember;
                trade.appendChild(button);
            });
            trade.prepend(input);
            card.append(icon, title, description, priceWrap, holding, trade);
            market.appendChild(card);
        });
    }

    market.addEventListener("click", async event => {
        const button = event.target.closest("button[data-action]");
        if (!button) return;
        if (!session?.access_token) {
            status.textContent = "Sign in before investing Wams Bucks.";
            return;
        }
        if (!lifetimeMember) {
            status.textContent = "Investing requires active Lifetime WamsTube Plus.";
            return;
        }
        const card = button.closest(".investment-card");
        const shares = Number(card.querySelector("input").value);
        if (!Number.isSafeInteger(shares) || shares < 1 || shares > 10000) {
            status.textContent = "Choose between 1 and 10,000 shares.";
            return;
        }
        button.disabled = true;
        status.textContent = `${button.dataset.action === "buy" ? "Buying" : "Selling"} shares…`;
        try {
            const result = await request("rpc/wams_trade_investment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ requested_asset: button.dataset.asset, requested_action: button.dataset.action, requested_shares: shares })
            });
            const row = Array.isArray(result) ? result[0] : result;
            balance.textContent = Number(row.wams_balance).toLocaleString();
            holdings.set(button.dataset.asset, Number(row.shares));
            const holdingLabel = card.querySelector("[data-holding]");
            holdingLabel.textContent = `Your shares: ${Number(row.shares).toLocaleString()}`;
            status.textContent = `${button.dataset.action === "buy" ? "Bought" : "Sold"} ${shares.toLocaleString()} share${shares === 1 ? "" : "s"} at ${Number(row.price).toLocaleString()} Wams Bucks each.`;
        } catch (error) {
            status.textContent = error.message || "That investment could not be completed.";
        } finally {
            button.disabled = false;
        }
    });

    async function load() {
        if (!apiUrl || !apiKey) {
            status.textContent = "Investing is not configured yet.";
            return;
        }
        if (!session?.access_token || !session.user?.id) {
            signIn.hidden = false;
            balance.textContent = "Sign in to view";
            status.textContent = "Sign in with an account that has Lifetime WamsTube Plus to access investing.";
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
                status.textContent = "Investing is exclusively for active Lifetime WamsTube Plus members.";
                return;
            }

            const assets = await request("rpc/wams_investment_market", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}"
            });
            const uid = encodeURIComponent(session.user.id);
            const [wallet, positions] = await Promise.all([
                request(`wams_wallets?user_id=eq.${uid}&select=balance`),
                request(`wams_investment_holdings?user_id=eq.${uid}&select=asset_key,shares`)
            ]);
            balance.textContent = Number(wallet[0]?.balance || 0).toLocaleString();
            holdings = new Map(positions.map(position => [position.asset_key, Number(position.shares)]));
            renderMarket(assets);
            status.textContent = "Market prices are up to date.";
        } catch (error) {
            status.textContent = `${error.message || "Could not load the investment market."} Apply investing.sql after the main Supabase schema to enable investing.`;
        }
    }

    load();
})();
