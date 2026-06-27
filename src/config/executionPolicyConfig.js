"use strict";

/**
 * executionPolicyConfig
 * Central policy-as-code configuration for the Stage 4 low-risk execution lane.
 */

function clean(value) {
    if (value === undefined || value === null) {
        return undefined;
    }

    const text = String(value).trim();
    return text || undefined;
}

function parseCsvList(value, defaultValue) {
    const source = clean(value);
    const raw = source || defaultValue || "";

    return String(raw)
        .split(",")
        .map(function mapValue(item) {
            return String(item || "").trim();
        })
        .filter(Boolean);
}

function parseNumber(value, defaultValue) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : defaultValue;
}

function normalizeIdentifier(value) {
    return String(value || "").trim().toLowerCase();
}

function getExecutionPolicyConfig(overrides) {
    const custom = overrides || {};

    return {
        appEnvironment:
            clean(custom.appEnvironment) ||
            clean(process.env.APP_ENV) ||
            clean(process.env.NODE_ENV) ||
            "dev",
        maxTargets: parseNumber(
            custom.maxTargets || process.env.MAX_EXECUTION_TARGETS,
            1
        ),
        allowedActionFamilies: parseCsvList(
            custom.allowedActionFamilies || process.env.ALLOWED_ACTION_FAMILIES,
            "read_only_lookup,group_fulfillment,app_assignment"
        ).map(normalizeIdentifier),
        allowedEnvironments: parseCsvList(
            custom.allowedEnvironments || process.env.EXECUTION_ALLOWED_ENVIRONMENTS,
            "dev,test,prod"
        ).map(normalizeIdentifier),
        allowedStandardGroupIds: parseCsvList(
            custom.allowedStandardGroupIds || process.env.ALLOWED_STANDARD_GROUP_IDS,
            ""
        ),
        deniedGroupIds: parseCsvList(
            custom.deniedGroupIds || process.env.DENIED_GROUP_IDS,
            ""
        ),
        allowedAppIds: parseCsvList(
            custom.allowedAppIds || process.env.ALLOWED_APP_IDS,
            ""
        ),
        deniedAppIds: parseCsvList(
            custom.deniedAppIds || process.env.DENIED_APP_IDS,
            ""
        ),
        requireApprovalForWriteActions:
            String(
                custom.requireApprovalForWriteActions !== undefined
                    ? custom.requireApprovalForWriteActions
                    : process.env.REQUIRE_APPROVAL_FOR_WRITE_ACTIONS || "true"
            )
                .trim()
                .toLowerCase() !== "false",
        idempotencyWindowMinutes: parseNumber(
            custom.idempotencyWindowMinutes || process.env.IDEMPOTENCY_WINDOW_MINUTES,
            30
        ),
        retry: {
            maxAttempts: parseNumber(
                custom.retryMaxAttempts || process.env.RETRY_MAX_ATTEMPTS,
                2
            ),
            initialDelayMs: parseNumber(
                custom.retryInitialDelayMs || process.env.RETRY_INITIAL_DELAY_MS,
                750
            ),
            maxDelayMs: parseNumber(
                custom.retryMaxDelayMs || process.env.RETRY_MAX_DELAY_MS,
                4000
            )
        }
    };
}

function isAllowedActionFamily(actionFamily, config) {
    const policy = config || getExecutionPolicyConfig();
    return policy.allowedActionFamilies.includes(normalizeIdentifier(actionFamily));
}

function isEnvironmentAllowed(targetEnvironment, config) {
    const policy = config || getExecutionPolicyConfig();
    return policy.allowedEnvironments.includes(normalizeIdentifier(targetEnvironment));
}

function isGroupAllowed(groupId, config) {
    const policy = config || getExecutionPolicyConfig();
    const normalized = clean(groupId);

    if (!normalized) {
        return false;
    }

    if (policy.deniedGroupIds.includes(normalized)) {
        return false;
    }

    if (policy.allowedStandardGroupIds.length === 0) {
        return true;
    }

    return policy.allowedStandardGroupIds.includes(normalized);
}

function isAppAllowed(appId, config) {
    const policy = config || getExecutionPolicyConfig();
    const normalized = clean(appId);

    if (!normalized) {
        return false;
    }

    if (policy.deniedAppIds.includes(normalized)) {
        return false;
    }

    if (policy.allowedAppIds.length === 0) {
        return true;
    }

    return policy.allowedAppIds.includes(normalized);
}

module.exports = {
    clean,
    parseCsvList,
    parseNumber,
    normalizeIdentifier,
    getExecutionPolicyConfig,
    isAllowedActionFamily,
    isEnvironmentAllowed,
    isGroupAllowed,
    isAppAllowed
};