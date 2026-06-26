"use strict";

/**
 * Group fulfillment agent.
 * Intentionally bounded to low-risk group membership changes.
 * Replace the executeCore function with the approved Okta connector when ready.
 */

async function executeCore(request) {
    return {
        downstream_system: "Okta",
        operation: request.operation,
        group_id: request.group_id,
        target_identity: request.target_identity,
        simulated: true
    };
}

async function execute(request) {
    if (!request.group_id) {
        throw new Error("group_id is required for group fulfillment.");
    }

    if (!["add", "remove"].includes(String(request.operation || "").toLowerCase())) {
        throw new Error("Group fulfillment operation must be add or remove.");
    }

    const result = await executeCore(request);

    return {
        execution_agent: "GroupFulfillmentAgent",
        execution_state: "SUCCESS",
        execution_result: result
    };
}

module.exports = { execute };
