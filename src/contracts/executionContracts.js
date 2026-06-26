const EXECUTION_STATES = Object.freeze({
    SIMULATED: 'SIMULATED',
    SUCCESS: 'SUCCESS',
    FAILED: 'FAILED',
    PARTIAL: 'PARTIAL'
});

const VERIFICATION_STATES = Object.freeze({
    PASSED: 'PASSED',
    FAILED: 'FAILED',
    PENDING: 'PENDING',
    NOT_REQUIRED: 'NOT_REQUIRED',
    NOT_RUN: 'NOT_RUN',
    INCONCLUSIVE: 'INCONCLUSIVE'
});

const ROLLBACK_STATES = Object.freeze({
    NOT_NEEDED: 'NOT_NEEDED',
    NOT_ALLOWED: 'NOT_ALLOWED',
    NOT_RUN: 'NOT_RUN',
    EXECUTED: 'EXECUTED',
    FAILED: 'FAILED'
});

function buildExecutionDecision({
    requestId,
    correlationId,
    actionFamily,
    requestedAction,
    riskTier = null,
    approvalState = null,
    identityMode = null,
    allowed,
    routeToAgent = null,
    verificationRequired = true,
    rollbackAllowed = false,
    blastRadius = null,
    reason = null
}) {
    return {
        requestId,
        correlationId,
        actionFamily,
        requestedAction,
        riskTier,
        approvalState,
        identityMode,
        allowed,
        routeToAgent,
        verificationRequired,
        rollbackAllowed,
        blastRadius,
        reason,
        decidedAt: new Date().toISOString()
    };
}

function buildExecutionResult({
    requestId,
    correlationId,
    executionId = null,
    agent,
    operation,
    executionState,
    verificationState = null,
    rollbackState = null,
    evidence = {},
    details = {}
}) {
    return {
        requestId,
        correlationId,
        executionId,
        agent,
        operation,
        executionState,
        verificationState,
        rollbackState,
        evidence,
        details,
        completedAt: new Date().toISOString()
    };
}

function buildExecutionFailure({
    requestId,
    correlationId,
    executionId = null,
    agent,
    operation,
    failureClass,
    retryEligible = false,
    containmentTaken = false,
    escalationTarget = null,
    evidence = {},
    details = {}
}) {
    return {
        requestId,
        correlationId,
        executionId,
        agent,
        operation,
        failureClass,
        retryEligible,
        containmentTaken,
        escalationTarget,
        evidence,
        details,
        failedAt: new Date().toISOString()
    };
}

function buildVerificationResult({
    requestId,
    correlationId,
    executionId = null,
    actionFamily,
    riskTier = null,
    verificationState,
    verified,
    verifier,
    failureClass = null,
    evidence = {},
    details = {}
}) {
    return {
        requestId,
        correlationId,
        executionId,
        actionFamily,
        riskTier,
        verificationState,
        verified,
        verifier,
        failureClass,
        evidence,
        details,
        checkedAt: new Date().toISOString()
    };
}

function buildRollbackResult({
    requestId,
    correlationId,
    executionId = null,
    actionFamily,
    rollbackState,
    rolledBack,
    rollbackAgent,
    evidence = {},
    details = {}
}) {
    return {
        requestId,
        correlationId,
        executionId,
        actionFamily,
        rollbackState,
        rolledBack,
        rollbackAgent,
        evidence,
        details,
        completedAt: new Date().toISOString()
    };
}

function buildRollbackFailure({
    requestId,
    correlationId,
    executionId = null,
    actionFamily,
    rollbackAgent,
    failureClass,
    escalationTarget,
    evidence = {},
    details = {}
}) {
    return {
        requestId,
        correlationId,
        executionId,
        actionFamily,
        rollbackState: ROLLBACK_STATES.FAILED,
        rolledBack: false,
        rollbackAgent,
        failureClass,
        escalationTarget,
        evidence,
        details,
        failedAt: new Date().toISOString()
    };
}

module.exports = {
    EXECUTION_STATES,
    VERIFICATION_STATES,
    ROLLBACK_STATES,
    buildExecutionDecision,
    buildExecutionResult,
    buildExecutionFailure,
    buildVerificationResult,
    buildRollbackResult,
    buildRollbackFailure
};