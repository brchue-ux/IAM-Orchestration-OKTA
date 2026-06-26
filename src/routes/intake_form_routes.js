
'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { buildFormDefinition } = require('../engines/dynamic_form_engine');
const { log } = require('../utils/logger');

const { resolveIdentity } = require('../agents/identityResolutionAgent');
const { evaluatePolicyEligibility } = require('../agents/policyEligibilityAgent');
const { determineApproval } = require('../agents/approvalAgent');
const { routeExecution } = require('../execution-control/executionRouter');
const { routeVerification } = require('../execution-control/verificationRouter');

const {
    ensureSchema,
    getRequestByCorrelationId,
    updateRequest,
    findOpenRequestByHash,
    buildRequestHash,
    createRequest
} = require('../services/requestRegistryStore');

const {
    appendRequestEvent,
    getRequestEventsByCorrelationId
} = require('../services/requestEventStore');

const router = express.Router();

function detectActionFamily(body = {}, action = '') {
    const normalizedAction = String(action || '').trim().toLowerCase();

    if (body.lookup_type || normalizedAction.includes('lookup') || normalizedAction.includes('status')) {
        return 'read_only_lookup';
    }

    if (
        normalizedAction.includes('group') ||
        normalizedAction.includes('add_user_to_group') ||
        normalizedAction.includes('remove_user_from_group')
    ) {
        return 'group_membership';
    }

    if (normalizedAction.includes('assign_app') || normalizedAction.includes('unassign_app') || normalizedAction.includes('app')) {
        return 'app_assignment';
    }

    if (
        normalizedAction.includes('suspend') ||
        normalizedAction.includes('unsuspend') ||
        normalizedAction.includes('deactivate') ||
        normalizedAction.includes('reactivate')
    ) {
        return 'user_lifecycle';
    }

    if (
        normalizedAction.includes('revoke_session') ||
        normalizedAction.includes('session') ||
        normalizedAction.includes('containment')
    ) {
        return 'containment';
    }

    return 'group_membership';
}

function normalize(body = {}, correlationId) {
    const requestedAction = body.action || body?.requestedAction?.actionType || null;
    const actionFamily = body.action_family || detectActionFamily(body, requestedAction);
    const requesterIdentity = body?.requester?.email || body.requester || null;
    const targetIdentity =
        body.target_identity ||
        body.target_user ||
        body?.subject?.email ||
        body?.target?.targetIdentifier ||
        body.target_resource ||
        null;

    return {
        correlation_id: correlationId,
        request_id: body.request_id || correlationId,
        requester_identity: requesterIdentity,
        requester_source: body.requester_source || 'api',
        requester_tenant_or_domain: body.requester_tenant_or_domain || null,
        target_identity: targetIdentity,
        target_identifier_type: body.target_identifier_type || null,
        target_system: body.target_system || 'okta',
        requested_action: requestedAction,
        action_family: actionFamily,
        risk_tier: body.risk_tier || null,
        business_justification:
            body.request_justification ||
            body.justification ||
            body.business_justification ||
            null,
        urgency: body.urgency || 'normal',
        requested_duration: body.requested_duration || null,
        approval_requirement: body.approval_requirement || null,
        normalized_status: 'ready_for_validation',
        source_channel: body.source_channel || 'api',
        expected_postcondition:
            body.expected_postcondition ||
            body.postcondition ||
            'Requested state change is reflected in target system verification.',
        requester_verified: Boolean(requesterIdentity),
        group_identifier: body.group_identifier || body.target_resource || null,
        app_identifier: body.app_identifier || body.target_resource || null,
        operation: body.operation || null,
        lifecycle_action: body.lifecycle_action || null,
        rollback_or_containment_plan: body.rollback_or_containment_plan || null,
        containment_action: body.containment_action || null,
        containment_reason: body.containment_reason || null,
        bulk_count: body.bulk_count || 1,
        details: {
            raw_body_keys: Object.keys(body || {})
        }
    };
}

function buildStatusPayload(requestRecord) {
    return {
        correlation_id: requestRecord.correlation_id,
        request_id: requestRecord.request_id,
        status: requestRecord.current_status,
        current_step: requestRecord.current_step,
        waiting_on: requestRecord.waiting_on,
        approval_id: requestRecord.approval_id,
        action_family: requestRecord.action_family,
        risk_tier: requestRecord.risk_tier,
        policy_decision: requestRecord.policy_decision,
        execution_status: requestRecord.execution_status,
        verification_status: requestRecord.verification_status,
        completion_status: requestRecord.completion_status,
        final_status: requestRecord.final_status,
        details: requestRecord.details || {}
    };
}

