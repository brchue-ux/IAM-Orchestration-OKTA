const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');
const { saveRequest, getRequest } = require('../storage/approvalStore');

// ==============================
// LOCAL TABLE ACCESS (for duplicate request detection)
// This is read-only intake logic and does NOT replace approvalStore.
// ==============================
const requestsConnectionString =
    process.env.APPROVALS_STORAGE_CONNECTION || process.env.AzureWebJobsStorage;

const requestsTableName =
    process.env.APPROVALS_TABLE_NAME || 'ApprovalRequests';

const requestsTableClient = TableClient.fromConnectionString(
    requestsConnectionString,
    requestsTableName
);

// ==============================
// HELPERS
// ==============================
function normalize(value) {
    return String(value || '').trim().toLowerCase();
}

function buildDuplicateSignature(subjectEmail, target, action) {
    return `${normalize(subjectEmail)}|${normalize(target)}|${normalize(action)}`;
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

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getCallerIdentity(request, fallback = 'anonymous') {
    return (
        request.headers.get('x-ms-client-principal-name') ||
        request.headers.get('x-user-email') ||
        fallback
    );
}

// Suggested config format:
// TOXIC_COMBOS="PayrollAdmins|FinanceApprovers;PrivilegedAccess|BreakGlass"
function parseToxicCombos(name) {
    const raw = process.env[name] || '';
    return raw
        .split(';')
        .map(x => x.trim())
        .filter(Boolean)
        .map(pair => {
            const [left, right] = pair.split('|').map(x => normalize(x));
            if (!left || !right) {
                return null;
            }
            return { left, right };
        })
        .filter(Boolean);
}

// ==============================
// STRUCTURED LOGGING SCHEMA
// Logs JSON to context.log() so traces remain queryable.
// ==============================
function buildLogEnvelope(eventName, severity, fields = {}) {
    return {
        schemaVersion: '1.0',
        component: 'SubmitRequest.js',
        eventName,
        severity,
        timestamp: new Date().toISOString(),

        requestId: fields.requestId || null,
        correlationId: fields.correlationId || null,
        requester: fields.requester || null,
        subjectEmail: fields.subjectEmail || null,
        target: fields.target || null,
        action: fields.action || null,
        requestType: fields.requestType || null,

        status: fields.status || null,
        riskTier: fields.riskTier || null,
        approvalRoute: fields.approvalRoute || null,

        duplicateSignature: fields.duplicateSignature || null,
        duplicateFound: fields.duplicateFound ?? null,
        existingRequestId: fields.existingRequestId || null,
        existingStatus: fields.existingStatus || null,

        alreadyHasAccess: fields.alreadyHasAccess ?? null,
        conflictDetected: fields.conflictDetected ?? null,
        recommendation: fields.recommendation || null,

        provider: fields.provider || null,
        operation: fields.operation || null,
        failureType: fields.failureType || null,
        verified: fields.verified ?? null,

        details: fields.details || {}
    };
}

function emitLog(context, eventName, fields = {}, severity = 'Information') {
    const envelope = buildLogEnvelope(eventName, severity, fields);
    context.log(JSON.stringify(envelope));
}

// ==============================
// DUPLICATE REQUEST DETECTION
// Query by persisted duplicateSignature + open statuses.
// ==============================
async function findDuplicateOpenRequest(duplicateSignature, context) {
    const openStatuses = new Set(['PENDING_APPROVAL', 'APPROVED']);

    const entities = requestsTableClient.listEntities({
        queryOptions: {
            filter: `partitionKey eq 'REQUEST' and duplicateSignature eq '${duplicateSignature.replace(/'/g, "''")}'`,
            select: [
                'rowKey',
                'status',
                'requester',
                'correlationId',
                'submittedAt',
                'duplicateSignature'
            ]
        }
    });

    for await (const entity of entities) {
        if (!openStatuses.has(entity.status)) {
            continue;
        }

        return {
            requestId: entity.rowKey,
            status: entity.status,
            requester: entity.requester || null,
            correlationId: entity.correlationId || null,
            submittedAt: entity.submittedAt || null
        };
    }

    return null;
}

// ==============================
// VALIDATION
// ==============================
function validateRequest(body) {
    const errors = [];

    if (!body) {
        errors.push('Missing request body');
        return errors;
    }

    if (!body.requestMetadata?.correlationId) {
        errors.push('Missing correlationId');
    }

    if (!body.requester?.email) {
        errors.push('Missing requester.email');
    }

    if (!body.subject?.email) {
        errors.push('Missing subject.email');
    }

    if (!body.requestContext?.requestType) {
        errors.push('Missing requestContext.requestType');
    }

    if (!body.target?.targetIdentifier) {
        errors.push('Missing target.targetIdentifier');
    }

    if (!body.requestedAction?.actionType) {
        errors.push('Missing requestedAction.actionType');
    }

    const allowedActions = ['ADD_USER_TO_GROUP'];

    if (!allowedActions.includes(body.requestedAction?.actionType)) {
        errors.push(`Action not allowed: ${body.requestedAction?.actionType}`);
    }

    return errors;
}

// ==============================
// POLICY ENGINE
// ==============================
function classifyRisk(record) {
    const target = normalize(record.target);

    const blocked = parseCsvEnv('BLOCKED_GROUPS');
    const allowed = parseCsvEnv('ALLOWED_GROUPS');

    if (blocked.has(target)) {
        return {
            tier: 'CRITICAL',
            reason: 'Target is explicitly blocked'
        };
    }

    if (
        target.includes('admin') ||
        target.includes('privileged') ||
        target.includes('root')
    ) {
        return {
            tier: 'HIGH',
            reason: 'Sensitive group keyword detected'
        };
    }

    if (allowed.has(target)) {
        return {
            tier: 'LOW',
            reason: 'Target is allowlisted'
        };
    }

    return {
        tier: 'MEDIUM',
        reason: 'Default classification'
    };
}

function getApprovalRoute(riskTier) {
    switch (riskTier) {
        case 'LOW':
            return 'AUTO_APPROVAL';
        case 'MEDIUM':
            return 'MANAGER';
        case 'HIGH':
            return 'SECURITY';
        case 'CRITICAL':
            return 'NONE';
        default:
            return 'MANAGER';
    }
}

function isApproverAuthorized(record, approver) {
    const tier = record?.policy?.riskTier;

    if (!tier) {
        return { authorized: true, reason: null };
    }

    if (tier === 'LOW') {
        return { authorized: false, reason: 'LOW risk requests do not require manual approval' };
    }

    if (tier === 'CRITICAL') {
        return { authorized: false, reason: 'CRITICAL risk requests cannot be approved' };
    }

    if (tier === 'MEDIUM') {
        const managers = parseCsvEnv('MANAGER_APPROVERS');
        if (managers.size > 0 && !managers.has(normalize(approver))) {
            return { authorized: false, reason: 'Approver is not authorized for MEDIUM risk requests' };
        }
    }

    if (tier === 'HIGH') {
        const securityApprovers = parseCsvEnv('SECURITY_APPROVERS');
        if (securityApprovers.size > 0 && !securityApprovers.has(normalize(approver))) {
            return { authorized: false, reason: 'Approver is not authorized for HIGH risk requests' };
        }
    }

    return { authorized: true, reason: null };
}

// ==============================
// RUNTIME GUARDRAILS
// ==============================
function evaluateTargetGuardrails(targetIdentifier) {
    const normalizedTarget = normalize(targetIdentifier);

    const allowed = parseCsvEnv('ALLOWED_GROUPS');
    const blocked = parseCsvEnv('BLOCKED_GROUPS');

    if (blocked.has(normalizedTarget)) {
        return {
            allowed: false,
            reason: `Target is explicitly blocked: ${targetIdentifier}`,
            policyResult: 'BLOCKED_GROUP'
        };
    }

    if (allowed.size > 0 && !allowed.has(normalizedTarget)) {
        return {
            allowed: false,
            reason: `Target is not in ALLOWED_GROUPS: ${targetIdentifier}`,
            policyResult: 'NOT_IN_ALLOWLIST'
        };
    }

    return {
        allowed: true,
        reason: null,
        policyResult: 'ALLOWED'
    };
}

// ==============================
// OKTA CONFIG
// ==============================
function getOktaConfig() {
    const baseUrl = process.env.OKTA_ORG_URL;
    const accessToken = process.env.OKTA_ACCESS_TOKEN;
    const apiToken = process.env.OKTA_API_TOKEN;

    if (!baseUrl) {
        throw new Error('Missing OKTA_ORG_URL');
    }

    if (!accessToken && !apiToken) {
        throw new Error('Missing OKTA_ACCESS_TOKEN or OKTA_API_TOKEN');
    }

    const authHeader = accessToken
        ? `Bearer ${accessToken}`
        : `SSWS ${apiToken}`;

    return { baseUrl, authHeader };
}

async function oktaRequest(method, path, options = {}) {
    const { baseUrl, authHeader } = getOktaConfig();
    const { body, retry = false, maxAttempts = 3, context } = options;

    let attempt = 0;
    let lastError = null;

    while (attempt < maxAttempts) {
        attempt += 1;

        try {
            const response = await fetch(`${baseUrl}${path}`, {
                method,
                headers: {
                    Authorization: authHeader,
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                },
                body: body ? JSON.stringify(body) : undefined
            });

            let responseBody = null;
            try {
                responseBody = await response.json();
            } catch {
                responseBody = null;
            }

            if (!response.ok) {
                const message =
                    responseBody?.errorSummary ||
                    responseBody?.errorCauses?.map(c => c.errorSummary).join('; ') ||
                    `Okta request failed with status ${response.status}`;

                const error = new Error(message);
                error.status = response.status;
                error.responseBody = responseBody;

                const retryableStatuses = new Set([429, 500, 502, 503, 504]);
                const backoffBase = 300;

                if (retry && retryableStatuses.has(response.status) && attempt < maxAttempts) {
                    const delay = backoffBase * Math.pow(2, attempt);

                    emitLog(
                        context,
                        'IAM_OKTA_RETRY',
                        {
                            status: 'RETRYING',
                            provider: 'okta',
                            details: {
                                attempt,
                                delayMs: delay,
                                statusCode: response.status
                            }
                        },
                        'Warning'
                    );

                    await sleep(delay);
                    continue;
                }

                throw error;
            }

            return responseBody;
        } catch (error) {
            lastError = error;

            if (!retry || attempt >= maxAttempts) {
                throw error;
            }

            const delay = 300 * Math.pow(2, attempt);

            emitLog(
                context,
                'IAM_OKTA_RETRY_EXCEPTION',
                {
                    status: 'RETRYING',
                    provider: 'okta',
                    details: {
                        attempt,
                        delayMs: delay,
                        message: error.message
                    }
                },
                'Warning'
            );

            await sleep(delay);
        }
    }

    throw lastError || new Error('Unknown Okta request failure');
}

// ==============================
// OKTA LOOKUPS
// ==============================
async function resolveOktaUserIdFromSubjectEmail(subjectEmail, context) {
    const user = await oktaRequest(
        'GET',
        `/api/v1/users/${encodeURIComponent(subjectEmail)}`,
        { retry: true, context }
    );

    if (!user?.id) {
        throw new Error(`No Okta user id returned for subject: ${subjectEmail}`);
    }

    return user.id;
}

async function resolveOktaGroupFromTargetName(targetIdentifier, context) {
    const groups = await oktaRequest(
        'GET',
        `/api/v1/groups?search=${encodeURIComponent(`profile.name eq "${targetIdentifier}"`)}&limit=10`,
        { retry: true, context }
    );

    if (!Array.isArray(groups) || groups.length === 0) {
        throw new Error(`No Okta group found for target: ${targetIdentifier}`);
    }

    const exact = groups.find(g => normalize(g?.profile?.name) === normalize(targetIdentifier));
    const group = exact || groups[0];

    if (!group?.id) {
        throw new Error(`No Okta group id returned for target: ${targetIdentifier}`);
    }

    return {
        id: group.id,
        name: group?.profile?.name || targetIdentifier,
        type: group?.type || null
    };
}

async function getUserGroups(oktaUserId, context) {
    const groups = await oktaRequest(
        'GET',
        `/api/v1/users/${encodeURIComponent(oktaUserId)}/groups`,
        { retry: true, context }
    );

    return Array.isArray(groups) ? groups : [];
}

async function assignUserToGroup(oktaUserId, oktaGroupId, context) {
    await oktaRequest(
        'PUT',
        `/api/v1/groups/${encodeURIComponent(oktaGroupId)}/users/${encodeURIComponent(oktaUserId)}`,
        { retry: false, context }
    );
}

async function verifyUserGroupMembership(oktaUserId, oktaGroupId, context) {
    const groups = await getUserGroups(oktaUserId, context);
    return groups.some(g => g?.id === oktaGroupId);
}

// ==============================
// ENTITLEMENT INTELLIGENCE
// ==============================
async function assessEntitlements(record, context) {
    const oktaUserId = await resolveOktaUserIdFromSubjectEmail(record.subject.email, context);
    const targetGroup = await resolveOktaGroupFromTargetName(record.target, context);
    const currentGroups = await getUserGroups(oktaUserId, context);

    const currentGroupIds = new Set(currentGroups.map(g => g?.id).filter(Boolean));
    const currentGroupNames = new Set(
        currentGroups
            .map(g => normalize(g?.profile?.name))
            .filter(Boolean)
    );

    const alreadyHasAccess = currentGroupIds.has(targetGroup.id);

    const toxicCombos = parseToxicCombos('TOXIC_COMBOS');
    let conflictDetected = false;
    let conflictType = null;
    let conflictWith = null;
    let recommendation = 'PROCEED';
    let reason = 'No existing membership or conflict detected';

    if (alreadyHasAccess) {
        recommendation = 'REJECT';
        reason = 'Subject already has target group membership';
    }

    for (const combo of toxicCombos) {
        const targetName = normalize(targetGroup.name);

        const matchesLeftTarget = combo.left === targetName && currentGroupNames.has(combo.right);
        const matchesRightTarget = combo.right === targetName && currentGroupNames.has(combo.left);

        if (matchesLeftTarget || matchesRightTarget) {
            conflictDetected = true;
            conflictType = 'TOXIC_COMBINATION';
            conflictWith = matchesLeftTarget ? combo.right : combo.left;

            if (recommendation !== 'REJECT') {
                recommendation = 'ESCALATE';
                reason = `Toxic combination detected with existing group: ${conflictWith}`;
            }
            break;
        }
    }

    return {
        alreadyHasAccess,
        duplicateRequest: false,
        conflictDetected,
        conflictType,
        conflictWith,
        recommendation,
        reason,
        checkedAt: new Date().toISOString(),
        oktaUserId,
        oktaGroupId: targetGroup.id,
        targetGroupType: targetGroup.type,
        targetGroupName: targetGroup.name,
        currentGroups: currentGroups.map(g => ({
            id: g?.id || null,
            name: g?.profile?.name || null,
            type: g?.type || null
        }))
    };
}

// ==============================
// 1) SUBMIT REQUEST
// ==============================
app.http('SubmitRequest', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'SubmitRequest',

    handler: async (request, context) => {
        let body = {};

        try {
            body = await request.json();
        } catch {
            emitLog(
                context,
                'IAM_REQUEST_SUBMIT_RECEIVED',
                {
                    status: 'REJECTED',
                    details: {
                        reason: 'Invalid JSON'
                    }
                },
                'Error'
            );

            return {
                status: 400,
                jsonBody: {
                    status: 'REJECTED',
                    reason: 'Invalid JSON'
                }
            };
        }

        const errors = validateRequest(body);

        if (errors.length > 0) {
            emitLog(
                context,
                'IAM_REQUEST_SUBMIT_RECEIVED',
                {
                    correlationId: body?.requestMetadata?.correlationId || null,
                    requester: body?.requester?.email || null,
                    subjectEmail: body?.subject?.email || null,
                    target: body?.target?.targetIdentifier || null,
                    action: body?.requestedAction?.actionType || null,
                    requestType: body?.requestContext?.requestType || null,
                    status: 'REJECTED',
                    details: {
                        errors
                    }
                },
                'Warning'
            );

            return {
                status: 400,
                jsonBody: {
                    status: 'REJECTED',
                    errors
                }
            };
        }

        const caller = getCallerIdentity(request, body.requester?.email || 'anonymous');
        const duplicateSignature = buildDuplicateSignature(
            body.subject.email,
            body.target.targetIdentifier,
            body.requestedAction.actionType
        );

        const requestRecord = {
            requestId: `req-${Date.now()}`,
            correlationId: body.requestMetadata.correlationId,
            status: 'PENDING_APPROVAL',
            requester: body.requester.email,
            subject: {
                email: body.subject.email
            },
            requestType: body.requestContext.requestType,
            action: body.requestedAction.actionType,
            target: body.target.targetIdentifier,
            submittedAt: new Date().toISOString(),

            duplicateSignature,

            approval: null,
            execution: null,

            policy: {
                requestedBy: caller,
                riskTier: null,
                riskReason: null,
                approvalRoute: null,
                targetEvaluation: null,
                duplicateCheck: null,
                entitlementAssessment: null
            },

            oktaUserId: null,
            oktaGroupId: null,
            verification: null
        };

        emitLog(context, 'IAM_REQUEST_SUBMIT_RECEIVED', {
            requestId: requestRecord.requestId,
            correlationId: requestRecord.correlationId,
            requester: requestRecord.requester,
            subjectEmail: requestRecord.subject.email,
            target: requestRecord.target,
            action: requestRecord.action,
            requestType: requestRecord.requestType,
            status: requestRecord.status,
            duplicateSignature: requestRecord.duplicateSignature
        });

        const duplicate = await findDuplicateOpenRequest(duplicateSignature, context);

        requestRecord.policy.duplicateCheck = {
            duplicateFound: !!duplicate,
            duplicateSignature,
            existingRequestId: duplicate?.requestId || null,
            existingStatus: duplicate?.status || null,
            checkedAt: new Date().toISOString()
        };

        if (duplicate) {
            requestRecord.status = 'REJECTED';
            requestRecord.approval = {
                decision: 'REJECTED',
                approver: 'system',
                reason: `Duplicate open request exists: ${duplicate.requestId} (${duplicate.status})`,
                decidedAt: new Date().toISOString()
            };

            await saveRequest(requestRecord);

            emitLog(
                context,
                'IAM_REQUEST_DUPLICATE_REJECTED',
                {
                    requestId: requestRecord.requestId,
                    correlationId: requestRecord.correlationId,
                    requester: requestRecord.requester,
                    subjectEmail: requestRecord.subject.email,
                    target: requestRecord.target,
                    action: requestRecord.action,
                    requestType: requestRecord.requestType,
                    status: requestRecord.status,
                    duplicateSignature,
                    duplicateFound: true,
                    existingRequestId: duplicate.requestId,
                    existingStatus: duplicate.status
                },
                'Warning'
            );

            return {
                status: 409,
                jsonBody: {
                    status: 'REJECTED',
                    requestId: requestRecord.requestId,
                    correlationId: requestRecord.correlationId,
                    reason: `Duplicate open request exists: ${duplicate.requestId} (${duplicate.status})`,
                    duplicateOf: duplicate.requestId
                }
            };
        }

        const risk = classifyRisk(requestRecord);
        requestRecord.policy.riskTier = risk.tier;
        requestRecord.policy.riskReason = risk.reason;
        requestRecord.policy.approvalRoute = getApprovalRoute(risk.tier);

        if (risk.tier === 'CRITICAL') {
            requestRecord.status = 'POLICY_REJECTED';
            requestRecord.execution = {
                executor: 'system',
                provider: 'policy-engine',
                operation: requestRecord.action,
                subjectEmail: requestRecord.subject.email,
                result: 'BLOCKED',
                policyResult: 'CRITICAL_RISK',
                error: risk.reason,
                executedAt: new Date().toISOString()
            };

            await saveRequest(requestRecord);

            emitLog(
                context,
                'IAM_REQUEST_POLICY_REJECTED',
                {
                    requestId: requestRecord.requestId,
                    correlationId: requestRecord.correlationId,
                    requester: requestRecord.requester,
                    subjectEmail: requestRecord.subject.email,
                    target: requestRecord.target,
                    action: requestRecord.action,
                    requestType: requestRecord.requestType,
                    status: requestRecord.status,
                    riskTier: requestRecord.policy.riskTier,
                    approvalRoute: requestRecord.policy.approvalRoute,
                    duplicateSignature: requestRecord.duplicateSignature,
                    details: {
                        reason: requestRecord.policy.riskReason
                    }
                },
                'Warning'
            );

            return {
                status: 403,
                jsonBody: {
                    status: 'POLICY_REJECTED',
                    requestId: requestRecord.requestId,
                    correlationId: requestRecord.correlationId,
                    riskTier: requestRecord.policy.riskTier,
                    reason: requestRecord.policy.riskReason
                }
            };
        }

        try {
            const entitlementAssessment = await assessEntitlements(requestRecord, context);
            requestRecord.policy.entitlementAssessment = entitlementAssessment;
            requestRecord.oktaUserId = entitlementAssessment.oktaUserId;
            requestRecord.oktaGroupId = entitlementAssessment.oktaGroupId;

            if (entitlementAssessment.alreadyHasAccess) {
                requestRecord.status = 'REJECTED';
                requestRecord.approval = {
                    decision: 'REJECTED',
                    approver: 'system',
                    reason: entitlementAssessment.reason,
                    decidedAt: new Date().toISOString()
                };

                await saveRequest(requestRecord);

                emitLog(
                    context,
                    'IAM_REQUEST_ALREADY_HAS_ACCESS',
                    {
                        requestId: requestRecord.requestId,
                        correlationId: requestRecord.correlationId,
                        requester: requestRecord.requester,
                        subjectEmail: requestRecord.subject.email,
                        target: requestRecord.target,
                        action: requestRecord.action,
                        requestType: requestRecord.requestType,
                        status: requestRecord.status,
                        riskTier: requestRecord.policy.riskTier,
                        approvalRoute: requestRecord.policy.approvalRoute,
                        duplicateSignature: requestRecord.duplicateSignature,
                        alreadyHasAccess: true,
                        recommendation: entitlementAssessment.recommendation
                    },
                    'Warning'
                );

                return {
                    status: 409,
                    jsonBody: {
                        status: 'REJECTED',
                        requestId: requestRecord.requestId,
                        correlationId: requestRecord.correlationId,
                        reason: entitlementAssessment.reason,
                        riskTier: requestRecord.policy.riskTier
                    }
                };
            }

            if (entitlementAssessment.conflictDetected) {
                requestRecord.policy.riskTier = 'HIGH';
                requestRecord.policy.riskReason = entitlementAssessment.reason;
                requestRecord.policy.approvalRoute = 'SECURITY';
            }

            if (
                entitlementAssessment.targetGroupType &&
                entitlementAssessment.targetGroupType !== 'OKTA_GROUP'
            ) {
                requestRecord.status = 'POLICY_REJECTED';
                requestRecord.execution = {
                    executor: 'system',
                    provider: 'policy-engine',
                    operation: requestRecord.action,
                    subjectEmail: requestRecord.subject.email,
                    result: 'BLOCKED',
                    policyResult: 'NON_OKTA_GROUP',
                    error: `Target group is not OKTA_GROUP: ${entitlementAssessment.targetGroupType}`,
                    executedAt: new Date().toISOString()
                };

                await saveRequest(requestRecord);

                emitLog(
                    context,
                    'IAM_REQUEST_POLICY_REJECTED',
                    {
                        requestId: requestRecord.requestId,
                        correlationId: requestRecord.correlationId,
                        requester: requestRecord.requester,
                        subjectEmail: requestRecord.subject.email,
                        target: requestRecord.target,
                        action: requestRecord.action,
                        requestType: requestRecord.requestType,
                        status: requestRecord.status,
                        riskTier: requestRecord.policy.riskTier,
                        approvalRoute: requestRecord.policy.approvalRoute,
                        duplicateSignature: requestRecord.duplicateSignature,
                        details: {
                            reason: `Target group is not OKTA_GROUP: ${entitlementAssessment.targetGroupType}`
                        }
                    },
                    'Warning'
                );

                return {
                    status: 403,
                    jsonBody: {
                        status: 'POLICY_REJECTED',
                        requestId: requestRecord.requestId,
                        correlationId: requestRecord.correlationId,
                        reason: `Target group is not OKTA_GROUP: ${entitlementAssessment.targetGroupType}`,
                        riskTier: requestRecord.policy.riskTier
                    }
                };
            }
        } catch (error) {
            requestRecord.status = 'ASSESSMENT_FAILED';
            requestRecord.execution = {
                executor: 'system',
                provider: 'entitlement-intelligence',
                operation: requestRecord.action,
                subjectEmail: requestRecord.subject.email,
                result: 'FAILED',
                error: error.message,
                statusCode: error.status || null,
                executedAt: new Date().toISOString()
            };

            await saveRequest(requestRecord);

            emitLog(
                context,
                'IAM_REQUEST_ASSESSMENT_FAILED',
                {
                    requestId: requestRecord.requestId,
                    correlationId: requestRecord.correlationId,
                    requester: requestRecord.requester,
                    subjectEmail: requestRecord.subject.email,
                    target: requestRecord.target,
                    action: requestRecord.action,
                    requestType: requestRecord.requestType,
                    status: requestRecord.status,
                    riskTier: requestRecord.policy.riskTier,
                    approvalRoute: requestRecord.policy.approvalRoute,
                    duplicateSignature: requestRecord.duplicateSignature,
                    provider: 'entitlement-intelligence',
                    operation: requestRecord.action,
                    failureType: 'GENERAL_FAILURE',
                    details: {
                        error: error.message,
                        statusCode: error.status || null
                    }
                },
                'Error'
            );

            return {
                status: 502,
                jsonBody: {
                    status: 'ASSESSMENT_FAILED',
                    requestId: requestRecord.requestId,
                    correlationId: requestRecord.correlationId,
                    reason: error.message
                }
            };
        }

        if (requestRecord.policy.riskTier === 'LOW') {
            requestRecord.status = 'APPROVED';
            requestRecord.approval = {
                decision: 'AUTO_APPROVED',
                approver: 'system',
                reason: 'Low risk auto-approval',
                decidedAt: new Date().toISOString()
            };
        }

        await saveRequest(requestRecord);

        emitLog(context, 'IAM_REQUEST_CREATED', {
            requestId: requestRecord.requestId,
            correlationId: requestRecord.correlationId,
            requester: requestRecord.requester,
            subjectEmail: requestRecord.subject.email,
            target: requestRecord.target,
            action: requestRecord.action,
            requestType: requestRecord.requestType,
            status: requestRecord.status,
            riskTier: requestRecord.policy.riskTier,
            approvalRoute: requestRecord.policy.approvalRoute,
            duplicateSignature: requestRecord.duplicateSignature,
            duplicateFound: requestRecord.policy.duplicateCheck?.duplicateFound || false,
            alreadyHasAccess: requestRecord.policy.entitlementAssessment?.alreadyHasAccess || false,
            conflictDetected: requestRecord.policy.entitlementAssessment?.conflictDetected || false,
            recommendation: requestRecord.policy.entitlementAssessment?.recommendation || 'PROCEED'
        });

        return {
            status: requestRecord.status === 'APPROVED' ? 200 : 202,
            jsonBody: {
                status: requestRecord.status,
                requestId: requestRecord.requestId,
                correlationId: requestRecord.correlationId,
                riskTier: requestRecord.policy.riskTier,
                approvalRoute: requestRecord.policy.approvalRoute,
                entitlementAssessment: {
                    alreadyHasAccess: requestRecord.policy.entitlementAssessment?.alreadyHasAccess || false,
                    conflictDetected: requestRecord.policy.entitlementAssessment?.conflictDetected || false,
                    recommendation: requestRecord.policy.entitlementAssessment?.recommendation || 'PROCEED'
                }
            }
        };
    }
});

