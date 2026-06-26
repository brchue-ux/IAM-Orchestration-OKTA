const crypto = require('crypto');
const {
    createApprovalRecord,
    getApprovalById,
    updateApproval,
    updateRequest
} = require('../requestRegistryStore');

function routeToApprover(record) {
    const resource = String(record?.target_resource || '').toLowerCase();

    if (resource.includes('admin') || resource.includes('privileged')) {
        return {
            route_key: 'SECURITY_APPROVAL',
            approver_identifier: 'iam-security@company.example',
            waiting_on: 'IAM Security'
        };
    }

    return {
        route_key: 'APP_OWNER_APPROVAL',
        approver_identifier: 'app.owner@company.example',
        waiting_on: 'App Owner'
    };
}

async function createApprovalRequest(record, context = {}) {
    const approvalId = crypto.randomUUID();
    const route = routeToApprover(record);

    const approval = await createApprovalRecord({
        approval_id: approvalId,
        correlation_id: record.correlation_id,
        provider: 'MOCK',
        route_key: route.route_key,
        approver_identifier: route.approver_identifier,
        approval_state: 'PENDING',
        details: {
            requested_action: record.action,
            target_user: record.target_user,
            target_resource: record.target_resource
        }
    });

    await updateRequest(record.correlation_id, {
        current_status: 'approval_pending',
        current_step: 'WAITING_FOR_APPROVAL',
        waiting_on: route.waiting_on,
        approval_id: approval.approval_id,
        details: {
            approval_provider: 'MOCK',
            route_key: route.route_key,
            approver_identifier: route.approver_identifier
        }
    });

    if (context?.log) {
        context.log(JSON.stringify({
            event: 'IAM_MOCK_APPROVAL_CREATED',
            timestamp: new Date().toISOString(),
            correlationId: record.correlation_id,
            approvalId,
            waitingOn: route.waiting_on,
            approverIdentifier: route.approver_identifier
        }));
    }

    return {
        approvalState: 'PENDING',
        approved: false,
        provider: 'MOCK',
        approvalId,
        waitingOn: route.waiting_on,
        approverIdentifier: route.approver_identifier,
        routeKey: route.route_key
    };
}

async function getApprovalStatus(approvalId) {
    const approval = await getApprovalById(approvalId);
    if (!approval) {
        return null;
    }

    return {
        approvalState: approval.approval_state,
        approved: approval.approval_state === 'APPROVED',
        provider: approval.provider,
        approvalId: approval.approval_id,
        waitingOn: approval.approver_identifier,
        approverIdentifier: approval.approver_identifier,
        routeKey: approval.route_key,
        decisionBy: approval.decision_by,
        decidedAt: approval.decided_at
    };
}

async function decideApproval({ approvalId, decision, approver }, context = {}) {
    const normalizedDecision = String(decision || '').trim().toUpperCase();
    const nextState = normalizedDecision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
    const approval = await updateApproval(approvalId, {
        approval_state: nextState,
        decision_by: approver || null,
        decided_at: new Date(),
        details: {
            decision_source: 'mock_endpoint'
        }
    });

    await updateRequest(approval.correlation_id, {
        current_status: nextState === 'APPROVED' ? 'approved' : 'rejected',
        current_step: nextState === 'APPROVED' ? 'READY_FOR_EXECUTION' : 'REJECTED',
        waiting_on: null,
        approved_by: approver || null,
        approved_at: nextState === 'APPROVED' ? new Date() : null,
        details: {
            approval_provider: 'MOCK',
            approval_decision: nextState
        }
    });

    if (context?.log) {
        context.log(JSON.stringify({
            event: 'IAM_MOCK_APPROVAL_DECIDED',
            timestamp: new Date().toISOString(),
            approvalId,
            decision: nextState,
            approver: approver || null
        }));
    }

    return approval;
}

module.exports = {
    createApprovalRequest,
    getApprovalStatus,
    decideApproval
};