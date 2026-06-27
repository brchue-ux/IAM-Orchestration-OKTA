"use strict";

/**
 * environmentGuard
 * Enforces environment isolation and environment-specific approval posture.
 */

const { getExecutionPolicyConfig, normalizeIdentifier } = require("../config/executionPolicyConfig");

function evaluateEnvironmentIsolation(request, config) {
    const policy = config || getExecutionPolicyConfig();
    const reasons = [];
    const targetEnvironment = normalizeIdentifier(request && request.target_environment || policy.appEnvironment || "dev");
    const runtimeEnvironment = normalizeIdentifier(policy.appEnvironment || "dev");

    if (targetEnvironment !== runtimeEnvironment) {
        reasons.push(`Target environment ${targetEnvironment} does not match runtime environment ${runtimeEnvironment}.`);
    }

    if (!policy.allowedEnvironments.includes(targetEnvironment)) {
        reasons.push(`Target environment ${targetEnvironment} is not allowlisted.`);
    }

    if (targetEnvironment === "prod" && String(request && request.approval_requirement || "approval_required").toLowerCase() !== "approval_required") {
        reasons.push("Production execution requires explicit approval_requirement=approval_required.");
    }

    return {
        passed: reasons.length === 0,
        reasons,
        policy_decision: reasons.length === 0 ? "allowed" : "blocked_by_runtime_guardrail",
        runtime_environment: runtimeEnvironment,
        target_environment: targetEnvironment
    };
}

module.exports = {
    evaluateEnvironmentIsolation
};