-- request_registry_schema.sql
-- Example relational schema for moving the JSON-backed request registry
-- into a database-backed implementation later.

CREATE TABLE IF NOT EXISTS request_registry (
    correlation_id VARCHAR(128) PRIMARY KEY,
    request_id VARCHAR(128) NOT NULL,
    requester_identity VARCHAR(256),
    requester_source VARCHAR(128),
    requester_tenant_or_domain VARCHAR(256),
    target_identity VARCHAR(256),
    target_environment VARCHAR(64),
    action_family VARCHAR(128),
    requested_action TEXT,
    risk_tier VARCHAR(64),
    approval_requirement VARCHAR(64),
    approval_reference VARCHAR(256),
    current_status VARCHAR(64),
    current_step VARCHAR(128),
    waiting_on VARCHAR(128),
    source_channel VARCHAR(128),
    expected_postcondition TEXT,
    execution_agent VARCHAR(128),
    execution_tool_or_workflow VARCHAR(128),
    execution_status VARCHAR(64),
    verification_method VARCHAR(128),
    verification_result VARCHAR(64),
    verification_status VARCHAR(64),
    completion_status VARCHAR(64),
    final_status VARCHAR(64),
    details_json TEXT,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    reconciliation_requested_at TIMESTAMP NULL,
    reconciliation_reason TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_request_registry_request_id
    ON request_registry (request_id);

CREATE INDEX IF NOT EXISTS idx_request_registry_status
    ON request_registry (current_status, final_status);
