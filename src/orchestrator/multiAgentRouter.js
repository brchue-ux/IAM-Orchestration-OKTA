"use strict";

/**
 * Multi-agent orchestrator with:
 * ✅ verification-driven completion
 * ✅ request lifecycle persistence
 * ✅ runbook + rollback integration
 */

const {
    createRequest,
    updateRequest,
    getRequestByCorrelationId
} = require("../services/requestRegistryStore");

const { verify } = require("../agents/verificationReadBackAgent");
const { buildCompletionResponse } = require("../agents/completionSupportAgent");
const { executeRunbook } = require("../services/runbookExecutionService");

function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
}

/**
 * ✅ REQUEST STORE HELPER
 */
async function upsertLifecycleRecord(request, patch) {
    if (!request || !request.correlation_id) return;

    const existing = getRequestByCorrelationId(request.correlation_id);

    const base = {
        correlation_id: request.correlation_id,
        request_id: request.request_id || request.correlation_id,
        action_family: request.action_family,
        target_identity: request.target_identity,
        target_environment: request.target_environment,
        risk_tier: request.risk_tier
    };

    if (existing) {
        return updateRequest(request.correlation_id, {
            ...existing,
            ...patch
        });
    }

    return createRequest({
        ...base,
        ...patch
    });
}

/**
 * ✅ COMPLETION DECISION (STRICT VERIFICATION MODEL)
 */
function computeCompletionStatus(verification) {
    const result = normalizeText(verification.verification_result);

    if (result === "verified_success") return "completed_verified";
    if (result === "verified_failure") return "failed";
    if (result === "verification_inconclusive") return "verification_inconclusive";
    if (result === "verification_pending") return "verification_pending";

    return "manual_review";
}

function shouldTriggerRunbook(status, verification) {
    return status !== "completed_verified";
}

/**
 * ✅ MAIN ROUTER
 */
async function routeRequest(request, executionAgent) {

    // ✅ STEP 1 — intake persistence
    await upsertLifecycleRecord(request, {
        current_status: "ready_for_validation",
        current_step: "REQUEST_NORMALIZED",
        waiting_on: "validation"
    });

    /**
     * ✅ STEP 2 — EXECUTION
     */
    const execution = await executionAgent.execute(request);

    await upsertLifecycleRecord(request, {
        current_status: "execution_completed",
        current_step: "EXECUTION_COMPLETED",
        waiting_on: "verification",
        execution_status: execution.execution_state,
        details: { execution }
    });

    /**
     * ✅ STEP 3 — VERIFICATION (IMPORTANT)
     */
    const verification = await verify(request, execution);

    const completionStatus = computeCompletionStatus(verification);

    await upsertLifecycleRecord(request, {
        current_status: completionStatus,
        current_step: "VERIFICATION_COMPLETED",
        waiting_on: completionStatus === "completed_verified" ? null : "operations",
        verification_result: verification.verification_result,
        verification_method: verification.verification_method,
        details: { verification }
    });

    /**
     * ✅ STEP 4 — COMPLETION OUTPUT
     */
    const completion = buildCompletionResponse(request, execution, {
        ...verification,
        completion_status_override: completionStatus
    });

    const result = {
        correlation_id: request.correlation_id,
        status: completionStatus,
        request,
        execution,
        verification,
        completion
    };

    /**
     * ✅ STEP 5 — RUNBOOK (ONLY IF NOT VERIFIED SUCCESS)
     */
    if (shouldTriggerRunbook(completionStatus, verification)) {

        const runbookPlan = await executeRunbook(request, result);

        result.runbook_action_plan = runbookPlan;

        await upsertLifecycleRecord(request, {
            current_status: completionStatus,
            current_step: "RUNBOOK_EXECUTED",
            waiting_on: "operations",
            final_status: completionStatus
        });
    }

    return result;
}

module.exports = {
    routeRequest
};