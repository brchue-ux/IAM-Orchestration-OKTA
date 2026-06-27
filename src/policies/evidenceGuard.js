"use strict";

/**
 * evidenceGuard
 * Enforces pre-execution evidence requirements for Stage 4 low-risk execution.
 */

function clean(value) {
    if (value === undefined || value === null) {
        return undefined;
    }

    const text = String(value).trim();
    return text || undefined;
}

function requiresApproval(request) {
    return String(request && request.approval_requirement || "approval_required")
        .trim()
        .toLowerCase() === "approval_required";
}

function buildEvidenceGuardDecision(request, reasons) {
    const passed = reasons.length === 0;

    return {
        passed,
        reasons,
        policy_decision: passed ? "allowed" : "blocked_by_runtime_guardrail",
        required_evidence: {
            correlation_id_required: true,
            request_id_required: true,
            requester_identity_required: true,
            requester_source_required: true,
            source_channel_required: true,
            target_identity_required: true,
            requested_action_required: true,
            action_family_required: true,
            expected_postcondition_required: true,
            approval_record_required_for_write_actions: requiresApproval(request)
        }
    };
}

function validateApprovalRecord(approvalRecord) {
    const reasons = [];
    const record = approvalRecord || {};

    if (!clean(record.approver_identity)) {
        reasons.push("approval_record.approver_identity is required.");
    }

    if (!clean(record.approval_scope || record.scope)) {
        reasons.push("approval_record.approval_scope is required.");
    }

    if (!clean(record.approval_timestamp)) {
        reasons.push("approval_record.approval_timestamp is required.");
    }

    if (!clean(record.approval_expiry)) {
        reasons.push("approval_record.approval_expiry is required.");
    }

    if (!clean(record.approval_status || record.approval_state || record.state)) {
        reasons.push("approval_record.approval_status is required.");
    }

    return reasons;
}

function evaluateEvidenceReadiness(request) {
    const safeRequest = request || {};
    const reasons = [];

    if (!clean(safeRequest.correlation_id)) {
        reasons.push("correlation_id is required.");
    }

    if (!clean(safeRequest.request_id)) {
        reasons.push("request_id is required.");
    }

    if (!clean(safeRequest.requester_identity)) {
        reasons.push("requester_identity is required.");
    }

    if (!clean(safeRequest.requester_source)) {
        reasons.push("requester_source is required.");
    }

    if (!clean(safeRequest.source_channel)) {
        reasons.push("source_channel is required.");
    }

    if (!clean(safeRequest.target_identity)) {
        reasons.push("target_identity is required.");
    }

    if (!clean(safeRequest.requested_action)) {
        reasons.push("requested_action is required.");
    }

    if (!clean(safeRequest.action_family)) {
        reasons.push("action_family is required.");
    }

    if (!clean(safeRequest.expected_postcondition)) {
        reasons.push("expected_postcondition is required.");
    }

    if (requiresApproval(safeRequest)) {
        if (!safeRequest.approval_record) {
            reasons.push("approval_record is required for write actions.");
        } else {
            reasons.push.apply(reasons, validateApprovalRecord(safeRequest.approval_record));
        }
    }

    return buildEvidenceGuardDecision(safeRequest, reasons);
}

module.exports = {
    evaluateEvidenceReadiness,
    buildEvidenceGuardDecision,
    validateApprovalRecord
};