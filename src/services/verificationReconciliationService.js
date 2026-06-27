"use strict";

/**
 * verificationReconciliationService
 * Runs post-execution verification with bounded retries, propagation-aware delays,
 * and lightweight root-cause classification for low-risk execution lanes.
 */

const { getExecutionPolicyConfig } = require("../config/executionPolicyConfig");
const { logAuditEvent } = require("./auditLogger");
const { incrementCounter, recordDuration } = require("./metricsCollector");
const { classifyError } = require("../utils/errorClassification");

function sleep(delayMs) {
    return new Promise(function resolveAfterDelay(resolve) {
        setTimeout(resolve, delayMs);
    });
}

function clean(value) {
    if (value === undefined || value === null) {
        return undefined;
    }

    const text = String(value).trim();
    return text || undefined;
}

function normalizeStatus(value) {
    return String(value || "").trim().toLowerCase();
}

function shouldRetryVerification(result) {
    const verificationResult = normalizeStatus(result && result.verification_result);
    return ["verification_pending", "verification_inconclusive"].includes(verificationResult);
}

function calculateVerificationDelay(attempt, config) {
    const retryConfig = config && config.retry ? config.retry : { initialDelayMs: 750, maxDelayMs: 4000 };
    const initialDelayMs = Number(retryConfig.initialDelayMs || 750);
    const maxDelayMs = Number(retryConfig.maxDelayMs || 4000);
    const computed = initialDelayMs * Math.pow(2, Math.max(0, Number(attempt || 1) - 1));
    return Math.min(computed, maxDelayMs);
}

function inferRootCauseDomain(request, verificationResult, observedState) {
    const actionFamily = normalizeStatus(request && request.action_family);
    const details = JSON.stringify({
        verification_result: verificationResult,
        observed_state: observedState || null
    }).toLowerCase();

    if (details.includes("policy")) {
        return "policy";
    }

    if (details.includes("session")) {
        return "session";
    }

    if (details.includes("provision") || details.includes("lag")) {
        return "downstream_provisioning_lag";
    }

    if (actionFamily === "group_fulfillment") {
        return "group_membership";
    }

    if (actionFamily === "app_assignment") {
        return "app_assignment";
    }

    if (actionFamily === "read_only_lookup") {
        return "read_only_lookup";
    }

    return "authorization";
}

function buildFinalVerificationEnvelope(request, execution, attempts, startedAt, finalResult) {
    const verificationResult = normalizeStatus(finalResult && finalResult.verification_result);
    const observedState = finalResult && finalResult.observed_state ? finalResult.observed_state : null;

    return {
        verification_method: clean(finalResult && finalResult.verification_method) || "read_back_reconciliation",
        verification_status:
            verificationResult === "verified_success"
                ? "complete"
                : verificationResult === "verification_pending"
                    ? "pending"
                    : verificationResult === "verification_inconclusive"
                        ? "inconclusive"
                        : verificationResult === "verification_not_required_read_only"
                            ? "complete"
                            : "failed",
        verification_result: verificationResult || "verification_inconclusive",
        verification_agent: "verificationReconciliationService",
        verification_timestamp: new Date().toISOString(),
        expected_state: request && request.expected_postcondition ? request.expected_postcondition : null,
        observed_state: observedState,
        unresolved_discrepancy:
            ["verified_failure", "verification_inconclusive", "verification_pending"].includes(verificationResult)
                ? clean(finalResult && finalResult.unresolved_discrepancy) || "Observed state did not fully match expected state."
                : null,
        retries_attempted: Math.max(0, attempts - 1),
        root_cause_domain: inferRootCauseDomain(request, verificationResult, observedState),
        attempt_history: finalResult && Array.isArray(finalResult.attempt_history)
            ? finalResult.attempt_history
            : [],
        verification_duration_ms: Date.now() - startedAt,
        execution_reference:
            execution && execution.execution_result && execution.execution_result.okta_transaction_id
                ? execution.execution_result.okta_transaction_id
                : execution && execution.execution_result && execution.execution_result.transaction_id
                    ? execution.execution_result.transaction_id
                    : null
    };
}

