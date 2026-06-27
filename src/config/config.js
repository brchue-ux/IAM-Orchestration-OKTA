/**
 * Central configuration provider.
 *
 * Returns database and Okta runtime configuration.
 * Database config is validated eagerly because the app depends on it.
 * Okta config is validated only when execution is attempted.
 */

function getConfig() {
    const config = {
        db: {
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            server: process.env.DB_SERVER,
            database: process.env.DB_NAME,
            options: {
                encrypt: true,
                trustServerCertificate: true
            }
        },
        okta: {
            baseUrl: process.env.OKTA_BASE_URL || null,
            apiToken: process.env.OKTA_API_TOKEN || null,
            allowExecution: parseBool(process.env.OKTA_ALLOW_EXECUTION, false),
            environment: process.env.OKTA_ENVIRONMENT || 'unknown',
            requestTimeoutMs: parseNumber(
                process.env.OKTA_REQUEST_TIMEOUT_MS,
                15000
            )
        }
    };

    if (!config.db.server) {
        throw new Error('Missing DB_SERVER in .env');
    }

    if (!config.db.database) {
        throw new Error('Missing DB_NAME in .env');
    }

    if (!config.db.user) {
        throw new Error('Missing DB_USER in .env');
    }

    if (config.db.password === undefined || config.db.password === null) {
        throw new Error('Missing DB_PASSWORD in .env');
    }

    return config;
}

/**
 * Parse boolean-like environment values.
 *
 * @param {string|undefined|null} value
 * @param {boolean} defaultValue
 * @returns {boolean}
 */
function parseBool(value, defaultValue) {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }

    const normalized = String(value).trim().toLowerCase();

    if (['true', '1', 'yes', 'on'].includes(normalized)) {
        return true;
    }

    if (['false', '0', 'no', 'off'].includes(normalized)) {
        return false;
    }

    return defaultValue;
}

/**
 * Parse number-like environment values.
 *
 * @param {string|undefined|null} value
 * @param {number} defaultValue
 * @returns {number}
 */
function parseNumber(value, defaultValue) {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }

    const parsed = Number(value);

    if (Number.isNaN(parsed)) {
        return defaultValue;
    }

    return parsed;
}

module.exports = {
    getConfig
};