'use strict';

// @ts-nocheck

const path = require('path');
const crypto = require('crypto');
const sql = require('mssql');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

function cleanEnv(value) {
    if (value === undefined || value === null) {
        return undefined;
    }

    const text = String(value).trim();
    if (!text) {
        return undefined;
    }

    const unquoted = text.replace(/^['"]|['"]$/g, '').trim();
    return unquoted || undefined;
}

function parseBoolean(value, defaultValue) {
    const text = cleanEnv(value);
    if (text === undefined) {
        return defaultValue;
    }

    return ['true', '1', 'yes', 'y'].includes(text.toLowerCase());
}

function parseNumber(value, defaultValue) {
    const text = cleanEnv(value);
    if (text === undefined) {
        return defaultValue;
    }

    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : defaultValue;
}

function buildSqlConfig() {
    const server = cleanEnv(process.env.DB_SERVER) || cleanEnv(process.env.SQL_SERVER);

    const database =
        cleanEnv(process.env.DB_NAME) ||
        cleanEnv(process.env.SQL_DATABASE) ||
        cleanEnv(process.env.SQL_DB_NAME);

    const user = cleanEnv(process.env.DB_USER) || cleanEnv(process.env.SQL_USER);
    const password = cleanEnv(process.env.DB_PASSWORD) || cleanEnv(process.env.SQL_PASSWORD);

    const port = parseNumber(
        cleanEnv(process.env.DB_PORT) || cleanEnv(process.env.SQL_PORT),
        1433
    );

    const encrypt = parseBoolean(
        cleanEnv(process.env.DB_ENCRYPT) || cleanEnv(process.env.SQL_ENCRYPT),
        true
    );

    const trustServerCertificate = parseBoolean(
        cleanEnv(process.env.DB_TRUST_SERVER_CERTIFICATE) ||
            cleanEnv(process.env.SQL_TRUST_SERVER_CERTIFICATE) ||
            cleanEnv(process.env.SQL_TRUST_SERVER_CERT),
        true
    );

    const poolMax = parseNumber(
        cleanEnv(process.env.DB_POOL_MAX) || cleanEnv(process.env.SQL_POOL_MAX),
        10
    );

    const poolMin = parseNumber(
        cleanEnv(process.env.DB_POOL_MIN) || cleanEnv(process.env.SQL_POOL_MIN),
        0
    );

    const idleTimeoutMillis = parseNumber(
        cleanEnv(process.env.DB_POOL_IDLE_TIMEOUT_MS) ||
            cleanEnv(process.env.SQL_POOL_IDLE_TIMEOUT_MS),
        30000
    );

    return {
        server: server,
        port: port,
        database: database,
        user: user,
        password: password,
        options: {
            encrypt: encrypt,
            trustServerCertificate: trustServerCertificate
        },
        pool: {
            max: poolMax,
            min: poolMin,
            idleTimeoutMillis: idleTimeoutMillis
        }
    };
}

function getSqlConfigDiagnostics() {
    return {
        DB_SERVER: cleanEnv(process.env.DB_SERVER) ? '[set]' : undefined,
        DB_NAME: cleanEnv(process.env.DB_NAME) ? '[set]' : undefined,
        SQL_DATABASE: cleanEnv(process.env.SQL_DATABASE) ? '[set]' : undefined,
        SQL_DB_NAME: cleanEnv(process.env.SQL_DB_NAME) ? '[set]' : undefined,
        DB_USER: cleanEnv(process.env.DB_USER) ? '[set]' : undefined,
        DB_PASSWORD: cleanEnv(process.env.DB_PASSWORD) ? '[set]' : undefined,
        SQL_SERVER: cleanEnv(process.env.SQL_SERVER) ? '[set]' : undefined,
        SQL_USER: cleanEnv(process.env.SQL_USER) ? '[set]' : undefined,
        SQL_PASSWORD: cleanEnv(process.env.SQL_PASSWORD) ? '[set]' : undefined,
        DB_PORT: cleanEnv(process.env.DB_PORT) || undefined,
        SQL_PORT: cleanEnv(process.env.SQL_PORT) || undefined
    };
}

async function getPool() {
    const config = buildSqlConfig();

    if (!config.server || !config.database || !config.user || !config.password) {
        console.error('DB config diagnostics:', getSqlConfigDiagnostics());
        throw new Error(
            'Missing DB config. Required: DB_SERVER/SQL_SERVER, DB_NAME/SQL_DATABASE, DB_USER/SQL_USER, DB_PASSWORD/SQL_PASSWORD'
        );
    }

    return sql.connect(config);
}

async function ensureSchema() {
    const pool = await getPool();

    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name = 'IamRequestRegistry' AND xtype = 'U')
        CREATE TABLE IamRequestRegistry (
            registry_id INT IDENTITY(1,1) PRIMARY KEY,
            correlation_id NVARCHAR(100) NOT NULL,
            request_hash NVARCHAR(255) NULL,
            request_id NVARCHAR(100) NULL,
            requester_identity NVARCHAR(255) NULL,
            target_identity NVARCHAR(255) NULL,
            action_family NVARCHAR(100) NULL,
            requested_action NVARCHAR(255) NULL,
            risk_tier NVARCHAR(50) NULL,
            policy_decision NVARCHAR(100) NULL,
            approval_requirement NVARCHAR(100) NULL,
            approval_record NVARCHAR(MAX) NULL,
            execution_agent NVARCHAR(255) NULL,
            execution_identity NVARCHAR(255) NULL,
            execution_status NVARCHAR(100) NULL,
            execution_tool_or_workflow NVARCHAR(255) NULL,
            completion_status NVARCHAR(100) NULL,
            final_status NVARCHAR(100) NULL,
            current_status NVARCHAR(100) NULL,
            current_step NVARCHAR(100) NULL,
            waiting_on NVARCHAR(100) NULL,
            verification_method NVARCHAR(255) NULL,
            verification_result NVARCHAR(100) NULL,
            verification_status NVARCHAR(100) NULL,
            expected_postcondition NVARCHAR(MAX) NULL,
            details NVARCHAR(MAX) NULL,
            evidence_links NVARCHAR(MAX) NULL,
            created_timestamp DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
            updated_timestamp DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );
    `);
}

function buildRequestHash(record) {
    const safeRecord = record || {};

    const material = [
        safeRecord.requester_identity || '',
        safeRecord.target_identity || '',
        safeRecord.action_family || '',
        safeRecord.requested_action || '',
        safeRecord.expected_postcondition || ''
    ]
        .map(function (value) {
            return String(value).trim().toLowerCase();
        })
        .join('|');

    return crypto.createHash('sha256').update(material).digest('hex');
}

async function createRequest(record) {
    const safeRecord = record || {};

    await ensureSchema();
    const pool = await getPool();

    const requestHash = safeRecord.request_hash || buildRequestHash(safeRecord);
    const details =
        safeRecord.details && typeof safeRecord.details !== 'string'
            ? JSON.stringify(safeRecord.details)
            : safeRecord.details || null;
    const approvalRecord =
        safeRecord.approval_record && typeof safeRecord.approval_record !== 'string'
            ? JSON.stringify(safeRecord.approval_record)
            : safeRecord.approval_record || null;
    const evidenceLinks =
        safeRecord.evidence_links && typeof safeRecord.evidence_links !== 'string'
            ? JSON.stringify(safeRecord.evidence_links)
            : safeRecord.evidence_links || null;

    await pool.request()
        .input('correlation_id', safeRecord.correlation_id)
        .input('request_hash', requestHash)
        .input('request_id', safeRecord.request_id || null)
        .input('requester_identity', safeRecord.requester_identity || null)
        .input('target_identity', safeRecord.target_identity || null)
        .input('action_family', safeRecord.action_family || null)
        .input('requested_action', safeRecord.requested_action || null)
        .input('risk_tier', safeRecord.risk_tier || null)
        .input('policy_decision', safeRecord.policy_decision || null)
        .input('approval_requirement', safeRecord.approval_requirement || null)
        .input('approval_record', approvalRecord)
        .input('execution_agent', safeRecord.execution_agent || null)
        .input('execution_identity', safeRecord.execution_identity || null)
        .input('execution_status', safeRecord.execution_status || null)
        .input('execution_tool_or_workflow', safeRecord.execution_tool_or_workflow || null)
        .input('completion_status', safeRecord.completion_status || null)
        .input('final_status', safeRecord.final_status || null)
        .input('current_status', safeRecord.current_status || 'created')
        .input('current_step', safeRecord.current_step || 'REQUEST_CREATED')
        .input('waiting_on', safeRecord.waiting_on || null)
        .input('verification_method', safeRecord.verification_method || null)
        .input('verification_result', safeRecord.verification_result || null)
        .input('verification_status', safeRecord.verification_status || null)
        .input('expected_postcondition', safeRecord.expected_postcondition || null)
        .input('details', details)
        .input('evidence_links', evidenceLinks)
        .query(`
            INSERT INTO IamRequestRegistry (
                correlation_id,
                request_hash,
                request_id,
                requester_identity,
                target_identity,
                action_family,
                requested_action,
                risk_tier,
                policy_decision,
                approval_requirement,
                approval_record,
                execution_agent,
                execution_identity,
                execution_status,
                execution_tool_or_workflow,
                completion_status,
                final_status,
                current_status,
                current_step,
                waiting_on,
                verification_method,
                verification_result,
                verification_status,
                expected_postcondition,
                details,
                evidence_links,
                created_timestamp,
                updated_timestamp
            ) VALUES (
                @correlation_id,
                @request_hash,
                @request_id,
                @requester_identity,
                @target_identity,
                @action_family,
                @requested_action,
                @risk_tier,
                @policy_decision,
                @approval_requirement,
                @approval_record,
                @execution_agent,
                @execution_identity,
                @execution_status,
                @execution_tool_or_workflow,
                @completion_status,
                @final_status,
                @current_status,
                @current_step,
                @waiting_on,
                @verification_method,
                @verification_result,
                @verification_status,
                @expected_postcondition,
                @details,
                @evidence_links,
                SYSUTCDATETIME(),
                SYSUTCDATETIME()
            );
        `);

    return getRequestByCorrelationId(safeRecord.correlation_id);
}

async function findOpenRequestByHash(requestHash) {
    await ensureSchema();
    const pool = await getPool();

    const result = await pool.request()
        .input('request_hash', requestHash)
        .query(`
            SELECT TOP 1 *
            FROM IamRequestRegistry
            WHERE request_hash = @request_hash
              AND (final_status IS NULL OR final_status NOT IN ('COMPLETED_VERIFIED', 'failed', 'rejected'))
            ORDER BY registry_id DESC
        `);

    return result.recordset[0] || null;
}

async function getRequestByCorrelationId(correlationId) {
    await ensureSchema();
    const pool = await getPool();

    const result = await pool.request()
        .input('correlation_id', correlationId)
        .query(`
            SELECT TOP 1 *
            FROM IamRequestRegistry
            WHERE correlation_id = @correlation_id
            ORDER BY registry_id DESC
        `);

    return result.recordset[0] || null;
}

async function updateRequest(correlationId, updates, actor) {
    const safeUpdates = updates || {};
    const safeActor = actor || 'SYSTEM';

    await ensureSchema();
    const pool = await getPool();
    const request = pool.request().input('correlation_id', correlationId);

    const allowedFields = [
        'request_hash',
        'request_id',
        'requester_identity',
        'target_identity',
        'action_family',
        'requested_action',
        'risk_tier',
        'policy_decision',
        'approval_requirement',
        'approval_record',
        'execution_agent',
        'execution_identity',
        'execution_status',
        'execution_tool_or_workflow',
        'completion_status',
        'final_status',
        'current_status',
        'current_step',
        'waiting_on',
        'verification_method',
        'verification_result',
        'verification_status',
        'expected_postcondition',
        'details',
        'evidence_links'
    ];

    const setClauses = [];

    allowedFields.forEach(function (field) {
        if (Object.prototype.hasOwnProperty.call(safeUpdates, field)) {
            let value = safeUpdates[field];

            if (
                (field === 'details' || field === 'approval_record' || field === 'evidence_links') &&
                value !== null &&
                value !== undefined &&
                typeof value !== 'string'
            ) {
                value = JSON.stringify(value);
            }

            request.input(field, value);
            setClauses.push(field + ' = @' + field);
        }
    });

    if (setClauses.length === 0) {
        return getRequestByCorrelationId(correlationId);
    }

    request.input('actor', safeActor);
    setClauses.push('updated_timestamp = SYSUTCDATETIME()');

    await request.query(`
        UPDATE IamRequestRegistry
        SET ${setClauses.join(', ')}
        WHERE correlation_id = @correlation_id
    `);

    return getRequestByCorrelationId(correlationId);
}

module.exports = {
    buildSqlConfig,
    getSqlConfigDiagnostics,
    getPool,
    ensureSchema,
    buildRequestHash,
    createRequest,
    findOpenRequestByHash,
    getRequestByCorrelationId,
    updateRequest
};