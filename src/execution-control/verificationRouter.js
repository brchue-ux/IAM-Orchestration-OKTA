'use strict';

/**
 * verificationRouter
 *
 * Verifies execution results, builds an evidence package,
 * and records a control-plane metric snapshot.
 */

const { appendRequestEvent } = require('../services/requestEventStore');
const { updateRequest } = require('../services/requestRegistryStore');
const { buildEvidencePackage } = require('../services/auditEvidenceAgent');
const { recordControlPlaneSnapshot } = require('../services/metricsService');

function normalizeActionFamily(value) {
    return String(value || '').trim().toLowerCase();
}

function verifyReadOnlyExecution(request = {}, executionResult = {}) {
    return {
        verificationStatus: 'verification_not_required_read_only',
        verificationResult:
            executionResult.executionState === 'SUCCESS'
                ? 'verified_success'
                : 'verified_failure',
        verificationMethod: 'read_only_simulation_check',
        observedState: 'no_state_change_expected',
        expectedState:
            request.expected_postcondition || 'Read-only lookup completed safely.'
    };
}

function verifyWriteExecution(request = {}, executionResult = {}) {
    const success = executionResult.executionState === 'SUCCESS';

    return {
        verificationStatus: success ? 'verified_success' : 'verified_failure',
        verificationResult: success ? 'verified_success' : 'verified_failure',
        verificationMethod: 'simulation_execution_result_check',
        observedState: success
            ? 'simulation_state_change_completed'
            : 'simulation_state_change_failed',
        expectedState: request.expected_postcondition || null
    };
}

async function persistVerification(
    correlationId,
    verification = {},
    finalStatus,
    evidencePackage
) {
    await updateRequest(
        correlationId,
        {
            current_status:
                finalStatus === 'COMPLETED_VERIFIED'
                    ? 'completed_verified'
                    : 'failed',
            current_step: 'VERIFICATION_COMPLETED',
            waiting_on: null,
            verification_method: verification.verificationMethod,
            verification_result: verification.verificationResult,
            verification_status: verification.verificationStatus,
            final_status: finalStatus,
            completion_status: finalStatus,
            details: {
                verification,
                evidence_package_summary: {
                    correlation_id: evidencePackage?.correlation_id || null,
                    request_id: evidencePackage?.request_id || null,
                    action_family: evidencePackage?.action_family || null
                }
            }
        },
        'VerificationRouter'
    );
}

async function appendVerificationEvent(
    correlationId,
    verification = {},
    finalStatus,
    evidencePackage
) {
    await appendRequestEvent({
        correlation_id: correlationId,
        event_name: 'VERIFICATION_COMPLETED',
        from_status: 'verification_pending',
        to_status: finalStatus,
        actor: 'VerificationRouter',
        event_details: {
            verification,
            final_status: finalStatus,
            evidence_package_summary: {
                correlation_id: evidencePackage?.correlation_id || null,
                request_id: evidencePackage?.request_id || null,
                action_family: evidencePackage?.action_family || null
            }
        }
    });
}

async function routeVerification(request = {}, executionResult = {}, context = {}) {
    const actionFamily = normalizeActionFamily(request.action_family);

    if (context?.log) {
        context.log(`VerificationRouter: verifying ${actionFamily}`);
    }

    const verification =
        actionFamily === 'read_only_lookup'
            ? verifyReadOnlyExecution(request, executionResult)
            : verifyWriteExecution(request, executionResult);

    const finalStatus =
        verification.verificationResult === 'verified_success'
            ? 'COMPLETED_VERIFIED'
            : 'failed';

    const evidencePackage = await buildEvidencePackage(
        request.correlation_id,
        executionResult
    );

    await persistVerification(
        request.correlation_id,
        verification,
        finalStatus,
        evidencePackage
    );

    await appendVerificationEvent(
        request.correlation_id,
        verification,
        finalStatus,
        evidencePackage
    );

    const metricSnapshot = await recordControlPlaneSnapshot();

    return {
        execution: executionResult,
        verification: {
            verificationStatus: verification.verificationStatus,
            verificationResult: verification.verificationResult,
            verificationMethod: verification.verificationMethod,
            expectedState: verification.expectedState,
            observedState: verification.observedState,
            metricSnapshot
        },
        completion: {
            finalStatus,
            message:
                finalStatus === 'COMPLETED_VERIFIED'
                    ? 'Execution completed and verification checks passed.'
                    : 'Execution did not meet verification requirements.',
            evidencePackage
        }
    };
}

module.exports = {
    routeVerification,
    verifyReadOnlyExecution,
    verifyWriteExecution,
    normalizeActionFamily
};