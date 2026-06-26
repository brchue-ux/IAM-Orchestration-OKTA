"use strict";

/**
 * Separation-of-Duties policy engine.
 * Keeps approval, validation, execution, and verification responsibilities separate.
 */

const HIGH_RISK_FAMILIES = new Set([
    "privileged_access",
    "user_lifecycle",
    "session_containment",
    "policy_security_change"
]);

function buildSodDecision(request) {
    const reasons = [];

    const approverId = request.approval_record && request.approval_record.approver_identity;
    const requesterId = request.requester_identity;

    if (approverId && requesterId && approverId === requesterId) {
        reasons.push("Requester cannot self-approve the action.");
    }

    if (
        HIGH_RISK_FAMILIES.has(String(request.action_family || "").toLowerCase()) &&
        !request.approval_record
    ) {
        reasons.push("High-risk action requires an approval record before execution.");
    }

    if (
        String(request.action_family || "").toLowerCase() === "privileged_access" &&
        String(request.target_group_type || "").toLowerCase() === "privileged" &&
        String(request.risk_tier || "").toLowerCase() !== "high"
    ) {
        reasons.push("Privileged target must be classified as high risk.");
    }

    return {
        passed: reasons.length === 0,
        reasons: reasons,
        policy_decision: reasons.length === 0 ? "allowed" : "blocked_by_sod"
    };
}

module.exports = {
    buildSodDecision
};
