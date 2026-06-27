"use strict";

/**
 * Completion support agent.
 * Shapes safe user-facing responses after execution / verification.
 * Stage 4 rule: never declare write completion unless verification_result is verified_success.
 */

function buildCompletionResponse(request, execution, verification) {
    const verificationResult = String(
        verification && verification.verification_result
            ? verification.verification_result
            : ""
    ).trim().toLowerCase();

    if (verificationResult === "verified_success") {
        return {
            status: "completed_verified",
            message: `The approved action has been completed and verified. Reference ID: ${request.correlation_id}.`
        };
    }

    if (verificationResult === "verification_not_required_read_only") {
        return {
            status: "completed_verified",
            message: `The requested lookup completed successfully. Reference ID: ${request.correlation_id}.`
        };
    }

    if (String(execution && execution.execution_state || "").trim().toUpperCase() === "FAILED") {
        return {
            status: "failed",
            message: `The action could not be completed successfully. Reference ID: ${request.correlation_id}.`
        };
    }

    if (verificationResult === "verification_inconclusive") {
        return {
            status: "verification_pending",
            message: `The action was attempted, but verification is still pending or inconclusive. Reference ID: ${request.correlation_id}.`
        };
    }

    return {
        status: "escalated",
        message: `The action was attempted, but verification did not confirm the expected result. The request should be escalated for follow-up. Reference ID: ${request.correlation_id}.`
    };
}

module.exports = { buildCompletionResponse };