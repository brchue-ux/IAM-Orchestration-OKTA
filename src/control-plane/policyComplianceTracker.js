"use strict";

/**
 * policyComplianceTracker
 * Persists policy compliance evaluations for requests and agents.
 */

const { appendRecord, getCollection } = require("./controlPlaneStore");

async function recordCompliance(record) {
    return appendRecord("policy_compliance", record || {});
}

async function getComplianceRecords() {
    return getCollection("policy_compliance");
}

async function evaluateAndRecordCompliance(request, result) {
    const complianceRecord = {
        correlation_id: request && request.correlation_id || null,
        request_id: request && request.request_id || null,
        action_family: request && request.action_family || null,
        policy_decision: result && result.policy_decision || null,
        status: result && result.status || null,
        verification_result: result && result.verification && result.verification.verification_result || null,
        compliant: Boolean(result && ["approved", "allowed_without_approval"].includes(result.policy_decision))
    };

    if (result && result.status && String(result.status).toLowerCase() === "completed_verified") {
        complianceRecord.compliant = true;
    }

    if (result && result.error_classification) {
        complianceRecord.compliant = false;
        complianceRecord.error_classification = result.error_classification;
    }

    return recordCompliance(complianceRecord);
}

module.exports = {
    recordCompliance,
    getComplianceRecords,
    evaluateAndRecordCompliance
};