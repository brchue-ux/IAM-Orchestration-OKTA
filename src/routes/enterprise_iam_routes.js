"use strict";

/**
 * Enterprise IAM routes.
 * Persists request state, enforces idempotency, invokes the orchestrator,
 * and returns a lifecycle-aware response.
 */

const express = require("express");
const crypto = require("crypto");

const { routeRequest } = require("../orchestrator/multiAgentRouter");
const {
    createRequest,
    updateRequest,
    getRequestByCorrelationId
} = require("../services/requestRegistryStore");
const {
    appendRequestEvent,
    getRequestEventsByCorrelationId
} = require("../services/requestEventStore");
const { buildEvidencePackage } = require("../services/auditEvidenceAgent");
const { assertNotDuplicate } = require("../services/idempotencyService");
const { classifyError } = require("../utils/errorClassification");
const { logAuditEvent } = require("../services/auditLogger");
const { incrementCounter } = require("../services/metricsCollector");
const { evaluateAndRecordCompliance } = require("../control-plane/policyComplianceTracker");
const { createAlert } = require("../control-plane/alertingService");
const { requestReleaseApproval, listReleaseApprovals } = require("../governance/releaseApprovalFlow");

const router = express.Router();

function ensureCorrelationId(input) {
    const safeInput = input || {};
    if (safeInput.correlation_id) {
        return safeInput.correlation_id;
    }

    if (typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }

    return `req-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function persistInitialRequest(requestBody) {
    const correlationId = ensureCorrelationId(requestBody);

    const initialRecord = {
        correlation_id: correlationId,
        request_id: requestBody.request_id || correlationId,
        requester_identity: requestBody.requester_identity || null,
        requester_source: requestBody.requester_source || "teams",
        requester_tenant_or_domain: requestBody.requester_tenant_or_domain || null,
        target_identity: requestBody.target_identity || null,
        target_environment: requestBody.target_environment || "dev",
        action_family: requestBody.action_family || null,
        requested_action: requestBody.requested_action || null,
        risk_tier: requestBody.risk_tier || "low",
        approval_requirement: requestBody.approval_requirement || null,
        approval_reference: requestBody.approval_reference || null,
        approval_record: requestBody.approval_record || null,
        current_status: "request_captured",
        current_step: "REQUEST_CAPTURED",
        waiting_on: "Orchestrator",
        source_channel: requestBody.source_channel || "teams",
        expected_postcondition: requestBody.expected_postcondition || null,
        details: {
            received_payload: requestBody
        }
    };

    await createRequest(initialRecord);

    await appendRequestEvent({
        correlation_id: correlationId,
        event_name: "REQUEST_CAPTURED",
        from_status: null,
        to_status: "request_captured",
        actor: "enterprise_iam_routes",
        event_details: {
            message: "Request captured and persisted.",
            request_id: initialRecord.request_id
        }
    });

    await logAuditEvent({
        correlation_id: correlationId,
        event_name: "REQUEST_CAPTURED_AUDIT",
        actor: "enterprise_iam_routes",
        severity: "info",
        category: "intake",
        message: "Request captured and stored in the registry."
    });

    incrementCounter("requests_captured_total", 1, {
        action_family: requestBody.action_family || "unknown"
    });

    return correlationId;
}

async function persistOrchestratorResult(correlationId, result) {
    const nextStatus = result && result.status ? result.status : "manual_review";
    const approvalRecord =
        result && result.approval && result.approval.approval_record
            ? result.approval.approval_record
            : result && result.approval_record
                ? result.approval_record
                : null;

    const updatePayload = {
        policy_decision: result && result.policy_decision ? result.policy_decision : "manual_review",
        current_status: nextStatus,
        current_step: "ORCHESTRATOR_COMPLETED",
        waiting_on:
            nextStatus === "approval_pending"
                ? "Approver"
                : nextStatus === "verification_pending"
                    ? "Verification"
                    : nextStatus === "escalated"
                        ? "Operations"
                        : null,
        approval_record: approvalRecord,
        execution_agent:
            result && result.execution && result.execution.execution_agent
                ? result.execution.execution_agent
                : null,
        execution_tool_or_workflow:
            result && result.execution && result.execution.execution_tool_or_workflow
                ? result.execution.execution_tool_or_workflow
                : null,
        execution_status:
            result && result.execution && result.execution.execution_state
                ? result.execution.execution_state
                : null,
        verification_method:
            result && result.verification && result.verification.verification_method
                ? result.verification.verification_method
                : null,
        verification_result:
            result && result.verification && result.verification.verification_result
                ? result.verification.verification_result
                : null,
        verification_status:
            result && result.verification && result.verification.verification_status
                ? result.verification.verification_status
                : null,
        completion_status: nextStatus,
        final_status:
            nextStatus === "completed_verified"
                ? "completed_verified"
                : nextStatus === "failed"
                    ? "failed"
                    : nextStatus === "rejected"
                        ? "rejected"
                        : nextStatus === "escalated"
                            ? "escalated"
                            : null,
        details: result
    };

    await updateRequest(correlationId, updatePayload, "enterprise_iam_routes");

    await appendRequestEvent({
        correlation_id: correlationId,
        event_name: "ORCHESTRATOR_COMPLETED",
        from_status: "request_captured",
        to_status: nextStatus,
        actor: "enterprise_iam_routes",
        event_details: {
            policy_decision: result && result.policy_decision ? result.policy_decision : null,
            status: nextStatus
        }
    });
}

router.post("/requests", async function handleEnterpriseRequest(req, res) {
    let correlationId = null;
    let requestBody = null;

    try {
        requestBody = Object.assign({}, req.body || {});
        correlationId = await persistInitialRequest(requestBody);
        requestBody.correlation_id = correlationId;

        await assertNotDuplicate(requestBody);

        const result = await routeRequest(requestBody, {});
        await persistOrchestratorResult(correlationId, result);
        await evaluateAndRecordCompliance(requestBody, result);

        if (["failed", "escalated", "rejected"].includes(String(result && result.status || "").toLowerCase())) {
            await createAlert({
                alert_name: "request_follow_up_required",
                severity: "high",
                correlation_id: correlationId,
                alert_details: {
                    status: result.status,
                    policy_decision: result.policy_decision,
                    reasons: result.reasons || null,
                    rollback_plan: result.rollback_plan || null
                }
            });
        }

        let evidencePackage = null;
        if (
            result &&
            ["completed_verified", "verification_pending", "failed", "escalated"].includes(
                String(result.status || "").trim().toLowerCase()
            )
        ) {
            try {
                evidencePackage = await buildEvidencePackage(correlationId, result.execution || null);
            } catch (error) {
                evidencePackage = {
                    correlation_id: correlationId,
                    error: `Evidence package could not be built: ${error.message}`
                };
            }
        }

        const persistedRequest = await getRequestByCorrelationId(correlationId);
        const events = await getRequestEventsByCorrelationId(correlationId);

        return res.status(200).json({
            correlation_id: correlationId,
            request: persistedRequest,
            result,
            evidence_package: evidencePackage,
            event_stream: events
        });
    } catch (error) {
        const classified = classifyError(error, { stage: "route" });

        if (correlationId) {
            await logAuditEvent({
                correlation_id: correlationId,
                event_name: "REQUEST_FAILED",
                actor: "enterprise_iam_routes",
                severity: "error",
                category: "failure",
                message: error.message,
                error,
                details: {
                    classification: classified.classification
                }
            });

            await createAlert({
                alert_name: "request_route_error",
                severity: "high",
                correlation_id: correlationId,
                alert_details: {
                    classification: classified.classification,
                    message: error.message
                }
            });

            await updateRequest(
                correlationId,
                {
                    current_status: "failed",
                    current_step: "REQUEST_FAILED",
                    final_status: "failed",
                    completion_status: "failed",
                    details: {
                        error_message: error.message,
                        error_classification: classified.classification
                    }
                },
                "enterprise_iam_routes"
            );
        }

        return res.status(500).json({
            error: "enterprise_iam_request_failed",
            classification: classified.classification,
            correlation_id: correlationId,
            message: error.message
        });
    }
});

router.post("/governance/releases", async function handleReleaseApproval(req, res) {
    try {
        const releaseRecord = Object.assign({}, req.body || {});
        const approval = await requestReleaseApproval(releaseRecord);

        return res.status(200).json({
            message: "Release approval request recorded.",
            approval
        });
    } catch (error) {
        return res.status(500).json({
            error: "release_approval_record_failed",
            message: error.message
        });
    }
});

router.get("/governance/releases", async function handleListReleaseApprovals(req, res) {
    try {
        const releases = await listReleaseApprovals();
        return res.status(200).json({ releases });
    } catch (error) {
        return res.status(500).json({
            error: "release_approval_lookup_failed",
            message: error.message
        });
    }
});

module.exports = router;