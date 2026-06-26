// =====================================// POLICY (DYNAMIC ROUTING)
// =====================================
// Purpose:
// Determine whether approval is required and how approval should
// be routed before execution.
//
// Notes:
// - Keep this strictly policy/routing only.
// - Do NOT perform external calls here.
// - ServiceNow is the provider for approval orchestration.
// =====================================

/**
 * Normalize a value to lowercase string.
 */
function normalize(value) {
    return String(value || '').trim().toLowerCase();
}

/**
 * Return dynamic approval policy for a request.
 */
function getApprovalPolicy(record) {
    const action = normalize(record?.action);
    const target = normalize(record?.target_resource);
    const requester = normalize(record?.requester);
    const subject = normalize(record?.target_user);

    // Self-service standard group add
    if (action === 'add_user_to_group' && target === 'standard_write') {
        return {
            approvalRequired: true,
            provider: 'SERVICENOW',
            routeKey: 'MANAGER_STANDARD_GROUP',
            approverType: 'MANAGER',
            riskTier: 'LOW',
            requiresDifferentApproverThanRequester: true,
            requiresDifferentApproverThanSubject: true,
            approvalScope: 'GROUP_MEMBERSHIP_STANDARD'
        };
    }

    // Simple privilege heuristic example
    if (
        action === 'add_user_to_group' &&
        (target.includes('admin') || target.includes('privileged'))
    ) {
        return {
            approvalRequired: true,
            provider: 'SERVICENOW',
            routeKey: 'SECURITY_PRIVILEGED_GROUP',
            approverType: 'SECURITY',
            riskTier: 'HIGH',
            requiresDifferentApproverThanRequester: true,
            requiresDifferentApproverThanSubject: true,
            approvalScope: 'GROUP_MEMBERSHIP_PRIVILEGED'
        };
    }

    // Fallback route for group membership
    if (action === 'add_user_to_group') {
        return {
            approvalRequired: true,
            provider: 'SERVICENOW',
            routeKey: 'IAM_OPERATIONS_DEFAULT',
            approverType: 'IAM_OPERATIONS',
            riskTier: 'MEDIUM',
            requiresDifferentApproverThanRequester: true,
            requiresDifferentApproverThanSubject: true,
            approvalScope: 'GROUP_MEMBERSHIP_OTHER'
        };
    }

    // Unknown action -> approval still required, routed to IAM ops
    return {
        approvalRequired: true,
        provider: 'SERVICENOW',
        routeKey: 'IAM_OPERATIONS_DEFAULT',
        approverType: 'IAM_OPERATIONS',
        riskTier: 'UNKNOWN',
        requiresDifferentApproverThanRequester: true,
        requiresDifferentApproverThanSubject: true,
        approvalScope: 'UNKNOWN'
    };
}

module.exports = {
    getApprovalPolicy
};