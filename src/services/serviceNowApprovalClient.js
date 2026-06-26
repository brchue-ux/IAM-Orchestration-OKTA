// =====================================//
// =====================================
// Purpose:
// Provide a thin adapter for creating and checking approval records
// in ServiceNow before execution is allowed.
//
// IMPORTANT:
// - This file uses environment-configured endpoints because the exact
//   ServiceNow table/flow endpoint varies by environment.
// - Map the env vars below to your real ServiceNow REST endpoint(s).
// - Keep this client bounded to approval-only operations.
// =====================================

const fetchFn = global.fetch;

/**
 * Return a trimmed string or empty string.
 */
function normalize(value) {
    return String(value || '').trim();
}

/**
 * Get required ServiceNow config from environment.
 */
function getServiceNowConfig() {
    const baseUrl = normalize(process.env.SERVICENOW_BASE_URL);
    const authMode = normalize(process.env.SERVICENOW_AUTH_MODE || 'basic').toLowerCase();

    const createPath = normalize(
        process.env.SERVICENOW_APPROVAL_CREATE_PATH || '/api/x_iam/approval/request'
    );

    const statusPathTemplate = normalize(
        process.env.SERVICENOW_APPROVAL_STATUS_PATH || '/api/x_iam/approval/request/{id}'
    );

    if (!baseUrl) {
        throw new Error('Missing SERVICENOW_BASE_URL');
    }

    let headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json'
    };

    if (authMode === 'basic') {
        const username = normalize(process.env.SERVICENOW_USERNAME);
        const password = normalize(process.env.SERVICENOW_PASSWORD);

        if (!username || !password) {
            throw new Error('Missing SERVICENOW_USERNAME or SERVICENOW_PASSWORD');
        }

        const token = Buffer.from(`${username}:${password}`).toString('base64');
        headers.Authorization = `Basic ${token}`;
    } else if (authMode === 'bearer') {
        const token = normalize(process.env.SERVICENOW_BEARER_TOKEN);

        if (!token) {
            throw new Error('Missing SERVICENOW_BEARER_TOKEN');
        }

        headers.Authorization = `Bearer ${token}`;
    } else {
        throw new Error(`Unsupported SERVICENOW_AUTH_MODE: ${authMode}`);
    }

    return {
        baseUrl,
        headers,
        createPath,
        statusPathTemplate
    };
}

/**
 * Safely parse JSON response body.
 */
async function safeJson(response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

/**
 * Normalize an approval status from a ServiceNow response.
 *
 * This is intentionally tolerant because different ServiceNow endpoints
 * may return different field names.
 */
function normalizeApprovalStatus(payload) {
    const result = payload?.result || payload || {};

    const rawStatus = normalize(
        result.approval ||
        result.state ||
        result.status ||
        result.decision
    ).toLowerCase();

    if (['approved', 'approve', 'granted'].includes(rawStatus)) {
        return 'APPROVED';
    }

    if (['rejected', 'reject', 'denied', 'cancelled', 'canceled'].includes(rawStatus)) {
        return 'REJECTED';
    }

    if (['requested', 'pending', 'waiting', 'open'].includes(rawStatus)) {
        return 'PENDING';
    }

    return 'UNKNOWN';
}

/**
 * Build a normalized approval record from ServiceNow response payload.
 */
function buildApprovalRecord(payload) {
    const result = payload?.result || payload || {};

    return {
        externalApprovalId:
            result.sys_id ||
            result.id ||
            result.request_id ||
            null,

        approvalNumber:
            result.number ||
            result.request_number ||
            null,

        approvalStatus: normalizeApprovalStatus(payload),

        approver:
            result.approver ||
            result.assigned_to ||
            null,

        approvalTimestamp:
            result.approved_at ||
            result.decision_time ||
            result.updated_on ||
            null,

        raw: payload || null
    };
}

/**
 * Create a new approval request in ServiceNow.
 */
async function createApprovalRequest(payload, context = {}) {
    const { baseUrl, headers, createPath } = getServiceNowConfig();

    const response = await fetchFn(`${baseUrl}${createPath}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });

    const body = await safeJson(response);

    if (!response.ok) {
        const error = new Error('ServiceNow approval create failed');
        error.status = response.status;
        error.responseBody = body;
        throw error;
    }

    const normalized = buildApprovalRecord(body);

    if (context?.log) {
        context.log(JSON.stringify({
            event: 'IAM_APPROVAL_REQUEST_CREATED',
            timestamp: new Date().toISOString(),
            externalApprovalId: normalized.externalApprovalId,
            approvalNumber: normalized.approvalNumber,
            approvalStatus: normalized.approvalStatus
        }));
    }

    return normalized;
}

/**
 * Check approval status in ServiceNow.
 */
async function getApprovalStatus(externalApprovalId, context = {}) {
    const { baseUrl, headers, statusPathTemplate } = getServiceNowConfig();

    if (!externalApprovalId) {
        throw new Error('getApprovalStatus requires externalApprovalId');
    }

    const statusPath = statusPathTemplate.replace('{id}', encodeURIComponent(externalApprovalId));

    const response = await fetchFn(`${baseUrl}${statusPath}`, {
        method: 'GET',
        headers
    });

    const body = await safeJson(response);

    if (!response.ok) {
        const error = new Error('ServiceNow approval status lookup failed');
        error.status = response.status;
        error.responseBody = body;
        throw error;
    }

    const normalized = buildApprovalRecord(body);

    if (context?.log) {
        context.log(JSON.stringify({
            event: 'IAM_APPROVAL_STATUS_CHECKED',
            timestamp: new Date().toISOString(),
            externalApprovalId: normalized.externalApprovalId,
            approvalNumber: normalized.approvalNumber,
            approvalStatus: normalized.approvalStatus
        }));
    }

    return normalized;
}

module.exports = {
    createApprovalRequest,
    getApprovalStatus
};