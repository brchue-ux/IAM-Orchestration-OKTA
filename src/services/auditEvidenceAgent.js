
'use strict';

/**
 * AuditEvidenceAgent
 *
 * Wave 3 audit / evidence reconstruction agent.
 * Builds a structured evidence package from the request registry and request events.
 */

const { getRequestByCorrelationId } = require('./requestRegistryStore');
const { getRequestEventsByCorrelationId } = require('./requestEventStore');

function safeParseJson(value) {
    if (!value || typeof value !== 'string') {
        return value || null;
    }

    try {
        return JSON.parse(value);
    } catch (error) {
        return value;
    }
}

function parseEvent(event = {}) {
    return {
        ...event,
        event_details: safeParseJson(event.event_details)
    };
}

function buildVerificationSummary(requestRecord = {}, executionResult = {}) {
    return {
        verification_method: requestRecord.verification_method || 'router_simulation_check',
        verification_result:
            requestRecord.verification_result ||
            (executionResult?.executionState === 'SUCCESS'
                ? 'verified_success'
                : 'verified_failure'),
        verification_status: requestRecord.verification_status || null,
        expected_postcondition: requestRecord.expected_postcondition || null
    };
}

/**
 * Build an enterprise-style evidence package for one correlation ID.
 *
 * @param {string} correlationId Request correlation ID.
 * @param {object} executionResult Optional execution result from the live flow.
 * @returns {object} Structured evidence package.
 */
async function buildEvidencePackage(correlationId, executionResult = null) {
    const requestRecord = await getRequestByCorrelationId(correlationId);

    if (!requestRecord) {
        throw new Error(`No request record found for correlation ID: ${correlationId}`);
    }

    const events = await getRequestEventsByCorrelationId(correlationId);
    const parsedEvents = events.map(parseEvent);

    return {
        correlation_id: requestRecord.correlation_id,
        request_id: requestRecord.request_id,
        requester_identity: requestRecord.requester_identity,
        requester_authorization_source: requestRecord.requester_source || null,
        requester_source_channel: requestRecord.source_channel || null,
        target_identity: requestRecord.target_identity,
        normalized_action: requestRecord.requested_action,
        action_family: requestRecord.action_family,
        risk_tier: requestRecord.risk_tier,
        policy_decision: requestRecord.policy_decision,
        approval_requirement: requestRecord.approval_requirement,
        approval_record: safeParseJson(requestRecord.approval_record),
        execution_agent: requestRecord.execution_agent || null,
        execution_tool_or_workflow: requestRecord.execution_tool_or_workflow || null,
        execution_identity: requestRecord.execution_identity || null,
        execution_result: executionResult || {
            execution_status: requestRecord.execution_status || null,
            completion_status: requestRecord.completion_status || null,
            final_status: requestRecord.final_status || null
        },
        verification: buildVerificationSummary(requestRecord, executionResult),
        final_status: requestRecord.final_status || requestRecord.completion_status || requestRecord.current_status,
        evidence_links: safeParseJson(requestRecord.evidence_links),
        details: safeParseJson(requestRecord.details),
        timestamps: {
            created_timestamp: requestRecord.created_timestamp,
            updated_timestamp: requestRecord.updated_timestamp
        },
        event_stream: parsedEvents
    };
}

module.exports = {
    buildEvidencePackage,
    safeParseJson,
    parseEvent
};
