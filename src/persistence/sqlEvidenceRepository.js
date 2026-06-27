const sql = require('mssql');
const { getConfig } = require('../config/config');

let poolPromise = null;

async function getPool() {
    if (!poolPromise) {
        const config = getConfig();

        if (!config.db.server) {
            throw new Error('Missing DB_SERVER in config');
        }

        if (!config.db.database) {
            throw new Error('Missing DB_NAME in config');
        }

        if (!config.db.user) {
            throw new Error('Missing DB_USER in config');
        }

        if (config.db.password === undefined || config.db.password === null) {
            throw new Error('Missing DB_PASSWORD in config');
        }

        poolPromise = new sql.ConnectionPool(config.db)
            .connect()
            .then(function onConnected(pool) {
                console.log('✅ SQL connected');
                return pool;
            })
            .catch(function onConnectError(err) {
                poolPromise = null;
                throw err;
            });
    }

    return poolPromise;
}

async function closePool() {
    if (poolPromise) {
        const pool = await poolPromise;
        await pool.close();
        poolPromise = null;
    }
}

async function testConnection() {
    const pool = await getPool();
    const result = await pool.request().query(
        'SELECT DB_NAME() AS db_name, GETDATE() AS now'
    );
    return result.recordset;
}

async function upsertRequest(request) {
    if (!request.target_system) {
        throw new Error('Persistence Error: target_system is required');
    }

    const pool = await getPool();

    await pool.request()
        .input('correlation_id', sql.NVarChar(100), request.correlation_id)
        .input('request_id', sql.NVarChar(100), request.request_id)
        .input('requester_identity', sql.NVarChar(255), request.requester_identity)
        .input('requester_source', sql.NVarChar(100), request.requester_source || null)
        .input(
            'requester_authorization_source',
            sql.NVarChar(255),
            request.requester_authorization_source || null
        )
        .input('target_identity', sql.NVarChar(255), request.target_identity)
        .input(
            'target_identifier_type',
            sql.NVarChar(100),
            request.target_identifier_type || null
        )
        .input('target_system', sql.NVarChar(100), request.target_system)
        .input('requested_action', sql.NVarChar(255), request.requested_action)
        .input('action_family', sql.NVarChar(100), request.action_family)
        .input('risk_tier', sql.NVarChar(50), request.risk_tier || null)
        .input(
            'business_justification',
            sql.NVarChar(sql.MAX),
            request.business_justification || null
        )
        .input(
            'approval_requirement',
            sql.NVarChar(100),
            request.approval_requirement || null
        )
        .input(
            'normalized_status',
            sql.NVarChar(100),
            request.normalized_status
        )
        .input('current_status', sql.NVarChar(100), request.current_status)
        .input('final_status', sql.NVarChar(100), request.final_status || null)
        .input(
            'expected_postcondition',
            sql.NVarChar(sql.MAX),
            JSON.stringify(request.expected_postcondition || null)
        )
        .input('approved_by', sql.NVarChar(255), request.approved_by || null)
        .input(
            'approval_reference',
            sql.NVarChar(255),
            request.approval_reference || null
        )
        .input(
            'completion_message',
            sql.NVarChar(sql.MAX),
            request.completion_message || null
        )
        .query(`
MERGE dbo.Requests AS target
USING (SELECT @correlation_id AS correlation_id) AS source
ON target.correlation_id = source.correlation_id
WHEN MATCHED THEN
    UPDATE SET
        request_id = @request_id,
        requester_identity = @requester_identity,
        requester_source = @requester_source,
        requester_authorization_source = @requester_authorization_source,
        target_identity = @target_identity,
        target_identifier_type = @target_identifier_type,
        target_system = @target_system,
        requested_action = @requested_action,
        action_family = @action_family,
        risk_tier = @risk_tier,
        business_justification = @business_justification,
        approval_requirement = @approval_requirement,
        normalized_status = @normalized_status,
        current_status = @current_status,
        final_status = @final_status,
        expected_postcondition = @expected_postcondition,
        approved_by = @approved_by,
        approval_reference = @approval_reference,
        completion_message = @completion_message,
        updated_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT (
        correlation_id,
        request_id,
        requester_identity,
        requester_source,
        requester_authorization_source,
        target_identity,
        target_identifier_type,
        target_system,
        requested_action,
        action_family,
        risk_tier,
        business_justification,
        approval_requirement,
        normalized_status,
        current_status,
        final_status,
        expected_postcondition,
        approved_by,
        approval_reference,
        completion_message
    )
    VALUES (
        @correlation_id,
        @request_id,
        @requester_identity,
        @requester_source,
        @requester_authorization_source,
        @target_identity,
        @target_identifier_type,
        @target_system,
        @requested_action,
        @action_family,
        @risk_tier,
        @business_justification,
        @approval_requirement,
        @normalized_status,
        @current_status,
        @final_status,
        @expected_postcondition,
        @approved_by,
        @approval_reference,
        @completion_message
    );
        `);
}

