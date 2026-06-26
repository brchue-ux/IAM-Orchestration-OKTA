
'use strict';

/**
 * IdentityResolutionAgent
 *
 * Wave 1 identity resolution and target risk enrichment.
 */

const PRIVILEGED_KEYWORDS = [
    'admin',
    'administrator',
    'superuser',
    'root',
    'breakglass',
    'break-glass',
    'security',
    'privileged'
];

function normalizeText(value) {
    return String(value || '').trim();
}

function detectIdentifierType(value) {
    const text = normalizeText(value);

    if (!text) {
        return 'unknown';
    }

    if (text.includes('@')) {
        return 'email';
    }

    if (/^[a-f0-9-]{16,}$/i.test(text)) {
        return 'directory_id';
    }

    if (/^\d+$/.test(text)) {
        return 'employee_id';
    }

    if (text.split(' ').length === 1) {
        return 'okta_username';
    }

    return 'display_name';
}

function isPrivilegedValue(value) {
    const text = normalizeText(value).toLowerCase();
    return PRIVILEGED_KEYWORDS.some((keyword) => text.includes(keyword));
}

/**
 * Resolve the target identity using the data already available in the normalized request.
 *
 * This implementation is intentionally lightweight and does not call downstream identity APIs.
 * It prepares a typed resolve result for policy evaluation.
 */
function resolveIdentity(record = {}) {
    const targetIdentity = normalizeText(
        record.target_identity ||
        record.target_user_identifier ||
        record.target_user ||
        record.target_resource ||
        ''
    );

    if (!targetIdentity) {
        return {
            identity_resolution_status: 'needs_clarification',
            target_identity: null,
            target_identifier_type: 'unknown',
            protected_target: false,
            privileged_target: false,
            reasons: ['No target identity was provided.']
        };
    }

    const identifierType = detectIdentifierType(targetIdentity);

    if (identifierType === 'display_name') {
        return {
            identity_resolution_status: 'needs_clarification',
            target_identity: targetIdentity,
            target_identifier_type: identifierType,
            protected_target: false,
            privileged_target: isPrivilegedValue(targetIdentity),
            reasons: ['Display names are ambiguous. Provide email, Okta username, employee ID, or immutable directory ID.']
        };
    }

    return {
        identity_resolution_status: 'resolved',
        target_identity: targetIdentity,
        target_identifier_type: identifierType,
        protected_target: false,
        privileged_target: isPrivilegedValue(targetIdentity),
        reasons: ['Target identity is uniquely formatted for downstream processing.']
    };
}

module.exports = {
    resolveIdentity,
    detectIdentifierType,
    isPrivilegedValue
};
