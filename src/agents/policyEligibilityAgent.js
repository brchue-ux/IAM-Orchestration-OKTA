
'use strict';

/**
 * PolicyEligibilityAgent
 *
 * Wave 1 policy / eligibility validation for IAM and Okta requests.
 *
 * This agent is advisory / validation only. It does not execute state changes.
 */

const ALLOWED_ACTION_FAMILIES = new Set([
    'read_only_lookup',
    'group_membership',
    'app_assignment',
    'user_lifecycle',
    'containment'
]);

const PRIVILEGED_KEYWORDS = [
    'admin',
    'administrator',
    'superuser',
    'root',
    'breakglass',
    'break-glass',
    'security',
    'privileged'
];

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function detectPrivilegedTarget(record = {}) {
    const fields = [
        record.target_identity,
        record.target_user_identifier,
        record.group_identifier,
        record.app_identifier,
        record.target_resource,
        record.target_system,
        record.requested_action
    ];

    return fields.some((field) => {
        const text = normalizeText(field);
        return PRIVILEGED_KEYWORDS.some((keyword) => text.includes(keyword));
    });
}

function classifyRiskTier(record = {}) {
    const family = normalizeText(record.action_family);
    const privileged = detectPrivilegedTarget(record);

    if (privileged) {
        return 'high';
    }

    if (family === 'read_only_lookup') {
        return 'low';
    }

    if (family === 'group_membership' || family === 'app_assignment') {
        return 'moderate';
    }

    if (family === 'user_lifecycle' || family === 'containment') {
        return 'high';
    }

    return 'high';
}

function determineApprovalRequirement(record = {}, riskTier) {
    const family = normalizeText(record.action_family);

    if (family === 'read_only_lookup') {
        return 'none';
    }

    if (riskTier === 'high' || riskTier === 'critical') {
        return 'required';
    }

    return 'required';
}

function validateRequiredFields(record = {}) {
    const missing = [];

    const required = [
        'correlation_id',
        'request_id',
        'requester_identity',
        'target_identity',
        'target_identifier_type',
        'target_system',
        'requested_action',
        'action_family',
        'business_justification',
        'expected_postcondition'
    ];

    for (const field of required) {
        if (!record[field]) {
            missing.push(field);
        }
    }

    const family = normalizeText(record.action_family);

    if (family === 'group_membership') {
        if (!record.group_identifier) missing.push('group_identifier');
        if (!record.operation) missing.push('operation');
    }

    if (family === 'app_assignment') {
        if (!record.app_identifier) missing.push('app_identifier');
        if (!record.operation) missing.push('operation');
    }

    if (family === 'user_lifecycle') {
        if (!record.lifecycle_action) missing.push('lifecycle_action');
        if (!record.rollback_or_containment_plan) missing.push('rollback_or_containment_plan');
    }

    if (family === 'containment') {
        if (!record.containment_action) missing.push('containment_action');
        if (!record.containment_reason) missing.push('containment_reason');
    }

    return [...new Set(missing)];
}

function validateAllowlist(record = {}) {
    const family = normalizeText(record.action_family);
    return ALLOWED_ACTION_FAMILIES.has(family);
}

function buildBlastRadiusCaps(record = {}, riskTier) {
    const family = normalizeText(record.action_family);

    if (family === 'read_only_lookup') {
        return { max_targets: 10, allow_bulk: true };
    }

    if (riskTier === 'high' || riskTier === 'critical') {
        return { max_targets: 1, allow_bulk: false };
    }

    return { max_targets: 1, allow_bulk: false };
}

function buildDecision(record = {}, result = {}) {
    return {
        correlation_id: record.correlation_id,
        request_id: record.request_id,
        action_family: record.action_family,
        risk_tier: result.risk_tier,
        policy_decision: result.policy_decision,
        approval_requirement: result.approval_requirement,
        reasons: result.reasons || [],
        allowed_execution_agents: result.allowed_execution_agents || [],
        blast_radius_caps: result.blast_radius_caps || { max_targets: 1, allow_bulk: false }
    };
}

