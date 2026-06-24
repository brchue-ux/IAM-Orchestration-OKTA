const axios = require('axios');
const { ORG_URL, API_TOKEN } = require('./config');
const { log } = require('./logger');

const headers = {
    Authorization: `SSWS ${API_TOKEN}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
};

async function resolveGroupByName(groupName) {
    log("RESOLVER", "START", `group=${groupName}`);

    const search = `profile.name eq "${groupName}"`;
    const url = `${ORG_URL}/api/v1/groups?search=${encodeURIComponent(search)}`;

    const response = await axios.get(url, {
        headers,
        timeout: 30000,
        validateStatus: () => true
    });

    if (response.status !== 200) {
        const summary = response.data?.errorSummary || response.statusText || 'Unknown error';
        throw new Error(`Group lookup failed: ${response.status} ${summary}`);
    }

    const groups = Array.isArray(response.data) ? response.data : [];
    const oktaGroup = groups.find(g => g.profile?.name === groupName && g.type === 'OKTA_GROUP');

    if (!oktaGroup) {
        throw new Error(`Group not found or not an OKTA_GROUP: ${groupName}`);
    }

    log("RESOLVER", "SUCCESS", `group_id=${oktaGroup.id}`);

    return oktaGroup;
}

module.exports = { resolveGroupByName };