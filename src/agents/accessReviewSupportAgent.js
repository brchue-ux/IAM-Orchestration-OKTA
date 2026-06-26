
'use strict';

/**
 * AccessReviewSupportAgent
 *
 * Wave 4 read-only support agent for access review / certification preparation.
 * Intended location: src/agents/accessReviewSupportAgent.js
 */

const sql = require('mssql');
const { buildEvidencePackage } = require('../services/auditEvidenceAgent');
const { appendRequestEvent } = require('../services/requestEventStore');

async function getPool() {
    return sql.connect();
}

/**
 * Build a read-only access review summary for one target identity.
 */
async function buildAccessReviewSummary(request = {}) {
    const targetIdentity = request.target_identity || request.target_user_identifier || null;
    if (!targetIdentity) {
        throw new Error('target_identity is required for access review support.');
    }

    const pool = await getPool();
    const result = await pool.request()
        .input('target_identity', targetIdentity)
        .query(`
            SELECT TOP 50
                correlation_id,
                request_id,
                action_family,
                requested_action,
                policy_decision,
                approval_requirement,
                execution_agent,
                final_status,
                created_timestamp,
                updated_timestamp
            FROM IamRequestRegistry
            WHERE target_identity = @target_identity
            ORDER BY updated_timestamp DESC
        `);

    return {
        target_identity: targetIdentity,
        review_records: result.recordset,
        recommendation: 'Review the most recent verified and failed requests before selecting candidate remediation actions.'
    };
}

/**
 * Execute access review support in a read-only manner.
 */
async function execute(request = {}, context = {}) {
    if (context?.log) {
        context.log('AccessReviewSupportAgent: execution started');
    }

    const summary = await buildAccessReviewSummary(request);
    const evidence = request.correlation_id
        ? await buildEvidencePackage(request.correlation_id).catch(() => null)
        : null;

    if (request.correlation_id) {
        await appendRequestEvent({
            correlation_id: request.correlation_id,
            event_name: 'ACCESS_REVIEW_SUMMARY_PREPARED',
            from_status: request.current_status || 'ready_for_execution',
            to_status: request.current_status || 'ready_for_execution',
            actor: 'AccessReviewSupportAgent',
            event_details: {
                target_identity: summary.target_identity,
                record_count: summary.review_records.length
            }
        });
    }

    return {
        allowed: true,
        executionResult: {
            executionState: 'SUCCESS',
            executionMode: 'READ_ONLY_SUPPORT',
            agentName: 'AccessReviewSupportAgent',
            message: 'Access review summary prepared in read-only mode.',
            timestamp: new Date().toISOString(),
            reviewSummary: summary,
            evidencePackage: evidence
        }
    };
}

module.exports = {
    execute,
    buildAccessReviewSummary
};
