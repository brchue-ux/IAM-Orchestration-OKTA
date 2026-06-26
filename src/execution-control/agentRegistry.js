// =====================================
// ✅ AGENT REGISTRY
// =====================================
// Purpose:
// Resolve execution / verification / rollback agents
// by action family or agent name.
//
// This registry is intentionally bounded:
// - execution agents
// - verification agents
// - rollback agents
//
// It does NOT perform policy decisions.
// It only resolves handlers + metadata.
// =====================================

const { addUserToApprovedGroup } = require('../agents/AccessGroupFulfillmentAgent');
const { verifyGroupMembership } = require('../agents/groupVerificationAgent');
const { rollbackGroupMembership } = require('../agents/groupRollbackAgent');

const { getAgentMetadata } = require('../control-plane/agentRegistryMetadata');

// =====================================
// ✅ REGISTRY
// =====================================
const registry = {
    // ---------------------------------
    // EXECUTION
    // ---------------------------------
    AccessGroupFulfillmentAgent: {
        actionFamily: 'GROUP_FULFILLMENT',
        agentType: 'EXECUTION',
        handler: addUserToApprovedGroup
    },

    // ---------------------------------
    // VERIFICATION
    // ---------------------------------
    GroupVerificationAgent: {
        actionFamily: 'GROUP_FULFILLMENT',
        agentType: 'VERIFICATION',
        handler: verifyGroupMembership
    },

    // ---------------------------------
    // ROLLBACK
    // ---------------------------------
    GroupRollbackAgent: {
        actionFamily: 'GROUP_FULFILLMENT',
        agentType: 'ROLLBACK',
        handler: rollbackGroupMembership
    }
};

// =====================================
// ✅ HELPER: RESOLVE FULL AGENT OBJECT
// =====================================
function buildResolvedAgent(agentName) {
    const entry = registry[agentName];
    const metadata = getAgentMetadata(agentName);

    if (!entry || !metadata) {
        return null;
    }

    return {
        ...metadata,
        handler: entry.handler
    };
}

// =====================================
// ✅ GET EXECUTION AGENT BY FAMILY
// =====================================
function getAgentByFamily(actionFamily) {
    const match = Object.entries(registry).find(([, value]) => {
        return (
            value.actionFamily === actionFamily &&
            value.agentType === 'EXECUTION'
        );
    });

    if (!match) {
        return null;
    }

    const [agentName] = match;
    return buildResolvedAgent(agentName);
}

// =====================================
// ✅ GET VERIFICATION AGENT BY NAME
// =====================================
function getVerificationAgent(agentName) {
    const resolved = buildResolvedAgent(agentName);

    if (!resolved) {
        return null;
    }

    return resolved.agentType === 'VERIFICATION' ? resolved : null;
}

// =====================================
// ✅ GET ROLLBACK AGENT BY NAME
// =====================================
function getRollbackAgent(agentName) {
    const resolved = buildResolvedAgent(agentName);

    if (!resolved) {
        return null;
    }

    return resolved.agentType === 'ROLLBACK' ? resolved : null;
}

// =====================================
// ✅ EXPORT
// =====================================
module.exports = {
    getAgentByFamily,
    getVerificationAgent,
    getRollbackAgent
};