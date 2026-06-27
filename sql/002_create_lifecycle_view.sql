CREATE VIEW dbo.vw_RequestLifecycle AS
SELECT
    r.correlation_id,
    r.request_id,
    r.requester_identity,
    r.target_identity,
    r.target_system,
    r.action_family,
    r.risk_tier,
    r.policy_decision,
    r.approval_requirement,
    r.normalized_status,
    r.current_status,
    r.final_status,
    r.completion_message,
    r.created_at,
    r.updated_at,

    a.approval_decision,
    a.approver_identity,
    a.approval_timestamp,

    e.execution_agent,
    e.execution_tool_or_workflow,
    e.downstream_system,
    e.response_status,
    e.final_execution_result,
    e.okta_reference_id,
    e.service_now_record_id,

    v.verification_method,
    v.verification_result,
    v.verification_timestamp,

    n.channel AS last_notification_channel,
    n.status_communicated AS last_status_communicated,
    n.sent_at AS last_notification_at

FROM dbo.Requests r
OUTER APPLY (
    SELECT TOP 1 *
    FROM dbo.Approvals a
    WHERE a.correlation_id = r.correlation_id
    ORDER BY a.approval_timestamp DESC
) a
OUTER APPLY (
    SELECT TOP 1 *
    FROM dbo.ExecutionRuns e
    WHERE e.correlation_id = r.correlation_id
    ORDER BY e.created_at DESC
) e
OUTER APPLY (
    SELECT TOP 1 *
    FROM dbo.VerificationResults v
    WHERE v.correlation_id = r.correlation_id
    ORDER BY v.verification_timestamp DESC
) v
OUTER APPLY (
    SELECT TOP 1 *
    FROM dbo.Notifications n
    WHERE n.correlation_id = r.correlation_id
    ORDER BY n.sent_at DESC
) n;
GO