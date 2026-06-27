"use strict";

/**
 * idempotencyService
 * Detects likely duplicate requests using the request registry hash.
 */

const {
    buildRequestHash,
    findOpenRequestByHash
} = require("./requestRegistryStore");
const { normalizeActionFamily } = require("../contracts/requestEnvelope");

function buildIdempotencyMaterial(request) {
    const safeRequest = request || {};
    return {
        requester_identity: safeRequest.requester_identity || null,
        target_identity: safeRequest.target_identity || null,
        action_family: normalizeActionFamily(safeRequest.action_family) || null,
        requested_action: safeRequest.requested_action || null,
        expected_postcondition: safeRequest.expected_postcondition || null
    };
}

function buildIdempotencyKey(request) {
    return buildRequestHash(buildIdempotencyMaterial(request));
}

async function findDuplicateOpenRequest(request) {
    const requestHash = buildIdempotencyKey(request);
    const existing = await findOpenRequestByHash(requestHash);

    return {
        request_hash: requestHash,
        existing_request: existing || null,
        is_duplicate: Boolean(existing)
    };
}

async function assertNotDuplicate(request) {
    const duplicateCheck = await findDuplicateOpenRequest(request);

    if (duplicateCheck.is_duplicate) {
        const error = new Error(
            `Duplicate open request detected for correlation ID ${duplicateCheck.existing_request.correlation_id}.`
        );
        error.code = "DUPLICATE_OPEN_REQUEST";
        error.existing_request = duplicateCheck.existing_request;
        throw error;
    }

    return duplicateCheck;
}

module.exports = {
    buildIdempotencyMaterial,
    buildIdempotencyKey,
    findDuplicateOpenRequest,
    assertNotDuplicate
};