function getAllowedExecutionAgents(record = {}) {
    const family = normalizeText(record.action_family);

    switch (family) {
        case 'read_only_lookup':
            return ['ReadOnlyStatusAgent'];
        case 'group_membership':
            return ['AccessGroupFulfillmentAgent'];
        case 'app_assignment':
            return ['AppAssignmentAgent'];
        case 'user_lifecycle':
            return ['UserLifecycleStateAgent'];
        case 'containment':
            return ['ContainmentSessionAgent'];
        default:
            return [];
    }
}

/**
 * Evaluate whether a normalized request can proceed to approval / execution.
 *
 * @param {object} record Normalized request object.
 * @returns {object} Structured policy decision contract.
 */
function evaluatePolicyEligibility(record = {}) {
    const reasons = [];
    const allowlisted = validateAllowlist(record);
    const missingFields = validateRequiredFields(record);
    const riskTier = classifyRiskTier(record);
    const approvalRequirement = determineApprovalRequirement(record, riskTier);
    const privileged = detectPrivilegedTarget(record);
    const blastRadiusCaps = buildBlastRadiusCaps(record, riskTier);
    const allowedExecutionAgents = getAllowedExecutionAgents(record);

    if (!allowlisted) {
        reasons.push('Requested action family is not allowlisted for execution.');
        return buildDecision(record, {
            risk_tier: riskTier,
            policy_decision: 'out_of_scope',
            approval_requirement: 'manual_review',
            reasons,
            allowed_execution_agents: [],
            blast_radius_caps: blastRadiusCaps
        });
    }

    if (missingFields.length > 0) {
        reasons.push(`Missing required fields: ${missingFields.join(', ')}.`);
        return buildDecision(record, {
            risk_tier: riskTier,
            policy_decision: 'manual_review',
            approval_requirement: 'manual_review',
            reasons,
            allowed_execution_agents: [],
            blast_radius_caps: blastRadiusCaps
        });
    }

    if (!record.requester_verified) {
        reasons.push('Requester authority has not been verified.');
        return buildDecision(record, {
            risk_tier: riskTier,
            policy_decision: 'manual_review',
            approval_requirement: 'manual_review',
            reasons,
            allowed_execution_agents: [],
            blast_radius_caps: blastRadiusCaps
        });
    }

    if (record.identity_resolution_status !== 'resolved') {
        reasons.push('Target identity is not uniquely resolved.');
        return buildDecision(record, {
            risk_tier: riskTier,
            policy_decision: 'manual_review',
            approval_requirement: 'manual_review',
            reasons,
            allowed_execution_agents: [],
            blast_radius_caps: blastRadiusCaps
        });
    }

    if (record.bulk_count && Number(record.bulk_count) > blastRadiusCaps.max_targets) {
        reasons.push('Request exceeds configured blast-radius cap.');
        return buildDecision(record, {
            risk_tier: riskTier,
            policy_decision: 'blocked_by_runtime_guardrail',
            approval_requirement: 'manual_review',
            reasons,
            allowed_execution_agents: [],
            blast_radius_caps: blastRadiusCaps
        });
    }

    if (privileged) {
        reasons.push('Target appears privileged and requires higher-risk governance path.');
        return buildDecision(record, {
            risk_tier: 'high',
            policy_decision: 'approval_required',
            approval_requirement: 'required',
            reasons,
            allowed_execution_agents: [],
            blast_radius_caps: { max_targets: 1, allow_bulk: false }
        });
    }

    reasons.push('Request is allowlisted and eligible for approval workflow.');
    return buildDecision(record, {
        risk_tier: riskTier,
        policy_decision: approvalRequirement === 'none' ? 'allowed_without_approval' : 'approval_required',
        approval_requirement: approvalRequirement,
        reasons,
        allowed_execution_agents: allowedExecutionAgents,
        blast_radius_caps: blastRadiusCaps
    });
}

module.exports = {
    evaluatePolicyEligibility,
    classifyRiskTier,
    determineApprovalRequirement,
    detectPrivilegedTarget
};
