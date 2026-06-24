const { log } = require('./logger');

function decideApproval(policyResult, riskTier, request) {
    log("APPROVAL", "START", `action=${request.action}`);

    if (!policyResult.allowed) {
        log("APPROVAL", "REJECTED", `reason=${policyResult.reason}`);
        return {
            status: "rejected",
            risk_tier: riskTier
        };
    }

    if (request.action === "LIST_GROUP_MEMBERS") {
        log("APPROVAL", "DECISION", "read_only_no_approval");
        return {
            status: "read_only_ready",
            risk_tier: riskTier,
            requires_human_approval: false
        };
    }

    if (riskTier === "high") {
        log("APPROVAL", "DECISION", "pending_high_risk_review");
        return {
            status: "pending_high_risk_review",
            risk_tier: riskTier,
            requires_human_approval: true
        };
    }

    log("APPROVAL", "DECISION", "pending_approval");
    return {
        status: "pending_approval",
        risk_tier: riskTier,
        requires_human_approval: true
    };
}

module.exports = { decideApproval };