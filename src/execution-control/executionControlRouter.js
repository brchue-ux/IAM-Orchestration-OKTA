const { getAgentByFamily } = require('./agentRegistry');
const {
    getActionFamily,
    isExecutionEnabledForFamily,
    evaluateBlastRadius,
    evaluateEnvironmentGate,
    evaluateApprovalGate
} = require('./runtimePolicy');
const { getVerificationPolicy } = require('./verificationPolicy');
const {
    EXECUTION_STATES,
    VERIFICATION_STATES,
    ROLLBACK_STATES,
    buildExecutionDecision,
    buildExecutionResult,
    buildExecutionFailure
} = require('../contracts/executionContracts');

// ==============================
// CONTROL-PLANE LOGGING
// ==============================
function emitLog(context, eventName, fields = {}, severity = 'Information') {
    const envelope = {
        schemaVersion: '1.0',
        component: 'executionControlRouter.js',
        eventName,
        severity,
        timestamp: new Date().toISOString(),

        requestId: fields.requestId || null,
        correlationId: fields.correlationId || null,
        actionFamily: fields.actionFamily || null,
        routeToAgent: fields.routeToAgent || null,
        identityMode: fields.identityMode || null,
        status: fields.status || null,

        details: fields.details || fields
    };

    if (context?.log) {
        context.log(JSON.stringify(envelope));
    }
}

function createExecutionId(record) {
    const safeRequestId = record?.requestId || 'unknown-request';
    return `${safeRequestId}-${Date.now()}`;
}

