
'use strict';

const sql = require('mssql');

async function getPool() {
    return sql.connect();
}

async function ensureEventSchema() {
    const pool = await getPool();

    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name = 'IamRequestEvents' AND xtype = 'U')
        CREATE TABLE IamRequestEvents (
            event_id INT IDENTITY(1,1) PRIMARY KEY,
            correlation_id NVARCHAR(100) NOT NULL,
            event_name NVARCHAR(100) NOT NULL,
            from_status NVARCHAR(100) NULL,
            to_status NVARCHAR(100) NULL,
            actor NVARCHAR(255) NULL,
            event_details NVARCHAR(MAX) NULL,
            created_timestamp DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );
    `);
}

/**
 * Append a structured request event.
 */
async function appendRequestEvent(event = {}) {
    await ensureEventSchema();
    const pool = await getPool();

    const details = event.event_details ? JSON.stringify(event.event_details) : null;

    await pool.request()
        .input('correlation_id', event.correlation_id)
        .input('event_name', event.event_name)
        .input('from_status', event.from_status || null)
        .input('to_status', event.to_status || null)
        .input('actor', event.actor || 'SYSTEM')
        .input('event_details', details)
        .query(`
            INSERT INTO IamRequestEvents (
                correlation_id,
                event_name,
                from_status,
                to_status,
                actor,
                event_details,
                created_timestamp
            ) VALUES (
                @correlation_id,
                @event_name,
                @from_status,
                @to_status,
                @actor,
                @event_details,
                SYSUTCDATETIME()
            );
        `);
}

/**
 * Retrieve request events for one correlation ID.
 */
async function getRequestEventsByCorrelationId(correlationId) {
    await ensureEventSchema();
    const pool = await getPool();

    const result = await pool.request()
        .input('correlation_id', correlationId)
        .query(`
            SELECT *
            FROM IamRequestEvents
            WHERE correlation_id = @correlation_id
            ORDER BY event_id ASC
        `);

    return result.recordset;
}

module.exports = {
    ensureEventSchema,
    appendRequestEvent,
    getRequestEventsByCorrelationId
};