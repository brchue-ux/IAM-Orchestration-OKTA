
'use strict';

/**
 * controlPlaneStore
 *
 * Wave 3 persistence store for control-plane inventory, metrics, and alerts.
 */

const sql = require('mssql');

async function getPool() {
    return sql.connect();
}

async function ensureControlPlaneSchema() {
    const pool = await getPool();

    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name = 'IamAgentInventory' AND xtype = 'U')
        CREATE TABLE IamAgentInventory (
            agent_name NVARCHAR(100) NOT NULL PRIMARY KEY,
            purpose NVARCHAR(255) NULL,
            owner_name NVARCHAR(255) NULL,
            environment_name NVARCHAR(50) NULL,
            risk_tier NVARCHAR(50) NULL,
            identity_mode NVARCHAR(50) NULL,
            tools_used NVARCHAR(MAX) NULL,
            status NVARCHAR(50) NULL,
            version_tag NVARCHAR(50) NULL,
            deployment_state NVARCHAR(50) NULL,
            updated_timestamp DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );
    `);

    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name = 'IamToolInventory' AND xtype = 'U')
        CREATE TABLE IamToolInventory (
            tool_name NVARCHAR(100) NOT NULL PRIMARY KEY,
            target_system NVARCHAR(100) NULL,
            action_family NVARCHAR(100) NULL,
            allowed_environment NVARCHAR(50) NULL,
            owner_name NVARCHAR(255) NULL,
            required_scopes NVARCHAR(MAX) NULL,
            risk_tier NVARCHAR(50) NULL,
            approval_requirements NVARCHAR(255) NULL,
            updated_timestamp DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );
    `);

    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name = 'IamMetricSnapshots' AND xtype = 'U')
        CREATE TABLE IamMetricSnapshots (
            snapshot_id INT IDENTITY(1,1) PRIMARY KEY,
            environment_name NVARCHAR(50) NULL,
            metric_name NVARCHAR(100) NOT NULL,
            metric_value FLOAT NULL,
            metric_details NVARCHAR(MAX) NULL,
            recorded_timestamp DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );
    `);

    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name = 'IamAlerts' AND xtype = 'U')
        CREATE TABLE IamAlerts (
            alert_id INT IDENTITY(1,1) PRIMARY KEY,
            alert_name NVARCHAR(100) NOT NULL,
            severity NVARCHAR(50) NOT NULL,
            correlation_id NVARCHAR(100) NULL,
            alert_details NVARCHAR(MAX) NULL,
            created_timestamp DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );
    `);
}

async function upsertAgentInventory(record = {}) {
    await ensureControlPlaneSchema();
    const pool = await getPool();

    await pool.request()
        .input('agent_name', record.agent_name)
        .input('purpose', record.purpose || null)
        .input('owner_name', record.owner_name || null)
        .input('environment_name', record.environment_name || null)
        .input('risk_tier', record.risk_tier || null)
        .input('identity_mode', record.identity_mode || null)
        .input('tools_used', record.tools_used ? JSON.stringify(record.tools_used) : null)
        .input('status', record.status || null)
        .input('version_tag', record.version_tag || null)
        .input('deployment_state', record.deployment_state || null)
        .query(`
            MERGE IamAgentInventory AS target
            USING (SELECT @agent_name AS agent_name) AS source
            ON target.agent_name = source.agent_name
            WHEN MATCHED THEN
                UPDATE SET
                    purpose = @purpose,
                    owner_name = @owner_name,
                    environment_name = @environment_name,
                    risk_tier = @risk_tier,
                    identity_mode = @identity_mode,
                    tools_used = @tools_used,
                    status = @status,
                    version_tag = @version_tag,
                    deployment_state = @deployment_state,
                    updated_timestamp = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN
                INSERT (
                    agent_name,
                    purpose,
                    owner_name,
                    environment_name,
                    risk_tier,
                    identity_mode,
                    tools_used,
                    status,
                    version_tag,
                    deployment_state,
                    updated_timestamp
                ) VALUES (
                    @agent_name,
                    @purpose,
                    @owner_name,
                    @environment_name,
                    @risk_tier,
                    @identity_mode,
                    @tools_used,
                    @status,
                    @version_tag,
                    @deployment_state,
                    SYSUTCDATETIME()
                );
        `);
}

async function upsertToolInventory(record = {}) {
    await ensureControlPlaneSchema();
    const pool = await getPool();

    await pool.request()
        .input('tool_name', record.tool_name)
        .input('target_system', record.target_system || null)
        .input('action_family', record.action_family || null)
        .input('allowed_environment', record.allowed_environment || null)
        .input('owner_name', record.owner_name || null)
        .input('required_scopes', record.required_scopes ? JSON.stringify(record.required_scopes) : null)
        .input('risk_tier', record.risk_tier || null)
        .input('approval_requirements', record.approval_requirements || null)
        .query(`
            MERGE IamToolInventory AS target
            USING (SELECT @tool_name AS tool_name) AS source
            ON target.tool_name = source.tool_name
            WHEN MATCHED THEN
                UPDATE SET
                    target_system = @target_system,
                    action_family = @action_family,
                    allowed_environment = @allowed_environment,
                    owner_name = @owner_name,
                    required_scopes = @required_scopes,
                    risk_tier = @risk_tier,
                    approval_requirements = @approval_requirements,
                    updated_timestamp = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN
                INSERT (
                    tool_name,
                    target_system,
                    action_family,
                    allowed_environment,
                    owner_name,
                    required_scopes,
                    risk_tier,
                    approval_requirements,
                    updated_timestamp
                ) VALUES (
                    @tool_name,
                    @target_system,
                    @action_family,
                    @allowed_environment,
                    @owner_name,
                    @required_scopes,
                    @risk_tier,
                    @approval_requirements,
                    SYSUTCDATETIME()
                );
        `);
}

async function appendMetricSnapshot(record = {}) {
    await ensureControlPlaneSchema();
    const pool = await getPool();

    await pool.request()
        .input('environment_name', record.environment_name || null)
        .input('metric_name', record.metric_name)
        .input('metric_value', record.metric_value || 0)
        .input('metric_details', record.metric_details ? JSON.stringify(record.metric_details) : null)
        .query(`
            INSERT INTO IamMetricSnapshots (
                environment_name,
                metric_name,
                metric_value,
                metric_details,
                recorded_timestamp
            ) VALUES (
                @environment_name,
                @metric_name,
                @metric_value,
                @metric_details,
                SYSUTCDATETIME()
            );
        `);
}

async function appendAlert(record = {}) {
    await ensureControlPlaneSchema();
    const pool = await getPool();

    await pool.request()
        .input('alert_name', record.alert_name)
        .input('severity', record.severity || 'medium')
        .input('correlation_id', record.correlation_id || null)
        .input('alert_details', record.alert_details ? JSON.stringify(record.alert_details) : null)
        .query(`
            INSERT INTO IamAlerts (
                alert_name,
                severity,
                correlation_id,
                alert_details,
                created_timestamp
            ) VALUES (
                @alert_name,
                @severity,
                @correlation_id,
                @alert_details,
                SYSUTCDATETIME()
            );
        `);
}

async function getLatestMetricSnapshots() {
    await ensureControlPlaneSchema();
    const pool = await getPool();

    const result = await pool.request().query(`
        SELECT *
        FROM IamMetricSnapshots
        ORDER BY snapshot_id DESC
    `);

    return result.recordset;
}

module.exports = {
    ensureControlPlaneSchema,
    upsertAgentInventory,
    upsertToolInventory,
    appendMetricSnapshot,
    appendAlert,
    getLatestMetricSnapshots
};
