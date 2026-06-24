const { log } = require('./logger');
const { getRequesterCapabilitiesFromSource } = require('./authorization-source-agent');

const ACTION_REQUIREMENTS = {
    LIST_GROUP_MEMBERS: 'READ_ONLY_STATUS',
    ADD_USER_TO_GROUP: 'STANDARD_WRITE',
    SUSPEND_USER: 'SUBMIT_HIGH_RISK',
    ASSIGN_PRIVILEGED_GROUP: 'SUBMIT_HIGH_RISK'
};

async function authorizeRequester(request) {
    const requiredCapability = ACTION_REQUIREMENTS[request.action];

    log("AUTHZ", "START", `requester=${request.requester} action=${request.action}`);

    if (!requiredCapability) {
        log("AUTHZ", "FAIL", "unknown_action");
        return {
            allowed: false,
            required_capability: null,
            requester_capabilities: [],
            requester_group_names: [],
            requester_user_id: null,
            reason: 'Unknown action'
        };
    }

    const source = await getRequesterCapabilitiesFromSource(request.requester);

    if (!source.requester_capabilities.includes(requiredCapability)) {
        log("AUTHZ", "FAIL", `missing_capability=${requiredCapability}`);
        return {
            allowed: false,
            required_capability: requiredCapability,
            requester_capabilities: source.requester_capabilities,
            requester_group_names: source.requester_group_names,
            requester_user_id: source.requester_user_id,
            reason: `Requester lacks required capability: ${requiredCapability}`
        };
    }

    log("AUTHZ", "SUCCESS", `capability=${requiredCapability}`);

    return {
        allowed: true,
        required_capability: requiredCapability,
        requester_capabilities: source.requester_capabilities,
        requester_group_names: source.requester_group_names,
        requester_user_id: source.requester_user_id
    };
}

module.exports = { authorizeRequester };