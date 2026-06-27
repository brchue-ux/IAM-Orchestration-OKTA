"use strict";

/**
 * requestRegistryStore
 * Lightweight JSON-backed request store for request lifecycle, verification,
 * evidence, and reconciliation lookups.
 */

const fs = require("fs");
const path = require("path");

const STORE_DIR = path.resolve(process.cwd(), ".request-store");
const STORE_FILE = path.join(STORE_DIR, "request-registry.json");

function ensureStore() {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    if (!fs.existsSync(STORE_FILE)) {
        fs.writeFileSync(STORE_FILE, JSON.stringify({ requests: [] }, null, 2), "utf8");
    }
}

function loadStore() {
    ensureStore();
    return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
}

function saveStore(store) {
    ensureStore();
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
    return store;
}

function getPool() {
    ensureStore();
    return { kind: "json-file-store", path: STORE_FILE };
}

function upsertRequest(record) {
    const store = loadStore();
    const requests = Array.isArray(store.requests) ? store.requests : [];
    const correlationId = record && record.correlation_id;
    if (!correlationId) {
        throw new Error("correlation_id is required.");
    }

    const idx = requests.findIndex(function findRequest(item) {
        return item && item.correlation_id === correlationId;
    });

    const now = new Date().toISOString();
    const payload = Object.assign({}, record, {
        updated_at: now,
        created_at: idx >= 0 && requests[idx] && requests[idx].created_at ? requests[idx].created_at : now
    });

    if (idx >= 0) {
        requests[idx] = Object.assign({}, requests[idx], payload);
    } else {
        requests.push(payload);
    }

    store.requests = requests;
    saveStore(store);
    return payload;
}

function createRequest(record) {
    return upsertRequest(record);
}

function updateRequest(correlationId, patch, actor) {
    const existing = getRequestByCorrelationId(correlationId);
    if (!existing) {
        throw new Error(`Request ${correlationId} was not found.`);
    }

    return upsertRequest(Object.assign({}, existing, patch || {}, {
        last_updated_by: actor || existing.last_updated_by || "unknown"
    }));
}

function getRequestByCorrelationId(correlationId) {
    const store = loadStore();
    const requests = Array.isArray(store.requests) ? store.requests : [];
    return requests.find(function findRequest(item) {
        return item && item.correlation_id === correlationId;
    }) || null;
}

function getRequestByRequestId(requestId) {
    const store = loadStore();
    const requests = Array.isArray(store.requests) ? store.requests : [];
    return requests.find(function findRequest(item) {
        return item && item.request_id === requestId;
    }) || null;
}

function listRequests(options) {
    const store = loadStore();
    const requests = Array.isArray(store.requests) ? store.requests.slice() : [];
    const limit = Number(options && options.limit ? options.limit : 50);
    return requests
        .sort(function sortRequests(a, b) {
            return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
        })
        .slice(0, limit);
}

module.exports = {
    STORE_DIR,
    STORE_FILE,
    getPool,
    loadStore,
    saveStore,
    createRequest,
    updateRequest,
    upsertRequest,
    getRequestByCorrelationId,
    getRequestByRequestId,
    listRequests
};