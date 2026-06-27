"use strict";

/**
 * alertStore
 *
 * Persists alerts to a lightweight JSON-backed store so alert history survives
 * process restarts and can be used by dashboards, notifications, and audit review.
 */

const fs = require("fs");
const path = require("path");

const STORE_DIR = path.resolve(process.cwd(), ".request-store");
const ALERT_STORE_FILE = path.join(STORE_DIR, "alerts.json");

/**
 * ✅ ensure storage exists
 */
function ensureStore() {
    fs.mkdirSync(STORE_DIR, { recursive: true });

    if (!fs.existsSync(ALERT_STORE_FILE)) {
        fs.writeFileSync(
            ALERT_STORE_FILE,
            JSON.stringify({ alerts: [] }, null, 2),
            "utf8"
        );
    }
}

/**
 * ✅ load alerts
 */
function loadAlerts() {
    ensureStore();

    const data = fs.readFileSync(ALERT_STORE_FILE, "utf8");
    return JSON.parse(data);
}

/**
 * ✅ save alerts
 */
function saveAlerts(store) {
    ensureStore();

    fs.writeFileSync(
        ALERT_STORE_FILE,
        JSON.stringify(store, null, 2),
        "utf8"
    );

    return store;
}

/**
 * ✅ generate alert ID
 */
function buildAlertId() {
    return `alert-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
}

/**
 * ✅ create alert
 */
function createAlert(alert) {
    const store = loadAlerts();

    const payload = Object.assign(
        {
            alert_id: buildAlertId(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            status: "open",
            severity: "medium",
            category: "runtime",
            actor: "system"
        },
        alert || {}
    );

    if (!Array.isArray(store.alerts)) {
        store.alerts = [];
    }

    store.alerts.unshift(payload);
    saveAlerts(store);

    return payload;
}

/**
 * ✅ list alerts
 */
function listAlerts(options) {
    const store = loadAlerts();
    const alerts = Array.isArray(store.alerts) ? store.alerts.slice() : [];

    const limit = Number(options && options.limit ? options.limit : 200);

    return alerts.slice(0, limit);
}

/**
 * ✅ get alert by ID
 */
function getAlertById(alertId) {
    const store = loadAlerts();

    return (
        (store.alerts || []).find(function findAlert(item) {
            return item && item.alert_id === alertId;
        }) || null
    );
}

/**
 * ✅ update alert
 */
function updateAlert(alertId, patch) {
    const store = loadAlerts();

    const index = (store.alerts || []).findIndex(function findAlert(item) {
        return item && item.alert_id === alertId;
    });

    if (index < 0) {
        throw new Error(`Alert ${alertId} was not found.`);
    }

    store.alerts[index] = Object.assign(
        {},
        store.alerts[index],
        patch || {},
        {
            updated_at: new Date().toISOString()
        }
    );

    saveAlerts(store);

    return store.alerts[index];
}

/**
 * ✅ acknowledge alert
 */
function acknowledgeAlert(alertId, acknowledgedBy) {
    return updateAlert(alertId, {
        status: "acknowledged",
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: acknowledgedBy || "unknown"
    });
}

/**
 * ✅ close alert
 */
function closeAlert(alertId, closedBy) {
    return updateAlert(alertId, {
        status: "closed",
        closed_at: new Date().toISOString(),
        closed_by: closedBy || "unknown"
    });
}

module.exports = {
    ALERT_STORE_FILE,
    createAlert,
    listAlerts,
    getAlertById,
    updateAlert,
    acknowledgeAlert,
    closeAlert
};