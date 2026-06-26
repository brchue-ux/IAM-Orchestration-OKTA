const agentInventory = [
    {
        agentName: 'AccessGroupFulfillmentAgent',
        agentType: 'EXECUTION',
        purpose: 'Adds a user to approved business access groups only.',
        actionFamily: 'GROUP_FULFILLMENT',
        riskTier: 'LOW',

        identityMode: 'SYSTEM_IDENTITY',
        identityScope: {
            oktaScopes: ['groups.manage', 'users.read'],
            maxScope: 'BUSINESS_GROUPS_ONLY'
        },

        allowedActions: ['ADD_USER_TO_GROUP'],
        prohibitedActions: [
            'ADD_USER_TO_ADMIN_GROUP',
            'MODIFY_POLICY',
            'SUSPEND_USER',
            'REVOKE_SESSIONS'
        ],

        allowedTargets: {
            groupTypes: ['BUSINESS'],
            excludedGroupClasses: ['ADMIN', 'PRIVILEGED', 'BREAK_GLASS'],
            maxTargetsPerRequest: 1
        },

        approvalRequired: false,
        requiredApprovalType: null,

        verificationRequired: true,
        rollbackAllowed: true,

        environment: ['dev', 'test'],
        owner: 'IAM Engineering',
        status: 'ACTIVE',
        version: '1.0.0'
    },

    {
        agentName: 'GroupVerificationAgent',
        agentType: 'VERIFICATION',
        purpose: 'Confirms the requested group membership state exists after execution.',
        actionFamily: 'GROUP_FULFILLMENT',
        riskTier: 'LOW',

        identityMode: 'SYSTEM_IDENTITY',
        identityScope: {
            oktaScopes: ['groups.read', 'users.read'],
            maxScope: 'READ_ONLY'
        },

        allowedActions: ['VERIFY_GROUP_MEMBERSHIP'],
        prohibitedActions: [
            'ADD_USER_TO_GROUP',
            'REMOVE_USER_FROM_GROUP',
            'MODIFY_POLICY',
            'SUSPEND_USER',
            'REVOKE_SESSIONS'
        ],

        environment: ['dev', 'test', 'prod'],
        owner: 'IAM Engineering',
        status: 'ACTIVE',
        version: '1.0.0'
    },

    {
        agentName: 'GroupRollbackAgent',
        agentType: 'ROLLBACK',
        purpose: 'Removes a user from a group when rollback is explicitly allowed and invoked.',
        actionFamily: 'GROUP_FULFILLMENT',
        riskTier: 'LOW',

        identityMode: 'SYSTEM_IDENTITY',
        identityScope: {
            oktaScopes: ['groups.manage', 'users.read'],
            maxScope: 'BUSINESS_GROUPS_ONLY'
        },

        allowedActions: ['REMOVE_USER_FROM_GROUP'],
        prohibitedActions: [
            'ADD_USER_TO_GROUP',
            'MODIFY_POLICY',
            'SUSPEND_USER',
            'REVOKE_SESSIONS'
        ],

        environment: ['dev', 'test'],
        owner: 'IAM Engineering',
        status: 'ACTIVE',
        version: '1.0.0'
    }
];

function getAgentMetadata(agentName) {
    return agentInventory.find(agent => agent.agentName === agentName) || null;
}

function agentExists(agentName) {
    return agentInventory.some(agent => agent.agentName === agentName);
}

function getAgentsByFamily(actionFamily) {
    return agentInventory.filter(agent => agent.actionFamily === actionFamily);
}

module.exports = {
    agentInventory,
    getAgentMetadata,
    agentExists,
    getAgentsByFamily
};