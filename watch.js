"use strict";

function watchSession() {
    try {
        return JSON.parse(
            localStorage.getItem("wamsTubeSession") || "null"
        );
    } catch {
        return null;
    }
}

async function watchApi(path, options = {}) {
    const url =
        (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");

    const key =
        window.WAMS_SUPABASE_ANON_KEY || "";

    if (!url || !key) {
        throw new Error("Supabase is not configured.");
    }

    const session = watchSession();

    const response = await fetch(`${url}${path}`, {
        ...options,
        headers: {
            apikey: key,

            ...(session?.access_token
                ? {
                      Authorization:
                          `Bearer ${session.access_token}`
                  }
                : {}),

            ...(options.headers || {})
        }
    });

    if (!response.ok) {
        const text = await response.text();

        let message = text;

        try {
            const data = JSON.parse(text);
            message =
                data.message ||
                data.msg ||
                data.hint ||
                text;
        } catch {
            // Keep the original response.
        }

        throw new Error(
            message ||
                `Supabase request failed (${response.status}).`
        );
    }

    if (response.status === 204) {
        return null;
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
}

let activeWatchVideo = null;

async function setupLegacyPlusPlayerTools(player, mediaUrl, videoTitle, storagePath, videoId) {
    const tools = document.getElementById("plusPlayerTools");
    const speedSelect = document.getElementById("plusPlaybackSpeed");
    const pipButton = document.getElementById("plusPictureInPicture");
    const theaterButton = document.getElementById("plusTheaterMode");
    const loopButton = document.getElementById("plusLoopVideo");
    const downloadButton = document.getElementById("plusDownloadVideo");
    const shareButton = document.getElementById("plusShareVideo");
    const status = document.getElementById("plusPlayerStatus");
    const session = watchSession();
    if (!tools || !session?.user?.id) return;

    try {
        const profiles = await watchApi(
            `/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=plus_expires_at`
        );
        const expiry = profiles[0]?.plus_expires_at
            ? new Date(profiles[0].plus_expires_at)
            : null;
        if (!expiry || expiry <= new Date()) return;

        tools.hidden = false;

        if (theaterButton) {
            const watchPage = document.querySelector(".watch-page");
            theaterButton.addEventListener("click", () => {
                const enabled = theaterButton.getAttribute("aria-pressed") !== "true";
                theaterButton.setAttribute("aria-pressed", String(enabled));
                theaterButton.textContent = enabled ? "Exit theater mode" : "Theater mode";
                watchPage?.classList.toggle("plus-theater-mode", enabled);
            });
        }

        if (loopButton) {
            loopButton.addEventListener("click", () => {
                player.loop = !player.loop;
                loopButton.setAttribute("aria-pressed", String(player.loop));
                loopButton.textContent = player.loop ? "Loop on" : "Loop off";
            });
        }

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
                if (navigator.share) {
                    await navigator.share(shareData);
                    if (status) status.textContent = "Video shared.";
                } else if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(shareData.url);
                    if (status) status.textContent = "Video link copied.";
                } else if (status) {
                    status.textContent = "Copy the video link from your browser’s address bar to share it.";
                }
            } catch (error) {
                if (error.name !== "AbortError" && status) status.textContent = error.message || "Could not share this video.";
            }
        });
    } catch (error) {
        console.warn("Could not check Plus player access.", error);
    }
}

