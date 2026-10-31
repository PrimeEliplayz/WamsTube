"use strict";

const gamesLibrary = document.getElementById("gamesLibrary");
const gameFrame = document.getElementById("gameFrame");
const gameStage = document.getElementById("gameStage");
const stageOverlay = document.getElementById("gameStageOverlay");
const overlayIcon = document.getElementById("gameStageOverlayIcon");
const overlayTitle = document.getElementById("gameStageOverlayTitle");
const overlayMessage = document.getElementById("gameStageOverlayMessage");
const signInLink = document.getElementById("gameSignInLink");
const title = document.getElementById("selectedGameTitle");
const description = document.getElementById("selectedGameDescription");
const help = document.getElementById("gameHelp");
const restartButton = document.getElementById("restartGame");
const wideButton = document.getElementById("wideGame");
const fullscreenButton = document.getElementById("fullscreenGame");
const openGameLink = document.getElementById("openGameLink");
const gamesUrl = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
const gamesKey = window.WAMS_SUPABASE_ANON_KEY || "";
let activeGame = null;

function currentSession() {
    try {
        const session = JSON.parse(localStorage.getItem("wamsTubeSession") || "null");
        if (!session?.access_token) return null;
        const payloadPart = session.access_token.split(".")[1];
        if (payloadPart) {
            const payload = JSON.parse(atob(payloadPart.replace(/-/g, "+").replace(/_/g, "/")));
            if (payload.exp && payload.exp <= Math.floor(Date.now() / 1000)) return null;
        }
        return session;
    } catch {
        return null;
    }
}

function safeHttpsUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" ? url.href : "";
    } catch {
        return "";
    }
}

function showGate(message, closed = false) {
    gameFrame.removeAttribute("src");
    gameFrame.title = activeGame ? `${activeGame.title} game` : "Game player";
    stageOverlay.hidden = false;
    overlayIcon.textContent = closed ? "block" : "lock";
    overlayTitle.textContent = closed ? "Game closed" : "Sign in to play";
    overlayMessage.textContent = message;
    signInLink.hidden = closed;
    openGameLink.hidden = true;
    restartButton.disabled = true;
}

function setGame(game) {
    activeGame = game;
    title.textContent = game.title;
    description.textContent = game.description || "";
    help.textContent = game.controls || "Click inside the game first so keyboard controls work.";
    gameFrame.title = `${game.title} game`;
    gamesLibrary.querySelectorAll(".game-choice").forEach(button => {
        const selected = button.dataset.gameId === game.id;
        button.setAttribute("aria-current", selected ? "true" : "false");
    });

    if (game.isClosed) {
        showGate("this game has been closed by an owner", true);
        return;
    }
    if (!currentSession()) {
        showGate("Sign in to your account to play games.");
        return;
    }

    stageOverlay.hidden = true;
    gameFrame.src = game.embedUrl || game.websiteUrl;
    openGameLink.href = game.websiteUrl;
    openGameLink.hidden = false;
    restartButton.disabled = false;
}

function showEmptyState(message) {
    activeGame = null;
    gamesLibrary.replaceChildren();
    const notice = document.createElement("p");
    notice.className = "games-empty-state";
    notice.textContent = message;
    gamesLibrary.appendChild(notice);
    title.textContent = "No game selected";
    description.textContent = "Games added by an owner will appear here.";
    help.textContent = "Some websites block iframe embedding. Use the website link when a game does not load.";
    gameFrame.removeAttribute("src");
    gameFrame.title = "Game player";
    stageOverlay.hidden = true;
    openGameLink.hidden = true;
    restartButton.disabled = true;
}