async function reconcileVerification(request, execution, verifyFn, options) {
    if (typeof verifyFn !== "function") {
        throw new Error("reconcileVerification requires a verifyFn function.");
    }

    const config = getExecutionPolicyConfig((options && options.config) || {});
    const maxAttempts = Number(
        options && options.maxAttempts
            ? options.maxAttempts
            : process.env.VERIFICATION_RETRY_MAX_ATTEMPTS || 3
    );

    const startedAt = Date.now();
    const attemptHistory = [];
    let attempt = 0;
    let finalResult = null;

    while (attempt < maxAttempts) {
        attempt += 1;
        const attemptStartedAt = Date.now();

        try {
            const verification = await verifyFn(request, execution, {
                attempt,
                previous_attempts: attemptHistory
            });

            const attemptRecord = {
                attempt,
                verification_result: normalizeStatus(verification && verification.verification_result) || "verification_inconclusive",
                observed_state: verification && verification.observed_state ? verification.observed_state : null,
                verification_timestamp: new Date().toISOString(),
                duration_ms: Date.now() - attemptStartedAt
            };

            attemptHistory.push(attemptRecord);
            finalResult = Object.assign({}, verification || {}, {
                attempt_history: attemptHistory
            });

            if (!shouldRetryVerification(verification)) {
                break;
            }

            if (attempt < maxAttempts) {
                const delayMs = calculateVerificationDelay(attempt, config);
                await logAuditEvent({
                    correlation_id: request && request.correlation_id ? request.correlation_id : null,
                    event_name: "VERIFICATION_RETRY_SCHEDULED",
                    actor: "verificationReconciliationService",
                    severity: "info",
                    category: "verification",
                    message: `Verification retry ${attempt + 1} scheduled after ${delayMs} ms.`,
                    details: {
                        attempt,
                        next_attempt: attempt + 1,
                        delay_ms: delayMs,
                        latest_verification_result: attemptRecord.verification_result
                    }
                });
                await sleep(delayMs);
            }
        } catch (error) {
            const classified = classifyError(error, { stage: "verification" });
            attemptHistory.push({
                attempt,
                verification_result: "verification_inconclusive",
                observed_state: null,
                verification_timestamp: new Date().toISOString(),
                duration_ms: Date.now() - attemptStartedAt,
                error_message: error.message,
                error_classification: classified.classification
            });

            finalResult = {
                verification_result: "verification_inconclusive",
                verification_method: "read_back_reconciliation",
                observed_state: null,
                unresolved_discrepancy: error.message,
                attempt_history: attemptHistory
            };

            if (attempt >= maxAttempts) {
                break;
            }

            const delayMs = calculateVerificationDelay(attempt, config);
            await sleep(delayMs);
        }
    }

    const envelope = buildFinalVerificationEnvelope(
        request,
        execution,
        attempt,
        startedAt,
        finalResult || {
            verification_result: "verification_inconclusive",
            verification_method: "read_back_reconciliation",
            attempt_history: attemptHistory
        }
    );

    incrementCounter("verification_reconciliation_total", 1, {
        verification_result: envelope.verification_result || "unknown",
        action_family: request && request.action_family ? request.action_family : "unknown"
    });
    recordDuration("verification_reconciliation_duration_ms", envelope.verification_duration_ms, {
        action_family: request && request.action_family ? request.action_family : "unknown"
    });

    await logAuditEvent({
        correlation_id: request && request.correlation_id ? request.correlation_id : null,
        event_name: "VERIFICATION_RECONCILIATION_COMPLETED",
        actor: "verificationReconciliationService",
        severity: envelope.verification_result === "verified_success" ? "info" : "warning",
        category: "verification",
        message: `Verification reconciliation completed with result ${envelope.verification_result}.`,
        details: envelope
    });

    return envelope;
}

module.exports = {
    sleep,
    shouldRetryVerification,
    calculateVerificationDelay,
    inferRootCauseDomain,
    reconcileVerification
};