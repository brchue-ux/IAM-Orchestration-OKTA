const axios = require('axios');
const { ORG_URL, API_TOKEN } = require('./config');
const { resolveGroupByName } = require('./resource-resolver');
const { log } = require('./logger');

const headers = {
    Authorization: `SSWS ${API_TOKEN}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
};

async function listGroupMembers(groupName) {
    log("STATUS", "START", `list_group_members group=${groupName}`);

    const group = await resolveGroupByName(groupName);
    const url = `${ORG_URL}/api/v1/groups/${group.id}/users`;

    const response = await axios.get(url, {
        headers,
        timeout: 30000,
        validateStatus: () => true
    });

    if (response.status !== 200) {
        const summary = response.data?.errorSummary || response.statusText || 'Unknown error';
        throw new Error(`List group members failed: ${response.status} ${summary}`);
    }

    const members = Array.isArray(response.data) ? response.data : [];

    const results = members.map(user => ({
        id: user.id,
        login: user.profile?.login,
        email: user.profile?.email,
        firstName: user.profile?.firstName,
        lastName: user.profile?.lastName,
        status: user.status
    }));

    log("STATUS", "SUCCESS", `member_count=${results.length}`);

    return {
        group_id: group.id,
        group_name: group.profile?.name,
        members: results
    };
}

module.exports = { listGroupMembers };