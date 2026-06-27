"use strict";

/**
 * errorClassification
 * Classifies runtime errors into operational categories.
 */

const ERROR_CLASSES = Object.freeze({
    VALIDATION_ERROR: "VALIDATION_ERROR",
    POLICY_VIOLATION: "POLICY_VIOLATION",
    APPROVAL_ERROR: "APPROVAL_ERROR",
    CONNECTOR_ERROR: "CONNECTOR_ERROR",
    TIMEOUT_ERROR: "TIMEOUT_ERROR",
    AUTHENTICATION_ERROR: "AUTHENTICATION_ERROR",
    NOT_FOUND_ERROR: "NOT_FOUND_ERROR",
    VERIFICATION_ERROR: "VERIFICATION_ERROR",
    TRANSIENT_ERROR: "TRANSIENT_ERROR",
    UNKNOWN_ERROR: "UNKNOWN_ERROR"
});

function normalizeStatus(statusCode) {
    const parsed = Number(statusCode);
    return Number.isFinite(parsed) ? parsed : null;
}

function classifyError(error, context) {
    const safeError = error || {};
    const safeContext = context || {};
    const message = String(safeError.message || "").toLowerCase();
    const statusCode = normalizeStatus(
        safeError.statusCode || safeError.status || safeContext.statusCode
    );

    if (message.includes("approval") || safeContext.stage === "approval") {
        return {
            classification: ERROR_CLASSES.APPROVAL_ERROR,
            retryable: false
        };
    }

    if (
        message.includes("missing") ||
        message.includes("required") ||
        message.includes("invalid") ||
        safeContext.stage === "validation"
    ) {
        return {
            classification: ERROR_CLASSES.VALIDATION_ERROR,
            retryable: false
        };
    }

    if (
        message.includes("policy") ||
        message.includes("out of scope") ||
        message.includes("blast") ||
        message.includes("sod") ||
        safeContext.stage === "policy"
    ) {
        return {
            classification: ERROR_CLASSES.POLICY_VIOLATION,
            retryable: false
        };
    }

    if (message.includes("verify") || safeContext.stage === "verification") {
        return {
            classification: ERROR_CLASSES.VERIFICATION_ERROR,
            retryable: false
        };
    }

    if (statusCode === 401 || statusCode === 403 || message.includes("unauthorized")) {
        return {
            classification: ERROR_CLASSES.AUTHENTICATION_ERROR,
            retryable: false
        };
    }

    if (statusCode === 404 || message.includes("not found")) {
        return {
            classification: ERROR_CLASSES.NOT_FOUND_ERROR,
            retryable: false
        };
    }

    if (statusCode === 408 || message.includes("timeout") || message.includes("etimeout")) {
        return {
            classification: ERROR_CLASSES.TIMEOUT_ERROR,
            retryable: true
        };
    }

    if (
        statusCode === 429 ||
        (statusCode !== null && statusCode >= 500) ||
        message.includes("temporar") ||
        message.includes("rate limit") ||
        message.includes("socket hang up")
    ) {
        return {
            classification: ERROR_CLASSES.TRANSIENT_ERROR,
            retryable: true
        };
    }

    if (safeContext.stage === "connector" || message.includes("connector") || message.includes("axios")) {
        return {
            classification: ERROR_CLASSES.CONNECTOR_ERROR,
            retryable: true
        };
    }

    return {
        classification: ERROR_CLASSES.UNKNOWN_ERROR,
        retryable: false
    };
}

module.exports = {
    ERROR_CLASSES,
    classifyError
};