function normalize(value) {
    return String(value || '').trim().toLowerCase();
}

function parseCsvEnv(name) {
    const raw = process.env[name] || '';
    return new Set(
        raw
            .split(',')
            .map(x => normalize(x))
            .filter(Boolean)
    );
}

function getActionFamily(record) {
    const action = normalize(record?.action);

    if (action === 'add_user_to_group') {
        return 'GROUP_FULFILLMENT';
    }

    if (action === 'assign_user_to_app') {
        return 'APP_ASSIGNMENT';
    }

    if (action === 'read_identity_status') {
        return 'READ_ONLY_STATUS';
    }

    if (action === 'suspend_user' || action === 'unsuspend_user') {
        return 'USER_LIFECYCLE';
    }

    if (action === 'revoke_sessions') {
        return 'SESSION_CONTAINMENT';
    }

    return 'UNKNOWN';
}

function isExecutionEnabledForFamily(actionFamily) {
    const enabledFamilies = parseCsvEnv('EXECUTION_ENABLED_FAMILIES');

    if (enabledFamilies.size === 0) {
        return false;
    }

    return enabledFamilies.has(normalize(actionFamily));
}

function evaluateBlastRadius(record, agentDef = {}) {
    const configuredMaxTargets =
        Number(agentDef?.allowedTargets?.maxTargetsPerRequest) ||
        Number(process.env.MAX_EXECUTION_TARGETS || 1);

    let actualTargets = 1;

    if (Array.isArray(record?.targets)) {
        actualTargets = record.targets.length;
    } else if (Array.isArray(record?.target_users)) {
        actualTargets = record.target_users.length;
    } else if (Array.isArray(record?.targetUsers)) {
        actualTargets = record.targetUsers.length;
    }

    if (actualTargets > configuredMaxTargets) {
        return {
            allowed: false,
            maxTargets: configuredMaxTargets,
            actualTargets,
            reason: `Blast radius exceeded: ${actualTargets} targets requested, maximum allowed is ${configuredMaxTargets}`
        };
    }

    const excludedGroupClasses = new Set(
        (agentDef?.allowedTargets?.excludedGroupClasses || []).map(normalize)
    );

    const requestedGroupClass = normalize(
        record?.target_group_class ||
        record?.target_resource_class ||
        record?.policy?.targetClass
    );

    if (requestedGroupClass && excludedGroupClasses.has(requestedGroupClass)) {
        return {
            allowed: false,
            maxTargets: configuredMaxTargets,
            actualTargets,
            reason: `Target class ${requestedGroupClass} is excluded for this agent`
        };
    }

    const allowedGroupTypes = new Set(
        (agentDef?.allowedTargets?.groupTypes || []).map(normalize)
    );

    const requestedGroupType = normalize(
        record?.target_group_type ||
        record?.policy?.groupType
    );

    if (
        allowedGroupTypes.size > 0 &&
        requestedGroupType &&
        !allowedGroupTypes.has(requestedGroupType)
    ) {
        return {
            allowed: false,
            maxTargets: configuredMaxTargets,
            actualTargets,
            reason: `Target group type ${requestedGroupType} is not allowed for this agent`
        };
    }

    return {
        allowed: true,
        maxTargets: configuredMaxTargets,
        actualTargets,
        reason: null
    };
}

function evaluateEnvironmentGate(record = {}, agentDef = {}) {
    const environment = normalize(process.env.RUNTIME_ENVIRONMENT || 'dev');

    const globallyAllowedEnvironments = parseCsvEnv('EXECUTION_ALLOWED_ENVIRONMENTS');
    const agentAllowedEnvironments = new Set(
        (agentDef?.environment || []).map(normalize)
    );

    if (
        globallyAllowedEnvironments.size > 0 &&
        !globallyAllowedEnvironments.has(environment)
    ) {
        return {
            allowed: false,
            environment,
            reason: `Execution is not allowed in environment: ${environment}`
        };
    }

    if (
        agentAllowedEnvironments.size > 0 &&
        !agentAllowedEnvironments.has(environment)
    ) {
        return {
            allowed: false,
            environment,
            reason: `Agent ${agentDef.agentName || 'UNKNOWN_AGENT'} is not authorized for environment: ${environment}`
        };
    }

    return {
        allowed: true,
        environment,
        reason: null
    };
}

function evaluateApprovalGate(record = {}, agentDef = {}) {
    const status = normalize(record?.status);

    if (agentDef?.approvalRequired === true) {
        if (status !== 'approved') {
            return {
                allowed: false,
                approvalState: record?.status || null,
                reason: `Request must be APPROVED before execution (current: ${record?.status || 'null'})`
            };
        }

        return {
            allowed: true,
            approvalState: record?.status || 'APPROVED',
            reason: null
        };
    }

    return {
        allowed: true,
        approvalState: record?.status || 'NOT_REQUIRED',
        reason: null
    };
}

module.exports = {
    getActionFamily,
    isExecutionEnabledForFamily,
    evaluateBlastRadius,
    evaluateEnvironmentGate,
    evaluateApprovalGate
};