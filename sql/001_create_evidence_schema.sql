-- SQL Server / Azure SQL compatible DDL

CREATE TABLE dbo.Requests (
    correlation_id            NVARCHAR(100)  NOT NULL PRIMARY KEY,
    request_id                NVARCHAR(100)  NOT NULL UNIQUE,
    requester_identity        NVARCHAR(255)  NOT NULL,
    requester_source_channel  NVARCHAR(100)  NULL,
    requester_authority_src   NVARCHAR(255)  NULL,
    target_identity           NVARCHAR(255)  NOT NULL,
    target_identifier_type    NVARCHAR(100)  NULL,
    target_system             NVARCHAR(100)  NOT NULL,
    requested_action          NVARCHAR(255)  NOT NULL,
    action_family             NVARCHAR(100)  NOT NULL,
    risk_tier                 NVARCHAR(50)   NULL,
    business_justification    NVARCHAR(MAX)  NULL,
    approval_requirement      NVARCHAR(100)  NULL,
    policy_decision           NVARCHAR(100)  NULL,
    normalized_status         NVARCHAR(100)  NOT NULL,
    expected_postcondition    NVARCHAR(MAX)  NULL,
    current_status            NVARCHAR(100)  NOT NULL,
    final_status              NVARCHAR(100)  NULL,
    completion_message        NVARCHAR(MAX)  NULL,
    created_at                DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at                DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE TABLE dbo.Approvals (
    approval_id               BIGINT IDENTITY(1,1) PRIMARY KEY,
    correlation_id            NVARCHAR(100)  NOT NULL,
    approver_identity         NVARCHAR(255)  NOT NULL,
    approver_role             NVARCHAR(255)  NULL,
    approval_timestamp        DATETIME2      NOT NULL,
    approval_expiry           DATETIME2      NULL,
    approval_scope            NVARCHAR(MAX)  NULL,
    approval_decision         NVARCHAR(100)  NOT NULL,
    approval_evidence_id      NVARCHAR(255)  NULL,
    emergency_break_glass     BIT            NOT NULL DEFAULT 0,
    quorum_requirement        NVARCHAR(100)  NULL,
    CONSTRAINT FK_Approvals_Requests
        FOREIGN KEY (correlation_id) REFERENCES dbo.Requests(correlation_id)
);
GO

CREATE TABLE dbo.ExecutionRuns (
    execution_run_id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    correlation_id            NVARCHAR(100)  NOT NULL,
    workflow_run_id           NVARCHAR(255)  NULL,
    execution_agent           NVARCHAR(100)  NOT NULL,
    execution_tool_or_workflow NVARCHAR(255) NOT NULL,
    downstream_system         NVARCHAR(100)  NOT NULL,
    execution_identity        NVARCHAR(255)  NULL,
    normalized_payload_hash   NVARCHAR(255)  NULL,
    response_status           NVARCHAR(100)  NULL,
    retries_attempted         INT            NOT NULL DEFAULT 0,
    final_execution_result    NVARCHAR(100)  NOT NULL,
    error_classification      NVARCHAR(255)  NULL,
    okta_reference_id         NVARCHAR(255)  NULL,
    service_now_record_id     NVARCHAR(255)  NULL,
    created_at                DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_ExecutionRuns_Requests
        FOREIGN KEY (correlation_id) REFERENCES dbo.Requests(correlation_id)
);
GO

CREATE TABLE dbo.VerificationResults (
    verification_id           BIGINT IDENTITY(1,1) PRIMARY KEY,
    correlation_id            NVARCHAR(100)  NOT NULL,
    verification_method       NVARCHAR(255)  NOT NULL,
    verification_agent        NVARCHAR(100)  NOT NULL,
    verification_timestamp    DATETIME2      NOT NULL,
    verification_result       NVARCHAR(100)  NOT NULL,
    expected_state            NVARCHAR(MAX)  NULL,
    observed_state            NVARCHAR(MAX)  NULL,
    unresolved_discrepancy    NVARCHAR(MAX)  NULL,
    CONSTRAINT FK_Verification_Requests
        FOREIGN KEY (correlation_id) REFERENCES dbo.Requests(correlation_id)
);
GO

CREATE TABLE dbo.Notifications (
    notification_id           BIGINT IDENTITY(1,1) PRIMARY KEY,
    correlation_id            NVARCHAR(100)  NOT NULL,
    recipient                 NVARCHAR(255)  NOT NULL,
    channel                   NVARCHAR(100)  NOT NULL,
    message_category          NVARCHAR(100)  NOT NULL,
    status_communicated       NVARCHAR(100)  NOT NULL,
    reference_id_included     BIT            NOT NULL DEFAULT 1,
    sensitive_details_suppressed BIT         NOT NULL DEFAULT 1,
    message_body              NVARCHAR(MAX)  NULL,
    sent_at                   DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Notifications_Requests
        FOREIGN KEY (correlation_id) REFERENCES dbo.Requests(correlation_id)
);
GO

CREATE TABLE dbo.AuditEvents (
    audit_event_id            BIGINT IDENTITY(1,1) PRIMARY KEY,
    correlation_id            NVARCHAR(100)  NULL,
    event_name                NVARCHAR(255)  NOT NULL,
    actor                     NVARCHAR(255)  NOT NULL,
    severity                  NVARCHAR(50)   NOT NULL,
    category                  NVARCHAR(100)  NOT NULL,
    message                   NVARCHAR(MAX)  NULL,
    details                   NVARCHAR(MAX)  NULL,
    logged_at                 DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE INDEX IX_Requests_CurrentStatus ON dbo.Requests(current_status);
CREATE INDEX IX_Requests_FinalStatus   ON dbo.Requests(final_status);
CREATE INDEX IX_Approvals_Correlation  ON dbo.Approvals(correlation_id);
CREATE INDEX IX_Execution_Correlation  ON dbo.ExecutionRuns(correlation_id);
CREATE INDEX IX_Verification_Correlation ON dbo.VerificationResults(correlation_id);
CREATE INDEX IX_Notifications_Correlation ON dbo.Notifications(correlation_id);
CREATE INDEX IX_Audit_Correlation ON dbo.AuditEvents(correlation_id);
GO