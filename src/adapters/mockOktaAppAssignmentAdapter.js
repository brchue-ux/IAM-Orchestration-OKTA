"use strict";

const crypto = require("crypto");
const { ExecutionAdapter } = require("./executionAdapter");

/**
 * Generate deterministic payload hash for audit/evidence tracking.
 */
function hashPayload(payload) {
    return crypto
        .createHash("sha256")
        .update(JSON.stringify(payload || {}))
        .digest("hex");
}

class MockOktaAppAssignmentAdapter extends ExecutionAdapter {
    constructor() {
        super("MockOktaAppAssignmentAdapter");
    }

    /**
     * Execute mock Okta App Assignment
     */
    async execute(requestEnvelope) {
        if (!requestEnvelope || requestEnvelope.action_family !== "app_assignment") {
            throw new Error(
                "MockOktaAppAssignmentAdapter only supports action_family=app_assignment"
            );
        }

        const oktaReferenceId = `okta-mock-${Date.now()}`;
        const payloadHash = hashPayload(requestEnvelope);

        return {
            workflow_run_id: `workflow-mock-${Date.now()}`,
            execution_agent: this.name,
            execution_tool_or_workflow: "mock_okta_api",
            downstream_system: "Okta",
            execution_identity: "svc-okta-app-assignment@local",
            normalized_payload_hash: payloadHash,
            response_status: "200",
            retries_attempted: 0,
            final_execution_result: "success",
            okta_reference_id: oktaReferenceId,
            observed_state: requestEnvelope.expected_postcondition || null
        };
    }

    /**
     * Verify mock execution via read-back comparison
     */
    async verify(requestEnvelope, executionResult) {
        const expected = requestEnvelope?.expected_postcondition || null;
        const observed = executionResult?.observed_state || null;

        const matches = JSON.stringify(expected) === JSON.stringify(observed);

        return {
            verification_method: "mock_okta_read_back",
            verification_agent: this.name,
            verification_timestamp: new Date().toISOString(),
            verification_result: matches ? "verified_success" : "verified_failure",
            expected_state: expected,
            observed_state: observed,
            unresolved_discrepancy: matches
                ? null
                : "Observed state does not match expected postcondition."
        };
    }
}

module.exports = {
    MockOktaAppAssignmentAdapter
};