function buildGameChoices(games) {
    gamesLibrary.replaceChildren();
    games.forEach(game => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "game-choice";
        button.dataset.gameId = game.id;
        button.setAttribute("aria-current", "false");
        const icon = document.createElement("span");
        icon.className = "game-choice-icon material-symbols-rounded";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = game.isClosed ? "lock" : "sports_esports";
        const copy = document.createElement("span");
        copy.className = "game-choice-copy";
        const name = document.createElement("strong");
        name.textContent = game.title;
        const tagline = document.createElement("small");
        tagline.textContent = game.isClosed ? "Closed by an owner" : (game.description || new URL(game.websiteUrl).hostname);
        copy.append(name, tagline);
        button.append(icon, copy);
        button.addEventListener("click", () => setGame(game));
        gamesLibrary.appendChild(button);
    });
}

const suggestionForm = document.getElementById("gameSuggestionForm");
const suggestionAccess = document.getElementById("gameSuggestionAccess");
const suggestionStatus = document.getElementById("gameSuggestionStatus");
const mySuggestions = document.getElementById("myGameSuggestions");

async function suggestionRequest(path, options = {}) {
    const session = currentSession();
    const response = await fetch(`${gamesUrl}/rest/v1/${path}`, {
        ...options,
        headers: {
            apikey: gamesKey,
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
            ...(options.headers || {})
        }
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || payload.msg || "Could not process your game suggestion.");
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
}

function addAccessLink(text, href) {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = text;
    link.className = "game-access-link";
    suggestionAccess?.insertAdjacentElement("afterend", link);
}

async function loadMySuggestions(userId) {
    if (!mySuggestions) return;
    try {
        const rows = await suggestionRequest(`arcade_game_suggestions?submitter_id=eq.${encodeURIComponent(userId)}&select=id,title,status,created_at&order=created_at.desc&limit=10`);
        mySuggestions.replaceChildren();
        if (!rows?.length) return;
        rows.forEach(row => {
            const item = document.createElement("div");
            item.className = "my-game-suggestion";
            const name = document.createElement("strong");
            name.textContent = row.title;
            const state = document.createElement("span");
            state.textContent = ` · ${row.status === "pending" ? "Awaiting owner review" : row.status === "approved" ? "Approved and added to Games" : "Not approved"}`;
            item.append(name, state);
            mySuggestions.appendChild(item);
        });
    } catch (error) {
        if (suggestionStatus) suggestionStatus.textContent = error.message;
    }
}

async function setupGameSuggestions() {
    if (!suggestionAccess || !gamesUrl || !gamesKey) return;
    const session = currentSession();
    if (!session?.user?.id) {
        suggestionAccess.textContent = "Suggesting games is a WamsTube Plus feature. Sign in and keep an active Plus membership to submit a suggestion.";
        addAccessLink("Sign in", "login.html");
        return;
    }
    try {
        const profiles = await suggestionRequest(`profiles?id=eq.${encodeURIComponent(session.user.id)}&select=plus_expires_at,plus_plan,is_banned`);
        const profile = profiles?.[0];
        const expiry = profile?.plus_expires_at ? new Date(profile.plus_expires_at) : null;
        const plusActive = !profile?.is_banned && (profile?.plus_plan === "lifetime" || Boolean(expiry && expiry > new Date()));
        if (plusActive) {
            suggestionAccess.textContent = "Share a game website with the owners. If approved, it will be added to the Games catalog automatically.";
            suggestionForm.hidden = false;
        } else {
            suggestionAccess.textContent = "An active WamsTube Plus membership is required to suggest games.";
            addAccessLink("Explore WamsTube Plus", "plus.html");
        }
        await loadMySuggestions(session.user.id);
    } catch (error) {
        suggestionAccess.textContent = error.message || "Could not check WamsTube Plus access.";
    }
}

function validateSuggestionUrl(value, label, required = false) {
    const trimmed = value.trim();
    if (!trimmed && !required) return null;
    let url;
    try { url = new URL(trimmed); } catch { throw new Error(`Enter a valid ${label}.`); }
    if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
    return url.href;
}

suggestionForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const session = currentSession();
    if (!session?.user?.id) {
        if (suggestionStatus) suggestionStatus.textContent = "Sign in with active WamsTube Plus to submit a game.";
        return;
    }
    const submit = suggestionForm.querySelector('button[type="submit"]');
    try {
        const suggestion = {
            submitter_id: session.user.id,
            title: document.getElementById("suggestGameTitle").value.trim(),
            website_url: validateSuggestionUrl(document.getElementById("suggestGameWebsite").value, "website URL", true),
            embed_url: validateSuggestionUrl(document.getElementById("suggestGameEmbed").value, "embed URL"),
            description: document.getElementById("suggestGameDescription").value.trim(),
            controls: document.getElementById("suggestGameControls").value.trim()
        };
        if (!suggestion.title) throw new Error("Enter a game title.");
        if (submit) submit.disabled = true;
        if (suggestionStatus) suggestionStatus.textContent = "Sending your suggestion for owner review…";
        await suggestionRequest("arcade_game_suggestions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify(suggestion)
        });
        suggestionForm.reset();
        if (suggestionStatus) suggestionStatus.textContent = "Suggestion sent! Owners will review it, and approved games are added automatically.";
        await loadMySuggestions(session.user.id);
    } catch (error) {
        if (suggestionStatus) suggestionStatus.textContent = error.message || "Could not submit this game suggestion.";
    } finally {
        if (submit) submit.disabled = false;
    }
});

