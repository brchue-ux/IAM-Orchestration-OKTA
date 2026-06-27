"use strict";

/**
 * Normalize incoming request data into a predictable request envelope.
 * Intentionally lightweight and side-effect free.
 */

const WRITE_ACTION_FAMILIES = new Set([
    "group_fulfillment",
    "group_membership",
    "app_assignment",
    "user_lifecycle",
    "containment",
    "session_containment",
    "policy_security_change",
    "privileged_access"
]);

function cleanString(value) {
    if (value === undefined || value === null) {
        return undefined;
    }

    const text = String(value).trim();
    return text || undefined;
}

function toArray(value) {
    if (Array.isArray(value)) {
        return value
            .map(function mapItem(item) {
                return cleanString(item);
            })
            .filter(Boolean);
    }

    const cleaned = cleanString(value);
    return cleaned ? [cleaned] : [];
}

function normalizeActionFamily(value) {
    const family = String(value || "").trim().toLowerCase();

    if (family === "group_membership") {
        return "group_fulfillment";
    }

    if (family === "session_containment") {
        return "containment";
    }

    return family || undefined;
}

function normalizeApprovalRequirement(request) {
    const explicit = cleanString(request.approval_requirement);
    if (explicit) {
        return explicit.toLowerCase();
    }

    const family = normalizeActionFamily(request.action_family);
    return family === "read_only_lookup" ? "allowed_without_approval" : "approval_required";
}

function normalizeRequestEnvelope(input) {
    const request = input || {};
    const createdTimestamp = cleanString(request.created_timestamp) || new Date().toISOString();
    const actionFamily = normalizeActionFamily(request.action_family);
    const requestedDuration =
        request.requested_duration !== undefined && request.requested_duration !== null
            ? Number(request.requested_duration)
            : request.duration_minutes !== undefined && request.duration_minutes !== null
              ? Number(request.duration_minutes)
              : undefined;

    return {
        correlation_id: cleanString(request.correlation_id),
        request_id: cleanString(request.request_id),
        requester_identity: cleanString(request.requester_identity),
        requester_manager: cleanString(request.requester_manager),
        requester_roles: toArray(request.requester_roles),
        requester_source: cleanString(request.requester_source) || "teams",
        requester_tenant_or_domain: cleanString(request.requester_tenant_or_domain),
        target_identity: cleanString(request.target_identity),
        target_identifier_type: cleanString(request.target_identifier_type) || "email",
        target_system: cleanString(request.target_system) || "Okta",
        target_environment: cleanString(request.target_environment) || "dev",
        action_family: actionFamily,
        requested_action: cleanString(request.requested_action),
        operation: cleanString(request.operation),
        risk_tier: cleanString(request.risk_tier) || "low",
        target_group_type: cleanString(request.target_group_type) || "standard",
        target_app_type: cleanString(request.target_app_type),
        target_ids: toArray(request.target_ids),
        group_id: cleanString(request.group_id),
        app_id: cleanString(request.app_id),
        requested_duration: Number.isFinite(requestedDuration) ? requestedDuration : undefined,
        business_justification: cleanString(request.business_justification) || cleanString(request.justification),
        urgency: cleanString(request.urgency) || "normal",
        approval_requirement: normalizeApprovalRequirement(request),
        approval_reference: cleanString(request.approval_reference),
        approval_record: request.approval_record || null,
        normalized_status: cleanString(request.normalized_status) || "draft",
        created_timestamp: createdTimestamp,
        source_channel: cleanString(request.source_channel) || "teams",
        expected_postcondition: cleanString(request.expected_postcondition),
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
        "requested_action"
    ].forEach(function eachField(field) {
        if (!request[field]) {
            missing.push(field);
        }
    });

    if (WRITE_ACTION_FAMILIES.has(String(request.action_family || "").toLowerCase())) {
        ["operation", "expected_postcondition"].forEach(function eachWriteField(field) {
            if (!request[field]) {
                missing.push(field);
            }
        });
    }

    return {
        isValid: missing.length === 0,
        missing: missing
    };
}

module.exports = {
    normalizeRequestEnvelope,
    validateRequiredFields,
    normalizeActionFamily,
    WRITE_ACTION_FAMILIES
};