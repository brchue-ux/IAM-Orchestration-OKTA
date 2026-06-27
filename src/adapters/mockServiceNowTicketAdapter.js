"use strict";

const { ExecutionAdapter } = require("./executionAdapter");

class MockServiceNowTicketAdapter extends ExecutionAdapter {
    constructor() {
        super("MockServiceNowTicketAdapter");
    }

    async execute(requestEnvelope) {
        return {
            workflow_run_id: `snow-mock-${Date.now()}`,
            execution_agent: this.name,
            execution_tool_or_workflow: "mock_servicenow_table_api",
            downstream_system: "ServiceNow",
            execution_identity: "svc-servicenow-workflow@local",
            response_status: "201",
            retries_attempted: 0,
            final_execution_result: "success",
            service_now_record_id: `INC${Date.now()}`,
            observed_state: {
                ticket_created: true,
                correlation_id: requestEnvelope.correlation_id
            }
        };
    }

    async verify(requestEnvelope, executionResult) {
        const valid = Boolean(executionResult && executionResult.service_now_record_id);

        return {
            verification_method: "mock_servicenow_read_back",
            verification_agent: this.name,
            verification_timestamp: new Date().toISOString(),
            verification_result: valid ? "verified_success" : "verified_failure",
            expected_state: { ticket_created: true },
            observed_state: { ticket_created: valid },
            unresolved_discrepancy: valid ? null : "Ticket record was not created."
        };
    }
}

module.exports = {
    MockServiceNowTicketAdapter
};