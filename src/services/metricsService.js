
'use strict';

/**
 * metricsService
 *
 * Wave 3 control-plane metrics service.
 */

const sql = require('mssql');
const { ensureSchema } = require('./requestRegistryStore');
const { ensureEventSchema } = require('./requestEventStore');
const { appendMetricSnapshot, appendAlert } = require('./controlPlaneStore');

async function getPool() {
    return sql.connect();
}

async function queryScalar(queryText) {
    const pool = await getPool();
    const result = await pool.request().query(queryText);
    const firstRow = result.recordset[0] || {};
    const firstKey = Object.keys(firstRow)[0];
    return firstKey ? Number(firstRow[firstKey] || 0) : 0;
}

/**
 * Capture a point-in-time control-plane snapshot from request data.
 *
 * @returns {object} Recorded metric summary.
 */
async function recordControlPlaneSnapshot() {
    await ensureSchema();
    await ensureEventSchema();

    const totalRequests = await queryScalar('SELECT COUNT(*) AS total_requests FROM IamRequestRegistry');
    const completedRequests = await queryScalar("SELECT COUNT(*) AS completed_requests FROM IamRequestRegistry WHERE final_status = 'COMPLETED_VERIFIED'");
    const failedRequests = await queryScalar("SELECT COUNT(*) AS failed_requests FROM IamRequestRegistry WHERE final_status = 'failed'");
    const approvalPending = await queryScalar("SELECT COUNT(*) AS approval_pending FROM IamRequestRegistry WHERE current_status IN ('approval_required', 'approval_pending')");
    const verificationPending = await queryScalar("SELECT COUNT(*) AS verification_pending FROM IamRequestRegistry WHERE current_status = 'verification_pending'");

    const successRate = totalRequests > 0 ? completedRequests / totalRequests : 0;
    const failureRate = totalRequests > 0 ? failedRequests / totalRequests : 0;

    const metrics = [
        { metric_name: 'total_requests', metric_value: totalRequests },
        { metric_name: 'completed_requests', metric_value: completedRequests },
        { metric_name: 'failed_requests', metric_value: failedRequests },
        { metric_name: 'approval_pending', metric_value: approvalPending },
        { metric_name: 'verification_pending', metric_value: verificationPending },
        { metric_name: 'success_rate', metric_value: successRate },
        { metric_name: 'failure_rate', metric_value: failureRate }
    ];

    for (const metric of metrics) {
        await appendMetricSnapshot({
            environment_name: process.env.APP_ENV || 'dev',
            metric_name: metric.metric_name,
            metric_value: metric.metric_value,
            metric_details: {
                total_requests: totalRequests,
                completed_requests: completedRequests,
                failed_requests: failedRequests,
                approval_pending: approvalPending,
                verification_pending: verificationPending
            }
        });
    }

    if (failureRate >= 0.5 && totalRequests > 0) {
        await appendAlert({
            alert_name: 'high_failure_rate',
            severity: 'high',
            alert_details: {
                failure_rate: failureRate,
                failed_requests: failedRequests,
                total_requests: totalRequests
            }
        });
    }

    return {
        environment_name: process.env.APP_ENV || 'dev',
        total_requests: totalRequests,
        completed_requests: completedRequests,
        failed_requests: failedRequests,
        approval_pending: approvalPending,
        verification_pending: verificationPending,
        success_rate: successRate,
        failure_rate: failureRate
    };
}

module.exports = {
    recordControlPlaneSnapshot
};
