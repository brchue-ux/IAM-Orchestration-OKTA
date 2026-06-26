
'use strict';

/**
 * highRiskExecutionGuard
 *
 * Wave 4 runtime guard for privileged / high-risk execution.
 * Intended location: src/services/highRiskExecutionGuard.js
 */

const { appendAlert } = require('./controlPlaneStore');

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function isApprovalFresh(approvalRecord = {}) {
    if (!approvalRecord.approval_timestamp || !approvalRecord.approval_expiry) {
        return false;
    }

    const now = Date.now();
    const approvedAt = Date.parse(approvalRecord.approval_timestamp);
    const expiryAt = Date.parse(approvalRecord.approval_expiry);

    return !Number.isNaN(approvedAt) && !Number.isNaN(expiryAt) && approvedAt <= now && now <= expiryAt;
}

function buildGuardDecision(request = {}, reasons = []) {
    const allowed = reasons.length === 0;

    return {
        allowed,
        risk_tier: request.risk_tier || 'high',
        privileged_target: Boolean(request.privileged_target),
        reasons,
        required_controls: {
            separate_approver_required: true,
            fresh_approval_required: true,
            blast_radius_limit: 1,
            environment_match_required: true,
            break_glass_indicator_required_for_emergency: Boolean(request.emergency_break_glass)
        }
    };
}

/**
 * Evaluate whether a privileged or high-risk request can proceed.
 */
async function evaluateHighRiskExecutionReadiness(request = {}) {
    const reasons = [];
    const approvalRecord = request.approval_record || {};

    if (!request.privileged_target && normalizeText(request.risk_tier) !== 'high' && normalizeText(request.risk_tier) !== 'critical') {
        reasons.push('Request is not marked as privileged or high-risk for this lane.');
    }

    if (!approvalRecord.approver_identity) {
        reasons.push('Privileged execution requires an approver identity.');
    }

    if (!isApprovalFresh(approvalRecord)) {
        reasons.push('Privileged execution requires a fresh, non-expired approval record.');
    }

    if (approvalRecord.approver_identity && request.requester_identity && normalizeText(approvalRecord.approver_identity) == normalizeText(request.requester_identity)) {
        reasons.push('Requester and approver must be different for privileged execution.');
    }

    if ((request.bulk_count || 1) > 1) {
        reasons.push('Privileged execution is restricted to one target at a time.');
    }

    if (!request.expected_postcondition) {
        reasons.push('Privileged execution requires a defined expected_postcondition.');
    }

    if (request.environment_name && process.env.APP_ENV && normalizeText(request.environment_name) != normalizeText(process.env.APP_ENV)) {
        reasons.push('Request environment does not match runtime environment.');
    }

    if (request.emergency_break_glass && !approvalRecord.emergency_break_glass_indicator) {
        reasons.push('Emergency break-glass execution requires an emergency indicator in the approval record.');
    }

    const decision = buildGuardDecision(request, reasons);

    if (!decision.allowed) {
        await appendAlert({
            alert_name: 'high_risk_execution_blocked',
            severity: 'high',
            correlation_id: request.correlation_id || null,
            alert_details: decision
        });
    }

    return decision;
}

module.exports = {
    evaluateHighRiskExecutionReadiness,
    isApprovalFresh,
    buildGuardDecision
};
