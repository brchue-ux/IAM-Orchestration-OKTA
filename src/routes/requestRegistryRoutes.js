"use strict";

/**
 * requestRegistryRoutes
 *
 * Request APIs:
 * - create
 * - list
 * - lookup by correlation ID
 * - lookup by request ID
 * - patch/update
 * - reconcile
 */

const express = require("express");

const {
    createRequest,
    updateRequest,
    getRequestByCorrelationId,
    getRequestByRequestId,
    listRequests
} = require("../services/requestRegistryStore");

const router = express.Router();

/**
 * ✅ List requests
 */
router.get("/requests", function handleListRequests(req, res) {
    try {
        const limit = req.query && req.query.limit ? Number(req.query.limit) : 50;
        const requests = listRequests({ limit }) || [];

        return res.status(200).json({ requests });
    } catch (error) {
        return res.status(500).json({
            error: "request_list_failed",
            message: error.message
        });
    }
});

/**
 * ✅ Get by request ID
 */
router.get("/requests/by-request-id/:requestId", function handleGetByRequestId(req, res) {
    try {
        const request = getRequestByRequestId(req.params.requestId);

        if (!request) {
            return res.status(404).json({
                error: "request_not_found",
                request_id: req.params.requestId
            });
        }

        return res.status(200).json({ request });
    } catch (error) {
        return res.status(500).json({
            error: "request_lookup_failed",
            message: error.message
        });
    }
});

/**
 * ✅ Get by correlation ID
 */
router.get("/requests/:correlationId", function handleGetByCorrelationId(req, res) {
    try {
        const request = getRequestByCorrelationId(req.params.correlationId);

        if (!request) {
            return res.status(404).json({
                error: "request_not_found",
                correlation_id: req.params.correlationId
            });
        }

        return res.status(200).json({ request });
    } catch (error) {
        return res.status(500).json({
            error: "request_lookup_failed",
            message: error.message
        });
    }
});

/**
 * ✅ Create request
 */
router.post("/requests", function handleCreate(req, res) {
    try {
        const record = createRequest(req.body || {});
        return res.status(200).json({ request: record });
    } catch (error) {
        return res.status(400).json({
            error: "request_create_failed",
            message: error.message
        });
    }
});

/**
 * ✅ Patch/update request
 */
router.patch("/requests/:correlationId", function handlePatch(req, res) {
    try {
        const record = updateRequest(
            req.params.correlationId,
            req.body || {},
            "requestRegistryRoutes"
        );

        return res.status(200).json({ request: record });
    } catch (error) {
        return res.status(400).json({
            error: "request_update_failed",
            message: error.message
        });
    }
});

/**
 * ✅ Reconcile request
 */
router.post("/requests/:correlationId/reconcile", function handleReconcile(req, res) {
    try {
        const correlationId = req.params.correlationId;
        const request = getRequestByCorrelationId(correlationId);

        if (!request) {
            return res.status(404).json({
                error: "request_not_found",
                correlation_id: correlationId
            });
        }

        const patch = {
            reconciliation_requested_at: new Date().toISOString(),
            reconciliation_reason: req.body && req.body.reason
                ? req.body.reason
                : "manual_reconcile_request",
            current_status: req.body && req.body.current_status
                ? req.body.current_status
                : request.current_status,
            waiting_on: req.body && req.body.waiting_on
                ? req.body.waiting_on
                : request.waiting_on
        };

        const updated = updateRequest(
            correlationId,
            patch,
            "requestRegistryRoutes"
        );

        return res.status(200).json({ request: updated });
    } catch (error) {
        return res.status(400).json({
            error: "request_reconcile_failed",
            message: error.message
        });
    }
});

/**
 * ✅ EXPORT — CRITICAL
 */
module.exports = router;