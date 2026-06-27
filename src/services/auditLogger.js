"use strict";

/**
 * auditLogger
 *
 * Lightweight, safe audit logging service.
 *
 * - Writes structured audit events
 * - Delegates persistence to requestEventStore
 * - NEVER crashes the runtime if logging fails
 */

const { appendRequestEvent } = require("./requestEventStore");

/**
 * ✅ Normalize audit event
 */
function normalizeAuditEvent(event) {
    return {
        correlation_id: event && event.correlation_id ? event.correlation_id : null,
        event_name: event && event.event_name ? event.event_name : "UNKNOWN_EVENT",
        actor: event && event.actor ? event.actor : "system",
        severity: event && event.severity ? event.severity : "info",
        category: event && event.category ? event.category : "runtime",
        message: event && event.message ? event.message : null,
        logged_at: new Date().toISOString(),
        details: event && event.details ? event.details : null,
        error: event && event.error
            ? {
                name: event.error.name || "Error",
                message: event.error.message || String(event.error),
                stack: event.error.stack || null
            }
            : null
    };
}

/**
 * ✅ Main audit log entry point
 *
 * CRITICAL:
 * - Must NEVER throw
 * - Logging must NOT block runtime execution
 */
async function logAuditEvent(event) {
    const payload = normalizeAuditEvent(event);

    try {
        await appendRequestEvent(payload);
    } catch (error) {
        // ✅ DO NOT crash system — fallback to console
        console.warn("⚠️ auditLogger failed (fallback to console):", {
            event_name: payload.event_name,
            error: error.message
        });

        console.log("📘 audit event:", payload);
    }

    return payload;
}

module.exports = {
    logAuditEvent
};