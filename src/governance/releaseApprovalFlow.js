"use strict";

/**
 * releaseApprovalFlow
 * Manages lightweight release approvals for promotion and change history.
 */

const { appendRecord, getCollection } = require("../control-plane/controlPlaneStore");

async function requestReleaseApproval(releaseRecord) {
    const payload = Object.assign({
        release_id: `release-${Date.now()}`,
        approval_state: "pending"
    }, releaseRecord || {});

    return appendRecord("releases", payload);
}

async function listReleaseApprovals() {
    return getCollection("releases");
}

module.exports = {
    requestReleaseApproval,
    listReleaseApprovals
};