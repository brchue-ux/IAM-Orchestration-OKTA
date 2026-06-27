"use strict";

/**
 * completionAgent
 *
 * Converts verification results into:
 * - current_status
 * - final_status
 * - safe completion message
 *
 * Rules:
 * - NEVER claim success unless verification_result === "verified_success"
 * - Always include a reference/correlation ID in the message
 */

function buildCompletionStatus(verificationResult) {
    switch (verificationResult) {
        case "verified_success":
            return {
                final_status: "completed_success",
                current_status: "completed_verified"
            };

        case "verified_failure":
            return {
                final_status: "completed_failed",
                current_status: "failed"
            };

        case "verification_pending":
            return {
                final_status: "pending_verification",
                current_status: "verification_pending"
            };

        case "verification_inconclusive":
            return {
                final_status: "completed_unverified",
                current_status: "completed_unverified"
            };

        case "verification_not_required_read_only":
            return {
                final_status: "completed_success",
                current_status: "completed_verified"
            };

        default:
            return {
                final_status: "unknown",
                current_status: "verification_pending"
            };
    }
}

function buildCompletionMessage(request) {
    const id = request && request.correlation_id ? request.correlation_id : "unknown";

    switch (request.final_status) {
        case "completed_success":
            return `✅ The approved action has been completed and verified. Reference ID: ${id}`;

        case "completed_failed":
            return `❌ The action was attempted, but verification did not confirm the expected result. I’ve routed this for follow-up. Reference ID: ${id}`;

        case "pending_verification":
            return `⏳ The action is still pending verification. I’ll update once confirmed. Reference ID: ${id}`;

        case "completed_unverified":
            return `⚠️ The action completed, but verification could not confirm the expected result. Follow-up may be required. Reference ID: ${id}`;

        default:
            return `ℹ️ Request is still being processed. Reference ID: ${id}`;
    }
}

/**
 * Apply completion fields to a request record.
 */
function processCompletion(request, verificationResult) {
    const status = buildCompletionStatus(verificationResult);

    const completed = Object.assign({}, request, {
        current_status: status.current_status,
        final_status: status.final_status,
        verification_result: verificationResult,
        completion_message: buildCompletionMessage({
            correlation_id: request && request.correlation_id ? request.correlation_id : null,
            final_status: status.final_status
        }),
        completed_at: new Date().toISOString()
    });

    return completed;
}

module.exports = {
    processCompletion,
    buildCompletionStatus,
    buildCompletionMessage
};