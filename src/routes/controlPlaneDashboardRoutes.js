"use strict";

/**
 * controlPlaneDashboardRoutes
 *
 * Provides control-plane visibility:
 * - request summary
 * - alert summary
 * - metrics snapshot
 */

const express = require("express");
const { getActiveAlerts } = require("../control-plane/alertingService");
const { listRequests } = require("../services/requestRegistryStore");
const { getMetricsSnapshot } = require("../services/metricsCollector");

const router = express.Router();

/**
 * ✅ Dashboard endpoint
 */
router.get("/control-plane/dashboard", function handleDashboard(req, res) {
    try {
        const requests = listRequests({ limit: 100 }) || [];
        const alerts = getActiveAlerts({ limit: 100 }) || [];
        const metrics = getMetricsSnapshot();

        return res.status(200).json({
            request_summary: {
                total: requests.length
            },
            alerts_summary: {
                total: alerts.length
            },
            metrics
        });
    } catch (error) {
        return res.status(500).json({
            error: "dashboard_failed",
            message: error.message
        });
    }
});

module.exports = router;