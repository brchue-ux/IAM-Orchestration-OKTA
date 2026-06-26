
'use strict';

/**
 * temporaryAccessScheduler
 *
 * Wave 4 scheduler for temporary / time-bound access.
 * Computes expiration, records revocation intent, and tracks revocation status.
 * Intended location: src/services/temporaryAccessScheduler.js
 */

const sql = require('mssql');
const { updateRequest, getRequestByCorrelationId } = require('./requestRegistryStore');
const { appendRequestEvent } = require('./requestEventStore');
const { appendAlert } = require('./controlPlaneStore');

async function getPool() {
    return sql.connect();
}

/**
 * Ensure temporary-access schedule table exists.
 */
async function ensureTemporaryAccessSchema() {
    const pool = await getPool();

    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name = 'IamTemporaryAccessSchedule' AND xtype = 'U')
        CREATE TABLE IamTemporaryAccessSchedule (
            schedule_id INT IDENTITY(1,1) PRIMARY KEY,
            correlation_id NVARCHAR(100) NOT NULL,
            request_id NVARCHAR(100) NULL,
            target_identity NVARCHAR(255) NULL,
            action_family NVARCHAR(100) NULL,
            access_descriptor NVARCHAR(255) NULL,
            requested_duration NVARCHAR(100) NULL,
            expires_at DATETIME2 NOT NULL,
            revocation_status NVARCHAR(50) NOT NULL DEFAULT 'scheduled',
            revocation_reference NVARCHAR(100) NULL,
            created_timestamp DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
            updated_timestamp DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );
    `);
}

/**
 * Parse a simple duration string into milliseconds.
 * Supports values like 4h, 8h, 1d, 7d, 30m.
 */
function parseDurationToMilliseconds(value) {
    const text = String(value || '').trim().toLowerCase();
    const match = text.match(/^(\d+)(m|h|d)$/);

    if (!match) {
        return null;
    }

    const amount = Number(match[1]);
    const unit = match[2];

    if (unit === 'm') return amount * 60 * 1000;
    if (unit === 'h') return amount * 60 * 60 * 1000;
    if (unit === 'd') return amount * 24 * 60 * 60 * 1000;
    return null;
}

/**
 * Compute expiration timestamp from the requested duration.
 */
function buildExpirationTimestamp(request = {}) {
    const duration = request.requested_duration || request.temporary_duration || null;
    const milliseconds = parseDurationToMilliseconds(duration);

    if (!milliseconds) {
        return null;
    }

    return new Date(Date.now() + milliseconds).toISOString();
}

/**
 * Schedule temporary access revocation after a successful grant.
 */
async function scheduleTemporaryAccess(request = {}, executionResult = {}) {
    await ensureTemporaryAccessSchema();

    const expiresAt = buildExpirationTimestamp(request);
    if (!expiresAt) {
        throw new Error('Unable to schedule temporary access because requested_duration is missing or invalid.');
    }

    const pool = await getPool();
    const accessDescriptor =
        request.group_identifier ||
        request.app_identifier ||
        request.target_resource ||
        request.requested_action ||
        'temporary_access';

    await pool.request()
        .input('correlation_id', request.correlation_id)
        .input('request_id', request.request_id || request.correlation_id)
        .input('target_identity', request.target_identity || request.target_user_identifier || null)
        .input('action_family', request.action_family || null)
        .input('access_descriptor', accessDescriptor)
        .input('requested_duration', request.requested_duration || request.temporary_duration || null)
        .input('expires_at', expiresAt)
        .query(`
            INSERT INTO IamTemporaryAccessSchedule (
                correlation_id,
                request_id,
                target_identity,
                action_family,
                access_descriptor,
                requested_duration,
                expires_at,
                revocation_status,
                created_timestamp,
                updated_timestamp
            ) VALUES (
                @correlation_id,
                @request_id,
                @target_identity,
                @action_family,
                @access_descriptor,
                @requested_duration,
                @expires_at,
                'scheduled',
                SYSUTCDATETIME(),
                SYSUTCDATETIME()
            );
        `);

    await appendRequestEvent({
        correlation_id: request.correlation_id,
        event_name: 'TEMPORARY_ACCESS_SCHEDULED',
        from_status: request.current_status || 'execution_started',
        to_status: request.current_status || 'execution_started',
        actor: 'TemporaryAccessScheduler',
        event_details: {
            requested_duration: request.requested_duration || request.temporary_duration || null,
            expires_at: expiresAt,
            access_descriptor: accessDescriptor,
            execution_result: executionResult
        }
    });

    await updateRequest(request.correlation_id, {
        details: {
            temporary_access: {
                scheduled: true
            },
            temporary_access_schedule: {
                requested_duration: request.requested_duration || request.temporary_duration || null,
                expires_at: expiresAt,
                access_descriptor: accessDescriptor
            }
        }
    }, 'TemporaryAccessScheduler');

    return {
        scheduled: true,
        expires_at: expiresAt,
        access_descriptor: accessDescriptor,
        requested_duration: request.requested_duration || request.temporary_duration || null
    };
}

/**
 * Return all schedules that are due for revocation.
 */
async function getDueRevocations() {
    await ensureTemporaryAccessSchema();
    const pool = await getPool();

    const result = await pool.request().query(`
        SELECT *
        FROM IamTemporaryAccessSchedule
        WHERE revocation_status = 'scheduled'
          AND expires_at <= SYSUTCDATETIME()
        ORDER BY expires_at ASC
    `);

    return result.recordset;
}

/**
 * Mark a revocation as completed.
 */
async function markRevocationCompleted(scheduleId, revocationReference = null) {
    await ensureTemporaryAccessSchema();
    const pool = await getPool();

    await pool.request()
        .input('schedule_id', scheduleId)
        .input('revocation_reference', revocationReference)
        .query(`
            UPDATE IamTemporaryAccessSchedule
            SET revocation_status = 'completed',
                revocation_reference = @revocation_reference,
                updated_timestamp = SYSUTCDATETIME()
            WHERE schedule_id = @schedule_id
        `);
}

/**
 * Mark a revocation as failed and raise a control-plane alert.
 */
async function markRevocationFailed(scheduleId, correlationId, reason) {
    await ensureTemporaryAccessSchema();
    const pool = await getPool();

    await pool.request()
        .input('schedule_id', scheduleId)
        .query(`
            UPDATE IamTemporaryAccessSchedule
            SET revocation_status = 'failed',
                updated_timestamp = SYSUTCDATETIME()
            WHERE schedule_id = @schedule_id
        `);

    await appendAlert({
        alert_name: 'temporary_access_revocation_failed',
        severity: 'high',
        correlation_id: correlationId || null,
        alert_details: {
            schedule_id: scheduleId,
            reason
        }
    });
}

module.exports = {
    ensureTemporaryAccessSchema,
    parseDurationToMilliseconds,
    buildExpirationTimestamp,
    scheduleTemporaryAccess,
    getDueRevocations,
    markRevocationCompleted,
    markRevocationFailed
};
