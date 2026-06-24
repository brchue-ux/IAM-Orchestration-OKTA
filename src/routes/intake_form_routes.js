const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { buildFormDefinition } = require('./dynamic_form_engine');
const { log } = require('./logger');

const router = express.Router();

function normalize(body, correlation_id) {
    return {
        correlation_id,
        requester: body.requester,
        action: body.action,
        target_type: body.target_type,
        target_resource: body.target_resource,
        target_user: body.target_user || null,
        subject: body.target_user && body.target_user !== body.requester ? "other" : "self",
        risk_tier: "moderate",
        eligibility_decision: "UNKNOWN",
        collected_data: {
            justification: body.request_justification || body.justification || null,
            access_level: body.access_level || null
        }
    };
}

router.post('/intake/preview-form', async (req, res) => {
    try {
        const correlation_id = uuidv4();

        const normalized = normalize(req.body, correlation_id);
        const form = buildFormDefinition(normalized);

        return res.json({
            correlation_id,
            status: "preview_ready",
            normalized_request: normalized,
            form_definition: form
        });
    } catch (e) {
        console.error(e);
        res.status(500).send(e.message);
    }
});

module.exports = router;