async function watchExactCount(table, column, value) {
    const url =
        (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");

    const key =
        window.WAMS_SUPABASE_ANON_KEY || "";

    const session = watchSession();

    const query = new URLSearchParams({
        select: column,
        [column]: `eq.${value}`
    });

    const response = await fetch(
        `${url}/rest/v1/${table}?${query.toString()}`,
        {
            headers: {
                apikey: key,

                ...(session?.access_token
                    ? {
                          Authorization:
                              `Bearer ${session.access_token}`
                      }
                    : {}),

                Prefer: "count=exact",
                Range: "0-0"
            }
        }
    );

    if (!response.ok) {
        throw new Error(
            await response.text() ||
                `Could not count ${table}.`
        );
    }

    const range =
        response.headers.get("Content-Range") || "";

    const total = range.split("/")[1];

    return total && total !== "*"
        ? Number(total)
        : 0;
}

function setSignInHint() {
    const hint =
        document.getElementById("watchCommentAuthHint");

    if (!hint) return;

    hint.replaceChildren(
        document.createTextNode(
            "Sign in to join the conversation. "
        )
    );

    const link = document.createElement("a");
    link.href = "login.html";
    link.textContent = "Sign in";

    hint.appendChild(link);
}

function openReportPage(videoId) {
    const reportUrl = new URL(
        "report.html",
        window.location.href
    );

    reportUrl.searchParams.set("videoId", videoId);

    window.location.href = reportUrl.toString();
}

async function loadWatchComments() {
    if (!activeWatchVideo) return;

    const list =
        document.getElementById("watchCommentList");

    const count =
        document.getElementById("watchCommentCount");

    const [comments, total] = await Promise.all([
        watchApi(
            `/rest/v1/video_comments?video_id=eq.${encodeURIComponent(
                activeWatchVideo.id
            )}&select=id,user_id,body,created_at&order=created_at.desc&limit=100`
        ),

        watchExactCount(
            "video_comments",
            "video_id",
            activeWatchVideo.id
        )
    ]);

    if (count) {
        count.textContent = total.toLocaleString();
    }

    if (!list) return;

    list.replaceChildren();

    if (!comments.length) {
        const empty = document.createElement("p");
        empty.className = "watch-channel";
        empty.textContent = "Be the first to comment.";
        list.appendChild(empty);
        return;
    }

    const userIds = [
        ...new Set(comments.map(comment => comment.user_id))
    ];

    const profileFilter =
        `(${userIds.join(",")})`;

    const [profiles, commentLikes] = await Promise.all([
        watchApi(
            `/rest/v1/profiles?select=id,channel_name&id=in.${encodeURIComponent(
                profileFilter
            )}`
        ),
        watchApi(
            `/rest/v1/video_comment_likes?select=comment_id,user_id&comment_id=in.${encodeURIComponent(
                `(${comments.map(comment => comment.id).join(",")})`
            )}`
        )
    ]);

    const names = new Map(
        profiles.map(profile => [
            profile.id,
            profile.channel_name
        ])
    );

    comments.forEach(comment => {
        const row = document.createElement("article");
        row.className = "watch-comment";

        const avatar = document.createElement("div");
        avatar.className = "watch-comment-avatar";
        avatar.setAttribute("aria-hidden", "true");

        const name =
            names.get(comment.user_id) ||
            "WamsTube user";

        avatar.textContent =
            name.trim().charAt(0).toUpperCase() ||
            "W";

        const content = document.createElement("div");
        content.className = "watch-comment-content";

        const meta = document.createElement("div");
        meta.className = "watch-comment-meta";

        const author = document.createElement("strong");
        author.textContent = name;

        const time = document.createElement("time");
        time.dateTime = comment.created_at;
        time.textContent =
            new Date(comment.created_at).toLocaleString();

        meta.append(author, time);

        const body = document.createElement("p");
        body.textContent = comment.body;

        const likesForComment = commentLikes.filter(like => like.comment_id === comment.id);
        let commentLikeTotal = likesForComment.length;
        const viewerId = watchSession()?.user?.id;
        const ownLike = likesForComment.some(like => like.user_id === viewerId);
        const likeButton = document.createElement("button");
        likeButton.type = "button";
        likeButton.className = "watch-comment-like";
        likeButton.setAttribute("aria-pressed", String(ownLike));
        likeButton.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">thumb_up</span>';
        const likeCount = document.createElement("span");
        likeCount.textContent = String(likesForComment.length);
        likeButton.appendChild(likeCount);
        likeButton.disabled = !viewerId;
        likeButton.addEventListener("click", async () => {
            if (!viewerId || likeButton.disabled) return;
            likeButton.disabled = true;
            const wasLiked = likeButton.getAttribute("aria-pressed") === "true";
            try {
                if (wasLiked) {
                    await watchApi(`/rest/v1/video_comment_likes?comment_id=eq.${encodeURIComponent(comment.id)}&user_id=eq.${encodeURIComponent(viewerId)}`, { method: "DELETE" });
                    const index = commentLikes.findIndex(like => like.comment_id === comment.id && like.user_id === viewerId);
                    if (index >= 0) commentLikes.splice(index, 1);
                } else {
                    await watchApi("/rest/v1/video_comment_likes", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ comment_id: comment.id, user_id: viewerId })
                    });
                    commentLikes.push({ comment_id: comment.id, user_id: viewerId });
                }
                commentLikeTotal = Math.max(0, commentLikeTotal + (wasLiked ? -1 : 1));
                likeButton.setAttribute("aria-pressed", String(!wasLiked));
                likeCount.textContent = String(commentLikeTotal);
            } catch (error) {
                console.warn("Could not update comment like.", error);
            } finally {
                likeButton.disabled = !viewerId;
            }
        });

        content.append(meta, body, likeButton);
        row.append(avatar, content);
        row.id = `comment-${comment.id}`;
        list.appendChild(row);
    });
    if (window.location.hash.startsWith("#comment-")) {
        document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView({ block: "center" });
    }
}

function setupReportButton(video) {
    const reportButton =
        document.getElementById("watchReportToggle");

    if (!reportButton) return;

    reportButton.addEventListener("click", () => {
        openReportPage(video.id);
    });
}

