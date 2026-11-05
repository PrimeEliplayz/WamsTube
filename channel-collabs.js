"use strict";

(() => {
    const section = document.getElementById("channelCollabSection");
    if (!section) return;

    const ranks = [
        "Commenting", "Supporter", "Community helper", "Moderator", "Contributor",
        "Editor", "Senior editor", "Manager", "Senior manager", "Co-managing"
    ];
    const session = typeof currentSession === "function" ? currentSession() : null;
    const ownerId = new URLSearchParams(window.location.search).get("channel") || session?.user?.id;
    const isOwner = Boolean(session?.user?.id && ownerId === session.user.id);
    const requestArea = document.getElementById("channelCollabRequestArea");
    const manageArea = document.getElementById("channelCollabManageArea");
    const requestButton = document.getElementById("channelCollabRequestButton");
    const requestStatus = document.getElementById("channelCollabRequestStatus");
    const list = document.getElementById("channelCollabList");
    const manageStatus = document.getElementById("channelCollabManageStatus");

    function rankLabel(rank) {
        return `Rank ${rank} · ${ranks[rank - 1]}`;
    }

    function makeRankSelect(rank) {
        const select = document.createElement("select");
        select.className = "channel-collab-rank";
        select.setAttribute("aria-label", "Collaboration rank");
        ranks.forEach((label, index) => {
            const option = new Option(`Rank ${index + 1} · ${label}`, String(index + 1));
            select.add(option);
        });
        select.value = String(rank || 1);
        return select;
    }

    async function getRows() {
        const params = new URLSearchParams({
            select: "id,owner_id,collaborator_id,rank,status,requested_at",
            owner_id: `eq.${ownerId}`,
            order: "requested_at.asc"
        });
        return supabaseRequest(`/rest/v1/channel_collaborations?${params}`);
    }

    async function setRow(id, values) {
        await supabaseRequest(`/rest/v1/channel_collaborations?id=eq.${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify(values)
        });
    }

    async function removeRow(id) {
        await supabaseRequest(`/rest/v1/channel_collaborations?id=eq.${encodeURIComponent(id)}`, {
            method: "DELETE",
            headers: { Prefer: "return=minimal" }
        });
    }

    function makeAction(label, handler, className = "") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `channel-manage-button ${className}`.trim();
        button.textContent = label;
        button.addEventListener("click", () => handler(button));
        return button;
    }

    async function renderManager() {
        list.textContent = "Loading collaborations…";
        try {
            const rows = await getRows();
            const ids = [...new Set(rows.map(row => row.collaborator_id))];
            const profiles = ids.length
                ? await supabaseRequest(`/rest/v1/profiles?select=id,channel_name&id=in.(${ids.map(encodeURIComponent).join(",")})`)
                : [];
            const names = new Map(profiles.map(profile => [profile.id, profile.channel_name || "WamsTube channel"]));
            list.replaceChildren();

            if (!rows.length) {
                const empty = document.createElement("p");
                empty.className = "channel-collab-empty";
                empty.textContent = "No collaboration requests or collaborators yet.";
                list.appendChild(empty);
                return;
            }

            rows.forEach(row => {
                const item = document.createElement("article");
                item.className = "channel-collab-row";
                const details = document.createElement("div");
                details.className = "channel-collab-copy";
                const name = document.createElement("strong");
                name.textContent = names.get(row.collaborator_id) || "WamsTube channel";
                const meta = document.createElement("span");
                meta.textContent = row.status === "accepted"
                    ? `Active · ${rankLabel(row.rank)}`
                    : `${row.status === "pending" ? "Request pending" : "Request declined"} · ${new Date(row.requested_at).toLocaleDateString()}`;
                details.append(name, meta);
                item.appendChild(details);

                const rank = makeRankSelect(row.rank);
                item.appendChild(rank);
                if (row.status === "pending") {
                    item.append(
                        makeAction("Approve", async button => saveRow(button, row.id, { status: "accepted", rank: Number(rank.value), decided_at: new Date().toISOString() })),
                        makeAction("Decline", async button => saveRow(button, row.id, { status: "declined", decided_at: new Date().toISOString() }), "channel-collab-secondary")
                    );
                } else if (row.status === "accepted") {
                    item.appendChild(makeAction("Save rank", async button => saveRow(button, row.id, { rank: Number(rank.value) })));
                    item.appendChild(makeAction("Remove", async button => {
                        if (!window.confirm(`Remove ${names.get(row.collaborator_id) || "this collaborator"} from your channel?`)) return;
                        await runManagerAction(button, async () => { await removeRow(row.id); await renderManager(); });
                    }, "channel-collab-secondary"));
                } else {
                    item.appendChild(makeAction("Clear request", async button => {
                        await runManagerAction(button, async () => { await removeRow(row.id); await renderManager(); });
                    }, "channel-collab-secondary"));
                }
                list.appendChild(item);
            });
        } catch (error) {
            list.textContent = error.message || "Could not load channel collaborations. Apply channel-collaborations.sql in Supabase first.";
        }
    }

    async function runManagerAction(button, action) {
        button.disabled = true;
        manageStatus.textContent = "Saving…";
        try {
            await action();
            manageStatus.textContent = "Collaboration settings saved.";
        } catch (error) {
            manageStatus.textContent = error.message || "Could not save collaboration settings.";
            button.disabled = false;
        }
    }

    async function saveRow(button, id, values) {
        await runManagerAction(button, async () => {
            await setRow(id, values);
            await renderManager();
        });
    }

    async function renderRequester() {
        requestArea.hidden = false;
        if (!session?.user?.id) {
            requestButton.textContent = "Sign in to request a collaboration";
            requestButton.addEventListener("click", () => { window.location.href = "login.html"; }, { once: true });
            return;
        }
        if (isOwner) return;

        try {
            const params = new URLSearchParams({
                select: "id,rank,status",
                owner_id: `eq.${ownerId}`,
                collaborator_id: `eq.${session.user.id}`
            });
            const rows = await supabaseRequest(`/rest/v1/channel_collaborations?${params}`);
            const existing = rows[0];
            if (existing?.status === "accepted") {
                requestButton.textContent = `Collaborating · ${rankLabel(existing.rank)}`;
                requestButton.disabled = true;
            } else if (existing?.status === "pending") {
                requestButton.textContent = "Collaboration request pending";
                requestButton.disabled = true;
            } else {
                requestButton.textContent = existing ? "Request collaboration again" : "Request to collaborate";
                requestButton.disabled = false;
                requestButton.onclick = async () => {
                    requestButton.disabled = true;
                    requestStatus.textContent = "Sending request…";
                    try {
                        if (existing) await removeRow(existing.id);
                        await supabaseRequest("/rest/v1/channel_collaborations", {
                            method: "POST",
                            headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
                            body: JSON.stringify({ owner_id: ownerId, collaborator_id: session.user.id, rank: 1, status: "pending" })
                        });
                        requestButton.textContent = "Collaboration request pending";
                        requestStatus.textContent = "Your request was sent to the channel owner.";
                    } catch (error) {
                        requestButton.disabled = false;
                        requestStatus.textContent = error.message || "Could not send your collaboration request.";
                    }
                };
            }
        } catch (error) {
            requestStatus.textContent = error.message || "Could not check your collaboration request.";
        }
    }

    if (!ownerId || !window.supabaseRequest) return;
    section.hidden = false;
    if (isOwner) {
        manageArea.hidden = false;
        renderManager();
    } else {
        renderRequester();
    }
})();
