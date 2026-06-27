"use strict";

/**
 * controlPlaneClient
 * Produces a persistent control-plane snapshot for inventory, ownership,
 * environment, permissions, policy posture, releases, alerts, rollback proof,
 * promotion readiness, and runtime metrics.
 */

const { getExecutionPolicyConfig } = require("../config/executionPolicyConfig");
const { getMetricsSnapshot } = require("./metricsCollector");
const { listRegisteredAgents } = require("../control-plane/agentRegistryStore");
const { getComplianceRecords } = require("../control-plane/policyComplianceTracker");
const { listAlerts } = require("../control-plane/alertingService");
const { listReleaseApprovals } = require("../governance/releaseApprovalFlow");
const { listRollbackEvents } = require("../governance/rollbackController");
const { validatePromotionReadiness } = require("../governance/promotionGateValidator");

function buildStaticToolInventory(config) {
    return [
        {
            tool_name: "OktaClient",
            target_system: "Okta",
            action_family: "group_fulfillment,app_assignment,read_only_lookup",
            allowed_environment: config.allowedEnvironments,
            owner: process.env.OKTA_CONNECTOR_OWNER || "platform-engineering",
            required_scopes: process.env.OKTA_REQUIRED_SCOPES || "managed-outside-runtime",
            risk_tier: "low-to-moderate",
            approval_requirements: "required_for_write_actions"
        },
        {
            tool_name: "ServiceNowClient",
            target_system: "ServiceNow",
            action_family: "approval",
            allowed_environment: config.allowedEnvironments,
            owner: process.env.SERVICENOW_CONNECTOR_OWNER || "iam-governance",
            required_scopes: "approval-request-read-write",
            risk_tier: "control",
            approval_requirements: "n/a"
        }
    ];
}

function buildStaticConnectionInventory(config) {
    return [
        {
            connection_name: "okta",
            system_connected: "Okta",
            auth_model: process.env.OKTA_AUTH_MODEL || "api-token",
            identity_used: process.env.OKTA_EXECUTION_IDENTITY || "service-identity",
            environment: config.appEnvironment,
            expiration_health: process.env.OKTA_CONNECTION_HEALTH || "unknown",
            owning_team: process.env.OKTA_CONNECTOR_OWNER || "platform-engineering"
        },
        {
            connection_name: "servicenow",
            system_connected: "ServiceNow",
            auth_model: process.env.SERVICENOW_AUTH_MODE || "basic",
            identity_used: process.env.SERVICENOW_EXECUTION_IDENTITY || "service-identity",
            environment: config.appEnvironment,
            expiration_health: process.env.SERVICENOW_CONNECTION_HEALTH || "unknown",
            owning_team: process.env.SERVICENOW_CONNECTOR_OWNER || "iam-governance"
        }
    ];
}

async function getControlPlaneSnapshot() {
    const config = getExecutionPolicyConfig();
    const metrics = getMetricsSnapshot();
    const agents = await listRegisteredAgents();
    const complianceRecords = await getComplianceRecords();
    const alerts = await listAlerts();
    const releases = await listReleaseApprovals();
    const rollbacks = await listRollbackEvents();
    const promotionReadiness = await validatePromotionReadiness();

    return {
        generated_at: new Date().toISOString(),
        environment: config.appEnvironment,
        policy_config: {
            allowed_action_families: config.allowedActionFamilies,
            allowed_environments: config.allowedEnvironments,
            max_targets: config.maxTargets,
            require_approval_for_write_actions: config.requireApprovalForWriteActions
        },
        inventories: {
            agents,
            tools: buildStaticToolInventory(config),
            connections: buildStaticConnectionInventory(config)
        },
        policy_compliance: complianceRecords,
        alerts,
        releases,
        rollback_events: rollbacks,
        promotion_readiness: promotionReadiness,
        metrics,
        kpis: {
            success_rate: promotionReadiness.metrics_assessment ? promotionReadiness.metrics_assessment.success_rate : null,
            failure_rate: promotionReadiness.metrics_assessment ? promotionReadiness.metrics_assessment.failure_rate : null,
            rollback_proof_count: promotionReadiness.rollback_assessment ? promotionReadiness.rollback_assessment.rollback_proof_count : null,
            compliance_record_count: promotionReadiness.supporting_counts ? promotionReadiness.supporting_counts.compliance_records : null,
            high_severity_alert_count: promotionReadiness.supporting_counts ? promotionReadiness.supporting_counts.high_severity_alerts : null
        },
        ownership: {
            product_owner: process.env.PRODUCT_OWNER || "unassigned",
            security_owner: process.env.SECURITY_OWNER || "unassigned",
            operations_owner: process.env.OPERATIONS_OWNER || "unassigned",
            change_approver: process.env.CHANGE_APPROVER || "unassigned",
            on_call_responder: process.env.ON_CALL_RESPONDER || "unassigned"
        }
    };
}

module.exports = {
    getControlPlaneSnapshot,
    buildStaticToolInventory,
    buildStaticConnectionInventory
};