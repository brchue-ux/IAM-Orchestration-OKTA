"use strict";

/**
 * promotionGateValidator
 * Evaluates whether the runtime is ready to be classified as Stage 4 low-risk execution
 * using metrics thresholds, rollback proof, alert posture, and compliance coverage.
 */

const { getMetricsSnapshot } = require("../services/metricsCollector");
const { listRegisteredAgents } = require("../control-plane/agentRegistryStore");
const { getComplianceRecords } = require("../control-plane/policyComplianceTracker");
const { listAlerts } = require("../control-plane/alertingService");
const { listRollbackEvents } = require("./rollbackController");

function parseNumber(value, fallbackValue) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallbackValue;
}

function getThresholds() {
    return {
        minimumExecutionSuccessRate: parseNumber(process.env.PROMOTION_MIN_SUCCESS_RATE, 0.95),
        maximumFailureRate: parseNumber(process.env.PROMOTION_MAX_FAILURE_RATE, 0.05),
        minimumComplianceRecords: parseNumber(process.env.PROMOTION_MIN_COMPLIANCE_RECORDS, 5),
        requireRollbackProof: String(process.env.PROMOTION_REQUIRE_ROLLBACK_PROOF || "true").trim().toLowerCase() !== "false",
        maximumHighSeverityAlerts: parseNumber(process.env.PROMOTION_MAX_HIGH_ALERTS, 0)
    };
}

function extractMetricValue(metricsSnapshot, metricNamePrefix) {
    const counters = metricsSnapshot && metricsSnapshot.counters ? metricsSnapshot.counters : {};
    return Object.keys(counters).reduce(function accumulate(total, key) {
        return key.startsWith(metricNamePrefix) ? total + Number(counters[key] || 0) : total;
    }, 0);
}

function buildMetricsAssessment(metricsSnapshot, thresholds) {
    const successCount = extractMetricValue(metricsSnapshot, "request_router_completion_total|status=completed_verified");
    const failureCount = extractMetricValue(metricsSnapshot, "request_router_completion_total|status=failed") +
        extractMetricValue(metricsSnapshot, "request_router_failures_total");
    const totalTerminated = successCount + failureCount;
    const successRate = totalTerminated > 0 ? successCount / totalTerminated : 0;
    const failureRate = totalTerminated > 0 ? failureCount / totalTerminated : 0;

    return {
        success_count: successCount,
        failure_count: failureCount,
        total_terminated_requests: totalTerminated,
        success_rate: successRate,
        failure_rate: failureRate,
        meets_success_rate_threshold: successRate >= thresholds.minimumExecutionSuccessRate,
        meets_failure_rate_threshold: failureRate <= thresholds.maximumFailureRate,
        metrics_present: Boolean(metricsSnapshot && metricsSnapshot.last_updated)
    };
}

function buildRollbackAssessment(rollbackEvents, thresholds) {
    const events = Array.isArray(rollbackEvents) ? rollbackEvents : [];
    const rollbackProofCount = events.filter(function filterEvent(event) {
        return event && event.rollback_plan && event.rollback_plan.requires_human_confirmation === true;
    }).length;

    return {
        rollback_event_count: events.length,
        rollback_proof_count: rollbackProofCount,
        meets_requirement: thresholds.requireRollbackProof ? rollbackProofCount > 0 : true
    };
}

async function validatePromotionReadiness() {
    const reasons = [];
    const thresholds = getThresholds();
    const metrics = getMetricsSnapshot();
    const agents = await listRegisteredAgents();
    const compliance = await getComplianceRecords();
    const alerts = await listAlerts();
    const rollbackEvents = await listRollbackEvents();

    const metricsAssessment = buildMetricsAssessment(metrics, thresholds);
    const rollbackAssessment = buildRollbackAssessment(rollbackEvents, thresholds);

    if (!Array.isArray(agents) || agents.length === 0) {
        reasons.push("No agents are registered in the control plane.");
    }

    if (!Array.isArray(compliance) || compliance.length < thresholds.minimumComplianceRecords) {
        reasons.push(`At least ${thresholds.minimumComplianceRecords} policy compliance records are required.`);
    }

    const highSeverityAlerts = alerts.filter(function filterAlert(alert) {
        return String(alert && alert.severity || "").toLowerCase() === "high";
    });

    if (highSeverityAlerts.length > thresholds.maximumHighSeverityAlerts) {
        reasons.push("High-severity alerts are still open in the control plane.");
    }

    if (!metricsAssessment.metrics_present) {
        reasons.push("Metrics have not been collected for the runtime.");
    }

    if (!metricsAssessment.meets_success_rate_threshold) {
        reasons.push(
            `Execution success rate ${metricsAssessment.success_rate.toFixed(4)} is below the threshold ${thresholds.minimumExecutionSuccessRate.toFixed(4)}.`
        );
    }

    if (!metricsAssessment.meets_failure_rate_threshold) {
        reasons.push(
            `Execution failure rate ${metricsAssessment.failure_rate.toFixed(4)} exceeds the threshold ${thresholds.maximumFailureRate.toFixed(4)}.`
        );
    }

    if (!rollbackAssessment.meets_requirement) {
        reasons.push("Rollback proof is required but no rollback-proof event was found.");
    }

    return {
        passed: reasons.length === 0,
        reasons,
        promotion_target: "stage_4_low_risk_execution",
        policy_decision: reasons.length === 0 ? "promotion_ready" : "promotion_blocked",
        thresholds,
        metrics_assessment: metricsAssessment,
        rollback_assessment: rollbackAssessment,
        supporting_counts: {
            registered_agents: Array.isArray(agents) ? agents.length : 0,
            compliance_records: Array.isArray(compliance) ? compliance.length : 0,
            high_severity_alerts: highSeverityAlerts.length
        }
    };
}

module.exports = {
    getThresholds,
    extractMetricValue,
    buildMetricsAssessment,
    buildRollbackAssessment,
    validatePromotionReadiness
};