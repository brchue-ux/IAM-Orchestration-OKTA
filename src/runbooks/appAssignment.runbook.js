"use strict";

/**
 * appAssignment.runbook
 * Runbook definition for low-risk application assignment.
 */

function getRunbook() {
    return {
        runbook_name: "app_assignment_low_risk",
        purpose: "Safely assign or unassign approved low-risk applications.",
        trigger: "Approved app_assignment request enters execution.",
        preconditions: [
            "target identity is uniquely resolved",
            "application is allowlisted",
            "approval is valid when required",
            "blast-radius checks passed",
            "expected_postcondition is present"
        ],
        expected_action_path: [
            "validate request",
            "execute app assignment or unassignment through approved connector",
            "read back assignment state",
            "communicate verified outcome",
            "persist evidence"
        ],
        expected_result: "Application assignment state matches the approved request.",
        validation_verification_steps: [
            "query downstream app assignment state after execution",
            "compare observed state to expected_postcondition",
            "capture verification_result and verification_method"
        ],
        common_failure_modes: [
            "approval expired",
            "application not allowlisted",
            "connector timeout",
            "verification mismatch",
            "environment mismatch"
        ],
        operational_checks: [
            "review request registry",
            "review request event stream",
            "confirm connector health",
            "confirm approval freshness"
        ],
        fallback_or_workaround: [
            "stop automated execution",
            "route to escalation",
            "generate operator guidance"
        ],
        rollback_containment: [
            "reverse assignment operation if safe and approved",
            "freeze repeat execution if policy mismatch is detected"
        ],
        escalation_conditions: [
            "verification_result is verified_failure",
            "policy guard blocks execution",
            "connector repeatedly fails"
        ],
        owner_roles: [
            "IAM Operations",
            "Platform Engineering",
            "IAM Governance"
        ]
    };
}

module.exports = {
    getRunbook
};