const axios = require('axios');

async function assignUserToApp({ userId, appId, token, domain, userName }) {
    try {
        const url = `https://${domain}/api/v1/apps/${appId}/users`;

        const body = {
            id: userId,
            scope: 'USER'
        };

        // Optional but recommended for many apps
        if (userName) {
            body.credentials = {
                userName
            };
        }

        const response = await axios.post(
            url,
            body,
            {
                headers: {
                    Authorization: `SSWS ${token}`, // switch to Bearer later
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                },
                timeout: 30000,
                validateStatus: () => true
            }
        );

        // ✅ Handle success vs failure explicitly
        if (response.status >= 200 && response.status < 300) {
            return {
                success: true,
                status: response.status,
                data: response.data || null
            };
        }

        // ❌ Controlled failure
        return {
            success: false,
            status: response.status,
            error: response.data?.errorSummary || 'Unknown Okta error',
            details: response.data || null
        };

    } catch (error) {
        return {
            success: false,
            error: error.message,
            type: 'NETWORK_OR_RUNTIME_FAILURE'
        };
    }
}

module.exports = {
    assignUserToApp
};