"use strict";

window.WamsPlusFeatures = (() => {
    async function setup(player, mediaUrl, videoTitle, storagePath, videoId) {
        const tools = document.getElementById("plusPlayerTools");
        const speedSelect = document.getElementById("plusPlaybackSpeed");
        const pipButton = document.getElementById("plusPictureInPicture");
        const theaterButton = document.getElementById("plusTheaterMode");
        const loopButton = document.getElementById("plusLoopVideo");
        const downloadButton = document.getElementById("plusDownloadVideo");
        const shareButton = document.getElementById("plusShareVideo");
        const status = document.getElementById("plusPlayerStatus");
        let session = null;

        try {
            session = JSON.parse(localStorage.getItem("wamsTubeSession") || "null");
        } catch {
            return;
        }

        if (!tools || !session?.user?.id || typeof window.watchApi !== "function") return;

        try {
            const profiles = await window.watchApi(
                `/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=plus_expires_at,plus_plan`
            );
            const profile = profiles[0];
            const expiry = profile?.plus_expires_at ? new Date(profile.plus_expires_at) : null;
            if (profile?.plus_plan !== "lifetime" && (!expiry || expiry <= new Date())) return;

            tools.hidden = false;

            theaterButton?.addEventListener("click", () => {
                const enabled = theaterButton.getAttribute("aria-pressed") !== "true";
                theaterButton.setAttribute("aria-pressed", String(enabled));
                theaterButton.textContent = enabled ? "Exit theater mode" : "Theater mode";
                document.querySelector(".watch-page")?.classList.toggle("plus-theater-mode", enabled);
            });

            loopButton?.addEventListener("click", () => {
                player.loop = !player.loop;
                loopButton.setAttribute("aria-pressed", String(player.loop));
                loopButton.textContent = player.loop ? "Loop on" : "Loop off";
            });

            const progressKey = `wamsPlusProgress:${videoId}`;
            let restoredProgress = false;
            player.addEventListener("loadedmetadata", () => {
                if (restoredProgress || !Number.isFinite(player.duration)) return;
                restoredProgress = true;
                const savedTime = Number(localStorage.getItem(progressKey));
                if (savedTime > 5 && savedTime < player.duration - 5) {
                    player.currentTime = savedTime;
                    if (status) status.textContent = "Resumed from where you left off.";
                }
            });
            player.addEventListener("timeupdate", () => {
                if (Number.isFinite(player.currentTime) && player.currentTime > 0) {
                    localStorage.setItem(progressKey, String(Math.floor(player.currentTime)));
                }
            });
            player.addEventListener("ended", () => localStorage.removeItem(progressKey));

            if (speedSelect) {
                const savedSpeed = localStorage.getItem("wamsPlusPlaybackSpeed") || "1";
                const supportedSpeed = [...speedSelect.options].some(option => option.value === savedSpeed);
                speedSelect.value = supportedSpeed ? savedSpeed : "1";
                player.playbackRate = Number(speedSelect.value);
                speedSelect.addEventListener("change", () => {
                    player.playbackRate = Number(speedSelect.value);
                    localStorage.setItem("wamsPlusPlaybackSpeed", speedSelect.value);
                });
            }

            if (!document.pictureInPictureEnabled || !player.requestPictureInPicture) {
                if (pipButton) pipButton.disabled = true;
                if (status) status.textContent = "Picture-in-picture is not supported by this browser for this video.";
            } else {
                pipButton?.addEventListener("click", async () => {
                    try {
                        if (document.pictureInPictureElement) {
                            await document.exitPictureInPicture();
                        } else {
                            await player.requestPictureInPicture();
                        }
                    } catch (error) {
                        if (status) status.textContent = error.message || "Could not open the mini player.";
                    }
                });
            }

            downloadButton?.addEventListener("click", () => {
                const link = document.createElement("a");
                const safeTitle = (videoTitle || "wamstube-video").replace(/[^a-z0-9._-]+/gi, "-");
                const rawExtension = (storagePath?.split(".").pop() || "mp4").toLowerCase();
                const extension = /^[a-z0-9]{1,8}$/.test(rawExtension) ? rawExtension : "mp4";
                link.href = mediaUrl;
                link.download = `${safeTitle}.${extension}`;
                link.target = "_blank";
                link.rel = "noopener";
                link.click();
                if (status) status.textContent = "Your browser opened the video file. Use its download or save option if it does not download automatically.";
            });

            shareButton?.addEventListener("click", async () => {
                const shareData = { title: videoTitle || "WamsTube video", url: window.location.href };
                try {
                    if (typeof navigator.share === "function") {
                        await navigator.share(shareData);
                        if (status) status.textContent = "Video shared.";
                        return;
                    }
                } catch (error) {
                    if (error?.name === "AbortError") return;
                }

                try {
                    if (navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(shareData.url);
                        if (status) status.textContent = "Sharing unavailable; video link copied instead.";
                        return;
                    }
                } catch {
                    // Clipboard permissions can also be denied; provide a manual copy field below.
                }

                if (status) {
                    status.textContent = "Sharing permission was denied. Copy the video link here:";
                    let field = document.getElementById("plusShareFallbackLink");
                    if (!field) {
                        field = document.createElement("input");
                        field.id = "plusShareFallbackLink";
                        field.type = "url";
                        field.readOnly = true;
                        field.setAttribute("aria-label", "Video link to copy");
                        field.className = "plus-share-fallback-link";
                        status.insertAdjacentElement("afterend", field);
                    }
                    field.value = shareData.url;
                    field.hidden = false;
                    field.focus();
                    field.select();
                }
            });
        } catch (error) {
            console.warn("Could not check Plus player access.", error);
        }
    }

    return { setup };
})();
