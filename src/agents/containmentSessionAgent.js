
'use strict';

/**
 * ContainmentSessionAgent
 *
 * Session revocation / containment agent.
 * This implementation is a governed simulation stub for Wave 2.
 */

function normalizeContainmentAction(request = {}) {
    const action = String(request.containment_action || request.requested_action || '').trim().toLowerCase();
    if (action.includes('reauth')) return 'force_reauthentication';
    if (action.includes('revoke')) return 'revoke_sessions';
    return action || 'revoke_sessions';
}

function validateRequest(request = {}) {
    const missing = [];
    if (!request.target_identity && !request.target_user_identifier) missing.push('target_identity');
    if (!request.containment_reason) missing.push('containment_reason');
    if (!request.expected_postcondition) missing.push('expected_postcondition');
    return missing;
}

/**
 * Execute approved containment action in simulation mode.
 *
 * @param {object} request Normalized request object.
 * @param {object} context Optional runtime context.
 * @returns {object} Execution decision and result bundle.
 */
async function execute(request = {}, context = {}) {
    if (context?.log) {
        context.log('ContainmentSessionAgent: execution started');
    }

    const missing = validateRequest(request);
    if (missing.length > 0) {
        return {
            allowed: false,
            executionResult: {
                executionState: 'FAILED',
                errorClassification: 'INPUT_VALIDATION_FAILED',
                message: `Missing required fields: ${missing.join(', ')}`,
                timestamp: new Date().toISOString(),
                missingFields: missing
            }
        };
    }

    const containmentAction = normalizeContainmentAction(request);
    const targetIdentity = request.target_identity || request.target_user_identifier;

    return {
        allowed: true,
        executionResult: {
            executionState: 'SUCCESS',
            executionMode: 'WRITE_SIMULATION',
            agentName: 'ContainmentSessionAgent',
            downstreamSystem: request.target_system || 'okta',
            message: `Containment action ${containmentAction} simulated successfully.`,
            timestamp: new Date().toISOString(),
            normalizedInputPayloadHash: request.request_hash || null,
            evidence: {
                target_identity: targetIdentity,
                containment_action: containmentAction,
                containment_reason: request.containment_reason,
                expected_postcondition: request.expected_postcondition
            }
        }
    };
}

module.exports = {
    execute,
    normalizeContainmentAction,
    validateRequest
};