// ==============================
// 2) REQUEST STATUS
// ==============================
app.http('RequestStatus', {
    methods: ['GET'],
    authLevel: 'function',
    route: 'RequestStatus',

    handler: async (request, context) => {
        const requestId = request.query.get('requestId');

        if (!requestId) {
            return {
                status: 400,
                jsonBody: {
                    status: 'REJECTED',
                    reason: 'Missing requestId'
                }
            };
        }

        const record = await getRequest(requestId);

        if (!record) {
            return {
                status: 404,
                jsonBody: {
                    status: 'NOT_FOUND',
                    requestId
                }
            };
        }

        return {
            status: 200,
            jsonBody: record
        };
    }
});

// ==============================
// 3) AUDIT LOG
// ==============================
app.http('AuditLog', {
    methods: ['GET'],
    authLevel: 'function',
    route: 'AuditLog',

    handler: async (request, context) => {
        const requestId = request.query.get('requestId');

        if (!requestId) {
            return {
                status: 400,
                jsonBody: {
                    status: 'REJECTED',
                    reason: 'Missing requestId'
                }
            };
        }

        const record = await getRequest(requestId);

        if (!record) {
            return {
                status: 404,
                jsonBody: {
                    status: 'NOT_FOUND',
                    requestId
                }
            };
        }

        return {
            status: 200,
            jsonBody: {
                audit: {
                    requestId: record.requestId,
                    correlationId: record.correlationId,
                    requester: record.requester,
                    subject: record.subject,
                    action: record.action,
                    target: record.target,
                    duplicateSignature: record.duplicateSignature,
                    status: record.status,
                    submittedAt: record.submittedAt,
                    approval: record.approval,
                    execution: record.execution,
                    policy: record.policy,
                    verification: record.verification,
                    oktaUserId: record.oktaUserId,
                    oktaGroupId: record.oktaGroupId
                }
            }
        };
    }
});

