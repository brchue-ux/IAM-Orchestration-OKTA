"use strict";

const { insertNotification } = require("../persistence/sqlEvidenceRepository");

function buildMessage(request) {
    const id = request.correlation_id;

    switch (request.final_status) {
        case "completed_success":
            return {
                message_category: "completed_verified",
                status_communicated: "completed_verified",
                message_body:
                    `The approved action has been completed and verified. ` +
                    `Reference ID: ${id}.`
            };

        case "pending_verification":
            return {
                message_category: "execution_pending",
                status_communicated: "verification_pending",
                message_body:
                    `The requested change is in progress and completion will only be ` +
                    `confirmed after verification succeeds. Reference ID: ${id}.`
            };

        case "completed_failed":
            return {
                message_category: "verification_failed",
                status_communicated: "failed",
                message_body:
                    `The action was attempted, but verification did not confirm the ` +
                    `expected result. The request has been routed for follow-up. ` +
                    `Reference ID: ${id}.`
            };

        case "completed_unverified":
            return {
                message_category: "completed_unverified",
                status_communicated: "completed_unverified",
                message_body:
                    `The change was completed, but verification could not confirm the ` +
                    `expected result. Follow-up may be required. Reference ID: ${id}.`
            };

        default:
            return {
                message_category: "request_captured",
                status_communicated: request.current_status || "unknown",
                message_body:
                    `I’ve captured the request and am checking whether it can proceed ` +
                    `safely. Reference ID: ${id}.`
            };
    }
}

async function sendCompletionNotification(request, channel) {
    const built = buildMessage(request);

    const payload = {
        correlation_id: request.correlation_id,
        recipient: request.requester_identity,
        channel: channel || "Teams",
        message_category: built.message_category,
        status_communicated: built.status_communicated,
        message_body: built.message_body
    };

    await insertNotification(payload);

    return payload;
}

module.exports = {
    sendCompletionNotification,
    buildMessage
};