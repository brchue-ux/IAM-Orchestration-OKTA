const sql = require('mssql');
const { getPool } = require('./sqlEvidenceRepository');

async function upsertApprovalRecord(approval) {
    const pool = await getPool();

    await pool.request()
        .input(
            'approval_reference',
            sql.NVarChar(255),
            approval.approval_reference
        )
        .input(
            'approver_identity',
            sql.NVarChar(255),
            approval.approver_identity
        )
        .input(
            'approval_decision',
            sql.NVarChar(100),
            approval.approval_decision
        )
        .input(
            'approval_scope',
            sql.NVarChar(sql.MAX),
            JSON.stringify(approval.approval_scope || null)
        )
        .input(
            'approval_expires_at',
            sql.DateTime2,
            approval.approval_expires_at
                ? new Date(approval.approval_expires_at)
                : null
        )
        .input(
            'approval_evidence_link',
            sql.NVarChar(1000),
            approval.approval_evidence_link || null
        )
        .input(
            'requester_identity',
            sql.NVarChar(255),
            approval.requester_identity || null
        )
        .input(
            'target_identity',
            sql.NVarChar(255),
            approval.target_identity || null
        )
        .input(
            'action_family',
            sql.NVarChar(100),
            approval.action_family || null
        )
        .query(`
MERGE dbo.ApprovalRecords AS target
USING (SELECT @approval_reference AS approval_reference) AS source
ON target.approval_reference = source.approval_reference
WHEN MATCHED THEN
    UPDATE SET
        approver_identity = @approver_identity,
        approval_decision = @approval_decision,
        approval_scope = @approval_scope,
        approval_expires_at = @approval_expires_at,
        approval_evidence_link = @approval_evidence_link,
        requester_identity = @requester_identity,
        target_identity = @target_identity,
        action_family = @action_family,
        updated_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT (
        approval_reference,
        approver_identity,
        approval_decision,
        approval_scope,
        approval_expires_at,
        approval_evidence_link,
        requester_identity,
        target_identity,
        action_family
    )
    VALUES (
        @approval_reference,
        @approver_identity,
        @approval_decision,
        @approval_scope,
        @approval_expires_at,
        @approval_evidence_link,
        @requester_identity,
        @target_identity,
        @action_family
    );
        `);
}

async function getApprovalRecordByReference(approvalReference) {
    const pool = await getPool();

    const result = await pool.request()
        .input(
            'approval_reference',
            sql.NVarChar(255),
            approvalReference
        )
        .query(`
            SELECT TOP 1
                approval_reference,
                approver_identity,
                approval_decision,
                approval_scope,
                approval_expires_at,
                approval_evidence_link,
                requester_identity,
                target_identity,
                action_family,
                created_at,
                updated_at
            FROM dbo.ApprovalRecords
            WHERE approval_reference = @approval_reference
        `);

    return result.recordset[0] || null;
}

module.exports = {
    upsertApprovalRecord,
    getApprovalRecordByReference
};