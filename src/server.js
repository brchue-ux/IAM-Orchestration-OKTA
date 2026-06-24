const express = require('express');
const sql = require('mssql');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const intakeRoutes = require('./intake_form_routes');
app.use(intakeRoutes);

const { buildFormDefinition } = require('./dynamic_form_engine');
const { assignUserToApp } = require('./execution-agent');

const config = {
    server: "iam-agent-db.database.windows.net",
    database: "IAM_request_db",
    user: "CloudSA3879c360",
    password: "Kw$papy3!!",
    port: 1433,
    options: { encrypt: true }
};

function normalize(body, correlation_id) {
    return {
        correlation_id,
        requester: body.requester,
        action: body.action,
        target_type: body.target_type,
        target_resource: body.target_resource,
        target_user: body.target_user || null,
        collected_data: {
            justification: body.request_justification || body.justification || null
        }
    };
}

app.post('/requests', async (req, res) => {
    try {
        const correlation_id = uuidv4();

        const normalized = normalize(req.body, correlation_id);
        const form = buildFormDefinition(normalized);

        if (!form.can_submit_now) {
            return res.status(400).json({
                status: "incomplete_request",
                missing_fields: form.missing_fields
            });
        }

        // ✅ EXECUTION (HARDCODE FOR TEST)
        await assignUserToApp({
            userId: "USER_ID",
            appId: "APP_ID",
            token: "OKTA_API_TOKEN",
            domain: "yourdomain.okta.com"
        });

        return res.json({
            correlation_id,
            status: "executed"
        });

    } catch (e) {
        console.error(e);
        res.status(500).send(e.message);
    }
});

app.listen(3000, () => {
    console.log("running");
});