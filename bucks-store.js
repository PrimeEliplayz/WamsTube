"use strict";

const supabaseUrl = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
const supabaseKey = window.WAMS_SUPABASE_ANON_KEY || "";
let session = null;
try { session = JSON.parse(localStorage.getItem("wamsTubeSession") || "null"); } catch {}

async function request(path, options = {}) {
    if (!supabaseUrl || !supabaseKey) throw new Error("Supabase is not configured.");
    const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
        ...options,
        headers: {
            apikey: supabaseKey,
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
            ...(options.headers || {})
        }
    });
    const text = await response.text();
    if (!response.ok) {
        let detail = text;
        try {
            const payload = JSON.parse(text);
            detail = payload.message || payload.msg || payload.hint || payload.details || detail;
        } catch {}
        throw new Error(detail || `Request failed (${response.status}).`);
    }
    return text ? JSON.parse(text) : null;
}

document.getElementById("redeemGiftCard").addEventListener("click", async () => {
    const giftStatus = document.getElementById("giftCardStatus");
    const code = document.getElementById("giftCardCode").value.trim();
    if (!session?.access_token) {
        giftStatus.textContent = "Sign in before redeeming a gift card.";
        return;
    }
    if (!supabaseUrl || !supabaseKey) {
        giftStatus.textContent = "Gift-card redemption is not configured. Add the Supabase project settings first.";
        return;
    }
    if (!code) {
        giftStatus.textContent = "Enter your gift card code.";
        return;
    }
    const button = document.getElementById("redeemGiftCard");
    button.disabled = true;
    giftStatus.textContent = "Checking gift card…";
    try {
        const result = await request("rpc/redeem_wams_gift_card", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gift_code: code })
        });
        const row = Array.isArray(result) ? result[0] : result;
        giftStatus.textContent = `Gift card redeemed: ${Number(row?.credited || 0).toLocaleString()} Wams Bucks added. New Bucks balance: ${Number(row?.balance || 0).toLocaleString()}.`;
        document.getElementById("giftCardCode").value = "";
    } catch (error) {
        const message = error.message || "Could not redeem that gift card.";
        giftStatus.textContent = message.includes("redeem_wams_gift_card") && message.toLowerCase().includes("schema cache")
            ? "Gift-card redemption is not installed yet. Apply wams-store-codes.sql after the main Supabase schema."
            : message;
    } finally {
        button.disabled = false;
    }
});
