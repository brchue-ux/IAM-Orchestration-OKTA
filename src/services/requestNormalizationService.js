/**
 into a strict normalized IAM request object. * Request Normalization Service
 * This service does not perform policy decisions or execution.
 */

function normalizeRequest(rawInput) {
    if (!rawInput || typeof rawInput !== 'object') {
        throw new Error('Normalization Error: rawInput must be an object');
    }

    const correlation_id = rawInput.correlation_id || generateId('corr');
    const request_id = rawInput.request_id || generateId('req');

    const target_identity =
        rawInput.target_identity ||
        rawInput.target_user_identifier ||
        null;

    const target_identifier_type =
        rawInput.target_identifier_type ||
        (rawInput.target_user_identifier ? 'okta_user_id' : 'unknown');

    const requested_action =
        rawInput.requested_action ||
        inferRequestedAction(rawInput);

    const action_family =
        rawInput.action_family ||
        inferActionFamily(rawInput);

    const normalized = {
        correlation_id,
        request_id,

        requester_identity: rawInput.requester_identity || null,
        requester_source: rawInput.requester_source || 'api',
        requester_tenant_or_domain:
            rawInput.requester_tenant_or_domain || 'unknown',

        target_identity,
        target_identifier_type,
        target_system: rawInput.target_system || 'okta',

        requested_action,
        action_family,

        risk_tier: rawInput.risk_tier || 'low',
        business_justification:
            rawInput.business_justification || 'not_provided',
        urgency: rawInput.urgency || 'normal',
        requested_duration: rawInput.requested_duration || null,
        approval_requirement:
            rawInput.approval_requirement || 'required',

        normalized_status: 'ready_for_validation',
        current_status: 'draft',
        final_status: null,

        created_timestamp: new Date().toISOString(),
        source_channel: rawInput.source_channel || 'api',

        expected_postcondition:
            rawInput.expected_postcondition ||
            buildExpectedPostcondition(rawInput),

        target_user_identifier: rawInput.target_user_identifier || null,
        group_identifier: rawInput.group_identifier || null,
        operation: rawInput.operation
            ? String(rawInput.operation).toLowerCase()
            : inferOperation(rawInput),

        group_risk_class: rawInput.group_risk_class || 'standard',
        approval_reference: rawInput.approval_reference || null,
        approved_by: rawInput.approved_by || null,
        completion_message: rawInput.completion_message || null,

        requester_authorization_source: null,
        policy_decision: null,
        policy_reasons: [],
        approval_record: null
    };

    validateNormalizedRequest(normalized);

    return normalized;
}

function inferActionFamily(input) {
    if (input.group_identifier || input.target_user_identifier) {
        return 'group_membership_fulfillment';
    }

    return 'unknown';
}

function inferRequestedAction(input) {
    const operation = inferOperation(input);

    if (input.group_identifier && operation === 'add') {
        return 'add_user_to_group';
    }

    if (input.group_identifier && operation === 'remove') {
        return 'remove_user_from_group';
    }

    return 'unknown_action';
}

function inferOperation(input) {
    if (input.operation) {
        return String(input.operation).toLowerCase();
    }

    const requestedAction = String(input.requested_action || '').toLowerCase();

    if (requestedAction.includes('remove')) {
        return 'remove';
    }

    if (requestedAction.includes('add')) {
        return 'add';
    }

    return null;
}

function buildExpectedPostcondition(input) {
    if (input.group_identifier && input.target_user_identifier) {
        return {
            type: 'group_membership',
            group_identifier: input.group_identifier,
            target_user_identifier: input.target_user_identifier,
            expected_state: 'member'
        };
    }

    return {
        type: 'unknown',
        expected_state: 'undefined'
    };
}

function validateNormalizedRequest(request) {
    const requiredFields = [
        'correlation_id',
        'request_id',
        'requester_identity',
        'target_identity',
        'target_system',
        'requested_action',
        'action_family',
        'approval_requirement',
        'normalized_status',
        'created_timestamp',
        'source_channel',
        'expected_postcondition'
    ];

    for (const field of requiredFields) {
        if (!request[field]) {
            throw new Error(
                `Normalization Error: missing required field ${field}`
            );
        }
    }

    if (request.action_family === 'group_membership_fulfillment') {
        const groupFields = [
            'target_user_identifier',
            'group_identifier',
            'operation',
            'business_justification',
            'expected_postcondition'
        ];

        for (const field of groupFields) {
            if (!request[field]) {
                throw new Error(
                    `Normalization Error: missing group membership field ${field}`
                );
            }
        }
    }
}

function generateId(prefix) {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

module.exports = {
    normalizeRequest
};