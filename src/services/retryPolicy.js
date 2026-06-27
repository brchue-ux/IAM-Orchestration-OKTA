"use strict";

/**
 * retryPolicy
 * Safe retry handling for retryable errors only.
 */

const { getExecutionPolicyConfig } = require("../config/executionPolicyConfig");
const { classifyError } = require("../utils/errorClassification");

function sleep(delayMs) {
    return new Promise(function resolveAfterDelay(resolve) {
        setTimeout(resolve, delayMs);
    });
}

function calculateDelay(attempt, retryConfig) {
    const safeAttempt = Math.max(1, Number(attempt) || 1);
    const baseDelay = retryConfig.initialDelayMs;
    const maxDelay = retryConfig.maxDelayMs;
    const computed = baseDelay * Math.pow(2, safeAttempt - 1);
    return Math.min(computed, maxDelay);
}

function shouldRetry(error, attempt, options) {
    const config = getExecutionPolicyConfig();
    const retryConfig = (options && options.retry) || config.retry;
    const classification = classifyError(error, options && options.context);

    return (
        classification.retryable === true &&
        Number(attempt) < Number(retryConfig.maxAttempts || 0)
    );
}

async function executeWithRetry(operation, options) {
    if (typeof operation !== "function") {
        throw new Error("executeWithRetry requires an operation function.");
    }

    const config = getExecutionPolicyConfig();
    const retryConfig = (options && options.retry) || config.retry;
    const context = (options && options.context) || {};

    let attempt = 0;

    while (attempt < retryConfig.maxAttempts) {
        attempt += 1;

        try {
            return await operation({ attempt });
        } catch (error) {
            if (!shouldRetry(error, attempt, { retry: retryConfig, context })) {
                error.retry_attempts = attempt;
                throw error;
            }

            const delayMs = calculateDelay(attempt, retryConfig);
            await sleep(delayMs);
        }
    }

    throw new Error("Retry policy exhausted without producing a result.");
}

module.exports = {
    sleep,
    calculateDelay,
    shouldRetry,
    executeWithRetry
};