const axios = require('axios');

async function assignUserToApp({ userId, appId, token, domain }) {
    return axios.post(
        `https://${domain}/api/v1/apps/${appId}/users`,
        { id: userId },
        {
            headers: {
                Authorization: `SSWS ${token}`,
                "Content-Type": "application/json"
            }
        }
    );
}

module.exports = { assignUserToApp };
``