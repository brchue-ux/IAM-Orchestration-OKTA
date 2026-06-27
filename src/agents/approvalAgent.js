"use strict";

/**
 * Approval agent.
 * Uses ServiceNow when configured, otherwise falls back to mock approval behavior.
 */

const {
    createApprovalRequest,
    getApprovalStatus
} = require("../connectors/serviceNowClient");

function clean(value) {
    if (value === undefined || value === null) {
        return undefined;
    }

    const text = String(value).trim();
    return text || undefined;
}

function toIso(value) {
    if (!value) {
        return undefined;
    }

    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
        return undefined;
    }

    return new Date(parsed).toISOString();
}

function buildMockPendingApproval(request) {
    return {
        provider: "MOCK",
        approval_state: "pending",
        approval_id: `mock-${request.correlation_id}`,
        approval_record: {
            approval_id: `mock-${request.correlation_id}`,
            approver_identity: request.requester_manager || "manager.review.required",
            approval_scope: request.action_family,
            approval_status: "pending",
            approval_state: "pending",
            approval_timestamp: null,
            approval_expiry: null,
            approval_evidence_link: null
        }
    };
}

function buildMockApprovedApproval(approvalId) {
    const approvedAt = new Date();
    const expiryAt = new Date(approvedAt.getTime() + 8 * 60 * 60 * 1000);

    return {
        provider: "MOCK",
        approval_state: "approved",
        approval_id: approvalId,
        approval_record: {
            approval_id: approvalId,
            approver_identity: "manager.review.required",
            approval_scope: "all_low_risk",
            approval_status: "approved",
            approval_state: "approved",
            approval_timestamp: approvedAt.toISOString(),
            approval_expiry: expiryAt.toISOString(),
            approval_evidence_link: `mock://approval/${approvalId}`
        }
    };
}

function normalizeServiceNowApprovalRecord(raw, fallbackApprovalId) {
    const approvalId =
        clean(raw && (raw.approval_id || raw.sys_id || raw.id)) ||
        fallbackApprovalId ||
        null;

    const state = clean(
        raw &&
            (raw.approval_status ||
                raw.approval_state ||
                raw.state ||
                raw.status ||
                raw.approval_decision)
    );

    return {
        approval_id: approvalId,
        approver_identity: clean(
            raw &&
                (raw.approver_identity ||
                    raw.approver ||
                    raw.approver_email ||
                    raw.approved_by)
        ),
        approval_scope: clean(raw && (raw.approval_scope || raw.scope || raw.action_family)),
        approval_status: state || "pending",
        approval_state: state || "pending",
        approval_timestamp: toIso(
            raw &&
                (raw.approval_timestamp ||
                    raw.approved_at ||
                    raw.approval_date ||
                    raw.updated_at)
        ),
        approval_expiry: toIso(
            raw && (raw.approval_expiry || raw.expires_at || raw.expiry_date)
        ),
        approval_evidence_link: clean(
            raw &&
                (raw.approval_evidence_link ||
                    raw.evidence_link ||
                    raw.record_link ||
                    raw.link)
        ),
        emergency_break_glass_indicator: Boolean(
            raw &&
                (raw.emergency_break_glass_indicator ||
                    raw.break_glass_indicator ||
                    raw.emergency === true)
        )
    };
}

async function requestApproval(request) {
    const provider = String(process.env.APPROVAL_PROVIDER || "MOCK")
        .trim()
        .toUpperCase();

    if (provider === "MOCK") {
        return buildMockPendingApproval(request);
    }

    const payload = {
        correlation_id: request.correlation_id,
        requester_identity: request.requester_identity,
        target_identity: request.target_identity,
        action_family: request.action_family,
        requested_action: request.requested_action,
        approval_scope: request.action_family,
        justification: request.business_justification || request.justification,
        risk_tier: request.risk_tier,
        expected_postcondition: request.expected_postcondition,
        metadata: request.metadata || {}
    };

    const result = await createApprovalRequest(payload);
    const approvalId =
        clean(result && (result.approval_id || result.sys_id || result.id)) ||
        `sn-${request.correlation_id}`;

    return {
        provider: "SERVICENOW",
        approval_state: clean(
            result &&
                (result.approval_state ||
                    result.state ||
                    result.status ||
                    result.approval_status)
        ) || "pending",
        approval_id: approvalId,
        approval_record: normalizeServiceNowApprovalRecord(result, approvalId)
    };
}

async function refreshApproval(approvalId) {
    const provider = String(process.env.APPROVAL_PROVIDER || "MOCK")
        .trim()
        .toUpperCase();

    if (provider === "MOCK") {
        return buildMockApprovedApproval(approvalId);
    }

    const status = await getApprovalStatus(approvalId);

    return {
        provider: "SERVICENOW",
        approval_state: clean(
            status &&
                (status.approval_state ||
                    status.state ||
                    status.status ||
                    status.approval_status)
        ) || "pending",
        approval_id: approvalId,
        approval_record: normalizeServiceNowApprovalRecord(status, approvalId)
    };
}

module.exports = {
    requestApproval,
    refreshApproval,
    normalizeServiceNowApprovalRecord
};