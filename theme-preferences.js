"use strict";

(() => {
    const storageKey = "wamsTubeSiteTheme";
    const themes = [
        { id: "violet", name: "Violet", hue: 268 },
        { id: "blue", name: "Blue", hue: 215 },
        { id: "teal", name: "Teal", hue: 180 },
        { id: "mint", name: "Mint", hue: 155 },
        { id: "coral", name: "Coral", hue: 12 },
        { id: "peach", name: "Peach", hue: 24 },
        { id: "pink", name: "Pink", hue: 340 },
        { id: "gold", name: "Gold", hue: 43 }
    ];
    const options = document.getElementById("siteThemeOptions");
    const status = document.getElementById("siteThemeStatus");
    if (!options) return;

    function readTheme() {
        try {
            const value = JSON.parse(localStorage.getItem(storageKey) || "null");
            return themes.some(theme => theme.id === value?.id) ? value.id : "violet";
        } catch {
            return "violet";
        }
    }

    function applyTheme(theme) {
        const root = document.documentElement;
        root.dataset.wamsTheme = theme.id;
        root.dataset.wamsThemePattern = "0";
        root.style.setProperty("--wams-theme-hue", String(theme.hue));
        root.style.setProperty("--wams-theme-accent", `hsl(${theme.hue} 68% 43%)`);
        root.style.setProperty("--wams-theme-soft", `hsl(${theme.hue} 70% 95%)`);
    }

    function render() {
        const selected = readTheme();
        options.replaceChildren();
        themes.forEach(theme => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "settings-theme-option";
            button.setAttribute("aria-pressed", String(theme.id === selected));
            button.setAttribute("aria-label", `${theme.name} theme`);
            button.title = `${theme.name} theme`;
            const swatch = document.createElement("span");
            swatch.className = "settings-theme-swatch";
            swatch.style.setProperty("--theme-swatch", `hsl(${theme.hue} 68% 43%)`);
            const label = document.createElement("span");
            label.className = "settings-theme-label";
            label.textContent = theme.name;
            const check = document.createElement("span");
            check.className = "material-symbols-rounded settings-theme-check";
            check.setAttribute("aria-hidden", "true");
            check.textContent = "check_circle";
            button.append(swatch, label, check);
            button.addEventListener("click", () => {
                try {
                    localStorage.setItem(storageKey, JSON.stringify({ id: theme.id }));
                    applyTheme(theme);
                    render();
                    status.textContent = `${theme.name} theme saved on this device.`;
                } catch {
                    status.textContent = "Could not save your theme. Check this browser’s storage permissions.";
                }
            });
            options.appendChild(button);
        });
    }

    const selected = themes.find(theme => theme.id === readTheme());
    if (selected) applyTheme(selected);
    render();
})();
