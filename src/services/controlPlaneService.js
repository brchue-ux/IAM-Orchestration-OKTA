
'use strict';

/**
 * controlPlaneService
 *
 * Wave 3 service for control-plane inventory and summary views.
 */

const { buildEvidencePackage } = require('./auditEvidenceAgent');
const {
    ensureControlPlaneSchema,
    upsertAgentInventory,
    upsertToolInventory,
    getLatestMetricSnapshots
} = require('./controlPlaneStore');
const { recordControlPlaneSnapshot } = require('./metricsService');

const DEFAULT_AGENT_INVENTORY = [
    {
        agent_name: 'PolicyEligibilityAgent',
        purpose: 'Validate policy, approval requirement, and runtime eligibility.',
        owner_name: 'IAM Architecture',
        environment_name: process.env.APP_ENV || 'dev',
        risk_tier: 'advisory',
        identity_mode: 'advisory_only',
        tools_used: ['requestRegistryStore', 'requestEventStore'],
        status: 'active',
        version_tag: 'wave1',
        deployment_state: 'deployed'
    },
    {
        agent_name: 'IdentityResolutionAgent',
        purpose: 'Resolve target identity and identifier type before execution.',
        owner_name: 'IAM Architecture',
        environment_name: process.env.APP_ENV || 'dev',
        risk_tier: 'advisory',
        identity_mode: 'advisory_only',
        tools_used: ['requestRegistryStore'],
        status: 'active',
        version_tag: 'wave1',
        deployment_state: 'deployed'
    },
    {
        agent_name: 'ReadOnlyStatusAgent',
        purpose: 'Perform read-only status lookup in simulation mode.',
        owner_name: 'IAM Operations',
        environment_name: process.env.APP_ENV || 'dev',
        risk_tier: 'low',
        identity_mode: 'system_identity',
        tools_used: ['executionRouter'],
        status: 'active',
        version_tag: 'wave2',
        deployment_state: 'deployed'
    },
    {
        agent_name: 'AppAssignmentAgent',
        purpose: 'Perform bounded app assignment / unassignment in simulation mode.',
        owner_name: 'IAM Operations',
        environment_name: process.env.APP_ENV || 'dev',
        risk_tier: 'moderate',
        identity_mode: 'system_identity',
        tools_used: ['executionRouter'],
        status: 'active',
        version_tag: 'wave2',
        deployment_state: 'deployed'
    },
    {
        agent_name: 'UserLifecycleStateAgent',
        purpose: 'Perform bounded lifecycle actions in simulation mode.',
        owner_name: 'IAM Operations',
        environment_name: process.env.APP_ENV || 'dev',
        risk_tier: 'high',
        identity_mode: 'system_identity',
        tools_used: ['executionRouter'],
        status: 'active',
        version_tag: 'wave2',
        deployment_state: 'deployed'
    },
    {
        agent_name: 'ContainmentSessionAgent',
        purpose: 'Perform bounded session containment actions in simulation mode.',
        owner_name: 'IAM Operations',
        environment_name: process.env.APP_ENV || 'dev',
        risk_tier: 'high',
        identity_mode: 'system_identity',
        tools_used: ['executionRouter'],
        status: 'active',
        version_tag: 'wave2',
        deployment_state: 'deployed'
    },
    {
        agent_name: 'AuditEvidenceAgent',
        purpose: 'Build evidence packages for requests and verification.',
        owner_name: 'Compliance / Audit',
        environment_name: process.env.APP_ENV || 'dev',
        risk_tier: 'advisory',
        identity_mode: 'advisory_only',
        tools_used: ['requestRegistryStore', 'requestEventStore'],
        status: 'active',
        version_tag: 'wave3',
        deployment_state: 'deployed'
    }
];

const DEFAULT_TOOL_INVENTORY = [
    {
        tool_name: 'requestRegistryStore',
        target_system: 'sql',
        action_family: 'request_tracking',
        allowed_environment: process.env.APP_ENV || 'dev',
        owner_name: 'Platform Engineering',
        required_scopes: ['db.read', 'db.write'],
        risk_tier: 'moderate',
        approval_requirements: 'none'
    },
    {
        tool_name: 'requestEventStore',
        target_system: 'sql',
        action_family: 'audit_logging',
        allowed_environment: process.env.APP_ENV || 'dev',
        owner_name: 'Platform Engineering',
        required_scopes: ['db.read', 'db.write'],
        risk_tier: 'moderate',
        approval_requirements: 'none'
    },
    {
        tool_name: 'executionRouter',
        target_system: 'okta_simulation',
        action_family: 'execution_routing',
        allowed_environment: process.env.APP_ENV || 'dev',
        owner_name: 'IAM Operations',
        required_scopes: ['simulate.execute'],
        risk_tier: 'moderate',
        approval_requirements: 'policy_and_approval_required_for_write_actions'
    }
];

/**
 * Seed the control-plane inventory with the default Wave 1 / Wave 2 catalog.
 */
async function seedControlPlaneInventory() {
    await ensureControlPlaneSchema();

    for (const agentRecord of DEFAULT_AGENT_INVENTORY) {
        await upsertAgentInventory(agentRecord);
    }

    for (const toolRecord of DEFAULT_TOOL_INVENTORY) {
        await upsertToolInventory(toolRecord);
    }

    return {
        agents_seeded: DEFAULT_AGENT_INVENTORY.length,
        tools_seeded: DEFAULT_TOOL_INVENTORY.length
    };
}

/**
 * Build a control-plane summary for one correlation ID.
 * Includes evidence and latest metric snapshots.
 */
async function getControlPlaneSummary(correlationId) {
    await ensureControlPlaneSchema();

    const snapshot = await recordControlPlaneSnapshot();
    const latestMetrics = await getLatestMetricSnapshots();
    const evidence = correlationId ? await buildEvidencePackage(correlationId) : null;

    return {
        environment_name: process.env.APP_ENV || 'dev',
        metric_snapshot: snapshot,
        latest_metric_snapshots: latestMetrics,
        evidence_package: evidence
    };
}

module.exports = {
    seedControlPlaneInventory,
    getControlPlaneSummary,
    DEFAULT_AGENT_INVENTORY,
    DEFAULT_TOOL_INVENTORY
};
