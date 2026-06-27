"use strict";

/**
 * Okta connector for low-risk group membership execution and read-back.
 * Supports simulation mode by default and live mode when configuration is present.
 */

const axios = require("axios");

function clean(value) {
    if (value === undefined || value === null) {
        return undefined;
    }

    const text = String(value).trim();
    return text || undefined;
}

function normalizeIdentifier(value) {
    return String(value || "").trim().toLowerCase();
}

function getExecutionMode() {
    return String(process.env.OKTA_EXECUTION_MODE || "simulate").trim().toLowerCase();
}

function getBaseUrl() {
    return clean(process.env.OKTA_BASE_URL);
}

function getApiToken() {
    return clean(process.env.OKTA_API_TOKEN);
}

function buildHeaders() {
    const token = getApiToken();
    if (!token) {
        throw new Error("OKTA_API_TOKEN is missing.");
    }

    return {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `SSWS ${token}`
    };
}

function getClient() {
    const baseURL = getBaseUrl();
    if (!baseURL) {
        throw new Error("OKTA_BASE_URL is missing.");
    }

    return axios.create({
        baseURL,
        timeout: 30000,
        headers: buildHeaders()
    });
}

function buildSimulationResponse(operation, groupId, userIdentifier) {
    return {
        simulated: true,
        downstream_system: "Okta",
        operation,
        group_id: groupId,
        user_identifier: userIdentifier,
        transaction_id: `sim-${Date.now()}`
    };
}

async function addUserToGroup(groupId, userIdentifier) {
    if (getExecutionMode() !== "live") {
        return buildSimulationResponse("add", groupId, userIdentifier);
    }

    const client = getClient();
    const path = `/api/v1/groups/${encodeURIComponent(groupId)}/users/${encodeURIComponent(userIdentifier)}`;
    const response = await client.put(path);

    return {
        simulated: false,
        downstream_system: "Okta",
        operation: "add",
        group_id: groupId,
        user_identifier: userIdentifier,
        status_code: response.status,
        transaction_id: response.headers["x-okta-request-id"] || null
    };
}

async function removeUserFromGroup(groupId, userIdentifier) {
    if (getExecutionMode() !== "live") {
        return buildSimulationResponse("remove", groupId, userIdentifier);
    }

    const client = getClient();
    const path = `/api/v1/groups/${encodeURIComponent(groupId)}/users/${encodeURIComponent(userIdentifier)}`;
    const response = await client.delete(path);

    return {
        simulated: false,
        downstream_system: "Okta",
        operation: "remove",
        group_id: groupId,
        user_identifier: userIdentifier,
        status_code: response.status,
        transaction_id: response.headers["x-okta-request-id"] || null
    };
}

async function listGroupMembers(groupId) {
    if (getExecutionMode() !== "live") {
        return [];
    }

    const client = getClient();
    const path = `/api/v1/groups/${encodeURIComponent(groupId)}/users`;
    const response = await client.get(path);
    return Array.isArray(response.data) ? response.data : [];
}

async function isUserInGroup(groupId, userIdentifier) {
    if (getExecutionMode() !== "live") {
        return null;
    }

    const members = await listGroupMembers(groupId);
    const normalized = normalizeIdentifier(userIdentifier);

    return members.some(function someMember(member) {
        return (
            normalizeIdentifier(member && member.id) === normalized ||
            normalizeIdentifier(member && member.profile && member.profile.login) === normalized ||
            normalizeIdentifier(member && member.profile && member.profile.email) === normalized
        );
    });
}

module.exports = {
    getExecutionMode,
    addUserToGroup,
    removeUserFromGroup,
    listGroupMembers,
    isUserInGroup
};