"use strict";

/**
 * Normalize incoming request data into a predictable envelope.
 * This file is intentionally lightweight and side-effect free.
 */

function cleanString(value) {
    if (value === undefined || value === null) {
        return undefined;
    }

    const text = String(value).trim();
    return text || undefined;
}

function toArray(value) {
    if (Array.isArray(value)) {
        return value.filter(Boolean);
    }

    if (value === undefined || value === null || value === "") {
        return [];
    }

    return [value];
}

function normalizeRequestEnvelope(input) {
    const request = input || {};

    return {
        correlation_id: cleanString(request.correlation_id),
        request_id: cleanString(request.request_id),
        requester_identity: cleanString(request.requester_identity),
        requester_manager: cleanString(request.requester_manager),
        requester_roles: toArray(request.requester_roles),
        target_identity: cleanString(request.target_identity),
        target_environment: cleanString(request.target_environment) || "dev",
        action_family: cleanString(request.action_family),
        requested_action: cleanString(request.requested_action),
        operation: cleanString(request.operation),
        risk_tier: cleanString(request.risk_tier) || "low",
        target_group_type: cleanString(request.target_group_type) || "standard",
        target_app_type: cleanString(request.target_app_type) || undefined,
        target_ids: toArray(request.target_ids),
        group_id: cleanString(request.group_id),
        app_id: cleanString(request.app_id),
        duration_minutes: request.duration_minutes ? Number(request.duration_minutes) : undefined,
        justification: cleanString(request.justification),
        approval_record: request.approval_record || null,
        policy_context: request.policy_context || {},
        metadata: request.metadata || {}
    };
}

function validateRequiredFields(request) {
    const missing = [];
    [
        "correlation_id",
        "requester_identity",
        "target_identity",
        "action_family",
        "requested_action",
        "operation"
    ].forEach(function(field) {
        if (!request[field]) {
            missing.push(field);
        }
    });

    return {
        isValid: missing.length === 0,
        missing: missing
    };
}

module.exports = {
    normalizeRequestEnvelope,
    validateRequiredFields
};
