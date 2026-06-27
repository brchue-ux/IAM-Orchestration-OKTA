"use strict";

/**
 * agentRegistryStore
 * Persists agent inventory records for the control plane.
 */

const { upsertByKey, getCollection } = require("./controlPlaneStore");

async function registerAgent(agentRecord) {
    if (!agentRecord || !agentRecord.agent_name) {
        throw new Error("agent_name is required to register an agent.");
    }

    return upsertByKey("agent_registry", "agent_name", agentRecord);
}

async function listRegisteredAgents() {
    return getCollection("agent_registry");
}

module.exports = {
    registerAgent,
    listRegisteredAgents
};