// ==============================
// 4) APPROVE REQUEST
// ==============================
app.http('ApproveRequest', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'ApproveRequest',

    handler: async (request, context) => {
        let body = {};

        try {
            body = await request.json();
        } catch {
            return {
                status: 400,
                jsonBody: {
                    status: 'REJECTED',
                    reason: 'Invalid JSON'
                }
            };
        }

        const requestId = body?.requestId;
        const caller = getCallerIdentity(request, 'anonymous');
        const approver = caller !== 'anonymous' ? caller : body?.approver;

        if (!requestId || !approver) {
            return {
                status: 400,
                jsonBody: {
                    status: 'REJECTED',
                    reason: 'Missing requestId or approver'
                }
            };
        }

        const record = await getRequest(requestId);

        if (!record) {
            return {
                status: 404,
                jsonBody: {
                    status: 'NOT_FOUND',
                    requestId
                }
            };
        }

        if (record.requester === approver) {
            return {
                status: 403,
                jsonBody: {
                    status: 'REJECTED',
                    reason: 'Requester cannot approve their own request'
                }
            };
        }

        if (record.policy?.riskTier === 'LOW') {
            return {
                status: 409,
                jsonBody: {
                    status: 'REJECTED',
                    reason: 'LOW risk requests are auto-approved and do not require manual approval'
                }
            };
        }

        const authz = isApproverAuthorized(record, approver);
        if (!authz.authorized) {
            return {
                status: 403,
                jsonBody: {
                    status: 'REJECTED',
                    reason: authz.reason
                }
            };
        }

        if (record.status !== 'PENDING_APPROVAL') {
            return {
                status: 409,
                jsonBody: {
                    status: 'REJECTED',
                    reason: `Request is already ${record.status}`
                }
            };
        }

        record.status = 'APPROVED';
        record.approval = {
            decision: 'APPROVED',
            approver,
            decidedAt: new Date().toISOString()
        };

        await saveRequest(record);

        emitLog(context, 'IAM_REQUEST_APPROVED', {
            requestId: record.requestId,
            correlationId: record.correlationId,
            requester: record.requester,
            subjectEmail: record.subject?.email || null,
            target: record.target,
            action: record.action,
            requestType: record.requestType,
            status: record.status,
            riskTier: record.policy?.riskTier || null,
            approvalRoute: record.policy?.approvalRoute || null,
            duplicateSignature: record.duplicateSignature
        });

        return {
            status: 200,
            jsonBody: {
                status: 'APPROVED',
                requestId,
                riskTier: record.policy?.riskTier || null,
                approvalRoute: record.policy?.approvalRoute || null
            }
        };
    }
});

