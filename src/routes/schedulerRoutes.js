"use strict";

const express = require("express");
const { runSweep } = require("../runtime/autoHealScheduler");

const router = express.Router();

router.post("/control-plane/scheduler/run", async (req, res) => {
    const result = await runSweep();
    res.json({ result });
});

router.get("/control-plane/scheduler", (req, res) => {
    res.json({ scheduler: { running: true } });
});

module.exports = router;