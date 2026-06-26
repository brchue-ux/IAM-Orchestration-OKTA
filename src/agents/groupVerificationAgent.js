// =====================================//
// Purpose:
// Verify that a user is actually a member of a target group in Okta
// AFTER execution completes.
//
// Design:
// - READ-ONLY only
// - safe retry for verification lag / eventual consistency
// - bounded to GROUP_FULFILLMENT only
// - consumes execution evidence as the primary verification contract
// =====================================

const { oktaRequest } = require('../services/oktaClient');

// -------------------------------------
// SMALL SLEEP HELPER
// -------------------------------------
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// -------------------------------------
// ENV-DRIVEN RETRY SETTINGS
// -------------------------------------
// Defaults are intentionally small and safe for read-only verification.
// You can override them in .env later if needed.
function getRetryAttempts() {
    const raw = Number(process.env.VERIFICATION_RETRY_ATTEMPTS || 3);
    return Number.isFinite(raw) && raw > 0 ? raw : 3;
}

function getRetryDelayMs() {
    const raw = Number(process.env.VERIFICATION_RETRY_DELAY_MS || 800);
    return Number.isFinite(raw) && raw >= 0 ? raw : 800;
}

// -------------------------------------
// SAFE VALUE HELPERS
// -------------------------------------
function firstNonEmpty(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && value !== '') {
            return value;
        }
    }
    return null;
}

function buildFailure(details = {}, evidence = {}) {
    return {
        verificationState: 'FAILED',
        verified: false,
        verificationAgent: 'GroupVerificationAgent',
        evidence,
        details
    };
}

// -------------------------------------
// ID RESOLUTION FROM EXECUTION EVIDENCE
// -------------------------------------
// Primary contract:
// executionResult.evidence.resolvedEntities.userId / groupId
//
// Compatibility fallbacks:
// executionResult.evidence.userId / groupId
// record.target_resource_id / target_user_id / subject.id
function resolveVerificationContext(record, executionResult) {
    const evidence = executionResult?.evidence || {};
    const resolvedEntities = evidence?.resolvedEntities || {};
    const correlationInput = evidence?.correlationInput || {};

    const groupId = firstNonEmpty(
        resolvedEntities.groupId,
        evidence.groupId,
        record?.target_resource_id
    );

    const userId = firstNonEmpty(
        resolvedEntities.userId,
        evidence.userId,
        record?.target_user_id,
        record?.subject?.id
    );

    const subjectEmail = firstNonEmpty(
        evidence.subjectEmail,
        record?.target_user,
        record?.subject?.email,
        correlationInput.subjectLogin
    );

    const groupName = firstNonEmpty(
        evidence.groupName,
        record?.target_resource,
        correlationInput.groupRef
    );

    return {
        groupId,
        userId,
        subjectEmail,
        groupName
    };
}

// -------------------------------------
// MAIN VERIFICATION FUNCTION
// -------------------------------------
async function verifyGroupMembership(record, executionResult, context = {}) {
    try {
        const {
            groupId,
            userId,
            subjectEmail,
            groupName
        } = resolveVerificationContext(record, executionResult);

        if (!groupId || !userId) {
            return buildFailure(
                {
                    reason: 'Missing groupId or userId for verification'
                },
                {
                    groupId: groupId || null,
                    userId: userId || null,
                    subjectEmail: subjectEmail || null,
                    groupName: groupName || null
                }
            );
        }

        const maxAttempts = getRetryAttempts();
        const delayMs = getRetryDelayMs();

        let lastMembers = [];
        let membershipConfirmed = false;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            // READ-ONLY lookup of group members
            const members = await oktaRequest({
                method: 'GET',
                path: `/api/v1/groups/${groupId}/users`,
                expectedStatus: [200]
            });

            lastMembers = Array.isArray(members) ? members : [];
            membershipConfirmed = lastMembers.some(user => user?.id === userId);

            if (membershipConfirmed) {
                return {
                    verificationState: 'PASSED',
                    verified: true,
                    verificationAgent: 'GroupVerificationAgent',
                    evidence: {
                        groupId,
                        userId,
                        subjectEmail: subjectEmail || null,
                        groupName: groupName || null,
                        membershipConfirmed: true,
                        verificationAttempts: attempt,
                        memberCountLastSeen: lastMembers.length
                    },
                    details: {
                        note: 'User is confirmed member of group',
                        attemptsUsed: attempt
                    }
                };
            }

            // No match yet — wait and retry if attempts remain
            if (attempt < maxAttempts) {
                if (context?.log) {
                    context.log(JSON.stringify({
                        event: 'IAM_VERIFICATION_RETRY',
                        timestamp: new Date().toISOString(),
                        actionFamily: 'GROUP_FULFILLMENT',
                        verificationAgent: 'GroupVerificationAgent',
                        groupId,
                        userId,
                        subjectEmail: subjectEmail || null,
                        groupName: groupName || null,
                        attempt,
                        nextDelayMs: delayMs
                    }));
                }

                await sleep(delayMs);
            }
        }

        // Exhausted retries
        return buildFailure(
            {
                note: 'User not found in group membership list after retry window',
                attemptsUsed: maxAttempts
            },
            {
                groupId,
                userId,
                subjectEmail: subjectEmail || null,
                groupName: groupName || null,
                membershipConfirmed: false,
                verificationAttempts: maxAttempts,
                memberCountLastSeen: Array.isArray(lastMembers)
                    ? lastMembers.length
                    : 0
            }
        );
    } catch (error) {
        return buildFailure(
            {
                message: error.message,
                status: error.status || null,
                responseBody: error.responseBody || null
            },
            {}
        );
    }
}

module.exports = {
    verifyGroupMembership
};

// GROUP VERIFICATION AGENT (PRODUCTION)
