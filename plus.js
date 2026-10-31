"use strict";

(() => {
    const url = (window.WAMS_SUPABASE_URL || "").replace(/\/$/, "");
    const key = window.WAMS_SUPABASE_ANON_KEY || "";
    const balanceEl = document.getElementById("wamsBalance");
    const statusEl = document.getElementById("plus-status");
    const button = document.getElementById("plusCheckoutButton");
    const cancelButton = document.getElementById("plusCancelButton");
    const signIn = document.getElementById("plusSignIn");
    const planSelect = document.getElementById("plusPlanSelect");
    const priceEl = document.getElementById("plusPlanPrice");
    const durationEl = document.getElementById("plusPlanDuration");
    const includesEl = document.getElementById("plusPlanIncludes");
    const loanOwedEl = document.getElementById("wamsLoanOwed");
    const loanAmountInput = document.getElementById("wamsBorrowAmount");
    const borrowButton = document.getElementById("wamsBorrowButton");
    const repayButton = document.getElementById("wamsRepayButton");
    const loanStatusEl = document.getElementById("wamsLoanStatus");
    const plans = {
        day: { price: 10, duration: "1 day", level: 1, includes: "Plus Member badge, animated GIF profile art, playback tools, up to 1,000 local watch-history items, personalized recommendations, smart watch-later folders, and playlists of up to 500 videos." },
        week: { price: 35, duration: "1 week", level: 2, includes: "Everything in Day, plus Studio editing tools including captions and playback trimming." },
        month: { price: 100, duration: "1 month", level: 3, includes: "Everything in Week, plus creator analytics and subscriber-only videos." },
        year: { price: 900, duration: "1 year", level: 4, includes: "Everything in Month, plus verified-channel creator monetization tools." },
        lifetime: { price: 5000, duration: "Lifetime", level: 5, includes: "All Plus features available on WamsTube, including every feature in the shorter plans. Lifetime never expires." }
    };
    let session = null;
    let walletBalance = 0;
    let currentPlan = null;
    let membershipActive = false;
    let loanOwed = 0;
    try { session = JSON.parse(localStorage.getItem("wamsTubeSession") || "null"); } catch {}

    async function request(path, options = {}) {
        if (!url || !key) throw new Error("Supabase is not configured.");
        const response = await fetch(`${url}/rest/v1/${path}`, {
            ...options,
            headers: {
                apikey: key,
                ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
                ...(options.headers || {})
            }
        });
        if (!response.ok) {
            const text = await response.text();
            let detail = text;
            try { const data = JSON.parse(text); detail = data.message || data.msg || data.details || text; } catch {}
            throw new Error(detail || `Request failed (${response.status}).`);
        }
        if (response.status === 204) return null;
        const text = await response.text();
        return text ? JSON.parse(text) : null;
    }

    function displayWallet(balance) {
        walletBalance = Number(balance || 0);
        balanceEl.textContent = `${walletBalance.toLocaleString()} Wams Bucks`;
    }

    function updateLoanControls() {
        const amount = Number(loanAmountInput.value);
        const validAmount = Number.isInteger(amount) && amount >= 1 && amount <= 1000;
        borrowButton.disabled = !validAmount;
        repayButton.disabled = !validAmount || loanOwed < 1 || walletBalance < amount || amount > loanOwed;
    }

    function updatePlanDisplay() {
        const plan = plans[planSelect.value] || plans.month;
        priceEl.textContent = plan.price.toLocaleString();
        durationEl.textContent = plan.duration === "Lifetime" ? " · never expires" : ` / ${plan.duration}`;
        includesEl.textContent = plan.includes;
        if (!session?.access_token || !membershipActive) {
            button.textContent = `Get ${plan.duration} for ${plan.price.toLocaleString()} Wams Bucks`;
            button.disabled = walletBalance < plan.price;
            if (session?.access_token && balanceEl.textContent !== "Loading…" && walletBalance < plan.price) {
                statusEl.textContent = `You need ${(plan.price - walletBalance).toLocaleString()} more Wams Bucks for this plan.`;
            }
        }
    }

    async function loadCheckout() {
        if (!session?.access_token || !session.user?.id) {
            balanceEl.textContent = "Sign in required";
            loanOwedEl.textContent = "Sign in required";
            loanStatusEl.textContent = "Sign in to borrow or repay Wams Bucks.";
            borrowButton.disabled = true;
            repayButton.disabled = true;
            statusEl.textContent = "Sign in to view your wallet and use the Plus checkout.";
            button.hidden = true;
            signIn.hidden = false;
            return;
        }
        try {
            const [wallets, profiles, loans] = await Promise.all([
                request(`wams_wallets?user_id=eq.${encodeURIComponent(session.user.id)}&select=balance`),
                request(`profiles?id=eq.${encodeURIComponent(session.user.id)}&select=plus_expires_at,plus_plan,is_banned`),
                request(`wams_loans?borrower_id=eq.${encodeURIComponent(session.user.id)}&select=amount,repaid_amount`)
            ]);
            const profile = profiles[0];
            if (profile?.is_banned) throw new Error("This account cannot use the wallet.");
            displayWallet(wallets[0]?.balance || 0);
            loanOwed = (loans || []).reduce((total, loan) => total + Number(loan.amount || 0) - Number(loan.repaid_amount || 0), 0);
            loanOwedEl.textContent = `${loanOwed.toLocaleString()} Wams Bucks`;
            loanStatusEl.textContent = loanOwed > 0
                ? "Repayments go directly to wams@mtps.us and reduce your outstanding balance."
                : "Borrowed Bucks are a debt owed back to wams@mtps.us.";
            updateLoanControls();
            currentPlan = profile?.plus_plan || null;
            const expiry = profile?.plus_expires_at ? new Date(profile.plus_expires_at) : null;
            membershipActive = currentPlan === "lifetime" || Boolean(expiry && expiry > new Date());
            if (membershipActive) {
                statusEl.textContent = currentPlan === "lifetime"
                    ? "Your WamsTube Plus Lifetime membership is active. All available Plus features are unlocked."
                    : `Your ${currentPlan || "Plus"} membership is active until ${expiry.toLocaleString()}. You can cancel now for a 30% Wams Bucks refund.`;
                button.textContent = currentPlan === "lifetime" ? "Lifetime Plus is active" : "Plus is active";
                button.disabled = true;
                cancelButton.hidden = false;
            } else {
                cancelButton.hidden = true;
                statusEl.textContent = "Choose a prepaid plan and check out with your Wams Bucks balance.";
                updatePlanDisplay();
            }
        } catch (error) {
            balanceEl.textContent = "Unavailable";
            loanOwedEl.textContent = "Unavailable";
            loanStatusEl.textContent = error.message;
            borrowButton.disabled = true;
            repayButton.disabled = true;
            statusEl.textContent = error.message;
            button.disabled = true;
        }
    }

    async function processLoan(action) {
        const amount = Number(loanAmountInput.value);
        if (!Number.isInteger(amount) || amount < 1 || amount > 1000) {
            loanStatusEl.textContent = "Enter a whole number between 1 and 1,000 Wams Bucks.";
            return;
        }
        if (action === "borrow" && !window.confirm(`Borrow ${amount.toLocaleString()} Wams Bucks from wams@mtps.us? This amount will be added to the balance you owe that account.`)) return;
        borrowButton.disabled = true;
        repayButton.disabled = true;
        loanStatusEl.textContent = action === "borrow" ? "Processing your loan…" : "Processing your repayment…";
        try {
            const result = await request(`rpc/${action === "borrow" ? "borrow_wams_bucks" : "repay_wams_bucks"}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bucks: amount })
            });
            const update = Array.isArray(result) ? result[0] : result;
            displayWallet(update?.balance || 0);
            loanOwed = Number(update?.owed || 0);
            loanOwedEl.textContent = `${loanOwed.toLocaleString()} Wams Bucks`;
            loanStatusEl.textContent = action === "borrow"
                ? `Borrowed ${amount.toLocaleString()} Wams Bucks. You now owe ${loanOwed.toLocaleString()} Wams Bucks to wams@mtps.us.`
                : `Repaid ${amount.toLocaleString()} Wams Bucks. Remaining balance owed: ${loanOwed.toLocaleString()} Wams Bucks.`;
            updatePlanDisplay();
        } catch (error) {
            loanStatusEl.textContent = error.message || `Could not ${action} Wams Bucks.`;
        } finally {
            updateLoanControls();
        }
    }

    planSelect.addEventListener("change", updatePlanDisplay);
    loanAmountInput.addEventListener("input", updateLoanControls);
    borrowButton.addEventListener("click", () => processLoan("borrow"));
    repayButton.addEventListener("click", () => processLoan("repay"));
    cancelButton.addEventListener("click", async () => {
        if (!membershipActive || !currentPlan || !window.confirm("Cancel WamsTube Plus now? Your membership will end immediately and you’ll receive 30% of its listed price back in Wams Bucks.")) return;
        cancelButton.disabled = true;
        cancelButton.textContent = "Cancelling…";
        statusEl.textContent = "Cancelling your plan and processing the Wams Bucks refund…";
        try {
            const result = await request("rpc/cancel_wams_plus", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({})
            });
            const cancellation = Array.isArray(result) ? result[0] : result;
            displayWallet(cancellation?.balance || 0);
            membershipActive = false;
            currentPlan = null;
            cancelButton.hidden = true;
            cancelButton.textContent = "Cancel plan · refund 30%";
            updatePlanDisplay();
            statusEl.textContent = `Plan cancelled. ${Number(cancellation?.refunded || 0).toLocaleString()} Wams Bucks (30% of your plan price) were returned to your wallet.`;
        } catch (error) {
            statusEl.textContent = error.message || "Could not cancel your plan.";
        } finally {
            cancelButton.disabled = false;
        }
    });
    button.addEventListener("click", async () => {
        const selected = planSelect.value;
        const plan = plans[selected];
        if (button.disabled || !plan) return;
        button.disabled = true;
        button.textContent = "Processing checkout…";
        statusEl.textContent = "Confirming your Wams Bucks purchase…";
        try {
            const result = await request("rpc/purchase_wams_plus", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ requested_plan: selected })
            });
            const purchase = Array.isArray(result) ? result[0] : result;
            displayWallet(purchase?.balance || 0);
            membershipActive = true;
            currentPlan = purchase?.plan || selected;
            cancelButton.hidden = false;
            statusEl.textContent = currentPlan === "lifetime"
                ? "Checkout complete! Lifetime Plus is active and never expires."
                : `Checkout complete! ${selected} Plus is active until ${new Date(purchase.expires_at).toLocaleString()}.`;
            button.textContent = currentPlan === "lifetime" ? "Lifetime Plus is active" : "Plus is active";
            button.disabled = true;
        } catch (error) {
            statusEl.textContent = error.message;
            await loadCheckout();
        }
    });

    updatePlanDisplay();
    loadCheckout();
})();