async function insertStatusHistory(entry) {
    const pool = await getPool();

    await pool.request()
        .input('correlation_id', sql.NVarChar(100), entry.correlation_id)
        .input('status_value', sql.NVarChar(100), entry.status_value)
        .input('status_type', sql.NVarChar(50), entry.status_type)
        .input('changed_by', sql.NVarChar(255), entry.changed_by)
        .input('reason', sql.NVarChar(sql.MAX), entry.reason || null)
        .query(`
            INSERT INTO dbo.RequestStatusHistory (
                correlation_id,
                status_value,
                status_type,
                changed_by,
                reason
            )
            VALUES (
                @correlation_id,
                @status_value,
                @status_type,
                @changed_by,
                @reason
            )
        `);
}

async function insertExecutionRun(run) {
    const pool = await getPool();

    await pool.request()
        .input('correlation_id', sql.NVarChar(100), run.correlation_id)
        .input('execution_agent', sql.NVarChar(100), run.execution_agent)
        .input(
            'execution_tool_or_workflow',
            sql.NVarChar(255),
            run.execution_tool_or_workflow
        )
        .input('downstream_system', sql.NVarChar(100), run.downstream_system)
        .input(
            'final_execution_result',
            sql.NVarChar(100),
            run.final_execution_result
        )
        .input(
            'okta_reference_id',
            sql.NVarChar(255),
            run.okta_reference_id || null
        )
        .input(
            'service_now_record_id',
            sql.NVarChar(255),
            run.service_now_record_id || null
        )
        .query(`
            INSERT INTO dbo.ExecutionRuns (
                correlation_id,
                execution_agent,
                execution_tool_or_workflow,
                downstream_system,
                final_execution_result,
                okta_reference_id,
                service_now_record_id
            )
            VALUES (
                @correlation_id,
                @execution_agent,
                @execution_tool_or_workflow,
                @downstream_system,
                @final_execution_result,
                @okta_reference_id,
                @service_now_record_id
            )
        `);
}

async function insertVerification(verification) {
    const pool = await getPool();

    await pool.request()
        .input('correlation_id', sql.NVarChar(100), verification.correlation_id)
        .input(
            'verification_method',
            sql.NVarChar(255),
            verification.verification_method
        )
        .input(
            'verification_result',
            sql.NVarChar(100),
            verification.verification_result
        )
        .input(
            'expected_state',
            sql.NVarChar(sql.MAX),
            JSON.stringify(verification.expected_state || null)
        )
        .input(
            'observed_state',
            sql.NVarChar(sql.MAX),
            JSON.stringify(verification.observed_state || null)
        )
        .query(`
            INSERT INTO dbo.VerificationResults (
                correlation_id,
                verification_method,
                verification_result,
                expected_state,
                observed_state
            )
            VALUES (
                @correlation_id,
                @verification_method,
                @verification_result,
                @expected_state,
                @observed_state
            )
        `);
}

async function insertNotification(notification) {
    const pool = await getPool();

    await pool.request()
        .input('correlation_id', sql.NVarChar(100), notification.correlation_id)
        .input('recipient', sql.NVarChar(255), notification.recipient)
        .input('channel', sql.NVarChar(100), notification.channel)
        .input(
            'message_category',
            sql.NVarChar(100),
            notification.message_category
        )
        .input(
            'status_communicated',
            sql.NVarChar(100),
            notification.status_communicated
        )
        .input('message_body', sql.NVarChar(sql.MAX), notification.message_body)
        .query(`
            INSERT INTO dbo.Notifications (
                correlation_id,
                recipient,
                channel,
                message_category,
                status_communicated,
                message_body
            )
            VALUES (
                @correlation_id,
                @recipient,
                @channel,
                @message_category,
                @status_communicated,
                @message_body
            )
        `);
}

async function insertPolicyDecision(policy) {
    const pool = await getPool();

    await pool.request()
        .input('correlation_id', sql.NVarChar(100), policy.correlation_id)
        .input('request_id', sql.NVarChar(100), policy.request_id)
        .input('policy_decision', sql.NVarChar(100), policy.policy_decision)
        .input(
            'policy_reasons',
            sql.NVarChar(sql.MAX),
            JSON.stringify(policy.policy_reasons || [])
        )
        .input(
            'evaluated_rules',
            sql.NVarChar(sql.MAX),
            JSON.stringify(policy.evaluated_rules || [])
        )
        .input(
            'authorization_source',
            sql.NVarChar(255),
            policy.authorization_source || null
        )
        .input(
            'approval_record',
            sql.NVarChar(sql.MAX),
            JSON.stringify(policy.approval_record || null)
        )
        .input(
            'evaluated_at',
            sql.DateTime2,
            policy.evaluated_at ? new Date(policy.evaluated_at) : new Date()
        )
        .query(`
            INSERT INTO dbo.PolicyDecisions (
                correlation_id,
                request_id,
                policy_decision,
                policy_reasons,
                evaluated_rules,
                authorization_source,
                approval_record,
                evaluated_at
            )
            VALUES (
                @correlation_id,
                @request_id,
                @policy_decision,
                @policy_reasons,
                @evaluated_rules,
                @authorization_source,
                @approval_record,
                @evaluated_at
            )
        `);
}

module.exports = {
    getPool,
    closePool,
    testConnection,
    upsertRequest,
    insertStatusHistory,
    insertExecutionRun,
    insertVerification,
    insertNotification,
    insertPolicyDecision
};