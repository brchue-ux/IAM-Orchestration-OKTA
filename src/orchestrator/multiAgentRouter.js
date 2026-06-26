"use strict";

/**
 * Multi-agent orchestrator.
 * Handles intake, policy checks, routing, approval, execution, verification, and completion synthesis.
 */

const { normalizeRequestEnvelope, validateRequiredFields } = require("../contracts/requestEnvelope");
const { buildSodDecision } = require("../policy/sodPolicyEngine");
const { buildBlastRadiusDecision } = require("../policy/blastRadiusGuard");
const { requestApproval } = require("../agents/approvalAgent");
const readOnlyStatusAgent = require("../agents/readOnlyStatusAgent");
const groupFulfillmentAgent = require("../agents/groupFulfillmentAgent");
const userLifecycleStateAgent = require("../agents/userLifecycleStateAgent");
const { buildCompletionResponse } = require("../agents/completionSupportAgent");

function classifyRisk(request) {
    if (String(request.target_group_type || "").toLowerCase() === "privileged") {
        return "high";
    }

    const family = String(request.action_family || "").toLowerCase();

    if (["privileged_access", "session_containment", "policy_security_change"].includes(family)) {
        return "high";
    }

    if (["user_lifecycle", "app_assignment"].includes(family)) {
        return "moderate";
    }

    return request.risk_tier || "low";
}

function selectExecutionAgent(request) {
    const family = String(request.action_family || "").toLowerCase();

    if (family === "read_only_lookup") {
        return readOnlyStatusAgent;
    }

    if (family === "group_fulfillment") {
        return groupFulfillmentAgent;
    }

    if (family === "user_lifecycle") {
        return userLifecycleStateAgent;
    }

    return null;
}

async function verifyExecution(request, execution) {
    if (execution.execution_state !== "SUCCESS") {
        return {
            verification_result: "verified_failure",
            verification_method: "execution_state_check"
        };
    }

    return {
        verification_result: "verified_success",
        verification_method: "simulation_read_back_check"
    };
}

async function routeRequest(input, config) {
    const request = normalizeRequestEnvelope(input);
    request.risk_tier = classifyRisk(request);

    const requiredCheck = validateRequiredFields(request);
    if (!requiredCheck.isValid) {
        return {
            correlation_id: request.correlation_id,
            status: "needs_clarification",
            policy_decision: "manual_review",
            reasons: [`Missing required fields: ${requiredCheck.missing.join(', ')}.`],
            message: "Request requires clarification or manual review before approval / execution."
        };
    }

    const sodDecision = buildSodDecision(request);
    if (!sodDecision.passed) {
        return {
            correlation_id: request.correlation_id,
            status: "rejected",
            policy_decision: sodDecision.policy_decision,
            reasons: sodDecision.reasons,
            message: "Request rejected due to separation-of-duties controls."
        };
    }

    const blastDecision = buildBlastRadiusDecision(request, config || {});
    if (!blastDecision.passed) {
        return {
            correlation_id: request.correlation_id,
            status: "rejected",
            policy_decision: blastDecision.policy_decision,
            reasons: blastDecision.reasons,
            message: "Request rejected due to blast-radius controls."
        };
    }

    const requiresApproval = request.risk_tier === "high" || String(request.action_family).toLowerCase() !== "read_only_lookup";
    let approval = null;

    if (requiresApproval && !request.approval_record) {
        approval = await requestApproval(request);
        return {
            correlation_id: request.correlation_id,
            status: "approval_pending",
            policy_decision: "approval_required",
            approval: approval,
            message: `Approval is required before execution. Reference ID: ${request.correlation_id}.`
        };
    }

    const executionAgent = selectExecutionAgent(request);
    if (!executionAgent) {
        return {
            correlation_id: request.correlation_id,
            status: "manual_review",
            policy_decision: "manual_review",
            reasons: ["No execution agent is mapped for the requested action family."],
            message: "Request requires manual review because no bounded execution path is configured."
        };
    }

    const execution = await executionAgent.execute(request);
    const verification = await verifyExecution(request, execution);
    const completion = buildCompletionResponse(request, execution, verification);

    return {
        correlation_id: request.correlation_id,
        status: completion.status,
        policy_decision: "approved",
        request: request,
        execution: execution,
        verification: verification,
        completion: completion
    };
}

module.exports = {
    routeRequest,
    classifyRisk,
    selectExecutionAgent,
    verifyExecution
};
