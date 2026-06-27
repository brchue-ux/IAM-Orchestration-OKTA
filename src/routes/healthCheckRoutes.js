"use strict";

/**
 * healthCheckRoutes
 * Basic liveness, readiness, control-plane, alert, and promotion endpoints.
 */

const express = require("express");
const { getPool } = require("../services/requestRegistryStore");
const { getControlPlaneSnapshot } = require("../services/controlPlaneClient");
const { validatePromotionReadiness } = require("../governance/promotionGateValidator");
const { listAlerts } = require("../control-plane/alertingService");
const { getMetricsSnapshot } = require("../services/metricsCollector");

const router = express.Router();

function getConnectorHealth() {
    return {
        okta_configured: Boolean(process.env.OKTA_BASE_URL && process.env.OKTA_API_TOKEN),
        servicenow_configured: Boolean(
            process.env.SERVICENOW_BASE_URL &&
                ((process.env.SERVICENOW_AUTH_MODE || "basic").toLowerCase() === "bearer"
                    ? process.env.SERVICENOW_BEARER_TOKEN
                    : process.env.SERVICENOW_USERNAME && process.env.SERVICENOW_PASSWORD)
        )
    };
}

router.get("/health", async function handleHealth(req, res) {
    return res.status(200).json({
        status: "ok",
        service: "enterprise-iam-runtime",
        connectors: getConnectorHealth(),
        metrics: getMetricsSnapshot(),
        timestamp: new Date().toISOString()
    });
});

router.get("/ready", async function handleReady(req, res) {
    try {
        await getPool();
        const promotion = await validatePromotionReadiness();
        return res.status(200).json({
            status: promotion.passed ? "ready" : "not_ready_for_promotion",
            connectors: getConnectorHealth(),
            promotion_readiness: promotion,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        return res.status(503).json({
            status: "not_ready",
            connectors: getConnectorHealth(),
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

router.get("/control-plane", async function handleControlPlane(req, res) {
    try {
        const snapshot = await getControlPlaneSnapshot();
        return res.status(200).json(snapshot);
    } catch (error) {
        return res.status(500).json({
            error: "control_plane_snapshot_failed",
            message: error.message
        });
    }
});

router.get("/promotion-readiness", async function handlePromotionReadiness(req, res) {
    try {
        const decision = await validatePromotionReadiness();
        return res.status(200).json({
            promotion_readiness: decision,
            metrics: getMetricsSnapshot(),
            connectors: getConnectorHealth(),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        return res.status(500).json({
            error: "promotion_readiness_failed",
            message: error.message
        });
    }
});

router.get("/alerts", async function handleAlerts(req, res) {
    try {
        const alerts = await listAlerts();
        return res.status(200).json({ alerts });
    } catch (error) {
        return res.status(500).json({
            error: "alerts_lookup_failed",
            message: error.message
        });
    }
});

module.exports = router;