async function initializeWatchEngagement(video, channelName) {
    activeWatchVideo = {
        id: video.id,
        ownerId: video.owner_id
    };

    const section =
        document.getElementById("watchEngagement");

    if (section) {
        section.hidden = false;
    }

    const session = watchSession();
    const userId = session?.user?.id;

    const likeButton =
        document.getElementById("watchLikeButton");

    const subscribeButton =
        document.getElementById("watchSubscribeButton");

    const commentInput =
        document.getElementById("watchCommentInput");

    const commentSubmit =
        document.getElementById("watchCommentSubmit");

    const status =
        document.getElementById("watchEngagementStatus");

    const channelLabel =
        document.getElementById("watchChannelName");

    const channelAvatar =
        document.getElementById("watchChannelAvatar");

    setupReportButton(video);

    if (channelLabel) {
        channelLabel.textContent =
            channelName || "WamsTube channel";
    }

    if (channelAvatar) {
        channelAvatar.textContent =
            (channelName || "W")
                .trim()
                .charAt(0)
                .toUpperCase() || "W";
    }

    const counts = await Promise.all([
        watchExactCount(
            "video_likes",
            "video_id",
            video.id
        ),

        watchExactCount(
            "channel_follows",
            "channel_id",
            video.owner_id
        )
    ]);

    const likeCount =
        document.getElementById("watchLikeCount");

    const subscriberCount =
        document.getElementById("watchSubscriberCount");

    if (likeCount) {
        likeCount.textContent =
            counts[0].toLocaleString();
    }

    if (subscriberCount) {
        subscriberCount.textContent =
            `${counts[1].toLocaleString()} ${
                counts[1] === 1
                    ? "subscriber"
                    : "subscribers"
            }`;
    }

    const creatorProfiles = await watchApi(
        `/rest/v1/profiles?id=eq.${encodeURIComponent(video.owner_id)}&select=channel_name,admin_verified,monetization_enabled`
    );
    const creatorProfile = creatorProfiles[0] || {};
    const creatorVerified = Boolean(creatorProfile.admin_verified) || counts[1] > 100;
    const donateButton = document.getElementById("watchDonateButton");
    const donateDialog = document.getElementById("watchDonateDialog");
    const donateForm = document.getElementById("watchDonateForm");
    const donateAmount = document.getElementById("watchDonateAmount");
    const donateStatus = document.getElementById("watchDonateStatus");
    const donateConfirm = document.getElementById("watchDonateConfirm");
    const donateCancel = document.getElementById("watchDonateCancel");
    const donationAllowed = creatorVerified && creatorProfile.monetization_enabled && userId !== video.owner_id;
    if (donateButton) donateButton.hidden = !donationAllowed;
    const donateChannel = document.getElementById("watchDonateChannel");
    if (donateChannel) donateChannel.textContent = `Support ${creatorProfile.channel_name || channelName || "this creator"}. Donations also give the creator 30 days of WamsTube Plus.`;
    donateButton?.addEventListener("click", () => {
        if (!userId) {
            window.location.href = "login.html";
            return;
        }
        donateStatus.textContent = "";
        if (!donateDialog.open) donateDialog.showModal();
    });
    donateCancel?.addEventListener("click", () => donateDialog?.close());
    donateDialog?.addEventListener("click", event => {
        if (event.target === donateDialog) donateDialog.close();
    });
    donateForm?.addEventListener("submit", async event => {
        event.preventDefault();
        const amount = Number(donateAmount?.value);
        if (!Number.isInteger(amount) || amount < 1 || amount > 1000) {
            donateStatus.textContent = "Enter an amount from 1 to 1000 Wams Bucks.";
            return;
        }
        donateConfirm.disabled = true;
        donateStatus.textContent = "Sending your donation…";
        try {
            const result = await watchApi("/rest/v1/rpc/donate_wams_bucks_to_video", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ target_video: video.id, bucks: amount })
            });
            const receipt = Array.isArray(result) ? result[0] : result;
            const wallet = document.getElementById("watchWalletBalance");
            if (wallet) wallet.textContent = `${Number(receipt?.balance || 0).toLocaleString()} Wams Bucks`;
            donateStatus.textContent = `Donation sent! The creator received ${amount} Wams Bucks and 30 days of WamsTube Plus.`;
            donateDialog.close();
            if (status) status.textContent = `You donated ${amount} Wams Bucks to ${creatorProfile.channel_name || "this creator"}.`;
        } catch (error) {
            donateStatus.textContent = error.message || "Could not send the donation.";
        } finally {
            donateConfirm.disabled = false;
        }
    });

    const dailyClaim = document.getElementById("watchDailyClaim");
    const walletBalance = document.getElementById("watchWalletBalance");
    if (dailyClaim) {
        dailyClaim.disabled = false;
        if (!userId) {
            dailyClaim.textContent = "Sign in to claim";
            dailyClaim.addEventListener("click", () => {
                window.location.href = "login.html";
            });
        }
        if (userId) {
            try {
                const wallets = await watchApi(
                    `/rest/v1/wams_wallets?user_id=eq.${encodeURIComponent(userId)}&select=balance`
                );
                if (walletBalance) walletBalance.textContent = `${Number(wallets[0]?.balance || 0).toLocaleString()} Wams Bucks`;
            } catch (error) {
                if (walletBalance) walletBalance.textContent = "Wallet unavailable";
            }
            dailyClaim.addEventListener("click", async () => {
                dailyClaim.disabled = true;
                try {
                    const result = await watchApi("/rest/v1/rpc/claim_daily_wams_bucks", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: "{}"
                    });
                    const claim = Array.isArray(result) ? result[0] : result;
                    if (walletBalance) walletBalance.textContent = `${Number(claim?.balance || 0).toLocaleString()} Wams Bucks`;
                    if (status) status.textContent = claim?.claimed ? "10 Wams Bucks added to your wallet!" : "You have already claimed today's 10 Wams Bucks.";
                    dailyClaim.textContent = claim?.claimed ? "Claimed today" : "Already claimed today";
                } catch (error) {
                    if (status) status.textContent = error.message || "Could not claim today's reward.";
                    dailyClaim.disabled = false;
                }
            });
        }
    }

    if (userId) {
        const [
            likes,
            follows,
            profiles
        ] = await Promise.all([
            watchApi(
                `/rest/v1/video_likes?video_id=eq.${encodeURIComponent(
                    video.id
                )}&user_id=eq.${encodeURIComponent(
                    userId
                )}&select=video_id`
            ),

            watchApi(
                `/rest/v1/channel_follows?channel_id=eq.${encodeURIComponent(
                    video.owner_id
                )}&follower_id=eq.${encodeURIComponent(
                    userId
                )}&select=channel_id`
            ),

            watchApi(
                `/rest/v1/profiles?id=eq.${encodeURIComponent(
                    userId
                )}&select=channel_name`
            )
        ]);

        const liked = likes.length > 0;
        const subscribed = follows.length > 0;

        likeButton?.setAttribute(
            "aria-pressed",
            String(liked)
        );

        subscribeButton?.classList.toggle(
            "is-subscribed",
            subscribed
        );

        if (subscribeButton) {
            subscribeButton.textContent =
                userId === video.owner_id
                    ? "Your channel"
                    : subscribed
                    ? "Subscribed"
                    : "Subscribe";
        }

        if (
            userId === video.owner_id &&
            subscribeButton
        ) {
            subscribeButton.disabled = true;
        }

        const commentHint =
            document.getElementById(
                "watchCommentAuthHint"
            );

        if (commentHint) {
            commentHint.textContent =
                "Share your thoughts…";
        }

        const viewerName =
            profiles[0]?.channel_name || "W";

        const avatar =
            document.getElementById(
                "watchCommentAvatar"
            );

        if (avatar) {
            avatar.textContent =
                viewerName
                    .trim()
                    .charAt(0)
                    .toUpperCase() || "W";
        }

        likeButton?.addEventListener(
            "click",
            async () => {
                likeButton.disabled = true;

                try {
                    if (
                        likeButton.getAttribute(
                            "aria-pressed"
                        ) === "true"
                    ) {
                        await watchApi(
                            `/rest/v1/video_likes?video_id=eq.${encodeURIComponent(
                                video.id
                            )}&user_id=eq.${encodeURIComponent(
                                userId
                            )}`,
                            {
                                method: "DELETE"
                            }
                        );

                        likeButton.setAttribute(
                            "aria-pressed",
                            "false"
                        );

                        counts[0] =
                            Math.max(0, counts[0] - 1);
                    } else {
                        await watchApi(
                            "/rest/v1/video_likes",
                            {
                                method: "POST",
                                headers: {
                                    "Content-Type":
                                        "application/json"
                                },
                                body: JSON.stringify({
                                    video_id: video.id,
                                    user_id: userId
                                })
                            }
                        );

                        likeButton.setAttribute(
                            "aria-pressed",
                            "true"
                        );

                        counts[0] += 1;
                    }

                    if (likeCount) {
                        likeCount.textContent =
                            counts[0].toLocaleString();
                    }
                } catch (error) {
                    if (status) {
                        status.textContent =
                            error.message;
                    }
                } finally {
                    likeButton.disabled = false;
                }
            }
        );

        subscribeButton?.addEventListener(
            "click",
            async () => {
                subscribeButton.disabled = true;

                try {
                    if (
                        subscribeButton.classList.contains(
                            "is-subscribed"
                        )
                    ) {
                        await watchApi(
                            `/rest/v1/channel_follows?channel_id=eq.${encodeURIComponent(
                                video.owner_id
                            )}&follower_id=eq.${encodeURIComponent(
                                userId
                            )}`,
                            {
                                method: "DELETE"
                            }
                        );

                        subscribeButton.classList.remove(
                            "is-subscribed"
                        );

                        subscribeButton.textContent =
                            "Subscribe";

                        counts[1] =
                            Math.max(0, counts[1] - 1);
                    } else {
                        await watchApi(
                            "/rest/v1/channel_follows",
                            {
                                method: "POST",
                                headers: {
                                    "Content-Type":
                                        "application/json"
                                },
                                body: JSON.stringify({
                                    channel_id:
                                        video.owner_id,
                                    follower_id: userId
                                })
                            }
                        );

                        subscribeButton.classList.add(
                            "is-subscribed"
                        );

                        subscribeButton.textContent =
                            "Subscribed";

                        counts[1] += 1;
                    }

                    if (subscriberCount) {
                        subscriberCount.textContent =
                            `${counts[1].toLocaleString()} ${
                                counts[1] === 1
                                    ? "subscriber"
                                    : "subscribers"
                            }`;
                    }
                } catch (error) {
                    if (status) {
                        status.textContent =
                            error.message;
                    }
                } finally {
                    subscribeButton.disabled = false;
                }
            }
        );
    } else {
        if (likeButton) {
            likeButton.disabled = true;
        }

        if (subscribeButton) {
            subscribeButton.disabled = true;
        }

        if (commentInput) {
            commentInput.disabled = true;
        }

        if (commentSubmit) {
            commentSubmit.disabled = true;
        }

        if (status) {
            status.textContent =
                "Sign in to like this video or subscribe to the channel.";
        }

        setSignInHint();
    }

    await loadWatchComments();
}

