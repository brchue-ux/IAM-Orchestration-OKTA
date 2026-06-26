"use strict";

/**
 * Approval agent.
 * Uses ServiceNow when configured, otherwise falls back to mock approval behavior.
 */

const { createApprovalRequest, getApprovalStatus } = require("../connectors/serviceNowClient");

async function requestApproval(request) {
    const provider = String(process.env.APPROVAL_PROVIDER || "MOCK").trim().toUpperCase();

    if (provider === "MOCK") {
        return {
            provider: "MOCK",
            approval_state: "pending",
            approval_id: `mock-${request.correlation_id}`,
            approval_record: {
                approver_identity: request.requester_manager || "manager.review.required",
                approval_scope: request.action_family,
                approval_status: "pending"
            }
        };
    }

    const payload = {
        correlation_id: request.correlation_id,
        requester_identity: request.requester_identity,
        target_identity: request.target_identity,
        action_family: request.action_family,
        requested_action: request.requested_action,
        justification: request.justification,
        risk_tier: request.risk_tier,
        metadata: request.metadata || {}
    };

    const result = await createApprovalRequest(payload);
    return {
        provider: "SERVICENOW",
        approval_state: result.approval_state || result.state || "pending",
        approval_id: result.approval_id || result.sys_id,
        approval_record: result
    };
}

async function refreshApproval(approvalId) {
    const provider = String(process.env.APPROVAL_PROVIDER || "MOCK").trim().toUpperCase();

    if (provider === "MOCK") {
        return {
            provider: "MOCK",
            approval_state: "approved",
            approval_id: approvalId
        };
    }

    const status = await getApprovalStatus(approvalId);
    return {
        provider: "SERVICENOW",
        approval_state: status.approval_state || status.state || "pending",
        approval_id: approvalId,
        approval_record: status
    };
}

module.exports = {
    requestApproval,
    refreshApproval
};
