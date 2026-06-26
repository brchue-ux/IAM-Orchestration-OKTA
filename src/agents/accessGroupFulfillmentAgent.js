const { oktaRequest } = require('../services/oktaClient');
const { findUserByLogin, findGroupByName } = require('../services/oktaLookupService');

/**
 * Access Group Fulfillment Agent
 * Responsibility:
 * - Resolve user + group
 * - Perform group membership assignment
 * - Return structured execution response
 *
 * Boundaries:
 * - ONLY group membership changes
 * - NO user lifecycle or policy changes
 */

async function addUserToApprovedGroup(record, context) {
    try {
        // ✅ Resolve subject (user)
        const subjectLogin =
            record?.subject?.email ||
            record?.target_user ||
            record?.targetUser ||
            null;

        // ✅ Resolve group reference
        const groupRef =
            record?.target ||
            record?.target_resource ||
            record?.groupName ||
            null;

        // ✅ Validate input
        if (!subjectLogin || !groupRef) {
            throw new Error('Missing subject login/email or target group');
        }

        // ✅ STEP 1 — Resolve user (FIXED lookup logic)
        const user = await findUserByLogin(subjectLogin);

        if (!user?.id) {
            throw new Error(`Okta user resolution failed for: ${subjectLogin}`);
        }

        // ✅ STEP 2 — Resolve group
        const group = await findGroupByName(groupRef);

        if (!group?.id) {
            throw new Error(`Okta group resolution failed for: ${groupRef}`);
        }

        // ✅ STEP 3 — Execute membership assignment
        await oktaRequest({
            method: 'PUT',
            path: `/api/v1/groups/${group.id}/users/${user.id}`,
            expectedStatus: [204]
        });

        // ✅ SUCCESS RESPONSE
        return {
            actionFamily: 'GROUP_FULFILLMENT',
            executionState: 'SUCCESS',
            verificationState: 'PENDING',
            rollbackState: 'NOT_RUN',

            evidence: {
                correlationInput: {
                    subjectLogin,
                    groupRef
                },
                resolvedEntities: {
                    userId: user.id,
                    groupId: group.id
                },
                groupName: group?.profile?.name || groupRef,
                subjectEmail: user?.profile?.email || subjectLogin
            },

            details: {
                note: 'Okta group membership assignment completed',
                operation: 'ADD_USER_TO_GROUP'
            }
        };

    } catch (error) {
        // ✅ FAILURE RESPONSE (structured per runbook principles)
        return {
            actionFamily: 'GROUP_FULFILLMENT',
            executionState: 'FAILED',
            verificationState: 'NOT_RUN',
            rollbackState: 'NOT_RUN',

            evidence: {
                attemptedContext: {
                    subjectLogin:
                        record?.subject?.email ||
                        record?.target_user ||
                        record?.targetUser ||
                        null,
                    groupRef:
                        record?.target ||
                        record?.target_resource ||
                        record?.groupName ||
                        null
                }
            },

            details: {
                message: error.message,
                status: error.status || null,
                responseBody: error.responseBody || null,
                classification: classifyFailure(error)
            }
        };
    }
}

/**
 * ✅ Failure classification (aligned to runbook model)
 */
function classifyFailure(error) {
    const msg = (error.message || '').toLowerCase();

    if (msg.includes('not found')) {
        return 'DATA_RESOLUTION_FAILURE';
    }

    if (msg.includes('scope') || msg.includes('permission')) {
        return 'AUTHORIZATION_FAILURE';
    }

    if (msg.includes('token') || msg.includes('signature')) {
        return 'AUTHENTICATION_FAILURE';
    }

    if (msg.includes('timeout') || msg.includes('network')) {
        return 'CONNECTOR_FAILURE';
    }

    return 'EXECUTION_FAILURE';
}

module.exports = {
    addUserToApprovedGroup
};