router.post('/intake/preview-form', async (req, res) => {
    try {
        const correlationId = uuidv4();
        const normalized = normalize(req.body, correlationId);
        const resolvedIdentity = resolveIdentity(normalized);
        const merged = {
            ...normalized,
            ...resolvedIdentity,
            target_identity: resolvedIdentity.target_identity || normalized.target_identity,
            target_identifier_type: resolvedIdentity.target_identifier_type || normalized.target_identifier_type
        };
        const form = buildFormDefinition(merged);

        return res.json({
            correlation_id: correlationId,
            status: 'preview_ready',
            normalized_request: merged,
            form_definition: form
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
});

router.get('/requests/:correlationId', async (req, res) => {
    try {
        await ensureSchema();
        const requestRecord = await getRequestByCorrelationId(req.params.correlationId);

        if (!requestRecord) {
            return res.status(404).json({
                status: 'not_found',
                message: 'Request not found.'
            });
        }

        const events = await getRequestEventsByCorrelationId(req.params.correlationId);

        return res.json({
            request: buildStatusPayload(requestRecord),
            events
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ status: 'error', message: error.message });
    }
});

router.post('/requests', async (req, res) => {
    try {
        await ensureSchema();

        const correlationId = req.body?.correlation_id || uuidv4();
        const normalized = normalize(req.body, correlationId);
        const resolvedIdentity = resolveIdentity(normalized);

        const requestPackage = {
            ...normalized,
            ...resolvedIdentity,
            target_identity: resolvedIdentity.target_identity || normalized.target_identity,
            target_identifier_type: resolvedIdentity.target_identifier_type || normalized.target_identifier_type
        };

        requestPackage.request_hash = buildRequestHash(requestPackage);

        const existing = await findOpenRequestByHash(requestPackage.request_hash);
        if (existing && existing.correlation_id !== correlationId) {
            return res.status(202).json({
                correlation_id: existing.correlation_id,
                status: existing.current_status,
                current_step: existing.current_step,
                waiting_on: existing.waiting_on,
                message: 'A matching request is already in progress.'
            });
        }

        const policyDecision = evaluatePolicyEligibility(requestPackage);
        const requestRecord = await createRequest({
            ...requestPackage,
            risk_tier: policyDecision.risk_tier,
            policy_decision: policyDecision.policy_decision,
            approval_requirement: policyDecision.approval_requirement,
            current_status: 'ready_for_validation',
            current_step: 'POLICY_EVALUATION',
            waiting_on: policyDecision.policy_decision === 'approval_required' ? 'Approval Workflow' : null
        });

        await appendRequestEvent({
            correlation_id: correlationId,
            event_name: 'REQUEST_NORMALIZED',
            from_status: null,
            to_status: 'ready_for_validation',
            actor: requestPackage.requester_identity || 'SYSTEM',
            event_details: {
                action_family: requestPackage.action_family,
                target_identity: requestPackage.target_identity,
                target_identifier_type: requestPackage.target_identifier_type
            }
        });

        await appendRequestEvent({
            correlation_id: correlationId,
            event_name: 'IDENTITY_RESOLVED',
            from_status: 'ready_for_validation',
            to_status: requestPackage.identity_resolution_status,
            actor: 'IdentityResolutionAgent',
            event_details: resolvedIdentity
        });

        await appendRequestEvent({
            correlation_id: correlationId,
            event_name: 'POLICY_EVALUATED',
            from_status: requestRecord.current_status,
            to_status: policyDecision.policy_decision,
            actor: 'PolicyEligibilityAgent',
            event_details: policyDecision
        });

        if (policyDecision.policy_decision === 'manual_review' ||
            policyDecision.policy_decision === 'out_of_scope' ||
            policyDecision.policy_decision === 'blocked_by_runtime_guardrail') {
            await updateRequest(correlationId, {
                current_status: 'needs_clarification',
                current_step: 'POLICY_REVIEW',
                waiting_on: 'IAM Operations',
                details: {
                    policy_reasons: policyDecision.reasons
                }
            }, 'PolicyEligibilityAgent');

            return res.status(202).json({
                correlation_id: correlationId,
                status: 'needs_clarification',
                policy_decision: policyDecision.policy_decision,
                reasons: policyDecision.reasons,
                message: 'Request requires clarification or manual review before approval / execution.'
            });
        }

        if (policyDecision.policy_decision === 'approval_required') {
            await updateRequest(correlationId, {
                current_status: 'approval_required',
                current_step: 'APPROVAL_REQUIRED',
                waiting_on: 'Approval Workflow'
            }, 'PolicyEligibilityAgent');

            const approvalResult = await determineApproval({
                ...requestPackage,
                risk_tier: policyDecision.risk_tier,
                approval_requirement: policyDecision.approval_requirement,
                policy_decision: policyDecision.policy_decision
            }, {
                log: (message) => console.log(message)
            });

            return res.status(202).json({
                correlation_id: correlationId,
                status: approvalResult?.requestRecord?.current_status || 'approval_pending',
                current_step: approvalResult?.requestRecord?.current_step || 'APPROVAL_PENDING',
                waiting_on: approvalResult?.requestRecord?.waiting_on || 'Approval Workflow',
                approval: approvalResult,
                message: approvalResult?.details?.message || 'Approval is required before execution.'
            });
        }

        await updateRequest(correlationId, {
            current_status: 'ready_for_execution',
            current_step: 'READY_FOR_EXECUTION',
            waiting_on: 'Execution Router'
        }, 'PolicyEligibilityAgent');

        const executionDecision = await routeExecution({
            ...requestPackage,
            risk_tier: policyDecision.risk_tier,
            approval_requirement: policyDecision.approval_requirement,
            policy_decision: policyDecision.policy_decision
        }, {
            log: (message) => console.log(message)
        });

        const executionResult = executionDecision?.executionResult || null;

        await updateRequest(correlationId, {
            current_status: 'verification_pending',
            current_step: 'VERIFICATION_PENDING',
            waiting_on: 'Verification Router',
            execution_status: executionResult?.executionState || null
        }, 'ExecutionRouter');

        const verificationBundle = await routeVerification(
            requestPackage,
            executionResult,
            { log: (message) => console.log(message) }
        );

        const finalStatus = verificationBundle?.completion?.finalStatus || 'failed';

        await updateRequest(correlationId, {
            current_status: finalStatus === 'COMPLETED_VERIFIED' ? 'completed_verified' : 'failed',
            current_step: finalStatus,
            waiting_on: null,
            verification_status: verificationBundle?.verification?.verificationStatus || null,
            final_status: finalStatus,
            completion_status: finalStatus
        }, 'VerificationRouter');

        return res.status(200).json({
            correlation_id: correlationId,
            status: finalStatus,
            execution: verificationBundle?.execution || executionResult,
            verification: verificationBundle?.verification || null,
            completion: verificationBundle?.completion || null
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

module.exports = router;