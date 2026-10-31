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

    const storageKey = "wamsTubePreferences";
    const container = document.getElementById("settingsCategories");
    const search = document.getElementById("settingsSearch");
    const status = document.getElementById("settingsStatus");
    const count = document.getElementById("settingsCount");
    let preferences = loadPreferences();
    let saveTimer;

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

    function render(filter = "") {
        const query = filter.trim().toLocaleLowerCase();
        container.replaceChildren();
        let shown = 0;

        groups.forEach((group, groupIndex) => {
            const matchingItems = group.items
                .map((label, itemIndex) => ({ label, itemIndex }))
                .filter(item => !query || `${group.title} ${item.label}`.toLocaleLowerCase().includes(query));
            if (!matchingItems.length) return;

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
                const key = `${groupIndex}-${itemIndex}`;
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
                toggle.checked = preferences[key] ?? defaultValue(groupIndex, itemIndex);
                toggle.setAttribute("aria-label", label);
                const switchUI = document.createElement("span");
                switchUI.className = "settings-switch";
                row.append(copy, toggle, switchUI);
                toggle.addEventListener("change", () => {
                    preferences[key] = toggle.checked;
                    savePreferences();
                });
                section.appendChild(row);
                shown++;
            });
            container.appendChild(section);
        });

        count.textContent = `${shown} ${shown === 1 ? "setting" : "settings"}`;
        if (!shown) {
            const empty = document.createElement("p");
            empty.className = "settings-empty";
            empty.textContent = "No settings match your search.";
            container.appendChild(empty);
        }
    }

    function defaultValue(groupIndex, itemIndex) {
        // Most preferences start enabled; privacy-sensitive options start off.
        if (groupIndex === 2) return itemIndex >= 6;
        if (groupIndex === 9) return itemIndex !== 9;
        return true;
    }

    search.addEventListener("input", () => render(search.value));
    document.getElementById("settingsReset").addEventListener("click", () => {
        if (!window.confirm("Reset all 100 preferences to their defaults?")) return;
        preferences = {};
        savePreferences();
        render(search.value);
    });

    render();
})();
