"use strict";

/**
 * ServiceNow connector for approval creation and status lookup.
 * Supports basic auth or bearer token.
 */

const axios = require("axios");

function clean(value) {
    if (value === undefined || value === null) {
        return undefined;
    }

    const text = String(value).trim();
    return text || undefined;
}

function getBaseUrl() {
    return clean(process.env.SERVICENOW_BASE_URL);
}

function getAuthHeaders() {
    const mode = String(process.env.SERVICENOW_AUTH_MODE || "basic").trim().toLowerCase();

    if (mode === "bearer") {
        const token = clean(process.env.SERVICENOW_BEARER_TOKEN);
        if (!token) {
            throw new Error("ServiceNow bearer token is missing.");
        }

        return {
            Authorization: `Bearer ${token}`
        };
    }

    const username = clean(process.env.SERVICENOW_USERNAME);
    const password = clean(process.env.SERVICENOW_PASSWORD);

    if (!username || !password) {
        throw new Error("ServiceNow basic auth credentials are missing.");
    }

    const encoded = Buffer.from(`${username}:${password}`).toString("base64");
    return {
        Authorization: `Basic ${encoded}`
    };
}

function getClient() {
    const baseURL = getBaseUrl();
    if (!baseURL) {
        throw new Error("ServiceNow base URL is missing.");
    }

    return axios.create({
        baseURL,
        timeout: 30000,
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...getAuthHeaders()
        }
    });
}

async function createApprovalRequest(payload) {
    const path = process.env.SERVICENOW_APPROVAL_CREATE_PATH || "/api/x_iam/approval/request";
    const client = getClient();
    const response = await client.post(path, payload);
    return response.data;
}

async function getApprovalStatus(approvalId) {
    const template = process.env.SERVICENOW_APPROVAL_STATUS_PATH || "/api/x_iam/approval/request/{id}";
    const path = template.replace("{id}", encodeURIComponent(String(approvalId)));
    const client = getClient();
    const response = await client.get(path);
    return response.data;
}

module.exports = {
    createApprovalRequest,
    getApprovalStatus
};
