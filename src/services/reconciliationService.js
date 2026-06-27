"use strict";

/**
 * reconciliationService
 *
 * - Runs read-back verification
 * - Applies completion (final_status + message)
 * - Persists updates
 * - Triggers runbook / rollback if needed
 */

const {
    getRequestByCorrelationId,
    updateRequest
} = require("./requestRegistryStore");

const { verify } = require("../agents/verificationReadBackAgent");
const { processCompletion } = require("../agents/completionAgent");
const { executeRunbook } = require("./runbookExecutionService");
const {
    buildRollbackPlan,
    recordRollbackEvent
} = require("../governance/rollbackController");
const { logAuditEvent } = require("./auditLogger");
const { incrementCounter } = require("./metricsCollector");

/**
 * Normalize text for comparisons
 */
function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
}

/**
 * Decide if runbook should trigger
 */
function shouldTriggerRunbook(verificationResult) {
    const result = normalizeText(verificationResult);
    return !["verified_success", "verification_not_required_read_only"].includes(result);
}

/**
 * Extract execution + observed state cleanly
 */
function extractExecutionFromRecord(record) {
    if (!record) return null;

    if (record.execution) return record.execution;
    if (record.details && record.details.execution) return record.details.execution;

    const observedState =
        record.observed_state ||
        (record.details ? record.details.observed_state : null);

    return {
        execution_state: record.execution_status || null,
        execution_agent: record.execution_agent || null,
        execution_tool_or_workflow: record.execution_tool_or_workflow || null,
        execution_result: record.details ? record.details.execution_result : null,
        observed_state: observedState
    };
}

/**
 * Track retry metadata
 */
function updateReconciliationMetadata(record, patch) {
    const attempts = Number(record?.reconciliation_attempts || 0) + 1;

    return {
        ...patch,
        reconciliation_attempts: attempts,
        reconciliation_last_attempt_at: new Date().toISOString()
    };
}

/**
 * MAIN FUNCTION
 */
async function reconcileRequest(correlationId, options = {}) {
    const requestRecord = getRequestByCorrelationId(correlationId);

    if (!requestRecord) {
        throw new Error(`Request ${correlationId} was not found.`);
    }

    const execution = extractExecutionFromRecord(requestRecord);

    // ✅ AUDIT START
    await logAuditEvent({
        correlation_id: correlationId,
        event_name: "RECONCILIATION_STARTED",
        actor: "reconciliationService",
        severity: "info",
        category: "verification",
        message: "Reconciliation started.",
        details: {
            requested_by: options.requested_by || "system",
            attempts_before: requestRecord.reconciliation_attempts || 0
        }
    });

    // ✅ STEP 1: VERIFY
    const verification = await verify(requestRecord, execution);

    // ✅ STEP 2: APPLY COMPLETION LOGIC
    const completedRecord = processCompletion(
        requestRecord,
        verification.verification_result
    );

    // ✅ STEP 3: BUILD PATCH FOR DB
    let patch = updateReconciliationMetadata(requestRecord, {
        current_status: completedRecord.current_status,
        final_status: completedRecord.final_status,
        completion_message: completedRecord.completion_message,
        completed_at: completedRecord.completed_at,
        verification_result: verification.verification_result,
        verification_method: verification.verification_method || null,
        expected_postcondition:
            verification.expected_state ||
            requestRecord.expected_postcondition ||
            null,
        observed_state:
            verification.observed_state ||
            requestRecord.observed_state ||
            null,
        waiting_on:
            completedRecord.final_status === "completed_success"
                ? null
                : "operations",
        details: {
            ...(requestRecord.details || {}),
            verification,
            completion: {
                current_status: completedRecord.current_status,
                final_status: completedRecord.final_status
            }
        }
    });

    let runbookPlan = null;
    let rollbackPlan = null;

    // ✅ STEP 4: FAILURE HANDLING
    if (shouldTriggerRunbook(verification.verification_result)) {
        runbookPlan = await executeRunbook(requestRecord, {
            correlation_id: correlationId,
            verification,
            completion: completedRecord
        });

        rollbackPlan = buildRollbackPlan(requestRecord);

        await recordRollbackEvent({
            correlation_id: correlationId,
            rollback_plan: rollbackPlan,
            trigger_reason: verification.verification_result
        });

        patch = {
            ...patch,
            waiting_on: "operations",
            details: {
                ...patch.details,
                runbook_action_plan: runbookPlan,
                rollback_plan: rollbackPlan
            }
        };
    }

    // ✅ STEP 5: PERSIST
    const updated = updateRequest(correlationId, patch, "reconciliationService");

    // ✅ STEP 6: METRICS
    incrementCounter("reconciliation_requests_total");

    if (updated.final_status === "completed_success") {
        incrementCounter("reconciliation_success_total");
    } else if (updated.final_status === "completed_failed") {
        incrementCounter("reconciliation_failed_total");
    }

    // ✅ STEP 7: AUDIT COMPLETE
    await logAuditEvent({
        correlation_id: correlationId,
        event_name: "RECONCILIATION_COMPLETED",
        actor: "reconciliationService",
        severity:
            updated.final_status === "completed_success" ? "info" : "warning",
        message: `Reconciliation completed (${updated.final_status})`
    });

    return {
        request: updated,
        verification,
        current_status: updated.current_status,
        final_status: updated.final_status,
        completion_message: updated.completion_message,
        runbook_action_plan: runbookPlan,
        rollback_plan: rollbackPlan
    };
}

module.exports = {
    reconcileRequest
};