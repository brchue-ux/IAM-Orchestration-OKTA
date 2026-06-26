// =====================================
// ✅ VERIFICATION POLICY (SIMPLIFIED)
// =====================================

function buildPolicy({
    actionFamily,
    verificationRequired,
    rollbackAllowed,
    verificationAgent,
    rollbackAgent,
    escalationTarget,
    containmentRequiredOnFailure = false
}) {
    return {
        actionFamily,
        verificationRequired,
        rollbackAllowed,
        verificationAgent,
        rollbackAgent,
        escalationTarget,
        containmentRequiredOnFailure,

        // ✅ TEMP: assume implemented
        verificationAgentRegistered: true,
        rollbackAgentRegistered: true
    };
}

function getVerificationPolicy(actionFamily) {
    switch (actionFamily) {

        case 'GROUP_FULFILLMENT':
            return buildPolicy({
                actionFamily: 'GROUP_FULFILLMENT',
                verificationRequired: true,
                rollbackAllowed: true,
                verificationAgent: 'GroupVerificationAgent',
                rollbackAgent: 'GroupRollbackAgent',
                escalationTarget: 'IAM Engineering'
            });

        case 'APP_ASSIGNMENT':
            return buildPolicy({
                actionFamily: 'APP_ASSIGNMENT',
                verificationRequired: true,
                rollbackAllowed: true,
                verificationAgent: 'AppAssignmentVerificationAgent',
                rollbackAgent: 'AppAssignmentRollbackAgent',
                escalationTarget: 'IAM Engineering'
            });

        default:
            return buildPolicy({
                actionFamily,
                verificationRequired: true,
                rollbackAllowed: false,
                verificationAgent: 'GenericVerificationAgent',
                rollbackAgent: null,
                escalationTarget: 'IAM Engineering'
            });
    }
}

module.exports = {
    getVerificationPolicy
};