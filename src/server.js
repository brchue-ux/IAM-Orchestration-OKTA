const express = require('express');

// Thin composition only:
// - routes handle HTTP endpoint wiring
// - engines handle form logic
// - agents handle bounded execution logic
const intakeRoutes = require('./routes/intake_form_routes');

const app = express();
app.use(express.json());

// Simple health check
app.get('/health', (_req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'iam-api',
        mode: 'express-local'
    });
});

// Mount feature routes under /api
app.use('/api', intakeRoutes);

// Centralized error handler
app.use((err, _req, res, _next) => {
    console.error(err);

    res.status(err.status || 500).json({
        status: 'error',
        message: err.message || 'Unexpected server error'
    });
});

const port = Number(process.env.PORT || 3000);

// Only listen when this file is run directly with `node src/server.js`
if (require.main === module) {
    app.listen(port, () => {
        console.log(`IAM API local server running on port ${port}`);
    });
}

module.exports = app;