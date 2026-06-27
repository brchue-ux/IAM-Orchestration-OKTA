/**
-back verification for group membership fulfillment. * Verification Service
 * This service confirms whether the expected postcondition is present.
 */

const { listUserGroups } = require('./oktaExecutionService');

/**
 * Verify whether the target user is a member of the target group.
 *
 * @param {string} userId
 * @param {string} groupId
 * @returns {Promise<object>}
 */
async function verifyGroupMembership(userId, groupId) {
    if (!userId) {
        throw new Error('Verification Error: userId is required');
    }

    if (!groupId) {
        throw new Error('Verification Error: groupId is required');
    }

    const groups = await listUserGroups(userId);

    const isMember = groups.some(function isTargetGroup(group) {
        return group && String(group.id) === String(groupId);
    });

    return {
        verification_method: 'okta_user_groups_read_back',
        verification_result: isMember
            ? 'verified_success'
            : 'verified_failure',
        expected_state: {
            type: 'group_membership',
            user_id: userId,
            group_id: groupId,
            expected_state: 'member'
        },
        observed_state: {
            membership_confirmed: isMember,
            group_ids: groups
                .filter(Boolean)
                .map(function mapGroup(group) {
                    return group.id;
                })
        }
    };
}

module.exports = {
    verifyGroupMembership
};