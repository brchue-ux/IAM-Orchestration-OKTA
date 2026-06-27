/**
 * * Okta Execution Service
 * Scoped runtime execution for approved group membership add actions.
 * This service performs no policy decisions. It only executes and reads back.
 */

const { getConfig } = require('../config/config');

/**
 * Add a user to a group.
 *
 * @param {string} groupId
 * @param {string} userId
 * @returns {Promise<object>}
 */
async function addUserToGroup(groupId, userId) {
    validateExecutionInputs(groupId, userId);

    const config = getConfig();
    validateOktaRuntimeConfig(config.okta);

    const url = `${trimTrailingSlash(config.okta.baseUrl)}/api/v1/groups/${encodeURIComponent(
        groupId
    )}/users/${encodeURIComponent(userId)}`;

    const response = await fetch(url, {
        method: 'PUT',
        headers: buildHeaders(config.okta.apiToken),
        signal: AbortSignal.timeout(config.okta.requestTimeoutMs)
    });

    const responseText = await safeReadText(response);

    if (!response.ok) {
        throw buildHttpError(
            'Okta addUserToGroup failed',
            response.status,
            responseText
        );
    }

    return {
        ok: true,
        status: response.status,
        responseText
    };
}

/**
 * List groups for a user.
 *
 * @param {string} userId
 * @returns {Promise<Array>}
 */
async function listUserGroups(userId) {
    if (!userId) {
        throw new Error('Okta Execution Error: userId is required');
    }

    const config = getConfig();
    validateOktaRuntimeConfig(config.okta);

    const url = `${trimTrailingSlash(config.okta.baseUrl)}/api/v1/users/${encodeURIComponent(
        userId
    )}/groups`;

    const response = await fetch(url, {
        method: 'GET',
        headers: buildHeaders(config.okta.apiToken),
        signal: AbortSignal.timeout(config.okta.requestTimeoutMs)
    });

    const responseText = await safeReadText(response);

    if (!response.ok) {
        throw buildHttpError(
            'Okta listUserGroups failed',
            response.status,
            responseText
        );
    }

    const parsed = responseText ? JSON.parse(responseText) : [];

    return Array.isArray(parsed) ? parsed : [];
}

/**
 * Validate execution inputs.
 *
 * @param {string} groupId
 * @param {string} userId
 */
function validateExecutionInputs(groupId, userId) {
    if (!groupId) {
        throw new Error('Okta Execution Error: groupId is required');
    }

    if (!userId) {
        throw new Error('Okta Execution Error: userId is required');
    }
}

/**
 * Validate runtime config at the point of execution.
 *
 * @param {object} oktaConfig
 */
function validateOktaRuntimeConfig(oktaConfig) {
    if (!oktaConfig.allowExecution) {
        throw new Error(
            'Okta Execution Error: execution is disabled. Set OKTA_ALLOW_EXECUTION=true in Integrator only.'
        );
    }

    if (!oktaConfig.baseUrl) {
        throw new Error('Okta Execution Error: OKTA_BASE_URL is required');
    }

    if (!oktaConfig.apiToken) {
        throw new Error('Okta Execution Error: OKTA_API_TOKEN is required');
    }
}

/**
 * Build HTTP headers.
 *
 * @param {string} apiToken
 * @returns {object}
 */
function buildHeaders(apiToken) {
    return {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `SSWS ${apiToken}`
    };
}

/**
 * Safely read text body.
 *
 * @param {Response} response
 * @returns {Promise<string>}
 */
async function safeReadText(response) {
    try {
        return await response.text();
    } catch (error) {
        return '';
    }
}

/**
 * Create a structured HTTP error.
 *
 * @param {string} message
 * @param {number} status
 * @param {string} responseText
 * @returns {Error}
 */
function buildHttpError(message, status, responseText) {
    const error = new Error(`${message} (status ${status})`);
    error.httpStatus = status;
    error.responseText = responseText;
    return error;
}

/**
 * Trim trailing slash from a URL if present.
 *
 * @param {string} value
 * @returns {string}
 */
function trimTrailingSlash(value) {
    return String(value).replace(/\/+$/, '');
}

module.exports = {
    addUserToGroup,
    listUserGroups
};