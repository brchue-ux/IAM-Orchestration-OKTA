"use strict";

const { ExecutionAdapter } = require("./executionAdapter");

class RealOktaGroupFulfillmentAdapter extends ExecutionAdapter {
    constructor() {
        super("RealOktaGroupFulfillmentAdapter");
        this.orgUrl = process.env.OKTA_ORG_URL;
        this.apiToken = process.env.OKTA_API_TOKEN;
    }

    buildHeaders() {
        if (!this.orgUrl || !this.apiToken) {
            throw new Error("OKTA_ORG_URL and OKTA_API_TOKEN must be set.");
        }

        return {
            "Authorization": `SSWS ${this.apiToken}`,
            "Accept": "application/json",
            "Content-Type": "application/json"
        };
    }

    async execute(requestEnvelope) {
        if (!requestEnvelope || requestEnvelope.action_family !== "group_membership_fulfillment") {
            throw new Error(
                "RealOktaGroupFulfillmentAdapter only supports action_family=group_membership_fulfillment"
            );
        }

        const userId = requestEnvelope.target_user_identifier;
        const groupId = requestEnvelope.group_identifier;

        if (!userId || !groupId) {
            throw new Error("target_user_identifier and group_identifier are required.");
        }

        const response = await fetch(
            `${this.orgUrl}/api/v1/groups/${groupId}/users/${userId}`,
            {
                method: "PUT",
                headers: this.buildHeaders()
            }
        );

        return {
            execution_agent: this.name,
            execution_tool_or_workflow: "okta_core_api_group_membership",
            downstream_system: "Okta",
            execution_identity: "token_based_service_identity",
            response_status: String(response.status),
            final_execution_result: response.ok ? "success" : "failed",
            okta_reference_id: `${groupId}:${userId}`
        };
    }

    async verify(requestEnvelope) {
        const userId = requestEnvelope.target_user_identifier;
        const groupId = requestEnvelope.group_identifier;

        // Proposed verification pattern:
        // fetch user's groups and confirm the target group is present.
        const response = await fetch(
            `${this.orgUrl}/api/v1/users/${userId}/groups`,
            {
                method: "GET",
                headers: this.buildHeaders()
            }
        );

        if (!response.ok) {
            return {
                verification_method: "okta_read_back_user_groups",
                verification_agent: this.name,
                verification_timestamp: new Date().toISOString(),
                verification_result: "verification_inconclusive",
                expected_state: { group_identifier: groupId, membership: "present" },
                observed_state: null,
                unresolved_discrepancy: `Verification call failed with status ${response.status}.`
            };
        }

        const groups = await response.json();
        const present = Array.isArray(groups) && groups.some(function eachGroup(g) {
            return g && g.id === groupId;
        });

        return {
            verification_method: "okta_read_back_user_groups",
            verification_agent: this.name,
            verification_timestamp: new Date().toISOString(),
            verification_result: present ? "verified_success" : "verified_failure",
            expected_state: { group_identifier: groupId, membership: "present" },
            observed_state: { group_identifier: groupId, membership: present ? "present" : "absent" },
            unresolved_discrepancy: present ? null : "Target group was not found in user membership after execution."
        };
    }
}

module.exports = {
    RealOktaGroupFulfillmentAdapter
};