"use strict";

/**
 * alertingService
 *
 * Evaluates runtime signals and produces alerts for the control plane.
 */

const { listRequests } = require("../services/requestRegistryStore");

/**
 * In-memory alert store (lightweight for now)
 * Replace with alertStore.js for persistence if needed.
 */
let alerts = [];

/**
 * ✅ Evaluate alerts
 */
async function evaluateAlerts() {
    const requests = listRequests();

    if (!Array.isArray(requests)) {
        throw new Error("Request store did not return an array.");
    }

    // Example rule: failure spike
    const failed = requests.filter(function (r) {
        return r && r.current_status === "failed";
    });

    if (failed.length > 2) {
        alerts.push({
            alert_id: `alert-${Date.now()}`,
            alert_name: "failure_spike",
            severity: "high",
            category: "runtime",
            message: `Detected ${failed.length} failed requests`,
            created_at: new Date().toISOString(),
            status: "open"
        });
    }

    return {
        alerts_created: alerts.length
    };
}

/**
 * ✅ Retrieve active alerts
 */
function getActiveAlerts() {
    return Array.isArray(alerts) ? alerts.slice() : [];
}

/**
 * ✅ Export
 */
module.exports = {
    evaluateAlerts,
    getActiveAlerts
};