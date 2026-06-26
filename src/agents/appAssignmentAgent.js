
'use strict';

/**
 * AppAssignmentAgent
 *
 * Approved application assignment / unassignment agent.
 * This implementation is a governed simulation stub for Wave 2.
 */

function normalizeOperation(request = {}) {
    const operation = String(request.operation || '').trim().toLowerCase();
    if (operation === 'assign' || operation === 'unassign') {
        return operation;
    }

    const action = String(request.requested_action || '').toLowerCase();
    if (action.includes('unassign') || action.includes('remove')) {
        return 'unassign';
    }
    return 'assign';
}

function validateRequest(request = {}) {
    const missing = [];
    if (!request.target_identity && !request.target_user_identifier) missing.push('target_identity');
    if (!request.app_identifier && !request.target_resource) missing.push('app_identifier');
    if (!request.expected_postcondition) missing.push('expected_postcondition');
    return missing;
}

/**
 * Execute approved app assignment in simulation mode.
 *
 * @param {object} request Normalized request object.
 * @param {object} context Optional runtime context.
 * @returns {object} Execution decision and result bundle.
 */
async function execute(request = {}, context = {}) {
    if (context?.log) {
        context.log('AppAssignmentAgent: execution started');
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

    const operation = normalizeOperation(request);
    const appIdentifier = request.app_identifier || request.target_resource;
    const targetIdentity = request.target_identity || request.target_user_identifier;

    return {
        allowed: true,
        executionResult: {
            executionState: 'SUCCESS',
            executionMode: 'WRITE_SIMULATION',
            agentName: 'AppAssignmentAgent',
            downstreamSystem: request.target_system || 'okta',
            message: `Application ${operation} simulated successfully.`,
            timestamp: new Date().toISOString(),
            normalizedInputPayloadHash: request.request_hash || null,
            evidence: {
                target_identity: targetIdentity,
                app_identifier: appIdentifier,
                operation,
                expected_postcondition: request.expected_postcondition
            }
        }
    };
}

module.exports = {
    execute,
    normalizeOperation,
    validateRequest
};
