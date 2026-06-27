"use strict";

/**
 * notificationWebhookService
 *
 * Sends sanitized operational alerts to Microsoft Teams and/or Slack using
 * incoming webhooks. This service intentionally strips internal-only details
 * and must NOT expose secrets or raw internal payloads.
 */

const https = require("https");
const { URL } = require("url");
const { logAuditEvent } = require("../services/auditLogger");

/**
 * ✅ normalize helper
 */
function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
}

/**
 * ✅ POST JSON helper (fixed)
 */
function postJson(webhookUrl, body) {
    return new Promise(function executor(resolve, reject) {
        if (!webhookUrl) {
            return reject(new Error("A webhook URL is required."));
        }

        const parsed = new URL(webhookUrl);
        const payload = JSON.stringify(body);

        const request = https.request(
            {
                protocol: parsed.protocol,
                hostname: parsed.hostname,
                path: `${parsed.pathname}${parsed.search || ""}`,
                port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(payload)
                }
            },
            function onResponse(response) {
                let data = "";

                response.on("data", function onData(chunk) {
                    data += chunk;
                });

                response.on("end", function onEnd() {
                    resolve({
                        statusCode: response.statusCode,
                        body: data
                    });
                });
            }
        );

        request.on("error", reject);
        request.write(payload);
        request.end();
    });
}

/**
 * ✅ sanitize alert payload
 */
function sanitizeAlert(alert) {
    return {
        alert_id: alert && alert.alert_id ? alert.alert_id : null,
        alert_name: alert && alert.alert_name ? alert.alert_name : null,
        severity: alert && alert.severity ? alert.severity : "medium",
        category: alert && alert.category ? alert.category : "runtime",
        correlation_id: alert && alert.correlation_id ? alert.correlation_id : null,
        message: alert && alert.message ? alert.message : "No message provided.",
        created_at: alert && alert.created_at ? alert.created_at : new Date().toISOString(),
        status: alert && alert.status ? alert.status : "open"
    };
}

/**
 * ✅ Teams message format
 */
function buildTeamsMessage(alert) {
    const safe = sanitizeAlert(alert);

    return {
        "@type": "MessageCard",
        "@context": "https://schema.org/extensions",
        summary: `${safe.severity.toUpperCase()} alert: ${safe.alert_name || "unnamed_alert"}`,
        themeColor:
            safe.severity === "high"
                ? "FF0000"
                : safe.severity === "medium"
                ? "FFA500"
                : "0078D4",
        title: `${safe.severity.toUpperCase()} alert`,
        sections: [
            {
                facts: [
                    { name: "Alert", value: safe.alert_name || "unnamed_alert" },
                    { name: "Severity", value: safe.severity },
                    { name: "Category", value: safe.category },
                    { name: "Correlation ID", value: safe.correlation_id || "n/a" },
                    { name: "Created", value: safe.created_at },
                    { name: "Status", value: safe.status }
                ],
                text: safe.message
            }
        ]
    };
}

/**
 * ✅ Slack message format
 */
function buildSlackMessage(alert) {
    const safe = sanitizeAlert(alert);

    return {
        text: `*${safe.severity.toUpperCase()} alert* — ${safe.alert_name || "unnamed_alert"}`,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*${safe.severity.toUpperCase()} alert* — ${safe.alert_name || "unnamed_alert"}`
                }
            },
            {
                type: "section",
                fields: [
                    { type: "mrkdwn", text: `*Category:*\n${safe.category}` },
                    { type: "mrkdwn", text: `*Correlation ID:*\n${safe.correlation_id || "n/a"}` },
                    { type: "mrkdwn", text: `*Created:*\n${safe.created_at}` },
                    { type: "mrkdwn", text: `*Status:*\n${safe.status}` }
                ]
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: safe.message
                }
            }
        ]
    };
}

/**
 * ✅ Teams send
 */
async function sendTeamsAlert(alert) {
    const webhookUrl = process.env.TEAMS_ALERT_WEBHOOK_URL;

    if (!webhookUrl) {
        return { sent: false, channel: "teams", reason: "missing_webhook" };
    }

    const response = await postJson(webhookUrl, buildTeamsMessage(alert));

    return {
        sent: response.statusCode >= 200 && response.statusCode < 300,
        channel: "teams",
        statusCode: response.statusCode
    };
}

/**
 * ✅ Slack send
 */
async function sendSlackAlert(alert) {
    const webhookUrl = process.env.SLACK_ALERT_WEBHOOK_URL;

    if (!webhookUrl) {
        return { sent: false, channel: "slack", reason: "missing_webhook" };
    }

    const response = await postJson(webhookUrl, buildSlackMessage(alert));

    return {
        sent: response.statusCode >= 200 && response.statusCode < 300,
        channel: "slack",
        statusCode: response.statusCode
    };
}

/**
 * ✅ unified notification handler
 */
async function notifyAlertRecipients(alert) {
    if (!alert) {
        throw new Error("An alert payload is required.");
    }

    const severity = normalizeText(alert.severity);
    const notifications = [];

    // only notify for material signals
    if (["medium", "high", "critical"].includes(severity)) {
        notifications.push(await sendTeamsAlert(alert));
        notifications.push(await sendSlackAlert(alert));
    }

    await logAuditEvent({
        correlation_id: alert.correlation_id || null,
        event_name: "ALERT_NOTIFICATIONS_PROCESSED",
        actor: "notificationWebhookService",
        severity: "info",
        category: "notification",
        message: `Alert notifications processed for ${alert.alert_name || "unnamed_alert"}.`,
        details: { notifications }
    });

    return notifications;
}

module.exports = {
    sanitizeAlert,
    buildTeamsMessage,
    buildSlackMessage,
    sendTeamsAlert,
    sendSlackAlert,
    notifyAlertRecipients
};