const axios = require('axios');
const { ORG_URL, API_TOKEN } = require('./config');
const { resolveGroupByName } = require('./resource-resolver');
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
        throw new Error(`GET user failed: ${response.status} ${summary}`);
    }

    return response.data;
}

async function listUserGroups(userId) {
    const url = `${ORG_URL}/api/v1/users/${userId}/groups`;

    const response = await axios.get(url, {
        headers,
        timeout: 30000,
        validateStatus: () => true
    });

    if (response.status !== 200) {
        const summary = response.data?.errorSummary || response.statusText || 'Unknown error';
        throw new Error(`GET user groups failed: ${response.status} ${summary}`);
    }

    return response.data;
}

async function verifyExecution(request) {
    log("VERIFY", "START", `action=${request.action}`);

    try {
        if (request.action === "ADD_USER_TO_GROUP") {
            const group = await resolveGroupByName(request.target_resource);
            const user = await getUserByLogin(request.target_user);
            const groups = await listUserGroups(user.id);

            const inGroup = Array.isArray(groups) && groups.some(g => g.id === group.id);

            if (!inGroup) {
                throw new Error("User not in target group");
            }

            log("VERIFY", "SUCCESS", "user_in_group");

            return {
                verified: true,
                verification_status: "confirmed"
            };
        }

        return {
            verified: true,
            verification_status: "not_required"
        };
    } catch (err) {
        log("VERIFY", "FAIL", err.message);

        return {
            verified: false,
            verification_status: "failed"
        };
    }
}

module.exports = { verifyExecution };