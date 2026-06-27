/**
ates a normalized request using trusted runtime context. * Policy Validation Service
 * This service does not execute actions.
 */

const ALLOWED_POLICY_DECISIONS = new Set([
    'allowed_without_approval',
    'approval_required',
    'approval_pending',
    'approved',
    'rejected',
    'manual_review',
    'emergency_break_glass',
    'out_of_scope',
    'blocked_by_runtime_guardrail'
]);

function evaluatePolicy(request, trustedContext = {}) {
    validateNormalizedEnvelope(request);

    const reasons = [];
    const evaluated_rules = [];
    const authorization_source =
        trustedContext.requester_authorization_source || 'runtime_context';

    evaluated_rules.push('allowlisted_target_system');
    if (request.target_system !== 'okta') {
        return buildDecision({
            decision: 'out_of_scope',
            reasons: ['target_system_not_allowed'],
            evaluated_rules,
            authorization_source
        });
    }

    evaluated_rules.push('allowlisted_action_family');
    if (request.action_family !== 'group_membership_fulfillment') {
        return buildDecision({
            decision: 'out_of_scope',
            reasons: ['action_family_not_allowed'],
            evaluated_rules,
            authorization_source
        });
    }

    evaluated_rules.push('allowlisted_operation');
    const operation = getRequestedOperation(request);
    if (operation !== 'add') {
        return buildDecision({
            decision: 'out_of_scope',
            reasons: ['operation_not_allowed'],
            evaluated_rules,
            authorization_source
        });
    }

    evaluated_rules.push('required_group_membership_fields');

    if (!request.target_user_identifier) {
        reasons.push('missing_target_user_identifier');
    }

    if (!request.group_identifier) {
        reasons.push('missing_group_identifier');
    }

    if (!request.expected_postcondition) {
        reasons.push('missing_expected_postcondition');
    }

    if (reasons.length > 0) {
        return buildDecision({
            decision: 'rejected',
            reasons,
            evaluated_rules,
            authorization_source
        });
    }

    evaluated_rules.push('target_verification');

    if (trustedContext.target_is_unique === false) {
        return buildDecision({
            decision: 'rejected',
            reasons: ['target_not_unique'],
            evaluated_rules,
            authorization_source
        });
    }

    if (trustedContext.target_is_allowed_population === false) {
        return buildDecision({
            decision: 'rejected',
            reasons: ['target_population_not_allowed'],
            evaluated_rules,
            authorization_source
        });
    }

    if (trustedContext.target_is_privileged === true) {
        return buildDecision({
            decision: 'manual_review',
            reasons: ['target_is_privileged'],
            evaluated_rules,
            authorization_source
        });
    }

    evaluated_rules.push('group_verification');

    if (trustedContext.group_exists === false) {
        return buildDecision({
            decision: 'rejected',
            reasons: ['group_not_found'],
            evaluated_rules,
            authorization_source
        });
    }

    if (trustedContext.group_in_approved_scope === false) {
        return buildDecision({
            decision: 'rejected',
            reasons: ['group_outside_approved_scope'],
            evaluated_rules,
            authorization_source
        });
    }

    if (trustedContext.group_is_privileged === true) {
        return buildDecision({
            decision: 'manual_review',
            reasons: ['group_is_privileged'],
            evaluated_rules,
            authorization_source
        });
    }

    evaluated_rules.push('requester_authority_verification');

    const authority = determineRequesterAuthority(request, trustedContext);

    if (!authority.authorized) {
        return buildDecision({
            decision: 'rejected',
            reasons: [authority.reason || 'requester_authority_not_verified'],
            evaluated_rules,
            authorization_source
        });
    }

    evaluated_rules.push('approval_evaluation');

    if (trustedContext.approval_required === false) {
        return buildDecision({
            decision: 'allowed_without_approval',
            reasons: ['policy_allows_without_approval'],
            evaluated_rules,
            authorization_source
        });
    }

    const approval = trustedContext.approval_record || null;

    if (!approval) {
        return buildDecision({
            decision: 'approval_required',
            reasons: ['approval_missing'],
            evaluated_rules,
            authorization_source
        });
    }

    if (approval.decision !== 'approved') {
        return buildDecision({
            decision: 'approval_pending',
            reasons: ['approval_not_complete'],
            evaluated_rules,
            authorization_source,
            approval_record: approval
        });
    }

    if (isExpired(approval.expires_at)) {
        return buildDecision({
            decision: 'rejected',
            reasons: ['approval_expired'],
            evaluated_rules,
            authorization_source,
            approval_record: approval
        });
    }

    return buildDecision({
        decision: 'approved',
        reasons: ['policy_checks_passed'],
        evaluated_rules,
        authorization_source,
        approval_record: approval
    });
}

function validateNormalizedEnvelope(request) {
    if (!request || typeof request !== 'object') {
        throw new Error('Policy Validation Error: normalized request is required');
    }

    const requiredFields = [
        'correlation_id',
        'request_id',
        'requester_identity',
        'target_identity',
        'target_system',
        'requested_action',
        'action_family',
        'normalized_status',
        'expected_postcondition'
    ];

    for (const field of requiredFields) {
        if (!request[field]) {
            throw new Error(
                `Policy Validation Error: missing normalized field ${field}`
            );
        }
    }
}

function determineRequesterAuthority(request, trustedContext) {
    if (trustedContext.requester_is_same_as_target === true) {
        return {
            authorized: true,
            authority_type: 'self_service'
        };
    }

    if (trustedContext.requester_is_manager_of_target === true) {
        return {
            authorized: true,
            authority_type: 'manager'
        };
    }

    if (trustedContext.requester_has_support_role === true) {
        return {
            authorized: true,
            authority_type: 'support'
        };
    }

    if (trustedContext.requester_has_resource_owner_role === true) {
        return {
            authorized: true,
            authority_type: 'resource_owner'
        };
    }

    return {
        authorized: false,
        reason: 'requester_authority_not_verified'
    };
}

function buildDecision(params) {
    if (!ALLOWED_POLICY_DECISIONS.has(params.decision)) {
        throw new Error(
            `Policy Validation Error: invalid decision ${params.decision}`
        );
    }

    return {
        policy_decision: params.decision,
        policy_reasons: params.reasons || [],
        evaluated_rules: params.evaluated_rules || [],
        authorization_source: params.authorization_source || 'runtime_context',
        approval_record: params.approval_record || null,
        evaluated_at: new Date().toISOString(),
        allow_execution:
            params.decision === 'approved' ||
            params.decision === 'allowed_without_approval',
        requires_approval:
            params.decision === 'approval_required' ||
            params.decision === 'approval_pending',
        blocked:
            params.decision === 'rejected' ||
            params.decision === 'manual_review' ||
            params.decision === 'out_of_scope' ||
            params.decision === 'blocked_by_runtime_guardrail'
    };
}

function getRequestedOperation(request) {
    if (request.operation) {
        return String(request.operation).toLowerCase();
    }

    const action = String(request.requested_action || '').toLowerCase();

    if (action.includes('remove')) {
        return 'remove';
    }

    if (action.includes('add')) {
        return 'add';
    }

    return null;
}

function isExpired(expiresAt) {
    if (!expiresAt) {
        return false;
    }

    const parsed = Date.parse(expiresAt);
    if (Number.isNaN(parsed)) {
        return false;
    }

    return parsed < Date.now();
}

module.exports = {
    evaluatePolicy
};