// ==============================
// 5) REJECT REQUEST
// ==============================
app.http('RejectRequest', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'RejectRequest',

    handler: async (request, context) => {
        let body = {};

        try {
            body = await request.json();
        } catch {
            return {
                status: 400,
                jsonBody: {
                    status: 'REJECTED',
                    reason: 'Invalid JSON'
                }
            };
        }

        const requestId = body?.requestId;
        const caller = getCallerIdentity(request, 'anonymous');
        const approver = caller !== 'anonymous' ? caller : body?.approver;
        const reason = body?.reason || 'No reason provided';

        if (!requestId || !approver) {
            return {
                status: 400,
                jsonBody: {
                    status: 'REJECTED',
                    reason: 'Missing requestId or approver'
                }
            };
        }

        const record = await getRequest(requestId);

        if (!record) {
            return {
                status: 404,
                jsonBody: {
                    status: 'NOT_FOUND',
                    requestId
                }
            };
        }

        if (record.status !== 'PENDING_APPROVAL' && record.status !== 'APPROVED') {
            return {
                status: 409,
                jsonBody: {
                    status: 'REJECTED',
                    reason: `Request is already ${record.status}`
                }
            };
        }

        record.status = 'REJECTED';
        record.approval = {
            decision: 'REJECTED',
            approver,
            reason,
            decidedAt: new Date().toISOString()
        };

        await saveRequest(record);

        emitLog(context, 'IAM_REQUEST_REJECTED', {
            requestId: record.requestId,
            correlationId: record.correlationId,
            requester: record.requester,
            subjectEmail: record.subject?.email || null,
            target: record.target,
            action: record.action,
            requestType: record.requestType,
            status: record.status,
            riskTier: record.policy?.riskTier || null,
            approvalRoute: record.policy?.approvalRoute || null,
            duplicateSignature: record.duplicateSignature,
            details: {
                reason
            }
        }, 'Warning');

        return {
            status: 200,
            jsonBody: {
                status: 'REJECTED',
                requestId
            }
        };
    }
});

