const { TableClient } = require('@azure/data-tables');

const connectionString =
    process.env.APPROVALS_STORAGE_CONNECTION || process.env.AzureWebJobsStorage;

const tableName =
    process.env.APPROVALS_TABLE_NAME || 'ApprovalRequests';

if (!connectionString) {
    throw new Error(
        'Missing APPROVALS_STORAGE_CONNECTION or AzureWebJobsStorage for approvalStore.js'
    );
}

const tableClient = TableClient.fromConnectionString(connectionString, tableName);

let tableInitialized = false;

async function ensureTable() {
    if (tableInitialized) {
        return;
    }

    try {
        await tableClient.createTable();
    } catch (error) {
        // 409 = table already exists
        if (error.statusCode !== 409) {
            throw error;
        }
    }

    tableInitialized = true;
}

function stringifyOrNull(value) {
    if (value === undefined || value === null) {
        return null;
    }
    return JSON.stringify(value);
}

function parseOrNull(value) {
    if (!value) {
        return null;
    }

    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function toEntity(record) {
    return {
        partitionKey: 'REQUEST',
        rowKey: record.requestId,

        requestId: record.requestId,
        correlationId: record.correlationId || null,
        requester: record.requester || null,
        requestType: record.requestType || null,
        action: record.action || null,
        target: record.target || null,
        status: record.status || null,
        submittedAt: record.submittedAt || null,

        duplicateSignature: record.duplicateSignature || null,

        oktaUserId: record.oktaUserId || null,
        oktaGroupId: record.oktaGroupId || null,

        subjectJson: stringifyOrNull(record.subject),
        approvalJson: stringifyOrNull(record.approval),
        executionJson: stringifyOrNull(record.execution),
        policyJson: stringifyOrNull(record.policy),
        verificationJson: stringifyOrNull(record.verification)
    };
}

function fromEntity(entity) {
    if (!entity) {
        return null;
    }

    return {
        requestId: entity.requestId || entity.rowKey,
        correlationId: entity.correlationId || null,
        requester: entity.requester || null,
        requestType: entity.requestType || null,
        action: entity.action || null,
        target: entity.target || null,
        status: entity.status || null,
        submittedAt: entity.submittedAt || null,

        duplicateSignature: entity.duplicateSignature || null,

        oktaUserId: entity.oktaUserId || null,
        oktaGroupId: entity.oktaGroupId || null,

        subject: parseOrNull(entity.subjectJson),
        approval: parseOrNull(entity.approvalJson),
        execution: parseOrNull(entity.executionJson),
        policy: parseOrNull(entity.policyJson),
        verification: parseOrNull(entity.verificationJson)
    };
}

async function saveRequest(record) {
    await ensureTable();

    const entity = toEntity(record);
    await tableClient.upsertEntity(entity, 'Replace');

    return record;
}

async function getRequest(requestId) {
    await ensureTable();

    try {
        const entity = await tableClient.getEntity('REQUEST', requestId);
        return fromEntity(entity);
    } catch (error) {
        if (error.statusCode === 404) {
            return null;
        }
        throw error;
    }
}

async function listRequests() {
    await ensureTable();

    const results = [];

    const entities = tableClient.listEntities({
        queryOptions: {
            filter: `partitionKey eq 'REQUEST'`
        }
    });

    for await (const entity of entities) {
        results.push(fromEntity(entity));
    }

    return results;
}

module.exports = {
    saveRequest,
    getRequest,
    listRequests
};