"use strict";

const { listRequests, updateRequest } = require("../services/requestRegistryStore");
const { evaluateAlerts } = require("../control-plane/alertingService");

let interval = null;

async function runSweep() {
    const requests = listRequests({ limit: 100 });

    for (const req of requests) {
        if (req.current_status === "verification_pending") {
            updateRequest(req.correlation_id, {
                reconciliation_attempts: (req.reconciliation_attempts || 0) + 1,
                reconciliation_last_attempt_at: new Date().toISOString()
            });
        }
    }

    // ✅ CRITICAL: run alerts after sweep
    await evaluateAlerts();

    return { processed: requests.length };
}

async function startAutoHealScheduler() {
    if (interval) return;

    interval = setInterval(runSweep, 5000);
}

module.exports = {
    startAutoHealScheduler,
    runSweep
};