"use strict";

/**
 * metricsRoutes
 *
 * Exposes:
 * - /api/metrics          => Prometheus-style text output
 * - /api/metrics/json     => structured JSON snapshot
 */

const express = require("express");
const { getMetricsSnapshot } = require("../services/metricsCollector");

const router = express.Router();

function toPrometheusName(value) {
    return String(value || "")
        .trim()
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_/, "")
        .toLowerCase();
}

function renderPrometheus(snapshot) {
    const lines = [];
    const counters = snapshot && snapshot.counters ? snapshot.counters : {};
    const durations = snapshot && snapshot.durations ? snapshot.durations : {};

    Object.keys(counters).forEach(function renderCounter(key) {
        const metricName = toPrometheusName(key);
        lines.push(`# TYPE ${metricName} counter`);
        lines.push(`${metricName} ${counters[key]}`);
    });

    Object.keys(durations).forEach(function renderDuration(key) {
        const metricName = `${toPrometheusName(key)}_ms`;
        const stats = durations[key];

        if (!stats) {
            return;
        }

        lines.push(`# TYPE ${metricName}_avg gauge`);
        lines.push(`${metricName}_avg ${stats.avg}`);

        lines.push(`# TYPE ${metricName}_max gauge`);
        lines.push(`${metricName}_max ${stats.max}`);

        lines.push(`# TYPE ${metricName}_min gauge`);
        lines.push(`${metricName}_min ${stats.min}`);

        lines.push(`# TYPE ${metricName}_count gauge`);
        lines.push(`${metricName}_count ${stats.count}`);
    });

    return lines.join("\n");
}

router.get("/metrics", async function handleMetrics(req, res) {
    try {
        const snapshot = getMetricsSnapshot();
        const output = renderPrometheus(snapshot);

        res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
        return res.status(200).send(output);
    } catch (error) {
        return res.status(500).json({
            error: "metrics_export_failed",
            message: error.message
        });
    }
});

router.get("/metrics/json", async function handleMetricsJson(req, res) {
    try {
        return res.status(200).json(getMetricsSnapshot());
    } catch (error) {
        return res.status(500).json({
            error: "metrics_snapshot_failed",
            message: error.message
        });
    }
});

module.exports = router;