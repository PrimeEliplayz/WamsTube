"use strict";

(() => {
    const url = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
    const key = window.WAMS_SUPABASE_ANON_KEY || "";
    const status = document.getElementById("walletStatus");
    const content = document.getElementById("walletContent");
    const signIn = document.getElementById("walletSignIn");
    let session = null;
    try { session = JSON.parse(localStorage.getItem("wamsTubeSession") || "null"); } catch {}

    async function request(path, options = {}) {
        const response = await fetch(`${url}/rest/v1/${path}`, {
            ...options,
            headers: {
                apikey: key,
                Authorization: `Bearer ${session.access_token}`,
                ...(options.headers || {})
            }
        });
        const text = await response.text();
        if (!response.ok) {
            let message = text;
            try {
                const body = JSON.parse(text);
                message = body.message || body.msg || body.hint || body.details || text;
            } catch {}
            throw new Error(message || `Request failed (${response.status}).`);
        }
        return text ? JSON.parse(text) : [];
    }

    const exchangeAmount = document.getElementById("exchangeBucksAmount");
    const exchangePreview = document.getElementById("exchangePreview");
    const exchangeStatus = document.getElementById("exchangeStatus");
    const exchangeButton = document.getElementById("exchangeBucksButton");
    const cosmeticGrid = document.getElementById("walletCosmeticGrid");
    const cosmeticStatus = document.getElementById("walletCosmeticStatus");
    const cosmeticSearch = document.getElementById("walletCosmeticSearch");
    let cosmeticItems = [];
    let ownedCosmetics = new Map();

    function updateExchangePreview() {
        const bucks = Number(exchangeAmount.value);
        const valid = Number.isInteger(bucks) && bucks >= 100 && bucks <= 1000000 && bucks % 100 === 0;
        exchangeButton.disabled = !valid;
        exchangePreview.textContent = valid
            ? `You will receive $${(bucks / 100).toFixed(2)} Game USD.`
            : "Enter a multiple of 100 Bucks, from 100 to 1,000,000.";
    }

    exchangeAmount.addEventListener("input", updateExchangePreview);
    exchangeButton.addEventListener("click", async () => {
        if (!session?.access_token) {
            exchangeStatus.textContent = "Sign in before exchanging Wams Bucks.";
            return;
        }
        const bucks = Number(exchangeAmount.value);
        if (!Number.isInteger(bucks) || bucks < 100 || bucks > 1000000 || bucks % 100 !== 0) {
            updateExchangePreview();
            return;
        }
        exchangeButton.disabled = true;
        exchangeStatus.textContent = "Processing exchange…";
        try {
            const result = await request("rpc/exchange_wams_bucks_for_game_usd", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bucks })
            });
            const row = Array.isArray(result) ? result[0] : result;
            document.getElementById("walletBucksBalance").textContent = Number(row?.wams_balance || 0).toLocaleString();
            document.getElementById("walletGameUsdBalance").textContent = `$${(Number(row?.game_balance_cents || 0) / 100).toFixed(2)}`;
            exchangeStatus.textContent = "Exchange complete. Your balances have been updated.";
        } catch (error) {
            exchangeStatus.textContent = error.message || "Could not exchange Wams Bucks. Apply wams-game-wallet.sql after the main Supabase schema.";
        } finally {
            updateExchangePreview();
        }
    });

    updateExchangePreview();

    function formatGameUsd(cents, signed = false) {
        const amount = Number(cents || 0) / 100;
        const abs = Math.abs(amount).toFixed(2);
        return `${signed && amount > 0 ? "+" : amount < 0 ? "−" : ""}$${abs} Game USD`;
    }

    function renderActivity(rows) {
        const list = document.getElementById("walletActivity");
        list.replaceChildren();
        if (!rows.length) {
            const empty = document.createElement("p");
            empty.className = "wallet-empty";
            empty.textContent = "No Game USD activity yet. Exchange Bucks, gain a subscriber, or receive an admin grant to get started.";
            list.appendChild(empty);
            return;
        }
        rows.forEach(row => {
            const item = document.createElement("article");
            item.className = "wallet-activity-item";
            const details = document.createElement("div");
            const reason = document.createElement("strong");
            reason.textContent = row.reason || "Wallet update";
            const date = document.createElement("span");
            date.textContent = new Date(row.created_at).toLocaleString();
            const amount = document.createElement("b");
            amount.className = Number(row.amount_cents) >= 0 ? "is-credit" : "is-debit";
            amount.textContent = formatGameUsd(row.amount_cents, true);
            details.append(reason, date);
            item.append(details, amount);
            list.appendChild(item);
        });
    }

    const paletteHues = {
        aurora: 164, berry: 326, blue: 215, coral: 12, cosmic: 258,
        emerald: 145, gold: 43, lavender: 275, mint: 155, ocean: 194,
        orchid: 292, peach: 24, pink: 340, plum: 305, rainbow: 285,
        ruby: 350, sapphire: 225, sunset: 18, teal: 180, violet: 268
    };

    function renderCosmetics() {
        const query = cosmeticSearch.value.trim().toLowerCase();
        const matches = cosmeticItems.filter(item =>
            `${item.title} ${item.description} ${item.palette}`.toLowerCase().includes(query)
        );
        cosmeticGrid.replaceChildren();
        if (!matches.length) {
            const empty = document.createElement("p");
            empty.className = "wallet-empty";
            empty.textContent = "No customizations match that search.";
            cosmeticGrid.appendChild(empty);
            return;
        }
        for (const item of matches) {
            const card = document.createElement("article");
            card.className = "wallet-cosmetic-card";
            card.dataset.palette = item.palette;
            card.dataset.pattern = String(item.pattern);
            card.style.setProperty("--cosmetic-hue", String(paletteHues[item.palette] ?? 270));
            const copy = document.createElement("div");
            const title = document.createElement("h3");
            title.textContent = item.title;
            const description = document.createElement("p");
            description.textContent = item.description;
            const price = document.createElement("strong");
            price.textContent = `$${(Number(item.price_cents) / 100).toFixed(2)} Game USD`;
            copy.append(title, description, price);
            const button = document.createElement("button");
            button.type = "button";
            button.dataset.sku = item.sku;
            const owned = ownedCosmetics.get(item.sku);
            if (owned?.equipped) {
                button.textContent = "Equipped";
                button.disabled = true;
                button.className = "is-equipped";
            } else if (owned) {
                button.textContent = "Equip";
                button.dataset.action = "equip";
            } else {
                button.textContent = "Unlock";
                button.dataset.action = "buy";
            }
            card.append(copy, button);
            cosmeticGrid.appendChild(card);
        }
    }

    function applyEquippedCosmetic() {
        const equipped = [...ownedCosmetics.values()].find(item => item.equipped);
        const page = document.querySelector(".wallet-page");
        if (!equipped) {
            page.style.removeProperty("--wallet-accent");
            page.removeAttribute("data-wallet-pattern");
            return;
        }
        const palette = cosmeticItems.find(item => item.sku === equipped.item_sku)?.palette;
        if (paletteHues[palette] === undefined) return;
        page.style.setProperty("--wallet-accent", `hsl(${paletteHues[palette]} 68% 48%)`);
        page.dataset.walletPattern = String(cosmeticItems.find(item => item.sku === equipped.item_sku)?.pattern ?? 0);
    }

    cosmeticSearch.addEventListener("input", renderCosmetics);
    cosmeticGrid.addEventListener("click", async event => {
        const button = event.target.closest("button[data-action]");
        if (!button) return;
        if (!session?.access_token) {
            cosmeticStatus.textContent = "Sign in to unlock or equip WamsTube site themes.";
            return;
        }
        const action = button.dataset.action;
        const sku = button.dataset.sku;
        button.disabled = true;
        cosmeticStatus.textContent = action === "buy" ? "Unlocking customization…" : "Equipping customization…";
        try {
            await request(`rpc/${action === "buy" ? "buy_game_usd_cosmetic" : "equip_game_usd_cosmetic"}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ requested_sku: sku })
            });
            cosmeticStatus.textContent = action === "buy"
                ? "Site theme unlocked and equipped across WamsTube."
                : "Site theme equipped across WamsTube.";
            await load();
        } catch (error) {
            cosmeticStatus.textContent = error.message || "Could not update your site theme.";
            button.disabled = false;
        }
    });

    async function load() {
        if (!session?.access_token || !session.user?.id) {
            status.textContent = "Sign in to access My Wallet.";
            signIn.hidden = false;
            return;
        }
        if (!url || !key) {
            status.textContent = "Supabase is not configured.";
            return;
        }
        try {
            const uid = encodeURIComponent(session.user.id);
            const [wallets, bucks, activity, items, inventory] = await Promise.all([
                request(`game_usd_wallets?user_id=eq.${uid}&select=balance_cents`),
                request(`wams_wallets?user_id=eq.${uid}&select=balance`),
                request(`game_usd_transactions?user_id=eq.${uid}&select=amount_cents,reason,created_at&order=created_at.desc&limit=30`),
                request("game_usd_cosmetics?select=sku,title,description,palette,pattern,price_cents&order=price_cents.asc"),
                request(`game_usd_cosmetic_inventory?user_id=eq.${uid}&select=item_sku,equipped`)
            ]);
            const cents = Number(wallets[0]?.balance_cents || 0);
            document.getElementById("walletGameUsdBalance").textContent = `$${(cents / 100).toFixed(2)}`;
            document.getElementById("walletBucksBalance").textContent = `${Number(bucks[0]?.balance || 0).toLocaleString()}`;
            renderActivity(activity);
            cosmeticItems = items;
            ownedCosmetics = new Map(inventory.map(item => [item.item_sku, item]));
            applyEquippedCosmetic();
            renderCosmetics();
            content.hidden = false;
            status.textContent = "Balances are up to date.";
        } catch (error) {
            status.textContent = `${error.message || "Could not load your wallet."} If the Game USD tables are not installed yet, apply wams-game-wallet.sql after supabase.sql.`;
        }
    }

    load();
})();
