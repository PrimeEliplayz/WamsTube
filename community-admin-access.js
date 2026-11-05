"use strict";

document.addEventListener("DOMContentLoaded", async () => {
    const button = document.getElementById("requestCommunityAdmin");
    const message = document.getElementById("communityAdminRequestMessage");
    const manageLink = document.getElementById("communityAdminManageLink");
    if (!button || !message || !manageLink || !window.supabaseRequest) return;

    const session = window.currentSession?.();
    if (!session?.access_token || !session.user?.id) {
        message.textContent = "Sign in with your school account to request access.";
        button.addEventListener("click", () => { window.location.href = "login.html"; });
        return;
    }

    button.disabled = true;
    try {
        const [profiles, roleRows, requests] = await Promise.all([
            window.supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=is_admin,is_owner,is_banned,is_suspected`),
            window.supabaseRequest(`/rest/v1/community_admins?user_id=eq.${encodeURIComponent(session.user.id)}&enabled=eq.true&select=user_id`),
            window.supabaseRequest(`/rest/v1/community_admin_requests?requester_id=eq.${encodeURIComponent(session.user.id)}&select=status,requested_at&order=requested_at.desc&limit=1`)
        ]);
        const profile = profiles?.[0];
        if (!profile || profile.is_banned || profile.is_suspected) {
            button.hidden = true;
            message.textContent = "This account is not eligible to manage school community content.";
            return;
        }
        if (roleRows?.length || profile.is_admin || profile.is_owner) {
            button.hidden = true;
            manageLink.hidden = false;
            message.textContent = roleRows?.length ? "Community administrator access is active." : "You already have administrator access.";
            return;
        }

        const latest = requests?.[0];
        if (latest?.status === "pending") {
            button.hidden = true;
            message.textContent = `Your request is awaiting owner review (submitted ${new Date(latest.requested_at).toLocaleDateString()}).`;
        } else {
            button.disabled = false;
            button.textContent = latest?.status === "denied" ? "Request access again" : "Request community administrator access";
            button.addEventListener("click", async () => {
                button.disabled = true;
                message.textContent = "Sending your request to the owners…";
                try {
                    await window.supabaseRequest("/rest/v1/community_admin_requests", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
                        body: JSON.stringify({ requester_id: session.user.id, status: "pending" })
                    });
                    button.hidden = true;
                    message.textContent = "Request sent. An owner will review it in the Owner Panel.";
                } catch (error) {
                    button.disabled = false;
                    message.textContent = error.message || "Could not send your request.";
                }
            });
        }
    } catch (error) {
        button.disabled = true;
        message.textContent = `${error.message || "Could not check access."} Apply community-admin.sql to enable requests.`;
    }
});