async function loadGames() {
    if (!gamesUrl || !gamesKey) {
        showEmptyState("Games are not configured yet.");
        return;
    }
    try {
        const response = await fetch(`${gamesUrl}/rest/v1/arcade_games?select=id,title,website_url,embed_url,description,controls,is_closed&order=position.asc,created_at.asc`, {
            headers: { apikey: gamesKey }
        });
        if (!response.ok) throw new Error("Could not load the games catalog.");
        const rows = await response.json();
        const games = rows.map(row => ({
            id: row.id,
            title: String(row.title || "Game"),
            websiteUrl: safeHttpsUrl(row.website_url),
            embedUrl: safeHttpsUrl(row.embed_url || ""),
            description: String(row.description || ""),
            controls: String(row.controls || ""),
            isClosed: Boolean(row.is_closed)
        })).filter(game => game.websiteUrl);
        if (!games.length) {
            showEmptyState("No games have been added yet.");
            return;
        }
        buildGameChoices(games);
        setGame(games[0]);
    } catch (error) {
        console.warn("Could not load games.", error);
        showEmptyState("Games could not be loaded. Please try again later.");
    }
}

restartButton.addEventListener("click", () => {
    if (!activeGame || activeGame.isClosed || !currentSession()) return;
    gameFrame.src = activeGame.embedUrl || activeGame.websiteUrl;
});

wideButton.addEventListener("click", () => {
    const enabled = !gameStage.classList.contains("is-wide");
    gameStage.classList.toggle("is-wide", enabled);
    wideButton.setAttribute("aria-pressed", String(enabled));
    wideButton.innerHTML = enabled
        ? '<span class="material-symbols-rounded" aria-hidden="true">close_fullscreen</span> Normal size'
        : '<span class="material-symbols-rounded" aria-hidden="true">aspect_ratio</span> Theater';
});

async function toggleFullscreen() {
    try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (gameStage.requestFullscreen) await gameStage.requestFullscreen();
        else help.textContent = "Fullscreen is not supported by this browser.";
    } catch (error) {
        help.textContent = error.message || "Fullscreen could not be opened.";
    }
}

fullscreenButton.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", () => {
    const active = document.fullscreenElement === gameStage;
    fullscreenButton.innerHTML = active
        ? '<span class="material-symbols-rounded" aria-hidden="true">fullscreen_exit</span> Exit fullscreen'
        : '<span class="material-symbols-rounded" aria-hidden="true">fullscreen</span> Fullscreen';
});

setupGameSuggestions();
loadGames();
