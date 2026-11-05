"use strict";

document.addEventListener("DOMContentLoaded", async () => {
    const status = document.getElementById("myReportsStatus");
    const list = document.getElementById("myReportsList");
    const session = window.currentSession?.();
    if (!session?.access_token || !session.user?.id) {
        status.replaceChildren(document.createTextNode("Sign in to see your reports. "));
        const link = document.createElement("a");
        link.href = "login.html";
        link.textContent = "Sign in";
        status.appendChild(link);
        return;
    }

    try {
        const reports = await window.supabaseRequest(
            `/rest/v1/video_reports?select=id,video_id,reason,details,status,created_at,reviewed_at&reporter_id=eq.${encodeURIComponent(session.user.id)}&order=created_at.desc&limit=100`
        );
        const ids = [...new Set(reports.map(report => report.video_id))];
        const videos = ids.length
            ? await window.supabaseRequest(`/rest/v1/videos?select=id,title&id=in.(${ids.map(encodeURIComponent).join(",")})`)
            : [];
        const titles = new Map(videos.map(video => [video.id, video.title]));
        list.replaceChildren();
        reports.forEach(report => {
            const card = document.createElement("article");
            card.className = "my-report-card";
            const heading = document.createElement("h2");
            heading.textContent = titles.get(report.video_id) || "Video no longer available";
            const statusLabel = document.createElement("span");
            statusLabel.className = `my-report-state is-${report.status}`;
            statusLabel.textContent = report.status === "pending"
                ? "Pending"
                : report.status === "accepted" ? "Resolved" : "Reviewed";
            const reason = document.createElement("p");
            reason.textContent = `Reason: ${report.reason}`;
            const date = document.createElement("time");
            date.dateTime = report.created_at;
            date.textContent = `Submitted ${new Date(report.created_at).toLocaleDateString()}`;
            card.append(heading, statusLabel, reason, date);
            if (report.details) {
                const details = document.createElement("p");
                details.textContent = report.details;
                card.appendChild(details);
            }
            if (report.reviewed_at) {
                const reviewed = document.createElement("p");
                reviewed.className = "my-report-reviewed";
                reviewed.textContent = `Reviewed ${new Date(report.reviewed_at).toLocaleDateString()}.`;
                card.appendChild(reviewed);
            }
            list.appendChild(card);
        });
        status.textContent = reports.length ? `${reports.length} report${reports.length === 1 ? "" : "s"}` : "You haven’t submitted any reports yet.";
    } catch (error) {
        status.textContent = error.message || "Could not load your reports.";
        status.classList.add("error");
    }
});
