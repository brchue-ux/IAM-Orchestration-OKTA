"use strict";

/**
 * Example route for the enterprise IAM orchestrator.
 * Mount with: app.use('/api/iam', router)
 */

const express = require("express");
const { routeRequest } = require("../orchestrator/multiAgentRouter");

const router = express.Router();

router.post("/request", async function(req, res) {
    try {
        const result = await routeRequest(req.body, {
            maxTargets: process.env.MAX_EXECUTION_TARGETS || 1,
            allowedEnvironments: process.env.EXECUTION_ALLOWED_ENVIRONMENTS || "dev"
        });

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            status: "error",
            message: error.message
        });
    }
});

module.exports = router;
