const sql = require('mssql');const letpoolPromise = null;

/**
 * Build SQL connection config from environment variables.
 *
 * Required env vars:
 * - SQL_SERVER
 * - SQL_DATABASE
 * - SQL_USER
 * - SQL_PASSWORD
 */
function buildConfig() {
    return {
        server: process.env.SQL_SERVER,
        database: process.env.SQL_DATABASE,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        options: {
            encrypt: String(process.env.SQL_ENCRYPT || 'true').toLowerCase() === 'true',
            trustServerCertificate:
                String(process.env.SQL_TRUST_SERVER_CERT || 'true').toLowerCase() === 'true'
        },
        pool: {
            max: Number(process.env.SQL_POOL_MAX || 10),
            min: Number(process.env.SQL_POOL_MIN || 0),
            idleTimeoutMillis: Number(process.env.SQL_POOL_IDLE_TIMEOUT_MS || 30000)
        }
    };
}

/**
 * Return shared connection pool.
 */
async function getPool() {
    if (!poolPromise) {
        poolPromise = sql.connect(buildConfig());
    }
    return poolPromise;
}

/**
 * Optional helper for direct query pattern.
 */
async function query(configure) {
    const pool = await getPool();
    const request = pool.request();
    configure(request);
    return request.query(request.__queryText);
}

function setQuery(request, text) {
    request.__queryText = text;
    return request;
}

module.exports = {
    sql,
    getPool,
    query,
    setQuery
};