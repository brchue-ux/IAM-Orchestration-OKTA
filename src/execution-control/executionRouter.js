
'use strict';

/**
 * executionRouter
 *
 * Wave 4 execution router with temporary-access scheduling and privileged lane routing.
 * Intended location: src/execution-control/executionRouter.js
 */

const { appendRequestEvent } = require('../services/requestEventStore');
const { updateRequest } = require('../services/requestRegistryStore');
const { scheduleTemporaryAccess } = require('../services/temporaryAccessScheduler');

const readOnlyStatusAgent = require('../agents/readOnlyStatusAgent');
const accessGroupFulfillmentAgent = require('../agents/AccessGroupFulfillmentAgent');
const appAssignmentAgent = require('../agents/appAssignmentAgent');
const userLifecycleStateAgent = require('../agents/userLifecycleStateAgent');
const containmentSessionAgent = require('../agents/containmentSessionAgent');
const privilegedAccessLane = require('../agents/privilegedAccessLane');
const accessReviewSupportAgent = require('../agents/accessReviewSupportAgent');

function normalizeActionFamily(value) {
    return String(value || '').trim().toLowerCase();
}

function isTemporaryAccessRequest(request = {}) {
    return Boolean(request.requested_duration || request.temporary_duration);
}

function isPrivilegedExecutionRequest(request = {}) {
    return Boolean(request.privileged_target) || ['high', 'critical'].includes(normalizeActionFamily(request.risk_tier));
}

function getBaseAgentForActionFamily(actionFamily) {
    switch (normalizeActionFamily(actionFamily)) {
        case 'read_only_lookup':
            return { name: 'ReadOnlyStatusAgent', agent: readOnlyStatusAgent, writeAction: false };
        case 'group_membership':
            return { name: 'AccessGroupFulfillmentAgent', agent: accessGroupFulfillmentAgent, writeAction: true };
        case 'app_assignment':
            return { name: 'AppAssignmentAgent', agent: appAssignmentAgent, writeAction: true };
        case 'user_lifecycle':
            return { name: 'UserLifecycleStateAgent', agent: userLifecycleStateAgent, writeAction: true };
        case 'containment':
            return { name: 'ContainmentSessionAgent', agent: containmentSessionAgent, writeAction: true };
        case 'access_review_support':
            return { name: 'AccessReviewSupportAgent', agent: accessReviewSupportAgent, writeAction: false };
        default:
            return null;
    }
}

async function appendExecutionEvent(correlationId, eventName, fromStatus, toStatus, actor, eventDetails) {
    if (!correlationId) return;

    await appendRequestEvent({
        correlation_id: correlationId,
        event_name: eventName,
        from_status: fromStatus,
        to_status: toStatus,
        actor,
        event_details: eventDetails
    });
}

async function updateExecutionState(correlationId, updates = {}, actor = 'ExecutionRouter') {
    if (!correlationId) return;
    await updateRequest(correlationId, updates, actor);
}

/**
 * Route execution to the correct specialist, including the privileged lane
 * and temporary-access scheduling overlay.
 */
async function routeExecution(request = {}, context = {}) {
    const actionFamily = normalizeActionFamily(request.action_family);

    if (isPrivilegedExecutionRequest(request)) {
        const privilegedDecision = await privilegedAccessLane.execute(request, context);
        return {
            ...privilegedDecision,
            selectedAgent: 'PrivilegedAccessLane',
            actionFamily,
            writeAction: true,
            executionResult: privilegedDecision.executionResult
        };
    }

    const selected = getBaseAgentForActionFamily(actionFamily);
    if (!selected) {
        const failure = {
            allowed: false,
            executionResult: {
                executionState: 'FAILED',
                errorClassification: 'UNSUPPORTED_ACTION_FAMILY',
                message: `No execution agent is registered for action family: ${actionFamily}`,
                timestamp: new Date().toISOString()
            }
        };

        await appendExecutionEvent(
            request.correlation_id,
            'EXECUTION_ROUTING_FAILED',
            request.current_status || 'ready_for_execution',
            'failed',
            'ExecutionRouter',
            failure.executionResult
        );

        await updateExecutionState(request.correlation_id, {
            current_status: 'failed',
            current_step: 'EXECUTION_ROUTING_FAILED',
            waiting_on: null,
            execution_status: 'FAILED'
        });

        return failure;
    }

    if (context?.log) {
        context.log(`ExecutionRouter: selected ${selected.name} for ${actionFamily}`);
    }

    await appendExecutionEvent(
        request.correlation_id,
        'EXECUTION_ROUTED',
        request.current_status || 'ready_for_execution',
        'execution_started',
        'ExecutionRouter',
        {
            action_family: actionFamily,
            selected_agent: selected.name,
            temporary_access_requested: isTemporaryAccessRequest(request)
        }
    );

    await updateExecutionState(request.correlation_id, {
        current_status: 'execution_started',
        current_step: 'EXECUTION_ROUTER',
        waiting_on: selected.name,
        execution_agent: selected.name,
        execution_status: 'execution_started'
    });

    const decision = await selected.agent.execute(request, context);
    const executionResult = decision?.executionResult || {
        executionState: 'FAILED',
        errorClassification: 'EMPTY_EXECUTION_RESULT',
        message: 'Execution agent returned no execution result.',
        timestamp: new Date().toISOString()
    };

    let temporarySchedule = null;
    if (selected.writeAction && executionResult.executionState === 'SUCCESS' && isTemporaryAccessRequest(request)) {
        temporarySchedule = await scheduleTemporaryAccess(request, executionResult);
    }

    const nextStatus = executionResult.executionState === 'SUCCESS' ? 'verification_pending' : 'failed';

    await updateExecutionState(request.correlation_id, {
        current_status: nextStatus,
        current_step: 'EXECUTION_COMPLETED',
        waiting_on: nextStatus === 'verification_pending' ? 'VerificationRouter' : null,
        execution_status: executionResult.executionState,
        details: {
            execution_result: executionResult,
            temporary_access_schedule: temporarySchedule
        }
    });

    await appendExecutionEvent(
        request.correlation_id,
        'EXECUTION_COMPLETED',
        'execution_started',
        nextStatus,
        selected.name,
        {
            execution_result: executionResult,
            temporary_access_schedule: temporarySchedule
        }
    );

    return {
        ...decision,
        selectedAgent: selected.name,
        actionFamily,
        writeAction: selected.writeAction,
        executionResult,
        temporaryAccessSchedule: temporarySchedule
    };
}

module.exports = {
    routeExecution,
    getBaseAgentForActionFamily,
    normalizeActionFamily,
    isTemporaryAccessRequest,
    isPrivilegedExecutionRequest
};