async function getSignedMediaUrl(path) {
    const url =
        (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");

    const encoded = path
        .split("/")
        .map(encodeURIComponent)
        .join("/");

    const result = await watchApi(
        `/storage/v1/object/sign/wams-media/${encoded}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                expiresIn: 3600
            })
        }
    );

    const signed =
        result.signedURL ||
        result.signedUrl;

    if (!signed) {
        throw new Error(
            "Supabase did not return a media URL."
        );
    }

    if (signed.startsWith("http")) {
        return signed;
    }

    const relativeUrl =
        signed.startsWith("/")
            ? signed
            : `/${signed}`;

    return (
        `${url}` +
        `${
            relativeUrl.startsWith("/storage/v1/")
                ? ""
                : "/storage/v1"
        }` +
        relativeUrl
    );
}

function formatWatchDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "";
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainder = total % 60;
    return hours
        ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
        : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

async function loadRelatedVideos(currentVideoId) {
    const list = document.getElementById("watchRecommendationList");
    if (!list) return;
    try {
        let videos = await watchApi(
            `/rest/v1/videos?select=id,owner_id,title,storage_path,media_type,trim_start_seconds,trim_end_seconds,created_at,is_short&visibility=eq.public&is_deleted=eq.false&is_short=eq.false&id=neq.${encodeURIComponent(currentVideoId)}&order=created_at.desc&limit=100`
        );
        if (!videos.length) {
            list.textContent = "No other videos to recommend yet.";
            return;
        }
        const ownerIds = [...new Set(videos.map(video => video.owner_id))];
        const profiles = await watchApi(
            `/rest/v1/profiles?select=id,channel_name&id=in.${encodeURIComponent(`(${ownerIds.join(",")})`)}`
        );
        const channelNames = new Map(profiles.map(profile => [profile.id, profile.channel_name]));
        const viewer = watchSession();
        if (viewer?.access_token && viewer.user?.id) {
            try {
                const [viewerProfiles, follows] = await Promise.all([
                    watchApi(`/rest/v1/profiles?id=eq.${encodeURIComponent(viewer.user.id)}&select=plus_plan,plus_expires_at`),
                    watchApi(`/rest/v1/channel_follows?follower_id=eq.${encodeURIComponent(viewer.user.id)}&select=channel_id`)
                ]);
                const plus = viewerProfiles?.[0];
                const activePlus = plus?.plus_plan === "lifetime" || Boolean(plus?.plus_expires_at && new Date(plus.plus_expires_at) > new Date());
                if (activePlus && ["day", "week", "month", "year", "lifetime"].includes(plus.plus_plan)) {
                    let preferences = {};
                    try { preferences = JSON.parse(localStorage.getItem("wamsTubePreferences") || "{}"); } catch {}
                    const history = JSON.parse(localStorage.getItem("wamsTubeWatchHistory") || "[]");
                    const watchedIds = new Set((Array.isArray(history) ? history : []).map(entry => entry.id));
                    const followedIds = new Set(follows.map(row => row.channel_id));
                    if (preferences["6-8"] === true) videos = videos.filter(video => !watchedIds.has(video.id));
                    if (preferences["6-9"] === true) videos.sort((a, b) => Number(followedIds.has(b.owner_id)) - Number(followedIds.has(a.owner_id)));
                }
            } catch (error) {
                console.warn("Could not personalize Plus recommendations.", error);
            }
        }
        videos = videos.slice(0, 12);
        const cards = await Promise.all(videos.map(async video => {
            try {
                const mediaUrl = await getSignedMediaUrl(video.storage_path);
                const link = document.createElement("a");
                link.className = "watch-recommendation";
                link.href = `watch.html?videoId=${encodeURIComponent(video.id)}`;
                link.setAttribute("aria-label", `Watch ${video.title}`);

                const thumbnail = document.createElement("div");
                thumbnail.className = "watch-recommendation-thumbnail";
                const media = document.createElement((video.media_type || "").startsWith("image/") ? "img" : "video");
                media.className = "watch-recommendation-media";
                if (media instanceof HTMLImageElement) {
                    media.src = mediaUrl;
                    media.alt = "";
                } else {
                    media.src = mediaUrl;
                    media.muted = true;
                    media.preload = "metadata";
                    media.addEventListener("loadedmetadata", () => {
                        if (Number.isFinite(media.duration) && media.duration > 0) media.currentTime = Math.min(0.1, media.duration);
                    }, { once: true });
                }
                const placeholder = document.createElement("span");
                placeholder.className = "watch-recommendation-placeholder material-symbols-rounded";
                placeholder.textContent = "play_circle";
                const duration = document.createElement("span");
                duration.className = "watch-recommendation-duration";
                duration.textContent = media instanceof HTMLVideoElement ? "…" : "Image";
                if (media instanceof HTMLVideoElement) {
                    media.addEventListener("loadedmetadata", () => {
                        const start = Math.max(0, Number(video.trim_start_seconds) || 0);
                        const end = video.trim_end_seconds == null
                            ? media.duration
                            : Math.min(media.duration, Number(video.trim_end_seconds));
                        duration.textContent = formatWatchDuration(Math.max(0, end - start));
                    }, { once: true });
                    media.addEventListener("error", () => duration.textContent = "Video", { once: true });
                    media.addEventListener("loadeddata", () => placeholder.hidden = true, { once: true });
                }
                thumbnail.append(media, placeholder, duration);

                const copy = document.createElement("span");
                copy.className = "watch-recommendation-copy";
                const title = document.createElement("strong");
                title.textContent = video.title;
                const channel = document.createElement("span");
                channel.textContent = channelNames.get(video.owner_id) || "WamsTube channel";
                const date = document.createElement("span");
                date.textContent = new Date(video.created_at).toLocaleDateString();
                copy.append(title, channel, date);
                link.append(thumbnail, copy);
                return link;
            } catch (error) {
                console.warn("Could not load a related video.", error);
                return null;
            }
        }));
        list.replaceChildren(...cards.filter(Boolean));
        if (!list.children.length) list.textContent = "No related videos are available right now.";
    } catch (error) {
        list.textContent = "Related videos could not be loaded.";
        console.warn("Could not load related videos.", error);
    }
}

async function recordLocalWatchHistory(video, channelName) {
    try {
        const key = "wamsTubeWatchHistory";
        const saved = JSON.parse(localStorage.getItem(key) || "[]");
        const history = Array.isArray(saved) ? saved : [];
        const entry = { id: video.id, title: video.title, channel: channelName, watchedAt: new Date().toISOString() };
        let limit = 100;
        const session = watchSession();
        if (session?.access_token && session.user?.id) {
            try {
                const profiles = await watchApi(`/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=plus_plan,plus_expires_at`);
                const profile = profiles?.[0];
                const active = profile?.plus_plan === "lifetime" || Boolean(profile?.plus_expires_at && new Date(profile.plus_expires_at) > new Date());
                if (active && ["day", "week", "month", "year", "lifetime"].includes(profile.plus_plan)) limit = 1000;
            } catch (error) {
                console.warn("Could not check Plus history capacity; keeping the standard history limit.", error);
            }
        }
        localStorage.setItem(key, JSON.stringify([entry, ...history.filter(item => item.id !== video.id)].slice(0, limit)));
    } catch (error) {
        console.warn("Could not save local watch history.", error);
    }
}

function getWatchVideoData() {
    const params =
        new URLSearchParams(window.location.search);

    return {
        id:
            params.get("videoId") ||
            params.get("id") ||
            "",

        title:
            params.get("title") ||
            "Video",

        channel:
            params.get("channel") ||
            "Unknown channel",

        stats:
            params.get("stats") ||
            ""
    };
}

function showWatchError(message) {
    const container =
        document.querySelector(
            ".watch-video-container"
        );

    if (container) {
        container.replaceChildren();

        const error =
            document.createElement("div");

        error.className = "watch-loading";
        error.textContent = message;

        container.appendChild(error);
    }

    const title =
        document.getElementById("watchTitle");

    const channel =
        document.getElementById("watchChannel");

    if (title) {
        title.textContent = "Video unavailable";
    }

    if (channel) {
        channel.textContent = message;
    }
}

async function loadWatchVideo() {
    const video = getWatchVideoData();

    const container =
        document.querySelector(
            ".watch-video-container"
        );

    const title =
        document.getElementById("watchTitle");

    const channel =
        document.getElementById("watchChannel");

    if (!container) return;

    const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (uuidPattern.test(video.id)) {
        try {
            const items = await watchApi(
                `/rest/v1/videos?id=eq.${encodeURIComponent(
                    video.id
                )}&select=id,owner_id,title,description,visibility,storage_path,media_type,caption_path,trim_start_seconds,trim_end_seconds,created_at,is_deleted,takedown_reason,takedown_by`
            );

            if (!items.length) {
                throw new Error(
                    "This Supabase video is unavailable or private."
                );
            }

            const item = items[0];

            const profiles = await watchApi(
                `/rest/v1/profiles?id=eq.${encodeURIComponent(
                    item.owner_id
                )}&select=channel_name`
            );

            const channelName =
                profiles[0]?.channel_name ||
                "WamsTube channel";

            if (item.is_deleted) {
                const notice =
                    document.getElementById(
                        "takedownNotice"
                    );

                const reason =
                    document.getElementById(
                        "takedownReason"
                    );

                const moderator =
                    document.getElementById(
                        "takedownModerator"
                    );

                const message =
                    document.createElement("div");

                message.className =
                    "watch-loading";

                message.textContent =
                    "This video has been taken down.";

                container.replaceChildren(message);

                if (title) {
                    title.textContent = item.title;
                }

                if (channel) {
                    channel.textContent = channelName;
                }

                if (reason) {
                    reason.textContent =
                        item.takedown_reason ||
                        "No reason was recorded.";
                }

                if (moderator) {
                    if (item.takedown_by) {
                        const admins =
                            await watchApi(
                                `/rest/v1/profiles?id=eq.${encodeURIComponent(
                                    item.takedown_by
                                )}&select=channel_name`
                            );

                        moderator.textContent =
                            admins[0]?.channel_name ||
                            "Admin";
                    } else {
                        moderator.textContent =
                            "Not recorded";
                    }
                }

                if (notice) {
                    notice.hidden = false;
                }

                document.title =
                    `${item.title} - Taken down`;

                return;
            }

            const mediaUrl =
                await getSignedMediaUrl(
                    item.storage_path
                );

            let player;

            if (
                (item.media_type || "")
                    .startsWith("image/")
            ) {
                player =
                    document.createElement("img");

                player.alt = item.title;
                const durationBadge = document.getElementById("watchDuration");
                if (durationBadge) durationBadge.textContent = "Image";
            } else {
                player =
                    document.createElement("video");

                player.controls = true;
                player.playsInline = true;
            }

            if (player instanceof HTMLVideoElement) {
                const trimStart = Math.max(0, Number(item.trim_start_seconds) || 0);
                const durationBadge = document.getElementById("watchDuration");
                player.addEventListener("loadedmetadata", () => {
                    if (!durationBadge || !Number.isFinite(player.duration)) return;
                    const effectiveEnd = item.trim_end_seconds == null
                        ? player.duration
                        : Math.min(player.duration, Number(item.trim_end_seconds));
                    const visibleDuration = Math.max(0, effectiveEnd - trimStart);
                    durationBadge.textContent = `Duration ${formatWatchDuration(visibleDuration)}`;
                }, { once: true });
                const trimEnd = item.trim_end_seconds == null ? null : Number(item.trim_end_seconds);
                let trimReached = false;
                player.addEventListener("loadedmetadata", () => {
                    if (trimStart > 0 && trimStart < player.duration) player.currentTime = trimStart;
                }, { once: true });
                player.addEventListener("seeking", () => {
                    if (trimEnd !== null && player.currentTime < trimEnd - 0.1) trimReached = false;
                });
                player.addEventListener("play", () => {
                    if (trimReached || (trimEnd !== null && player.currentTime >= trimEnd)) {
                        trimReached = false;
                        player.currentTime = trimStart;
                    }
                });
                player.addEventListener("timeupdate", () => {
                    if (trimReached || trimEnd === null || !Number.isFinite(trimEnd) || player.currentTime < trimEnd) return;
                    if (player.loop) {
                        player.currentTime = trimStart;
                        player.play().catch(() => {});
                    } else {
                        trimReached = true;
                        player.pause();
                        player.currentTime = trimEnd;
                    }
                });
                if (item.caption_path) {
                    try {
                        const captionUrl = await getSignedMediaUrl(item.caption_path);
                        const track = document.createElement("track");
                        track.kind = "subtitles";
                        track.label = "Captions";
                        track.srclang = "en";
                        track.default = true;
                        track.src = captionUrl;
                        player.appendChild(track);
                    } catch (error) {
                        console.warn("Could not load video captions.", error);
                    }
                }
                window.WamsPlusFeatures?.setup(player, mediaUrl, item.title, item.storage_path, item.id);
            }
            player.src = mediaUrl;
            container.replaceChildren(player);

            if (title) {
                title.textContent = item.title;
            }

            if (channel) {
                channel.textContent = channelName;
            }
            const description = document.getElementById("watchDescription");
            if (description) {
                description.textContent = item.description || "";
                description.hidden = !item.description;
            }

            document.title =
                `${item.title} - WamsTube`;
            await recordLocalWatchHistory(item, channelName);
            loadRelatedVideos(item.id);

            const viewerSession = watchSession();
            if (viewerSession?.access_token && viewerSession?.user?.id) {
                try {
                    await watchApi("/rest/v1/rpc/record_video_view", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ video: item.id })
                    });
                } catch (error) {
                    console.warn("Could not record this video view.", error);
                }
            }

            try {
                await initializeWatchEngagement(
                    item,
                    channelName
                );
            } catch (error) {
                const status =
                    document.getElementById(
                        "watchEngagementStatus"
                    );

                const section =
                    document.getElementById(
                        "watchEngagement"
                    );

                if (section) {
                    section.hidden = false;
                }

                if (status) {
                    status.textContent =
                        error.message ||
                        "Video actions could not be loaded.";
                }
            }

            return;
        } catch (error) {
            showWatchError(
                error.message ||
                    "This video could not be loaded from Supabase."
            );

            return;
        }
    }

    if (!video.id) {
        showWatchError("No video ID was provided.");
        return;
    }

    const player =
        document.createElement("iframe");

    player.title = video.title;

    player.src =
        "https://www.youtube.com/embed/" +
        encodeURIComponent(video.id) +
        "?autoplay=1&rel=0&playsinline=1";

    player.referrerPolicy =
        "strict-origin-when-cross-origin";

    player.allow =
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";

    player.allowFullscreen = true;

    container.replaceChildren(player);

    if (title) {
        title.textContent = video.title;
    }

    if (channel) {
        channel.textContent =
            video.channel +
            (video.stats
                ? " • " + video.stats
                : "");
    }

    document.title =
        video.title + " - WamsTube";
}

function returnToHome() {
    window.location.href = "index.html";
}

document.addEventListener("DOMContentLoaded", () => {
    const backButton =
        document.getElementById("watchBackButton") ||
        document.querySelector(".watch-back");

    backButton?.addEventListener(
        "click",
        returnToHome
    );

    const commentForm =
        document.getElementById(
            "watchCommentForm"
        );

    commentForm?.addEventListener(
        "submit",
        async event => {
            event.preventDefault();

            const session = watchSession();

            const input =
                document.getElementById(
                    "watchCommentInput"
                );

            const submit =
                document.getElementById(
                    "watchCommentSubmit"
                );

            const status =
                document.getElementById(
                    "watchEngagementStatus"
                );

            const body =
                input?.value.trim();

            if (
                !session?.access_token ||
                !session?.user?.id ||
                !activeWatchVideo ||
                !body
            ) {
                return;
            }

            if (submit) {
                submit.disabled = true;
            }

            if (status) {
                status.textContent =
                    "Posting comment…";
            }

            try {
                await watchApi(
                    "/rest/v1/video_comments",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/json"
                        },
                        body: JSON.stringify({
                            video_id:
                                activeWatchVideo.id,
                            user_id:
                                session.user.id,
                            body
                        })
                    }
                );

                if (input) {
                    input.value = "";
                }

                if (status) {
                    status.textContent = "";
                }

                await loadWatchComments();
            } catch (error) {
                if (status) {
                    status.textContent =
                        error.message ||
                        "Could not post your comment.";
                }
            } finally {
                if (submit) {
                    submit.disabled = false;
                }
            }
        }
    );

    loadWatchVideo();
});
