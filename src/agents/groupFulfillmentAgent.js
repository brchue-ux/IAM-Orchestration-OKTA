"use strict";

/**
 * Group fulfillment agent.
 * Bounded to low-risk, standard Okta group membership changes.
 */

const oktaClient = require("../connectors/oktaClient");
const { isGroupAllowed } = require("../config/executionPolicyConfig");
const { executeWithRetry } = require("../services/retryPolicy");
const { classifyError } = require("../utils/errorClassification");
const { logAuditEvent } = require("../services/auditLogger");
const { incrementCounter } = require("../services/metricsCollector");

function normalizeOperation(value) {
    return String(value || "").trim().toLowerCase();
}

async function executeCore(request) {
    const operation = normalizeOperation(request.operation);

    if (operation === "add") {
        return oktaClient.addUserToGroup(request.group_id, request.target_identity);
    }

    if (operation === "remove") {
        return oktaClient.removeUserFromGroup(request.group_id, request.target_identity);
    }

    throw new Error("Unsupported group fulfillment operation.");
}

async function execute(request, context) {
    const policyConfig = context && context.policyConfig ? context.policyConfig : undefined;

    if (!request.group_id) {
        throw new Error("group_id is required for group fulfillment.");
    }

    if (!request.target_identity) {
        throw new Error("target_identity is required for group fulfillment.");
    }

    if (String(request.target_group_type || "standard").toLowerCase() !== "standard") {
        throw new Error("Group fulfillment agent is restricted to standard groups only.");
    }

    if (!isGroupAllowed(request.group_id, policyConfig)) {
        throw new Error("Requested group is not allowlisted for this execution lane.");
    }

    const operation = normalizeOperation(request.operation);
    if (!["add", "remove"].includes(operation)) {
        throw new Error("Group fulfillment operation must be add or remove.");
    }

    const startedAt = new Date().toISOString();

    try {
        await logAuditEvent({
            correlation_id: request.correlation_id,
            event_name: "GROUP_FULFILLMENT_EXECUTION_STARTED",
            actor: "GroupFulfillmentAgent",
            severity: "info",
            category: "execution",
            message: "Group fulfillment execution started.",
            details: {
                operation,
                group_id: request.group_id,
                target_identity: request.target_identity
            }
        });

        const result = await executeWithRetry(
            async function performOperation() {
                return executeCore(request);
            },
            {
                context: { stage: "connector" },
                retry: policyConfig && policyConfig.retry ? policyConfig.retry : undefined
            }
        );

        incrementCounter("group_fulfillment_success_total", 1, {
            operation
        });

        return {
            execution_agent: "GroupFulfillmentAgent",
            execution_tool_or_workflow: "Okta.Groups",
            execution_state: "SUCCESS",
            execution_timestamp: startedAt,
            execution_result: {
                ...result,
                operation,
                group_id: request.group_id,
                target_identity: request.target_identity
            }
        };
    } catch (error) {
        const classified = classifyError(error, { stage: "connector" });
        incrementCounter("group_fulfillment_failure_total", 1, {
            classification: classified.classification
        });

        await logAuditEvent({
            correlation_id: request.correlation_id,
            event_name: "GROUP_FULFILLMENT_EXECUTION_FAILED",
            actor: "GroupFulfillmentAgent",
            severity: "error",
            category: "failure",
            message: error.message,
            error,
            details: {
                classification: classified.classification,
                operation,
                group_id: request.group_id,
                target_identity: request.target_identity
            }
        });

        return {
            execution_agent: "GroupFulfillmentAgent",
            execution_tool_or_workflow: "Okta.Groups",
            execution_state: "FAILED",
            execution_timestamp: startedAt,
            execution_result: {
                downstream_system: "Okta",
                operation,
                group_id: request.group_id,
                target_identity: request.target_identity,
                error_message: error.message,
                error_classification: classified.classification
            }
        };
    }
}

module.exports = { execute };