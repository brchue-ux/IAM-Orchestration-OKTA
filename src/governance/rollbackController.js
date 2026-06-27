"use strict";

/**
 * rollbackController
 * Records rollback or containment actions for low-risk execution.
 */

const { appendRecord, getCollection } = require("../control-plane/controlPlaneStore");

async function recordRollbackEvent(event) {
    return appendRecord("rollback_events", event || {});
}

function buildRollbackPlan(request) {
    const safeRequest = request || {};
    const family = String(safeRequest.action_family || "").toLowerCase();

    if (family === "group_fulfillment") {
        return {
            action_family: family,
            corrective_action: safeRequest.operation === "add" ? "remove" : "add",
            target_identity: safeRequest.target_identity || null,
            target_object: safeRequest.group_id || null,
            requires_human_confirmation: true
        };
    }

    if (family === "app_assignment") {
        return {
            action_family: family,
            corrective_action: safeRequest.operation === "assign" ? "unassign" : "assign",
            target_identity: safeRequest.target_identity || null,
            target_object: safeRequest.app_id || null,
            requires_human_confirmation: true
        };
    }

    return {
        action_family: family || "unknown",
        corrective_action: "manual_review",
        requires_human_confirmation: true
    };
}

async function listRollbackEvents() {
    return getCollection("rollback_events");
}

module.exports = {
    recordRollbackEvent,
    buildRollbackPlan,
    listRollbackEvents
};