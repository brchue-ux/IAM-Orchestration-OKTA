"use strict";

/**
 * autoHealingRetryService
 *
 * Scans persisted request state and performs bounded verification-only
 * reconciliation for eligible requests. It does not re-execute unsafe write actions.
 * It also emits metrics and re-evaluates alerts after each sweep so the runtime
 * automatically updates the control plane.
 */

const { listRequests, updateRequest } = require("./requestRegistryStore");
const { reconcileRequest } = require("./reconciliationService");
const { logAuditEvent } = require("./auditLogger");
const { incrementCounter } = require("./metricsCollector");
const { evaluateAlerts } = require("../control-plane/alertingService");

function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
}

function parseNumber(value, fallbackValue) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallbackValue;
}

function buildPolicy() {
    return {
        maxAttempts: parseNumber(process.env.AUTO_HEAL_MAX_ATTEMPTS, 3),
        initialDelayMs: parseNumber(process.env.AUTO_HEAL_INITIAL_DELAY_MS, 2000),
        maxDelayMs: parseNumber(process.env.AUTO_HEAL_MAX_DELAY_MS, 60000),
        limitPerSweep: parseNumber(process.env.AUTO_HEAL_LIMIT_PER_SWEEP, 10),
        enabled: String(process.env.AUTO_HEAL_ENABLED || "true").trim().toLowerCase() !== "false"
    };
}

function computeBackoffDelay(attemptNumber, policy) {
    const computed = policy.initialDelayMs * Math.pow(2, Math.max(0, attemptNumber - 1));
    return Math.min(computed, policy.maxDelayMs);
}

function isEligibleForAutoHeal(record, policy, nowTimestamp) {
    if (!record || !record.correlation_id) {
        return false;
    }

    const status = normalizeText(record.current_status || record.final_status);

    if (![
        "verification_pending",
        "verification_inconclusive",
        "failed",
        "manual_review",
        "completed_unverified"
    ].includes(status)) {
        return false;
    }

    const attempts = Number(record.reconciliation_attempts || 0);
    if (attempts >= policy.maxAttempts) {
        return false;
    }

    const lastAttemptAt = record.reconciliation_last_attempt_at
        ? Date.parse(record.reconciliation_last_attempt_at)
        : 0;

    const nextEligibleAt = lastAttemptAt + computeBackoffDelay(Math.max(1, attempts + 1), policy);
    return nowTimestamp >= nextEligibleAt;
}

async function processAutoHealSweep(options) {
    const policy = buildPolicy();

    if (!policy.enabled) {
        return {
            policy,
            processed: [],
            skipped: [],
            message: "Auto-healing is disabled."
        };
    }

    const now = Date.now();
    const records = listRequests({ limit: policy.limitPerSweep * 10 }) || [];
    const eligible = records
        .filter(function filterEligible(record) {
            return isEligibleForAutoHeal(record, policy, now);
        })
        .slice(0, policy.limitPerSweep);

    const processed = [];
    const skipped = [];

    incrementCounter("auto_heal_sweeps_total");

    for (const record of eligible) {
        try {
            // eslint-disable-next-line no-await-in-loop
            const result = await reconcileRequest(record.correlation_id, {
                requested_by: options && options.requested_by ? options.requested_by : "autoHealingRetryService"
            });

            processed.push({
                correlation_id: record.correlation_id,
                current_status: result.current_status,
                final_status: result.final_status,
                attempts: result.request.reconciliation_attempts || 0
            });

            incrementCounter("auto_heal_processed_total");
        } catch (error) {
            // eslint-disable-next-line no-await-in-loop
            await updateRequest(
                record.correlation_id,
                {
                    auto_heal_last_error: error.message,
                    auto_heal_last_error_at: new Date().toISOString(),
                    waiting_on: "operations"
                },
                "autoHealingRetryService"
            );

            skipped.push({
                correlation_id: record.correlation_id,
                reason: error.message
            });

            incrementCounter("auto_heal_skipped_total");
        }
    }

    // Evaluate alerts automatically after the sweep so the control plane updates itself.
    const alertEvaluation = await evaluateAlerts();

    await logAuditEvent({
        event_name: "AUTO_HEAL_SWEEP_COMPLETED",
        actor: "autoHealingRetryService",
        severity: processed.length > 0 ? "info" : "warning",
        category: "operations",
        message: `Auto-heal sweep processed ${processed.length} request(s).`,
        details: {
            processed,
            skipped,
            policy,
            alert_evaluation: alertEvaluation
        }
    });

    return {
        policy,
        processed,
        skipped,
        scanned_records: records.length,
        alert_evaluation: alertEvaluation
    };
}

module.exports = {
    buildPolicy,
    computeBackoffDelay,
    isEligibleForAutoHeal,
    processAutoHealSweep
};