"use strict";

/**
 * runbookExecutionService
 * Converts runbook definitions into executable response logic for failure handling,
 * rollback/containment recommendation, and escalation actions.
 */

const { createAlert } = require("../control-plane/alertingService");
const { recordRollbackEvent, buildRollbackPlan } = require("../governance/rollbackController");
const { logAuditEvent } = require("./auditLogger");
const { classifyError } = require("../utils/errorClassification");

function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
}

function determineFailureClass(result) {
    const verificationResult = normalizeText(result && result.verification && result.verification.verification_result);
    const status = normalizeText(result && result.status);
    const errorClassification = normalizeText(result && result.error_classification);

    if (verificationResult === "verified_failure") {
        return "verification_related";
    }

    if (["verification_pending", "verification_inconclusive"].includes(verificationResult)) {
        return "verification_related";
    }

    if (errorClassification.includes("approval")) {
        return "approval_related";
    }

    if (errorClassification.includes("policy")) {
        return "policy_related";
    }

    if (errorClassification.includes("connector") || errorClassification.includes("timeout") || errorClassification.includes("transient")) {
        return "tool_connector_related";
    }

    if (["failed", "escalated"].includes(status)) {
        return "execution_related";
    }

    return "communication_related";
}

function buildExecutableActionPlan(request, result, runbook) {
    const failureClass = determineFailureClass(result);
    const completionStatus = normalizeText(result && result.status);
    const verificationResult = normalizeText(result && result.verification && result.verification.verification_result);
    const rollbackPlan = buildRollbackPlan(request);

    const actions = [];

    if (failureClass === "policy_related") {
        actions.push({ action_type: "stop_the_line", reason: "Policy or runtime guardrail blocked execution." });
        actions.push({ action_type: "escalate", owner_role: "IAM Governance" });
    }

    if (failureClass === "approval_related") {
        actions.push({ action_type: "approval_follow_up", owner_role: "Change Manager" });
    }

    if (failureClass === "tool_connector_related") {
        actions.push({ action_type: "connector_health_review", owner_role: "Platform Engineering" });
        actions.push({ action_type: "retry_review", owner_role: "IAM Operations" });
    }

    if (failureClass === "verification_related") {
        actions.push({ action_type: "reconcile_state", owner_role: "IAM Operations" });
    }

    if (["failed", "escalated"].includes(completionStatus) || verificationResult === "verified_failure") {
        actions.push({
            action_type: "rollback_candidate",
            owner_role: "IAM Operations",
            rollback_plan: rollbackPlan
        });
    }

    if (actions.length === 0) {
        actions.push({ action_type: "record_success", owner_role: "IAM Operations" });
    }

    return {
        runbook_name: runbook && runbook.runbook_name ? runbook.runbook_name : "generic_runbook",
        failure_class: failureClass,
        actions,
        rollback_plan: rollbackPlan
    };
}

async function executeRunbook(request, result, runbook) {
    const plan = buildExecutableActionPlan(request, result, runbook || {});

    await logAuditEvent({
        correlation_id: request && request.correlation_id ? request.correlation_id : null,
        event_name: "RUNBOOK_EXECUTION_STARTED",
        actor: "runbookExecutionService",
        severity: "info",
        category: "operations",
        message: `Executing runbook ${plan.runbook_name}.`,
        details: plan
    });

    for (const action of plan.actions) {
        if (action.action_type === "rollback_candidate") {
            // eslint-disable-next-line no-await-in-loop
            await recordRollbackEvent({
                correlation_id: request && request.correlation_id ? request.correlation_id : null,
                action_family: request && request.action_family ? request.action_family : null,
                rollback_plan: action.rollback_plan,
                trigger_reason: plan.failure_class,
                runbook_name: plan.runbook_name
            });
        }

        if (["stop_the_line", "connector_health_review", "approval_follow_up", "reconcile_state"].includes(action.action_type)) {
            // eslint-disable-next-line no-await-in-loop
            await createAlert({
                alert_name: `runbook_${action.action_type}`,
                severity: action.action_type === "stop_the_line" ? "high" : "medium",
                correlation_id: request && request.correlation_id ? request.correlation_id : null,
                alert_details: {
                    runbook_name: plan.runbook_name,
                    failure_class: plan.failure_class,
                    owner_role: action.owner_role || null,
                    action_type: action.action_type
                }
            });
        }
    }

    await logAuditEvent({
        correlation_id: request && request.correlation_id ? request.correlation_id : null,
        event_name: "RUNBOOK_EXECUTION_COMPLETED",
        actor: "runbookExecutionService",
        severity: plan.failure_class === "execution_related" ? "warning" : "info",
        category: "operations",
        message: `Runbook ${plan.runbook_name} executed with ${plan.actions.length} action(s).`,
        details: plan
    });

    return plan;
}

async function executeRunbookForError(request, error, runbook) {
    const classified = classifyError(error, { stage: "runbook" });
    const result = {
        status: "failed",
        error_classification: classified.classification,
        verification: {
            verification_result: "verification_inconclusive"
        }
    };

    return executeRunbook(request, result, runbook);
}

module.exports = {
    determineFailureClass,
    buildExecutableActionPlan,
    executeRunbook,
    executeRunbookForError
};