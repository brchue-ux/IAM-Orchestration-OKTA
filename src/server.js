/**
: * IAM API Server
 * - normalization
 * - policy validation
 * - approval lookup
 * - SQL evidence persistence
 * - automatic execution after approval
 * - read-back verification
 */

require('dotenv').config();

const express = require('express');
const { randomUUID } = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const { normalizeRequest } = require('./services/requestNormalizationService');
const { evaluatePolicy } = require('./services/policyValidationService');
const { addUserToGroup } = require('./services/oktaExecutionService');
const { verifyGroupMembership } = require('./services/verificationService');

const {
    upsertRequest,
    insertPolicyDecision,
    insertStatusHistory,
    insertExecutionRun,
    insertVerification,
    testConnection
} = require('./persistence/sqlEvidenceRepository');

const {
    upsertApprovalRecord,
    getApprovalRecordByReference
} = require('./persistence/sqlApprovalRepository');

/**
 * Health check.
 */
app.get('/health', function (req, res) {
    return res.status(200).json({
        status: 'ok'
    });
});

/**
 * Database connection test.
 */
app.get('/test-db', async function (req, res) {
    try {
        const result = await testConnection();

        return res.status(200).json({
            message: 'DB connected',
            data: result
        });
    } catch (error) {
        console.error('❌ DB ERROR:', error);

        return res.status(500).json({
            error: error.message
        });
    }
});

/**
 * Create or update an approval record.
 */
app.post('/test-approval-record', async function (req, res) {
    try {
        const body = req.body;

        if (!body.approval_reference) {
            return res.status(400).json({
                error: 'approval_reference is required'
            });
        }

        if (!body.approver_identity) {
            return res.status(400).json({
                error: 'approver_identity is required'
            });
        }

        if (!body.approval_decision) {
            return res.status(400).json({
                error: 'approval_decision is required'
            });
        }

        await upsertApprovalRecord({
            approval_reference: body.approval_reference,
            approver_identity: body.approver_identity,
            approval_decision: body.approval_decision,
            approval_scope: body.approval_scope || null,
            approval_expires_at: body.approval_expires_at || null,
            approval_evidence_link: body.approval_evidence_link || null,
            requester_identity: body.requester_identity || null,
            target_identity: body.target_identity || null,
            action_family: body.action_family || null
        });

        return res.status(200).json({
            message: 'Approval record saved',
            approval_reference: body.approval_reference
        });
    } catch (error) {
        console.error('❌ ERROR:', error);

        return res.status(500).json({
            error: error.message
        });
    }
});

/**
 * Full automatic request path:
 * normalize -> policy -> approval lookup -> persist -> execute -> verify
 */
