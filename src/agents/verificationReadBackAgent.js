"use strict";

/**
 * verificationReadBackAgent
 *
 * Purpose:
 * - Perform lightweight post-execution verification
 * - Return a standardized verification result
 * - Support the runtime states:
 *   - verified_success
 *   - verified_failure
 *   - verification_pending
 *   - verification_inconclusive
 *   - verification_not_required_read_only
 *
 * Notes:
 * - This is a read-back verification helper.
 * - It does NOT perform state changes.
 * - It is designed to be called by reconciliationService after execution.
 */

function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
}

function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getExpectedPostcondition(requestRecord) {
    if (!requestRecord) {
        return null;
    }

    if (requestRecord.expected_postcondition) {
        return requestRecord.expected_postcondition;
    }

    if (requestRecord.details && requestRecord.details.expected_postcondition) {
        return requestRecord.details.expected_postcondition;
    }

    return null;
}

function getObservedState(requestRecord, execution) {
    if (requestRecord && requestRecord.observed_state) {
        return requestRecord.observed_state;
    }

    if (requestRecord && requestRecord.details && requestRecord.details.observed_state) {
        return requestRecord.details.observed_state;
    }

    if (execution && execution.observed_state) {
        return execution.observed_state;
    }

    if (execution && execution.execution_result && isObject(execution.execution_result)) {
        return execution.execution_result;
    }

    return null;
}

function getActionFamily(requestRecord) {
    return normalizeText(
        requestRecord && requestRecord.action_family
            ? requestRecord.action_family
            : null
    );
}

function needsVerification(requestRecord) {
    const actionFamily = getActionFamily(requestRecord);

    if (!actionFamily) {
        return true;
    }

    if (actionFamily === "read_only_lookup" || actionFamily === "read-only_lookup") {
        return false;
    }

    return true;
}

function compareScalar(expectedValue, observedValue) {
    return normalizeText(expectedValue) === normalizeText(observedValue);
}

function compareObjectSubset(expectedObject, observedObject) {
    if (!isObject(expectedObject) || !isObject(observedObject)) {
        return false;
    }

    const expectedKeys = Object.keys(expectedObject);
    if (expectedKeys.length === 0) {
        return false;
    }

    return expectedKeys.every(function compareKey(key) {
        const expectedValue = expectedObject[key];
        const observedValue = observedObject[key];

        if (isObject(expectedValue)) {
            return compareObjectSubset(expectedValue, observedValue);
        }

        return compareScalar(expectedValue, observedValue);
    });
}

function inferVerificationFromExecution(execution) {
    const executionState = normalizeText(
        execution && (execution.execution_state || execution.status)
    );

    const executionResult = normalizeText(
        execution && (execution.execution_result || execution.result)
    );

    if (executionState === "pending" || executionResult === "pending") {
        return "verification_pending";
    }

    if (executionState === "failed" || executionResult === "failed") {
        return "verified_failure";
    }

    if (executionState === "success" || executionResult === "success") {
        return "verification_inconclusive";
    }

    return "verification_inconclusive";
}

/**
 * Build a standardized verification envelope.
 */
function buildResult(result, parts) {
    return {
        verification_method: parts.verification_method || "read_back_comparison",
        verification_result: result,
        verification_status:
            result === "verified_success"
                ? "completed_verified"
                : result,
        expected_state: parts.expected_state || null,
        observed_state: parts.observed_state || null,
        verification_timestamp: new Date().toISOString(),
        verification_agent: "verificationReadBackAgent",
        unresolved_discrepancy: parts.unresolved_discrepancy || null
    };
}

/**
 * Main verification function.
 *
 * Input:
 * - requestRecord: normalized/persisted request record
 * - execution: execution envelope or execution state
 *
 * Output:
 * - standardized verification result object
 */
async function verify(requestRecord, execution) {
    if (!needsVerification(requestRecord)) {
        return buildResult("verification_not_required_read_only", {
            verification_method: "no_write_action_detected"
        });
    }

    const expectedState = getExpectedPostcondition(requestRecord);
    const observedState = getObservedState(requestRecord, execution);

    if (!expectedState && !observedState) {
        return buildResult(inferVerificationFromExecution(execution), {
            expected_state: null,
            observed_state: null,
            verification_method: "execution_state_inference",
            unresolved_discrepancy:
                "No expected_postcondition or observed_state was available."
        });
    }

    if (expectedState && !observedState) {
        return buildResult("verification_pending", {
            expected_state: expectedState,
            observed_state: null,
            verification_method: "expected_state_missing_observed_state",
            unresolved_discrepancy:
                "Expected state exists but no observed state is available yet."
        });
    }

    let matched = false;

    if (isObject(expectedState) && isObject(observedState)) {
        matched = compareObjectSubset(expectedState, observedState);
    } else {
        matched = compareScalar(expectedState, observedState);
    }

    if (matched) {
        return buildResult("verified_success", {
            expected_state: expectedState,
            observed_state: observedState,
            verification_method: "expected_vs_observed_comparison"
        });
    }

    return buildResult("verified_failure", {
        expected_state: expectedState,
        observed_state: observedState,
        verification_method: "expected_vs_observed_comparison",
        unresolved_discrepancy:
            "Observed state does not match expected postcondition."
    });
}

module.exports = {
    verify,
    needsVerification,
    getExpectedPostcondition,
    getObservedState
};