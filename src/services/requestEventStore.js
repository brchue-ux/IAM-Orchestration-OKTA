"use strict";

/**
 * requestEventStore
 *
 * Temporary lightweight event store that writes audit/request events to a
 * local JSONL file. This removes the hard dependency on a SQL pool during
 * startup so the server, scheduler, and control-plane endpoints can run.
 *
 * One JSON object is appended per line to support simple troubleshooting,
 * audit review, and later migration back to a database-backed store.
 */

const fs = require("fs");
const path = require("path");

const STORE_DIR = path.resolve(process.cwd(), ".request-store");
const EVENTS_FILE = path.join(STORE_DIR, "request-events.jsonl");

function ensureStore() {
    fs.mkdirSync(STORE_DIR, { recursive: true });

    if (!fs.existsSync(EVENTS_FILE)) {
        fs.writeFileSync(EVENTS_FILE, "", "utf8");
    }
}

function sanitizeEvent(event) {
    return {
        correlation_id: event && event.correlation_id ? event.correlation_id : null,
        event_name: event && event.event_name ? event.event_name : "UNKNOWN_EVENT",
        actor: event && event.actor ? event.actor : "unknown",
        severity: event && event.severity ? event.severity : "info",
        category: event && event.category ? event.category : "runtime",
        message: event && event.message ? event.message : null,
        logged_at: event && event.logged_at ? event.logged_at : new Date().toISOString(),
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
 * Append one event record to the local JSONL file.
 */
async function appendRequestEvent(event) {
    ensureStore();

    const record = sanitizeEvent(event || {});
    const line = JSON.stringify(record) + "\n";

    await fs.promises.appendFile(EVENTS_FILE, line, "utf8");
    return record;
}

/**
 * Read recent request events from the local JSONL file.
 */
async function listRequestEvents(options) {
    ensureStore();

    const limit = Number(options && options.limit ? options.limit : 200);
    const raw = await fs.promises.readFile(EVENTS_FILE, "utf8");

    const rows = raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map(function parseLine(line) {
            try {
                return JSON.parse(line);
            } catch {
                return null;
            }
        })
        .filter(Boolean);

    return rows.slice(-limit).reverse();
}

module.exports = {
    EVENTS_FILE,
    appendRequestEvent,
    listRequestEvents
};