app.post('/test-real-group-add', async function (req, res) {
    try {
        const rawInput = req.body;

        // 1) Normalize untrusted input first
        const request = normalizeRequest(rawInput);

        // 2) Approval lookup from SQL (trusted approval source)
        const approvalRecord = request.approval_reference
            ? await getApprovalRecordByReference(request.approval_reference)
            : null;

        // 3) Build trusted runtime context
        const trustedContext = {
            requester_authorization_source: 'api_session',

            requester_is_same_as_target:
                request.requester_identity &&
                request.target_identity &&
                request.requester_identity === request.target_identity,

            requester_is_manager_of_target: false,
            requester_has_support_role: false,
            requester_has_resource_owner_role: false,

            target_is_unique: true,
            target_is_allowed_population: true,
            target_is_privileged: false,

            group_exists: true,
            group_in_approved_scope: true,
            group_is_privileged: false,

            approval_required: true,

            approval_record: approvalRecord
                ? {
                      decision: approvalRecord.approval_decision,
                      approval_reference: approvalRecord.approval_reference,
                      expires_at: approvalRecord.approval_expires_at
                          ? new Date(
                                approvalRecord.approval_expires_at
                            ).toISOString()
                          : null
                  }
                : null
        };

        // 4) Policy evaluation
        const policyResult = evaluatePolicy(request, trustedContext);

        // 5) Attach policy evidence to request
        request.policy_decision = policyResult.policy_decision;
        request.policy_reasons = policyResult.policy_reasons;
        request.requester_authorization_source =
            policyResult.authorization_source;
        request.approval_record = policyResult.approval_record || null;

        // 6) Apply lifecycle status based on policy
        switch (policyResult.policy_decision) {
            case 'allowed_without_approval':
            case 'approved':
                request.normalized_status = 'approved';
                request.current_status = 'ready_for_execution';
                request.final_status = null;
                break;

            case 'approval_required':
                request.normalized_status = 'approval_required';
                request.current_status = 'approval_required';
                request.final_status = null;
                break;

            case 'approval_pending':
                request.normalized_status = 'approval_pending';
                request.current_status = 'approval_pending';
                request.final_status = null;
                break;

            case 'manual_review':
            case 'rejected':
            case 'out_of_scope':
            case 'blocked_by_runtime_guardrail':
                request.normalized_status = 'validation_failed';
                request.current_status = 'validation_failed';
                request.final_status = 'failed';
                break;

            default:
                request.normalized_status = 'validation_failed';
                request.current_status = 'validation_failed';
                request.final_status = 'failed';
                break;
        }

        // 7) Persist request after policy
        await upsertRequest(request);

        await insertPolicyDecision({
            correlation_id: request.correlation_id,
            request_id: request.request_id,
            policy_decision: policyResult.policy_decision,
            policy_reasons: policyResult.policy_reasons,
            evaluated_rules: policyResult.evaluated_rules,
            authorization_source: policyResult.authorization_source,
            approval_record: policyResult.approval_record,
            evaluated_at: policyResult.evaluated_at
        });

        await insertStatusHistory({
            correlation_id: request.correlation_id,
            status_value: request.current_status,
            status_type: 'current_status',
            changed_by: 'policy_validation_service',
            reason: (policyResult.policy_reasons || []).join(', ')
        });

        // 8) Stop if policy blocked execution
        if (policyResult.blocked) {
            return res.status(403).json({
                message: 'Request blocked by policy',
                correlation_id: request.correlation_id,
                decision: policyResult.policy_decision,
                reasons: policyResult.policy_reasons
            });
        }

        // 9) Stop if approval still missing/pending
        if (policyResult.requires_approval) {
            return res.status(202).json({
                message: 'Request captured and waiting on approval',
                correlation_id: request.correlation_id,
                decision: policyResult.policy_decision,
                reasons: policyResult.policy_reasons
            });
        }

        // 10) Automatic execution begins after approved status
        request.normalized_status = 'execution_started';
        request.current_status = 'execution_started';

        await upsertRequest(request);

        await insertStatusHistory({
            correlation_id: request.correlation_id,
            status_value: request.current_status,
            status_type: 'current_status',
            changed_by: 'execution_orchestrator',
            reason: 'automatic execution started after approved policy decision'
        });

        // 11) Idempotency pre-check: if already a member, skip write and verify as success
        const preVerification = await verifyGroupMembership(
            request.target_user_identifier,
            request.group_identifier
        );

        if (preVerification.verification_result === 'verified_success') {
            await insertExecutionRun({
                correlation_id: request.correlation_id,
                execution_agent: 'okta_group_fulfillment_agent',
                execution_tool_or_workflow: 'automatic_group_add_pipeline',
                downstream_system: 'okta',
                final_execution_result: 'already_present',
                okta_reference_id: null,
                service_now_record_id: null
            });

            await insertVerification({
                correlation_id: request.correlation_id,
                verification_method: preVerification.verification_method,
                verification_result: preVerification.verification_result,
                expected_state: preVerification.expected_state,
                observed_state: preVerification.observed_state
            });

            request.normalized_status = 'completed_verified';
            request.current_status = 'completed_verified';
            request.final_status = 'completed_verified';
            request.completion_message =
                'User was already a member of the target group and verification succeeded.';

            await upsertRequest(request);

            await insertStatusHistory({
                correlation_id: request.correlation_id,
                status_value: request.current_status,
                status_type: 'current_status',
                changed_by: 'verification_service',
                reason: 'membership already present before write'
            });

            return res.status(200).json({
                message: 'Completed and verified',
                correlation_id: request.correlation_id,
                request_id: request.request_id,
                policy_decision: policyResult.policy_decision,
                execution_result: 'already_present',
                verification_result: 'verified_success'
            });
        }

        // 12) Live write to Okta
        const executionRunId = `run-${randomUUID()}`;

        await addUserToGroup(
            request.group_identifier,
            request.target_user_identifier
        );

        await insertExecutionRun({
            correlation_id: request.correlation_id,
            execution_agent: 'okta_group_fulfillment_agent',
            execution_tool_or_workflow: executionRunId,
            downstream_system: 'okta',
            final_execution_result: 'success',
            okta_reference_id: null,
            service_now_record_id: null
        });

        // 13) Verification pending status
        request.normalized_status = 'verification_pending';
        request.current_status = 'verification_pending';

        await upsertRequest(request);

        await insertStatusHistory({
            correlation_id: request.correlation_id,
            status_value: request.current_status,
            status_type: 'current_status',
            changed_by: 'execution_orchestrator',
            reason: 'execution completed, verification started'
        });

        // 14) Read-back verification
        const verification = await verifyGroupMembership(
            request.target_user_identifier,
            request.group_identifier
        );

        await insertVerification({
            correlation_id: request.correlation_id,
            verification_method: verification.verification_method,
            verification_result: verification.verification_result,
            expected_state: verification.expected_state,
            observed_state: verification.observed_state
        });

        // 15) Final status after verification
        if (verification.verification_result === 'verified_success') {
            request.normalized_status = 'completed_verified';
            request.current_status = 'completed_verified';
            request.final_status = 'completed_verified';
            request.completion_message =
                'Approved change executed and verified successfully.';

            await upsertRequest(request);

            await insertStatusHistory({
                correlation_id: request.correlation_id,
                status_value: request.current_status,
                status_type: 'current_status',
                changed_by: 'verification_service',
                reason: 'read-back verification succeeded'
            });

            return res.status(200).json({
                message: 'Completed and verified',
                correlation_id: request.correlation_id,
                request_id: request.request_id,
                policy_decision: policyResult.policy_decision,
                execution_result: 'success',
                verification_result: verification.verification_result
            });
        }

        request.normalized_status = 'completed_unverified';
        request.current_status = 'completed_unverified';
        request.final_status = 'completed_unverified';
        request.completion_message =
            'Execution was attempted, but verification did not confirm the expected state.';

        await upsertRequest(request);

        await insertStatusHistory({
            correlation_id: request.correlation_id,
            status_value: request.current_status,
            status_type: 'current_status',
            changed_by: 'verification_service',
            reason: 'read-back verification failed'
        });

        return res.status(502).json({
            message:
                'Execution attempted, but verification did not confirm the expected state',
            correlation_id: request.correlation_id,
            request_id: request.request_id,
            policy_decision: policyResult.policy_decision,
            execution_result: 'success',
            verification_result: verification.verification_result
        });
    } catch (error) {
        console.error('❌ ERROR:', error);

        return res.status(500).json({
            error: error.message
        });
    }
});

app.listen(PORT, function () {
    console.log(`✅ Server running on port ${PORT}`);
});