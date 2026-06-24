const axios = require('axios');
const { ORG_URL, API_TOKEN, AUTHZ_GROUPS } = require('./config');
const { log } = require('./logger');

const headers = {
    Authorization: `SSWS ${API_TOKEN}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
};

async function getUserByLogin(login) {
    const url = `${ORG_URL}/api/v1/users/${encodeURIComponent(login)}`;

    const response = await axios.get(url, {
        headers,
        timeout: 30000,
        validateStatus: () => true
    });

    if (response.status !== 200) {
        const summary = response.data?.errorSummary || response.statusText || 'Unknown error';
        throw new Error(`GET requester user failed: ${response.status} ${summary}`);
    }

    return response.data;
}

async function listRequesterGroups(userId) {
    const url = `${ORG_URL}/api/v1/users/${userId}/groups`;

    const response = await axios.get(url, {
        headers,
        timeout: 30000,
        validateStatus: () => true
    });

    if (response.status !== 200) {
        const summary = response.data?.errorSummary || response.statusText || 'Unknown error';
        throw new Error(`GET requester groups failed: ${response.status} ${summary}`);
    }

    return Array.isArray(response.data) ? response.data : [];
}

async function getRequesterCapabilitiesFromSource(requester) {
    log("AUTHZSRC", "START", `requester=${requester}`);

    const user = await getUserByLogin(requester);
    const groups = await listRequesterGroups(user.id);

    const groupNames = groups
        .map(g => g.profile?.name)
        .filter(Boolean);

    const capabilities = [];

    if (groupNames.includes(AUTHZ_GROUPS.READ_ONLY_STATUS)) {
        capabilities.push('READ_ONLY_STATUS');
    }

    if (groupNames.includes(AUTHZ_GROUPS.STANDARD_WRITE)) {
        capabilities.push('STANDARD_WRITE');
    }

    if (groupNames.includes(AUTHZ_GROUPS.SUBMIT_HIGH_RISK)) {
        capabilities.push('SUBMIT_HIGH_RISK');
    }

    log("AUTHZSRC", "SUCCESS", `capabilities=${capabilities.join(',') || 'none'}`);

    return {
        requester,
        requester_user_id: user.id,
        requester_group_names: groupNames,
        requester_capabilities: capabilities
    };
}

module.exports = { getRequesterCapabilitiesFromSource };
``