// ==============================
// 6) EXECUTE REQUEST
// ==============================
app.http('ExecuteRequest', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'ExecuteRequest',

    handler: async (request, context) => {
        let body = {};

        try {
            body = await request.json();
        } catch {
            return {
                status: 400,
                jsonBody: {
                    status: 'REJECTED',
                    reason: 'Invalid JSON'
                }
            };
        }

        const requestId = body?.requestId;

        if (!requestId) {
            return {
                status: 400,
                jsonBody: {
                    status: 'REJECTED',
                    reason: 'Missing requestId'
                }
            };
        }

        const record = await getRequest(requestId);

        if (!record) {
            return {
                status: 404,
                jsonBody: {
                    status: 'NOT_FOUND',
                    requestId
                }
            };
        }

        emitLog(context, 'IAM_EXECUTE_START', {
            requestId: record.requestId,
            correlationId: record.correlationId,
            requester: record.requester,
            subjectEmail: record.subject?.email || null,
            target: record.target,
            action: record.action,
            requestType: record.requestType,
            status: record.status,
            riskTier: record.policy?.riskTier || null,
            approvalRoute: record.policy?.approvalRoute || null,
            duplicateSignature: record.duplicateSignature,
            provider: 'okta',
            operation: record.action
        });

        if (record.status !== 'APPROVED') {
            return {
                status: 409,
                jsonBody: {
                    status: 'REJECTED',
                    reason: 'Must be APPROVED before execution',
                    currentStatus: record.status
                }
            };
        }

        if (record.action !== 'ADD_USER_TO_GROUP') {
            return {
                status: 400,
                jsonBody: {
                    status: 'REJECTED',
                    reason: `Unsupported action for execution: ${record.action}`
                }
            };
        }

        if (!record.subject?.email) {
            return {
                status: 400,
                jsonBody: {
                    status: 'REJECTED',
                    reason: 'Missing subject.email on request record'
                }
            };
        }

        if (record.policy?.riskTier === 'CRITICAL') {
            return {
                status: 403,
                jsonBody: {
                    status: 'POLICY_REJECTED',
                    reason: 'CRITICAL risk requests cannot be executed'
                }
            };
        }

        if (record.policy?.entitlementAssessment?.alreadyHasAccess) {
            return {
                status: 409,
                jsonBody: {
                    status: 'REJECTED',
                    reason: 'Subject already has target group membership'
                }
            };
        }

        const targetGuardrails = evaluateTargetGuardrails(record.target);
        record.policy = record.policy || {};
        record.policy.targetEvaluation = targetGuardrails.policyResult;

        if (!targetGuardrails.allowed) {
            record.status = 'POLICY_REJECTED';
            record.execution = {
                executor: 'system',
                provider: 'okta',
                operation: 'ADD_USER_TO_GROUP',
                subjectEmail: record.subject.email,
                result: 'BLOCKED',
                policyResult: targetGuardrails.policyResult,
                error: targetGuardrails.reason,
                executedAt: new Date().toISOString()
            };

            await saveRequest(record);

            emitLog(context, 'IAM_REQUEST_POLICY_REJECTED', {
                requestId: record.requestId,
                correlationId: record.correlationId,
                requester: record.requester,
                subjectEmail: record.subject?.email || null,
                target: record.target,
                action: record.action,
                requestType: record.requestType,
                status: record.status,
                riskTier: record.policy?.riskTier || null,
                approvalRoute: record.policy?.approvalRoute || null,
                duplicateSignature: record.duplicateSignature,
                provider: 'okta',
                operation: 'ADD_USER_TO_GROUP',
                details: {
                    reason: targetGuardrails.reason
                }
            }, 'Warning');

            return {
                status: 403,
                jsonBody: {
                    status: 'POLICY_REJECTED',
                    requestId,
                    reason: targetGuardrails.reason
                }
            };
        }

        try {
            const oktaUserId =
                record.oktaUserId ||
                (await resolveOktaUserIdFromSubjectEmail(record.subject.email, context));

            const group =
                record.policy?.entitlementAssessment?.oktaGroupId
                    ? {
                        id: record.policy.entitlementAssessment.oktaGroupId,
                        name: record.policy.entitlementAssessment.targetGroupName || record.target,
                        type: record.policy.entitlementAssessment.targetGroupType || null
                    }
                    : await resolveOktaGroupFromTargetName(record.target, context);

            const oktaGroupId = group.id;

            if (group.type && group.type !== 'OKTA_GROUP') {
                record.status = 'POLICY_REJECTED';
                record.execution = {
                    executor: 'system',
                    provider: 'okta',
                    operation: 'ADD_USER_TO_GROUP',
                    subjectEmail: record.subject.email,
                    target: record.target,
                    result: 'BLOCKED',
                    policyResult: 'NON_OKTA_GROUP',
                    error: `Target group is not OKTA_GROUP: ${group.type}`,
                    executedAt: new Date().toISOString()
                };

                await saveRequest(record);

                emitLog(context, 'IAM_REQUEST_POLICY_REJECTED', {
                    requestId: record.requestId,
                    correlationId: record.correlationId,
                    requester: record.requester,
                    subjectEmail: record.subject?.email || null,
                    target: record.target,
                    action: record.action,
                    requestType: record.requestType,
                    status: record.status,
                    riskTier: record.policy?.riskTier || null,
                    approvalRoute: record.policy?.approvalRoute || null,
                    duplicateSignature: record.duplicateSignature,
                    provider: 'okta',
                    operation: 'ADD_USER_TO_GROUP',
                    details: {
                        reason: `Target group is not OKTA_GROUP: ${group.type}`
                    }
                }, 'Warning');

                return {
                    status: 403,
                    jsonBody: {
                        status: 'POLICY_REJECTED',
                        requestId,
                        reason: `Target group is not OKTA_GROUP: ${group.type}`
                    }
                };
            }

            await assignUserToGroup(oktaUserId, oktaGroupId, context);

            const verified = await verifyUserGroupMembership(oktaUserId, oktaGroupId, context);

            record.oktaUserId = oktaUserId;
            record.oktaGroupId = oktaGroupId;
            record.verification = {
                verified,
                checkedAt: new Date().toISOString()
            };

            if (!verified) {
                record.status = 'VERIFICATION_FAILED';
                record.execution = {
                    executor: 'system',
                    provider: 'okta',
                    operation: 'ADD_USER_TO_GROUP',
                    subjectEmail: record.subject.email,
                    oktaUserId,
                    oktaGroupId,
                    result: 'EXECUTED_BUT_NOT_VERIFIED',
                    executedAt: new Date().toISOString()
                };

                await saveRequest(record);

                emitLog(context, 'IAM_REQUEST_VERIFICATION_FAILED', {
                    requestId: record.requestId,
                    correlationId: record.correlationId,
                    requester: record.requester,
                    subjectEmail: record.subject?.email || null,
                    target: record.target,
                    action: record.action,
                    requestType: record.requestType,
                    status: record.status,
                    riskTier: record.policy?.riskTier || null,
                    approvalRoute: record.policy?.approvalRoute || null,
                    duplicateSignature: record.duplicateSignature,
                    provider: 'okta',
                    operation: 'ADD_USER_TO_GROUP',
                    verified: false,
                    details: {
                        oktaUserId,
                        oktaGroupId
                    }
                }, 'Error');

                return {
                    status: 502,
                    jsonBody: {
                        status: 'VERIFICATION_FAILED',
                        requestId,
                        subjectEmail: record.subject.email,
                        oktaUserId,
                        oktaGroupId
                    }
                };
            }

            record.status = 'EXECUTED';
            record.execution = {
                executor: 'system',
                provider: 'okta',
                operation: 'ADD_USER_TO_GROUP',
                subjectEmail: record.subject.email,
                oktaUserId,
                oktaGroupId,
                result: 'SUCCESS',
                executedAt: new Date().toISOString()
            };

            await saveRequest(record);

            emitLog(context, 'IAM_REQUEST_EXECUTED', {
                requestId: record.requestId,
                correlationId: record.correlationId,
                requester: record.requester,
                subjectEmail: record.subject?.email || null,
                target: record.target,
                action: record.action,
                requestType: record.requestType,
                status: record.status,
                riskTier: record.policy?.riskTier || null,
                approvalRoute: record.policy?.approvalRoute || null,
                duplicateSignature: record.duplicateSignature,
                provider: 'okta',
                operation: 'ADD_USER_TO_GROUP',
                verified: true,
                details: {
                    oktaUserId,
                    oktaGroupId
                }
            });

            return {
                status: 200,
                jsonBody: {
                    status: 'EXECUTED',
                    requestId,
                    provider: 'okta',
                    subjectEmail: record.subject.email,
                    oktaUserId,
                    oktaGroupId,
                    verified: true
                }
            };
        } catch (error) {
            const failureType =
                error.status === 404 ? 'NOT_FOUND' :
                error.status === 403 ? 'ACCESS_DENIED' :
                error.status === 429 ? 'RATE_LIMIT' :
                'GENERAL_FAILURE';

            record.status = 'EXECUTION_FAILED';
            record.execution = {
                executor: 'system',
                provider: 'okta',
                operation: 'ADD_USER_TO_GROUP',
                subjectEmail: record.subject?.email || null,
                result: 'FAILED',
                failureType,
                error: error.message,
                statusCode: error.status || null,
                executedAt: new Date().toISOString()
            };

            await saveRequest(record);

            emitLog(context, 'IAM_REQUEST_EXECUTION_FAILED', {
                requestId: record.requestId,
                correlationId: record.correlationId,
                requester: record.requester,
                subjectEmail: record.subject?.email || null,
                target: record.target,
                action: record.action,
                requestType: record.requestType,
                status: record.status,
                riskTier: record.policy?.riskTier || null,
                approvalRoute: record.policy?.approvalRoute || null,
                duplicateSignature: record.duplicateSignature,
                provider: 'okta',
                operation: 'ADD_USER_TO_GROUP',
                failureType,
                details: {
                    error: error.message,
                    statusCode: error.status || null
                }
            }, 'Error');

            return {
                status: 502,
                jsonBody: {
                    status: 'EXECUTION_FAILED',
                    requestId,
                    failureType,
                    reason: error.message
                }
            };
        }
    }
});