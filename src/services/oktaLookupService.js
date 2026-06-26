const { oktaRequest } = require('./oktaClient');

function normalizeArrayResponse(resp) {
    if (!resp) return [];

    if (Array.isArray(resp)) return resp;

    if (resp.data && Array.isArray(resp.data)) return resp.data;

    if (resp.body && Array.isArray(resp.body)) return resp.body;

    return [];
}

async function findUserByLogin(login) {
    if (!login) {
        throw new Error('findUserByLogin requires a login');
    }

    try {
        // 1) Exact login search
        let resp = await oktaRequest({
            method: 'GET',
            path: `/api/v1/users?search=${encodeURIComponent(
                `profile.login eq "${login}"`
            )}`,
            expectedStatus: [200]
        });

        let users = normalizeArrayResponse(resp);

        if (users.length > 0 && users[0].id) {
            return users[0];
        }

        // 2) Exact primary email search
        resp = await oktaRequest({
            method: 'GET',
            path: `/api/v1/users?search=${encodeURIComponent(
                `profile.email eq "${login}"`
            )}`,
            expectedStatus: [200]
        });

        users = normalizeArrayResponse(resp);

        if (users.length > 0 && users[0].id) {
            return users[0];
        }

        // 3) Broad q fallback
        resp = await oktaRequest({
            method: 'GET',
            path: `/api/v1/users?q=${encodeURIComponent(login)}`,
            expectedStatus: [200]
        });

        users = normalizeArrayResponse(resp);

        if (users.length > 0 && users[0].id) {
            return users[0];
        }

        throw new Error(`Okta user not found for login: ${login}`);
    } catch (err) {
        if (err && (err.status || err.responseBody)) {
            const wrapped = new Error(`Okta user not found for login: ${login}`);
            wrapped.status = err.status || null;
            wrapped.responseBody = err.responseBody || null;
            throw wrapped;
        }

        throw new Error(
            err && err.message
                ? err.message
                : `Okta user not found for login: ${login}`
        );
    }
}

async function findGroupByName(groupName) {
    if (!groupName) {
        throw new Error('findGroupByName requires a group name');
    }

    try {
        // 1) Exact group name search
        let resp = await oktaRequest({
            method: 'GET',
            path: `/api/v1/groups?search=${encodeURIComponent(
                `profile.name eq "${groupName}"`
            )}`,
            expectedStatus: [200]
        });

        let groups = normalizeArrayResponse(resp);

        if (groups.length > 0 && groups[0].id) {
            return groups[0];
        }

        // 2) Broad q fallback
        resp = await oktaRequest({
            method: 'GET',
            path: `/api/v1/groups?q=${encodeURIComponent(groupName)}`,
            expectedStatus: [200]
        });

        groups = normalizeArrayResponse(resp);

        if (groups.length > 0 && groups[0].id) {
            return groups[0];
        }

        throw new Error(`Okta group not found for name: ${groupName}`);
    } catch (err) {
        if (err && (err.status || err.responseBody)) {
            const wrapped = new Error(`Okta group not found for name: ${groupName}`);
            wrapped.status = err.status || null;
            wrapped.responseBody = err.responseBody || null;
            throw wrapped;
        }

        throw new Error(
            err && err.message
                ? err.message
                : `Okta group not found for name: ${groupName}`
        );
    }
}

module.exports = {
    findUserByLogin,
    findGroupByName
};