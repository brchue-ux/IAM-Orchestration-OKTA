"use strict";

/**
 * Blast-radius guard.
 * Enforces caps on targets, environments, and privileged target classes.
 */

function buildBlastRadiusDecision(request, config) {
    const policy = config || {};
    const reasons = [];

    const maxTargets = Number(policy.maxTargets || process.env.MAX_EXECUTION_TARGETS || 1);
    const allowedEnvironments = new Set(
        String(policy.allowedEnvironments || process.env.EXECUTION_ALLOWED_ENVIRONMENTS || "dev")
            .split(",")
            .map((x) => x.trim().toLowerCase())
            .filter(Boolean)
    );

    const targetCount = request.target_ids && request.target_ids.length > 0
        ? request.target_ids.length
        : 1;

    if (targetCount > maxTargets) {
        reasons.push(`Requested target count ${targetCount} exceeds max allowed ${maxTargets}.`);
    }

    if (!allowedEnvironments.has(String(request.target_environment || "dev").toLowerCase())) {
        reasons.push(`Environment ${request.target_environment} is not approved for this connector.`);
    }

    if (
        String(request.target_group_type || "").toLowerCase() === "privileged" &&
        String(request.risk_tier || "").toLowerCase() !== "high"
    ) {
        reasons.push("Privileged target zone requires high-risk workflow.");
    }

    return {
        passed: reasons.length === 0,
        reasons: reasons,
        policy_decision: reasons.length === 0 ? "allowed" : "blocked_by_blast_radius"
    };
}

module.exports = {
    buildBlastRadiusDecision
};