// ==============================
// EXECUTION CONTROL ROUTER
// ==============================
async function executeWithControl(record, context) {
    const actionFamily = getActionFamily(record);
    const executionId = createExecutionId(record);
    const verificationPolicy = getVerificationPolicy(actionFamily);

    const agentDef = getAgentByFamily(actionFamily);

    // ------------------------------
    // 0. BASIC ACTION / POLICY SANITY
    // ------------------------------
    if (!actionFamily) {
        const decision = buildExecutionDecision({
            requestId: record.requestId,
            correlationId: record.correlationId,
            actionFamily: null,
            requestedAction: record.action,
            riskTier: record.policy?.riskTier || null,
            approvalState: record.status,
            identityMode: null,
            allowed: false,
            routeToAgent: null,
            verificationRequired: true,
            rollbackAllowed: false,
            reason: 'Unable to resolve action family from request.'
        });

        emitLog(context, 'IAM_ECL_POLICY_BLOCKED', decision, 'Warning');
        return { decision, blocked: true };
    }

    // ------------------------------
    // 1. AGENT RESOLUTION
    // ------------------------------
    if (!agentDef) {
        const decision = buildExecutionDecision({
            requestId: record.requestId,
            correlationId: record.correlationId,
            actionFamily,
            requestedAction: record.action,
            riskTier: record.policy?.riskTier || null,
            approvalState: record.status,
            identityMode: null,
            allowed: false,
            routeToAgent: null,
            verificationRequired: verificationPolicy.verificationRequired,
            rollbackAllowed: verificationPolicy.rollbackAllowed,
            reason: `No registered execution agent for action family: ${actionFamily}`
        });

        emitLog(context, 'IAM_ECL_POLICY_BLOCKED', decision, 'Warning');
        return { decision, blocked: true };
    }

    // ------------------------------
    // 2. AGENT-LEVEL ACTION GUARDRAILS
    // ------------------------------
    const actionAllowed =
        !Array.isArray(agentDef.allowedActions) ||
        agentDef.allowedActions.includes(record.action);

    const actionProhibited =
        Array.isArray(agentDef.prohibitedActions) &&
        agentDef.prohibitedActions.includes(record.action);

    if (!actionAllowed || actionProhibited) {
        const decision = buildExecutionDecision({
            requestId: record.requestId,
            correlationId: record.correlationId,
            actionFamily,
            requestedAction: record.action,
            riskTier: record.policy?.riskTier || null,
            approvalState: record.status,
            identityMode: agentDef.identityMode || null,
            allowed: false,
            routeToAgent: agentDef.agentName,
            verificationRequired: verificationPolicy.verificationRequired,
            rollbackAllowed: verificationPolicy.rollbackAllowed,
            reason: `Requested action ${record.action} is not permitted for ${agentDef.agentName}`
        });

        emitLog(context, 'IAM_ECL_POLICY_BLOCKED', decision, 'Warning');
        return { decision, blocked: true };
    }

    // ------------------------------
    // 3. ENVIRONMENT GATE
    // ------------------------------
    const envGate = evaluateEnvironmentGate(record, agentDef);
    if (!envGate.allowed) {
        const decision = buildExecutionDecision({
            requestId: record.requestId,
            correlationId: record.correlationId,
            actionFamily,
            requestedAction: record.action,
            riskTier: record.policy?.riskTier || null,
            approvalState: record.status,
            identityMode: agentDef.identityMode,
            allowed: false,
            routeToAgent: agentDef.agentName,
            verificationRequired: verificationPolicy.verificationRequired,
            rollbackAllowed: verificationPolicy.rollbackAllowed,
            reason: envGate.reason
        });

        emitLog(context, 'IAM_ECL_POLICY_BLOCKED', decision, 'Warning');
        return { decision, blocked: true };
    }

    // ------------------------------
    // 4. APPROVAL GATE
    // ------------------------------
    const approvalGate = evaluateApprovalGate(record, agentDef);
    if (!approvalGate.allowed) {
        const decision = buildExecutionDecision({
            requestId: record.requestId,
            correlationId: record.correlationId,
            actionFamily,
            requestedAction: record.action,
            riskTier: record.policy?.riskTier || null,
            approvalState: approvalGate.approvalState || record.status,
            identityMode: agentDef.identityMode,
            allowed: false,
            routeToAgent: agentDef.agentName,
            verificationRequired: verificationPolicy.verificationRequired,
            rollbackAllowed: verificationPolicy.rollbackAllowed,
            reason: approvalGate.reason
        });

        emitLog(context, 'IAM_ECL_POLICY_BLOCKED', decision, 'Warning');
        return { decision, blocked: true };
    }

    // ------------------------------
    // 5. BLAST RADIUS CHECK
    // ------------------------------
    const blastRadius = evaluateBlastRadius(record, agentDef);
    if (!blastRadius.allowed) {
        const decision = buildExecutionDecision({
            requestId: record.requestId,
            correlationId: record.correlationId,
            actionFamily,
            requestedAction: record.action,
            riskTier: record.policy?.riskTier || null,
            approvalState: record.status,
            identityMode: agentDef.identityMode,
            allowed: false,
            routeToAgent: agentDef.agentName,
            verificationRequired: verificationPolicy.verificationRequired,
            rollbackAllowed: verificationPolicy.rollbackAllowed,
            reason: blastRadius.reason,
            blastRadius
        });

        emitLog(context, 'IAM_ECL_POLICY_BLOCKED', decision, 'Warning');
        return { decision, blocked: true };
    }

    // ------------------------------
    // 6. VERIFICATION POLICY SANITY
    // ------------------------------
    if (
        verificationPolicy.verificationRequired &&
        !verificationPolicy.verificationAgentRegistered
    ) {
        const decision = buildExecutionDecision({
            requestId: record.requestId,
            correlationId: record.correlationId,
            actionFamily,
            requestedAction: record.action,
            riskTier: record.policy?.riskTier || null,
            approvalState: record.status,
            identityMode: agentDef.identityMode,
            allowed: false,
            routeToAgent: agentDef.agentName,
            verificationRequired: true,
            rollbackAllowed: verificationPolicy.rollbackAllowed,
            reason: `Verification agent ${verificationPolicy.verificationAgent} is not registered`
        });

        emitLog(context, 'IAM_ECL_POLICY_BLOCKED', decision, 'Warning');
        return { decision, blocked: true };
    }

    if (
        verificationPolicy.rollbackAllowed &&
        verificationPolicy.rollbackAgent &&
        !verificationPolicy.rollbackAgentRegistered
    ) {
        const decision = buildExecutionDecision({
            requestId: record.requestId,
            correlationId: record.correlationId,
            actionFamily,
            requestedAction: record.action,
            riskTier: record.policy?.riskTier || null,
            approvalState: record.status,
            identityMode: agentDef.identityMode,
            allowed: false,
            routeToAgent: agentDef.agentName,
            verificationRequired: verificationPolicy.verificationRequired,
            rollbackAllowed: true,
            reason: `Rollback agent ${verificationPolicy.rollbackAgent} is not registered`
        });

        emitLog(context, 'IAM_ECL_POLICY_BLOCKED', decision, 'Warning');
        return { decision, blocked: true };
    }

    // ------------------------------
    // 7. DECISION
    // ------------------------------
    const executionEnabled = isExecutionEnabledForFamily(actionFamily);

    const decision = buildExecutionDecision({
        requestId: record.requestId,
        correlationId: record.correlationId,
        actionFamily,
        requestedAction: record.action,
        riskTier: record.policy?.riskTier || null,
        approvalState: record.status,
        identityMode: agentDef.identityMode,
        allowed: true,
        routeToAgent: agentDef.agentName,
        verificationRequired: verificationPolicy.verificationRequired,
        rollbackAllowed: verificationPolicy.rollbackAllowed,
        blastRadius
    });

    emitLog(context, 'IAM_ECL_DECISION', decision);

    // ------------------------------
    // 8. SIMULATION MODE
    // ------------------------------
    if (!executionEnabled) {
        emitLog(
            context,
            'IAM_ECL_SIMULATION_ONLY',
            {
                requestId: record.requestId,
                correlationId: record.correlationId,
                actionFamily,
                routeToAgent: agentDef.agentName
            },
            'Warning'
        );

        return {
            decision,
            simulated: true,
            result: buildExecutionResult({
                requestId: record.requestId,
                correlationId: record.correlationId,
                executionId,
                agent: agentDef.agentName,
                operation: record.action,
                executionState: EXECUTION_STATES.SIMULATED,
                verificationState: verificationPolicy.verificationRequired
                    ? VERIFICATION_STATES.PENDING
                    : VERIFICATION_STATES.NOT_REQUIRED,
                rollbackState: verificationPolicy.rollbackAllowed
                    ? ROLLBACK_STATES.NOT_RUN
                    : ROLLBACK_STATES.NOT_ALLOWED,
                evidence: {},
                details: {
                    mode: 'SIMULATION_ONLY'
                }
            })
        };
    }

    // ------------------------------
    // 9. ROUTE TO EXECUTION AGENT
    // ------------------------------
    emitLog(context, 'IAM_ECL_ROUTE_SELECTED', {
        requestId: record.requestId,
        correlationId: record.correlationId,
        actionFamily,
        routeToAgent: agentDef.agentName
    });

    // ------------------------------
    // 10. EXECUTION
    // ------------------------------
    try {
        const agentResult = await agentDef.handler(record, context);

        const result = buildExecutionResult({
            requestId: record.requestId,
            correlationId: record.correlationId,
            executionId,
            agent: agentDef.agentName,
            operation: record.action,
            executionState: agentResult?.executionState || EXECUTION_STATES.SUCCESS,
            verificationState:
                agentResult?.verificationState ||
                (verificationPolicy.verificationRequired
                    ? VERIFICATION_STATES.PENDING
                    : VERIFICATION_STATES.NOT_REQUIRED),
            rollbackState:
                agentResult?.rollbackState ||
                (verificationPolicy.rollbackAllowed
                    ? ROLLBACK_STATES.NOT_RUN
                    : ROLLBACK_STATES.NOT_ALLOWED),
            evidence: agentResult?.evidence || {},
            details: agentResult?.details || {}
        });

        emitLog(context, 'IAM_ECL_EXECUTION_COMPLETED', result);

        return {
            decision,
            simulated: false,
            result
        };
    } catch (error) {
        // ------------------------------
        // 11. FAILURE HANDLING
        // ------------------------------
        const failure = buildExecutionFailure({
            requestId: record.requestId,
            correlationId: record.correlationId,
            executionId,
            agent: agentDef.agentName,
            operation: record.action,
            failureClass: error.failureClass || 'GENERAL_FAILURE',
            retryEligible: !!error.retryEligible,
            containmentTaken: !!error.containmentTaken,
            escalationTarget:
                error.escalationTarget ||
                verificationPolicy.escalationTarget ||
                'IAM_OPERATIONS',
            evidence: error.evidence || {},
            details: {
                message: error.message
            }
        });

        emitLog(context, 'IAM_ECL_EXECUTION_FAILED', failure, 'Error');

        return {
            decision,
            simulated: false,
            error: failure
        };
    }
}

module.exports = {
    executeWithControl
};