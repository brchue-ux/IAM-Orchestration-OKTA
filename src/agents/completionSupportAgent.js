"use strict";

/**
 * Completion support agent.
 * Shapes safe user-facing responses after execution / verification.
 */

function buildCompletionResponse(request, execution, verification) {
    const verified = verification && verification.verification_result === "verified_success";

    if (verified) {
        return {
            status: "completed_verified",
            message: `The approved action has been completed and verified. Reference ID: ${request.correlation_id}.`
        };
    }

    return {
        status: "verification_failed",
        message: `The action was attempted, but verification did not confirm the expected result. Reference ID: ${request.correlation_id}.`
    };
}

module.exports = { buildCompletionResponse };
