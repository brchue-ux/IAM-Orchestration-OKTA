const { log } = require('./logger');

function classifyRisk(request) {
    log("RISK", "START", `action=${request.action}`);

    let tier = "moderate";

    if (request.action === "LIST_GROUP_MEMBERS") {
        tier = "low";
    } else if (request.action === "ADD_USER_TO_GROUP") {
        tier = "moderate";
    } else if (request.action === "SUSPEND_USER" || request.action === "ASSIGN_PRIVILEGED_GROUP") {
        tier = "high";
    }

    log("RISK", "SUCCESS", `tier=${tier}`);
    return tier;
}

module.exports = { classifyRisk };