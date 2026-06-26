require('dotenv').config(); // ✅ THIS IS THE FIX

const express = require('express');

// Thin composition only:
// - routes handle HTTP endpoint wiring
// - engines handle form logic
// - agents handle bounded execution logic
const intakeRoutes = require('./routes/intake_form_routes');

const app = express();
app.use(express.json());

// ==============================
// ✅ HEALTH CHECK
// ==============================
app.get('/health', (_req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'iam-api',
        mode: 'express-local'
    });
});

// ==============================
// ✅ ROUTES
// ==============================
app.use('/api', intakeRoutes);

// ==============================
// ✅ ERROR HANDLER
// ==============================
app.use((err, _req, res, _next) => {
    console.error(err);

    res.status(err.status || 500).json({
        status: 'error',
        message: err.message || 'Unexpected server error'
    });
});

const port = Number(process.env.PORT || 3000);

// ==============================
// ✅ START SERVER
// ==============================
if (require.main === module) {
    app.listen(port, () => {
        console.log(`IAM API local server running on port ${port}`);
    });
}

module.exports = app;