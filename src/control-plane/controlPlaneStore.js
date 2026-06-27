"use strict";

/**
 * controlPlaneStore
 * Lightweight JSON-backed persistence for control-plane records.
 */

const fs = require("fs");
const path = require("path");

const STORE_DIR = path.resolve(process.cwd(), ".control-plane");
const STORE_FILE = path.join(STORE_DIR, "control-plane-store.json");

function ensureStoreDir() {
    fs.mkdirSync(STORE_DIR, { recursive: true });
}

function defaultStore() {
    return {
        agent_registry: [],
        policy_compliance: [],
        alerts: [],
        releases: [],
        rollback_events: []
    };
}

function loadStore() {
    ensureStoreDir();

    if (!fs.existsSync(STORE_FILE)) {
        const initial = defaultStore();
        fs.writeFileSync(STORE_FILE, JSON.stringify(initial, null, 2), "utf8");
        return initial;
    }

    return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
}

function saveStore(store) {
    ensureStoreDir();
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
    return store;
}

function appendRecord(collectionName, record) {
    const store = loadStore();
    const payload = Object.assign({}, record || {}, {
        recorded_at: new Date().toISOString()
    });

    if (!Array.isArray(store[collectionName])) {
        store[collectionName] = [];
    }

    store[collectionName].push(payload);
    saveStore(store);
    return payload;
}

function upsertByKey(collectionName, keyName, record) {
    const store = loadStore();
    const keyValue = record && record[keyName];

    if (!Array.isArray(store[collectionName])) {
        store[collectionName] = [];
    }

    const index = store[collectionName].findIndex(function findItem(item) {
        return item && item[keyName] === keyValue;
    });

    const payload = Object.assign({}, record || {}, {
        updated_at: new Date().toISOString()
    });

    if (index >= 0) {
        store[collectionName][index] = Object.assign({}, store[collectionName][index], payload);
    } else {
        store[collectionName].push(payload);
    }

    saveStore(store);
    return payload;
}

function getCollection(collectionName) {
    const store = loadStore();
    return Array.isArray(store[collectionName]) ? store[collectionName] : [];
}

module.exports = {
    STORE_DIR,
    STORE_FILE,
    loadStore,
    saveStore,
    appendRecord,
    upsertByKey,
    getCollection
};