"use strict";

let counters = {};

function incrementCounter(name) {
    counters[name] = (counters[name] || 0) + 1;
}

function getMetricsSnapshot() {
    return {
        counters,
        timestamp: new Date().toISOString()
    };
}

module.exports = {
    incrementCounter,
    getMetricsSnapshot
};