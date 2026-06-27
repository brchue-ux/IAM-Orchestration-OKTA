"use strict";

/**
 * App assignment agent.
 * Bounded to approved, low-risk application assignment changes.
 */

const oktaClient = require("../connectors/oktaClient");
const { isAppAllowed } = require("../config/executionPolicyConfig");
const { executeWithRetry } = require("../services/retryPolicy");
const { classifyError } = require("../utils/errorClassification");
const { logAuditEvent } = require("../services/auditLogger");
const { incrementCounter } = require("../services/metricsCollector");

function normalizeOperation(value) {
    return String(value || "").trim().toLowerCase();
}

async function executeCore(request) {
    const operation = normalizeOperation(request.operation);

    if (typeof oktaClient.assignUserToApp === "function" && operation === "assign") {
        return oktaClient.assignUserToApp(request.app_id, request.target_identity);
    }

    if (typeof oktaClient.unassignUserFromApp === "function" && operation === "unassign") {
        return oktaClient.unassignUserFromApp(request.app_id, request.target_identity);
    }

    return {
        simulated: true,
        downstream_system: "Okta",
        operation,
        app_id: request.app_id,
        target_identity: request.target_identity,
        message: "App assignment execution is running in simulation mode because no live Okta app-assignment methods were found."
    };
}

async function execute(request, context) {
    const policyConfig = context && context.policyConfig ? context.policyConfig : undefined;

    if (!request.app_id) {
        throw new Error("app_id is required for app assignment.");
    }

    if (!request.target_identity) {
        throw new Error("target_identity is required for app assignment.");
    }

    if (!isAppAllowed(request.app_id, policyConfig)) {
        throw new Error("Requested application is not allowlisted for this execution lane.");
    }

    const operation = normalizeOperation(request.operation);
    if (!["assign", "unassign"].includes(operation)) {
        throw new Error("App assignment operation must be assign or unassign.");
    }

    const startedAt = new Date().toISOString();

    try {
        await logAuditEvent({
            correlation_id: request.correlation_id,
            event_name: "APP_ASSIGNMENT_EXECUTION_STARTED",
            actor: "AppAssignmentAgent",
            severity: "info",
            category: "execution",
            message: "App assignment execution started.",
            details: {
                operation,
                app_id: request.app_id,
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

        incrementCounter("app_assignment_success_total", 1, {
            operation
        });

        return {
            execution_agent: "AppAssignmentAgent",
            execution_tool_or_workflow: "Okta.AppAssignments",
            execution_state: "SUCCESS",
            execution_timestamp: startedAt,
            execution_result: {
                ...result,
                operation,
                app_id: request.app_id,
                target_identity: request.target_identity
            }
        };
    } catch (error) {
        const classified = classifyError(error, { stage: "connector" });
        incrementCounter("app_assignment_failure_total", 1, {
            classification: classified.classification
        });

        await logAuditEvent({
            correlation_id: request.correlation_id,
            event_name: "APP_ASSIGNMENT_EXECUTION_FAILED",
            actor: "AppAssignmentAgent",
            severity: "error",
            category: "failure",
            message: error.message,
            error,
            details: {
                classification: classified.classification,
                operation,
                app_id: request.app_id,
                target_identity: request.target_identity
            }
        });

        return {
            execution_agent: "AppAssignmentAgent",
            execution_tool_or_workflow: "Okta.AppAssignments",
            execution_state: "FAILED",
            execution_timestamp: startedAt,
            execution_result: {
                downstream_system: "Okta",
                operation,
                app_id: request.app_id,
                target_identity: request.target_identity,
                error_message: error.message,
                error_classification: classified.classification
            }
        };
    }
}

module.exports = { execute };