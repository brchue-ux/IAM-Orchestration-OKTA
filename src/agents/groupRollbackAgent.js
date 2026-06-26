// =====================================// user from a target group in Okta as the rollback
// path for GROUP_FULFILLMENT if verification fails.
//
// This agent is bounded to group membership removal only.
// It must NOT perform unrelated writes.
//
// =====================================

const { oktaRequest } = require('../services/oktaClient');
const {
    findUserByLogin,
    findGroupByName
} = require('../services/oktaLookupService');

// =====================================
// ✅ MAIN ROLLBACK FUNCTION
// =====================================
async function rollbackGroupMembership(record, executionResult, context) {
    try {
        const subjectLogin =
            record?.target_user ||
            record?.subject?.email ||
            executionResult?.evidence?.subjectEmail ||
            null;

        const groupRef =
            executionResult?.evidence?.groupId ||
            executionResult?.evidence?.groupName ||
            record?.target_resource ||
            null;

        if (!subjectLogin || !groupRef) {
            return {
                rollbackState: "FAILED",
                rolledBack: false,
                rollbackAgent: "GroupRollbackAgent",
                evidence: {},
                details: {
                    reason: "Missing subject login or group reference for rollback"
                }
            };
        }

        const user = await findUserByLogin(subjectLogin);
        const group = await findGroupByName(groupRef);

        // ✅ Remove user from group
        await oktaRequest({
            method: "DELETE",
            path: `/api/v1/groups/${group.id}/users/${user.id}`,
            expectedStatus: [204]
        });

        return {
            rollbackState: "EXECUTED",
            rolledBack: true,
            rollbackAgent: "GroupRollbackAgent",

            evidence: {
                groupId: group.id,
                groupName: group?.profile?.name || groupRef,
                userId: user.id,
                subjectEmail: user?.profile?.email || subjectLogin
            },

            details: {
                note: "Okta group membership rollback completed"
            }
        };

    } catch (error) {
        return {
            rollbackState: "FAILED",
            rolledBack: false,
            rollbackAgent: "GroupRollbackAgent",

            evidence: {},

            details: {
                message: error.message,
                status: error.status || null,
                responseBody: error.responseBody || null
            }
        };
    }
}

module.exports = {
    rollbackGroupMembership
};

// ✅ GROUP ROLLBACK AGENT
// =====================================
// Purpose:
