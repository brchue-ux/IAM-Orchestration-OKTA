const fetch = global.fetch || require('node-fetch');

/**
 * Normalize a value to a trimmed string.
 * Returns empty string for null/undefined.
 */
function normalize(value) {
    return String(value || '').trim();
}

/**
 * Build a consistent Okta error object with optional response details.
 */
function buildOktaError(message, status = null, responseBody = null) {
    const error = new Error(message);
    error.status = status;
    error.responseBody = responseBody;
    return error;
}

/**
 * Resolve Okta base URL + auth header from environment variables.
 *
 * Supported auth modes:
 * 1) OKTA_ACCESS_TOKEN  -> Authorization: Bearer <token>
 * 2) OKTA_API_TOKEN     -> Authorization: SSWS <token>
 *
 * This intentionally avoids client_assertion / JWT service-app signing logic.
 */
function getOktaConfig() {
    const baseUrl = normalize(process.env.OKTA_ORG_URL);
    const accessToken = normalize(process.env.OKTA_ACCESS_TOKEN);
    const apiToken = normalize(process.env.OKTA_API_TOKEN);

    if (!baseUrl) {
        throw new Error('Missing OKTA_ORG_URL');
    }

    if (!accessToken && !apiToken) {
        throw new Error('Missing OKTA_ACCESS_TOKEN or OKTA_API_TOKEN');
    }

    const authHeader = accessToken
        ? `Bearer ${accessToken}`
        : `SSWS ${apiToken}`;

    return {
        baseUrl,
        authHeader
    };
}

/**
 * Sleep helper for retries.
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse response body safely.
 */
async function parseResponseBody(response) {
    const contentType = response.headers.get('content-type') || '';

    try {
        if (contentType.includes('application/json')) {
            return await response.json();
        }

        const text = await response.text();
        return text ? { raw: text } : null;
    } catch {
        return null;
    }
}

/**
 * Low-level Okta request helper.
 *
 * Supported input:
 * {
 *   method: 'GET' | 'POST' | 'PUT' | 'DELETE',
 *   path: '/api/v1/...',
 *   body?: object,
 *   expectedStatus?: number[],
 *   retry?: boolean,
 *   maxAttempts?: number,
 *   context?: { log?: Function }
 * }
 */
async function oktaRequest(options = {}) {
    const {
        method = 'GET',
        path,
        body,
        expectedStatus = [200],
        retry = true,
        maxAttempts = 3,
        context = null
    } = options;

    if (!path) {
        throw new Error('oktaRequest requires a path');
    }

    const { baseUrl, authHeader } = getOktaConfig();

    let attempt = 0;
    let lastError = null;

    while (attempt < maxAttempts) {
        attempt += 1;

        try {
            const response = await fetch(`${baseUrl}${path}`, {
                method,
                headers: {
                    Authorization: authHeader,
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                },
                body: body ? JSON.stringify(body) : undefined
            });

            const responseBody = await parseResponseBody(response);

            const isExpected = expectedStatus.includes(response.status);

            if (!isExpected) {
                const message =
                    responseBody?.errorSummary ||
                    responseBody?.error_description ||
                    responseBody?.error ||
                    responseBody?.raw ||
                    `Okta request failed with status ${response.status}`;

                const retryableStatuses = new Set([429, 500, 502, 503, 504]);

                if (retry && retryableStatuses.has(response.status) && attempt < maxAttempts) {
                    const delay = 300 * Math.pow(2, attempt);

                    if (context?.log) {
                        context.log(JSON.stringify({
                            event: 'IAM_OKTA_RETRY',
                            timestamp: new Date().toISOString(),
                            attempt,
                            delayMs: delay,
                            status: response.status,
                            path
                        }));
                    }

                    await sleep(delay);
                    continue;
                }

                throw buildOktaError(message, response.status, responseBody);
            }

            return responseBody;
        } catch (err) {
            lastError = err;

            const retryableStatuses = new Set([429, 500, 502, 503, 504]);
            const shouldRetry =
                retry &&
                attempt < maxAttempts &&
                (
                    retryableStatuses.has(err?.status) ||
                    err?.name === 'FetchError' ||
                    err?.code === 'ECONNRESET' ||
                    err?.code === 'ETIMEDOUT'
                );

            if (!shouldRetry) {
                throw err;
            }

            const delay = 300 * Math.pow(2, attempt);

            if (context?.log) {
                context.log(JSON.stringify({
                    event: 'IAM_OKTA_RETRY_EXCEPTION',
                    timestamp: new Date().toISOString(),
                    attempt,
                    delayMs: delay,
                    path,
                    message: err?.message || 'Unknown Okta client error'
                }));
            }

            await sleep(delay);
        }
    }

    throw lastError || new Error('Unknown Okta request failure');
}

module.exports = {
    oktaRequest,
    getOktaConfig
};