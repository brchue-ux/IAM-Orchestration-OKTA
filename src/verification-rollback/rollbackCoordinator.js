// =====================================
// ROLLBACK COORDINATOR
// =====================================
// Purpose:
// Invoke the correct rollback agent after a failed verification
// when rollback is allowed by policy.
//
// Design goals:
// - bounded rollback by action family
// - no rollback unless policy explicitly allows it
// - structured rollback result / failure output
// - evidence-bearing logging for auditability
// =====================================

const { getRollbackAgent } = require('../execution-control/agentRegistry');
const { getActionFamily } = require('../execution-control/runtimePolicy');
const {
    buildRollbackResult,
    buildRollbackFailure
} = require('../contracts/executionContracts');

// =====================================
// LOG HELPER
// =====================================
function emitLog(context, eventName, fields = {}, severity = 'Information') {
    const envelope = {
        schemaVersion: '1.0',
        component: 'rollbackCoordinator.js',
        eventName,
        severity,
        timestamp: new Date().toISOString(),
        requestId: fields.requestId || null,
        correlationId: fields.correlationId || null,
        actionFamily: fields.actionFamily || null,
        rollbackAgent: fields.rollbackAgent || null,
        rollbackState: fields.rollbackState || null,
        details: fields.details || fields
    };

    if (context?.log) {
        context.log(JSON.stringify(envelope));
    }
}

// =====================================
// RESOLVE ACTION FAMILY
// =====================================
function resolveActionFamily(record, executionResult) {
    if (executionResult?.actionFamily) {
        return executionResult.actionFamily;
    }

    return getActionFamily(record);
}

// =====================================
// MAIN ROLLBACK FUNCTION
// =====================================
async function executeRollback(record, executionResult, verificationPolicy, context = {}) {
    const actionFamily = resolveActionFamily(record, executionResult);
    const executionId = executionResult?.executionId || null;

    // ---------------------------------
    // 1. POLICY CHECK
    // ---------------------------------
    if (!verificationPolicy?.rollbackAllowed) {
        const notAllowed = buildRollbackResult({
            requestId: record.requestId || null,
            correlationId: record.correlation_id || record.correlationId || null,
            executionId,
            actionFamily,
            rollbackState: 'NOT_ALLOWED',
            rolledBack: false,
            rollbackAgent: null,
            evidence: {},
            details: {
                reason: 'Rollback not allowed by policy'
            }
        });

        emitLog(context, 'IAM_ROLLBACK_SKIPPED', notAllowed, 'Warning');
        return notAllowed;
    }

    // ---------------------------------
    // 2. AGENT REGISTRATION CHECK
    // ---------------------------------
    const rollbackAgentName = verificationPolicy.rollbackAgent || null;

    if (
        rollbackAgentName &&
        verificationPolicy.rollbackAgentRegistered === false
    ) {
        const failure = buildRollbackFailure({
            requestId: record.requestId || null,
            correlationId: record.correlation_id || record.correlationId || null,
            executionId,
            actionFamily,
            rollbackAgent: rollbackAgentName,
            failureClass: 'ROLLBACK_AGENT_NOT_REGISTERED',
            escalationTarget:
                verificationPolicy.escalationTarget || 'IAM_OPERATIONS',
            evidence: {},
            details: {
                reason: `Rollback agent ${rollbackAgentName} is not registered`
            }
        });

        emitLog(context, 'IAM_ROLLBACK_FAILED', failure, 'Error');
        return failure;
    }

    const rollbackAgentDef = rollbackAgentName
        ? getRollbackAgent(rollbackAgentName)
        : null;

    if (!rollbackAgentDef || typeof rollbackAgentDef.handler !== 'function') {
        const failure = buildRollbackFailure({
            requestId: record.requestId || null,
            correlationId: record.correlation_id || record.correlationId || null,
            executionId,
            actionFamily,
            rollbackAgent: rollbackAgentName,
            failureClass: 'ROLLBACK_HANDLER_NOT_IMPLEMENTED',
            escalationTarget:
                verificationPolicy.escalationTarget || 'IAM_OPERATIONS',
            evidence: {},
            details: {
                reason: 'Rollback agent handler not implemented'
            }
        });

        emitLog(context, 'IAM_ROLLBACK_FAILED', failure, 'Error');
        return failure;
    }

    // ---------------------------------
    // 3. EXECUTE ROLLBACK
    // ---------------------------------
    try {
        const rollbackResponse = await rollbackAgentDef.handler(
            record,
            executionResult,
            context
        );

        const result = buildRollbackResult({
            requestId: record.requestId || null,
            correlationId: record.correlation_id || record.correlationId || null,
            executionId,
            actionFamily,
            rollbackState: rollbackResponse?.rollbackState || 'EXECUTED',
            rolledBack: rollbackResponse?.rolledBack === true,
            rollbackAgent:
                rollbackResponse?.rollbackAgent || rollbackAgentDef.agentName,
            evidence: rollbackResponse?.evidence || {},
            details: rollbackResponse?.details || {}
        });

        emitLog(context, 'IAM_ROLLBACK_COMPLETED', result);
        return result;
    } catch (error) {
        const failure = buildRollbackFailure({
            requestId: record.requestId || null,
            correlationId: record.correlation_id || record.correlationId || null,
            executionId,
            actionFamily,
            rollbackAgent: rollbackAgentName,
            failureClass: error.failureClass || 'ROLLBACK_FAILURE',
            escalationTarget:
                error.escalationTarget ||
                verificationPolicy.escalationTarget ||
                'IAM_OPERATIONS',
            evidence: error.evidence || {},
            details: {
                message: error.message
            }
        });

        emitLog(context, 'IAM_ROLLBACK_FAILED', failure, 'Error');
        return failure;
    }
}

// =====================================
// EXPORT
// =====================================
module.exports = {
    executeRollback
};