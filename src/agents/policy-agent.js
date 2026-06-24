const { log } = require('./logger');

const ALLOWED_ACTIONS = [
    "LIST_GROUP_MEMBERS",
    "ADD_USER_TO_GROUP",
    "SUSPEND_USER",
    "ASSIGN_PRIVILEGED_GROUP"
];

const ALLOWED_TARGET_TYPES = ["GROUP", "USER"];

function validatePolicy(request) {
    log("POLICY", "START");

    if (!request.requester || !request.action || !request.target_type || !request.target_resource) {
        log("POLICY", "FAIL", "missing_required_fields");
        return { allowed: false, reason: "Missing required fields" };
    }

    if (!ALLOWED_ACTIONS.includes(request.action)) {
        log("POLICY", "FAIL", "unsupported_action");
        return { allowed: false, reason: "Unsupported action" };
    }

    if (!ALLOWED_TARGET_TYPES.includes(request.target_type)) {
        log("POLICY", "FAIL", "unsupported_target_type");
        return { allowed: false, reason: "Unsupported target type" };
    }

    log("POLICY", "SUCCESS", "allowed=true");
    return { allowed: true };
}

module.exports = { validatePolicy };