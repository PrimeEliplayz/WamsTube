"use strict";

const REPORT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reportSession() {
    try {
        return JSON.parse(localStorage.getItem("wamsTubeSession") || "null");
    } catch {
        return null;
    }
}

async function reportApi(path, options = {}) {
    const supabaseUrl = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
    const anonKey = window.WAMS_SUPABASE_ANON_KEY || "";
    if (!supabaseUrl || !anonKey) throw new Error("Supabase is not configured.");

    const session = reportSession();
    const response = await fetch(`${supabaseUrl}${path}`, {
        ...options,
        headers: {
            apikey: anonKey,
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
            ...(options.headers || {})
        }
    });

    if (!response.ok) {
        const text = await response.text();
        let message = text;
        try {
            const data = JSON.parse(text);
            message = data.message || data.msg || data.hint || text;
        } catch {
            // Keep the original response text.
        }
        throw new Error(message || `Supabase request failed (${response.status}).`);
    }

    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
}

function getReportedVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("videoId") || params.get("id") || "";
}

function setReportStatus(text, type = "") {
    const status = document.getElementById("reportStatus");
    if (!status) return;
    status.textContent = text;
    status.className = `report-status ${type}`.trim();
}

function setSignInMessage() {
    setReportStatus("You’ll need to sign in before you can submit a report.", "error");
    const status = document.getElementById("reportStatus");
    if (!status) return;
    const link = document.createElement("a");
    link.href = "login.html";
    link.textContent = "Sign in";
    link.style.marginLeft = "6px";
    status.appendChild(link);
}

function goBackToVideo() {
    const videoId = getReportedVideoId();
    window.location.href = videoId
        ? `watch.html?videoId=${encodeURIComponent(videoId)}`
        : "index.html";
}

async function submitVideoReport(event) {
    event.preventDefault();

    const session = reportSession();
    const videoId = getReportedVideoId();
    if (!session?.access_token || !session?.user?.id) {
        setSignInMessage();
        return;
    }
    if (!REPORT_UUID_PATTERN.test(videoId)) {
        setReportStatus("Open a video and choose Report to submit a report.", "error");
        return;
    }

    const selectedReason = document.querySelector('input[name="reason"]:checked');
    if (!selectedReason) {
        setReportStatus("Choose a reason before submitting.", "error");
        return;
    }

    const details = document.getElementById("reportDetails")?.value.trim() || "";
    const submitButton = document.getElementById("reportSubmitButton");
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Submitting…";
    }
    setReportStatus("Sending your report…");

    try {
        await reportApi("/rest/v1/video_reports", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Prefer: "return=minimal"
            },
            body: JSON.stringify({
                video_id: videoId,
                reporter_id: session.user.id,
                reason: selectedReason.value,
                details: details || null
            })
        });

        setReportStatus("Thanks. Your report was sent to the admins for review.", "success");
        window.setTimeout(goBackToVideo, 1300);
    } catch (error) {
        console.error("Video report submission failed:", error);
        setReportStatus(error.message || "The report could not be submitted.", "error");
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = "Submit report";
        }
    }
}

async function initializeReportPage() {
    const form = document.getElementById("videoReportForm");
    const videoId = getReportedVideoId();

    document.getElementById("reportBackButton")?.addEventListener("click", goBackToVideo);
    document.getElementById("reportCancelButton")?.addEventListener("click", goBackToVideo);
    form?.addEventListener("submit", submitVideoReport);

    if (!form) return;
    if (!REPORT_UUID_PATTERN.test(videoId)) {
        setReportStatus("To report a video, open it first and select the Report button below the video.");
        return;
    }

    form.hidden = false;
    if (!reportSession()?.access_token) {
        setSignInMessage();
    }

    try {
        const params = new URLSearchParams({
            id: `eq.${videoId}`,
            select: "id,title,visibility,is_deleted",
            limit: "1"
        });
        const videos = await reportApi(`/rest/v1/videos?${params}`);
        if (!videos?.length || videos[0].visibility !== "public" || videos[0].is_deleted) {
            form.hidden = true;
            setReportStatus("This video is unavailable for reporting. Only active public videos can be reported.", "error");
            return;
        }

        const context = document.getElementById("reportVideoContext");
        if (context) {
            context.textContent = `Reporting: ${videos[0].title}`;
            context.hidden = false;
        }
    } catch (error) {
        console.warn("Could not verify the video before reporting.", error);
        setReportStatus("We couldn’t verify this video right now. You can still try to submit your report.");
    }
}

document.addEventListener("DOMContentLoaded", initializeReportPage);
