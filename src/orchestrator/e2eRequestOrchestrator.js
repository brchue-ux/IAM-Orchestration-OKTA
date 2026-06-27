"use strict";

const crypto = require("crypto");
const { MockOktaAppAssignmentAdapter } = require("../adapters/mockOktaAppAssignmentAdapter");
const { MockServiceNowTicketAdapter } = require("../adapters/mockServiceNowTicketAdapter");
const {
    upsertRequest,
    insertApproval,
    insertExecutionRun,
    insertVerification,
    insertAuditEvent
} = require("../persistence/sqlEvidenceRepository");
const { sendCompletionNotification } = require("../notifications/completionNotifier");

function buildIds() {
    const now = Date.now();
    return {
        correlation_id: `corr-${now}`,
        request_id: `req-${now}`
    };
}

function sha256(input) {
    return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

async function processFullRequest(input) {
    const ids = buildIds();

    const request = {
        correlation_id: ids.correlation_id,
        request_id: ids.request_id,
        requester_identity: input.requester_identity,
        requester_source_channel: input.requester_source_channel || "Teams",
        requester_authority_src: input.requester_authority_src || "directory",
        target_identity: input.target_identity,
        target_identifier_type: input.target_identifier_type || "email",
        target_system: "Okta",
        requested_action: input.requested_action,
        action_family: input.action_family,
        risk_tier: input.risk_tier || "low",
        business_justification: input.business_justification,
        approval_requirement: "approval_required",
        policy_decision: "approval_pending",
        normalized_status: "approval_pending",
        expected_postcondition: input.expected_postcondition,
        current_status: "approval_pending",
        final_status: null,
        completion_message: null
    };

    await upsertRequest(request);
    await insertAuditEvent({
        correlation_id: request.correlation_id,
        event_name: "REQUEST_CAPTURED",
        actor: "e2eRequestOrchestrator",
        severity: "info",
        category: "request",
        message: "Request intake captured and normalized.",
        details: { target_identity: request.target_identity, action_family: request.action_family }
    });

    // --- Manual/Mock approval step for test harness ---
    const approval = {
        correlation_id: request.correlation_id,
        approver_identity: input.approver_identity,
        approver_role: input.approver_role || "manager",
        approval_timestamp: new Date(),
        approval_expiry: null,
        approval_scope: `request_id:${request.request_id}`,
        approval_decision: "approved",
        approval_evidence_id: `approval-${Date.now()}`
    };
    await insertApproval(approval);

    request.policy_decision = "approved";
    request.normalized_status = "approved";
    request.current_status = "ready_for_execution";
    await upsertRequest(request);

    await insertAuditEvent({
        correlation_id: request.correlation_id,
        event_name: "APPROVAL_CAPTURED",
        actor: "e2eRequestOrchestrator",
        severity: "info",
        category: "approval",
        message: "Approval evidence captured.",
        details: { approver_identity: approval.approver_identity }
    });

    // --- Execution ---
    const oktaAdapter = new MockOktaAppAssignmentAdapter();
    const snowAdapter = new MockServiceNowTicketAdapter();

    const oktaRun = await oktaAdapter.execute(request);
    oktaRun.correlation_id = request.correlation_id;
    oktaRun.normalized_payload_hash = sha256(request);
    await insertExecutionRun(oktaRun);

    const snowRun = await snowAdapter.execute(request);
    snowRun.correlation_id = request.correlation_id;
    await insertExecutionRun(snowRun);

    request.current_status = "execution_started";
    await upsertRequest(request);

    // --- Verification ---
    const verification = await oktaAdapter.verify(request, oktaRun);
    verification.correlation_id = request.correlation_id;
    await insertVerification(verification);

    // --- Completion mapping ---
    if (verification.verification_result === "verified_success") {
        request.current_status = "completed_verified";
        request.final_status = "completed_success";
        request.completion_message = `The approved action has been completed and verified. Reference ID: ${request.correlation_id}.`;
    } else {
        request.current_status = "failed";
        request.final_status = "completed_failed";
        request.completion_message = `The action was attempted, but verification did not confirm the expected result. Reference ID: ${request.correlation_id}.`;
    }

    await upsertRequest(request);
    await sendCompletionNotification(request, "Teams");

    await insertAuditEvent({
        correlation_id: request.correlation_id,
        event_name: "REQUEST_COMPLETED",
        actor: "e2eRequestOrchestrator",
        severity: request.final_status === "completed_success" ? "info" : "warning",
        category: "completion",
        message: `Request completed with final_status ${request.final_status}.`,
        details: {
            verification_result: verification.verification_result,
            okta_reference_id: oktaRun.okta_reference_id,
            service_now_record_id: snowRun.service_now_record_id
        }
    });

    return {
        request,
        approval,
        oktaRun,
        snowRun,
        verification
    };
}

module.exports = {
    processFullRequest
};