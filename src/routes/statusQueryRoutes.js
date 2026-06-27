"use strict";

/**
 * statusQueryRoutes
 * Status, history, and compliance lookup endpoints for request reconciliation.
 */

const express = require("express");
const { getRequestByCorrelationId } = require("../services/requestRegistryStore");
const { getRequestEventsByCorrelationId } = require("../services/requestEventStore");
const { getMetricsSnapshot } = require("../services/metricsCollector");
const { getComplianceRecords } = require("../control-plane/policyComplianceTracker");

const router = express.Router();

router.get("/requests/:correlationId", async function handleGetRequest(req, res) {
    try {
        const correlationId = req.params.correlationId;
        const request = await getRequestByCorrelationId(correlationId);

        if (!request) {
            return res.status(404).json({
                error: "request_not_found",
                correlation_id: correlationId,
                message: "No request record was found for the supplied correlation ID."
            });
        }

        return res.status(200).json({
            correlation_id: correlationId,
            request
        });
    } catch (error) {
        return res.status(500).json({
            error: "request_lookup_failed",
            message: error.message
        });
    }
});

router.get("/requests/:correlationId/events", async function handleGetEvents(req, res) {
    try {
        const correlationId = req.params.correlationId;
        const events = await getRequestEventsByCorrelationId(correlationId);

        return res.status(200).json({
            correlation_id: correlationId,
            events
        });
    } catch (error) {
        return res.status(500).json({
            error: "request_events_lookup_failed",
            message: error.message
        });
    }
});

router.get("/requests/:correlationId/status", async function handleGetStatus(req, res) {
    try {
        const correlationId = req.params.correlationId;
        const request = await getRequestByCorrelationId(correlationId);

        if (!request) {
            return res.status(404).json({
                error: "request_not_found",
                correlation_id: correlationId,
                message: "No request record was found for the supplied correlation ID."
            });
        }

        return res.status(200).json({
            correlation_id: correlationId,
            status: request.current_status,
            current_step: request.current_step,
            waiting_on: request.waiting_on,
            final_status: request.final_status,
            verification_result: request.verification_result,
            metrics: getMetricsSnapshot()
        });
    } catch (error) {
        return res.status(500).json({
            error: "request_status_lookup_failed",
            message: error.message
        });
    }
});

router.get("/requests/:correlationId/compliance", async function handleGetCompliance(req, res) {
    try {
        const correlationId = req.params.correlationId;
        const complianceRecords = await getComplianceRecords();
        const records = complianceRecords.filter(function filterRecord(record) {
            return record && record.correlation_id === correlationId;
        });

        return res.status(200).json({
            correlation_id: correlationId,
            compliance_records: records
        });
    } catch (error) {
        return res.status(500).json({
            error: "request_compliance_lookup_failed",
            message: error.message
        });
    }
});

module.exports = router;