// =====================================
// COMPLETION AGENT (PRODUCTION)
// =====================================
// Purpose:
// Determine final outcome of IAM request
// and return user-facing completion status.
//
// Design:
// - NEVER declare success without verification
// - Interpret execution + verification + rollback states
// - Produce safe user-facing result
// - Generate completion evidence
// =====================================

function buildCompletionResult({
    status,
    message,
    correlationId,
    actionFamily,
    evidence = {},
    details = {}
}) {
    return {
        correlationId: correlationId || null,
        actionFamily: actionFamily || null,
        finalStatus: status,
        userMessage: message,
        evidence,
        details,
        completedAt: new Date().toISOString()
    };
}

// -------------------------------------
// MAIN COMPLETION FUNCTION
// -------------------------------------
function determineCompletion(record, execution, verification, rollback, context = {}) {
    const correlationId =
        record?.correlation_id ||
        record?.correlationId ||
        null;

    const actionFamily = execution?.actionFamily || null;

    const executionState = execution?.executionState;
    const verificationState = verification?.verificationState;
    const rollbackState = rollback?.rollbackState;

    // ---------------------------------
    // ✅ CASE 1 — VERIFIED SUCCESS
    // ---------------------------------
    if (
        executionState === 'SUCCESS' &&
        verificationState === 'PASSED'
    ) {
        return buildCompletionResult({
            status: 'COMPLETED_VERIFIED',
            message: `The approved action has been completed and verified.`,
            correlationId,
            actionFamily,
            evidence: {
                execution: execution?.evidence || {},
                verification: verification?.evidence || {}
            },
            details: {
                outcome: 'SUCCESS_VERIFIED'
            }
        });
    }

    // ---------------------------------
    // ❌ CASE 2 — ROLLBACK EXECUTED
    // ---------------------------------
    if (
        executionState === 'SUCCESS' &&
        verificationState === 'FAILED' &&
        rollbackState === 'EXECUTED'
    ) {
        return buildCompletionResult({
            status: 'ROLLED_BACK',
            message: `The action was attempted but did not pass verification and has been rolled back for safety.`,
            correlationId,
            actionFamily,
            evidence: {
                execution: execution?.evidence || {},
                verification: verification?.evidence || {},
                rollback: rollback?.evidence || {}
            },
            details: {
                outcome: 'FAILED_AND_ROLLED_BACK'
            }
        });
    }

    // ---------------------------------
    // ⚠️ CASE 3 — VERIFICATION FAILED, NO ROLLBACK
    // ---------------------------------
    if (
        executionState === 'SUCCESS' &&
        verificationState === 'FAILED'
    ) {
        return buildCompletionResult({
            status: 'VERIFICATION_FAILED',
            message: `The action was attempted, but verification did not confirm the expected result. Further review is required.`,
            correlationId,
            actionFamily,
            evidence: {
                execution: execution?.evidence || {},
                verification: verification?.evidence || {}
            },
            details: {
                outcome: 'UNVERIFIED_STATE'
            }
        });
    }

    // ---------------------------------
    // ❌ CASE 4 — EXECUTION FAILED
    // ---------------------------------
    if (executionState === 'FAILED') {
        return buildCompletionResult({
            status: 'EXECUTION_FAILED',
            message: `The request could not be completed due to an execution failure.`,
            correlationId,
            actionFamily,
            evidence: {
                execution: execution?.evidence || {}
            },
            details: {
                outcome: 'EXECUTION_ERROR'
            }
        });
    }

    // ---------------------------------
    // ⚠️ FALLBACK CASE — UNKNOWN STATE
    // ---------------------------------
    return buildCompletionResult({
        status: 'UNKNOWN',
        message: `The request is in an unknown state and requires investigation.`,
        correlationId,
        actionFamily,
        evidence: {},
        details: {
            outcome: 'UNKNOWN_STATE'
        }
    });
}

module.exports = {
    determineCompletion
};