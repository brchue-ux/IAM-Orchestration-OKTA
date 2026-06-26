const express = require('express');
const router = express.Router();

const { determineApproval } = require('../agents/approvalAgent');
const {
    updateRequest
} = require('../services/requestRegistryStore');

const {
    appendRequestEvent
} = require('../services/requestEventStore');

const { routeExecution } = require('../services/executionRouter');
const { routeVerification } = require('../services/verificationRouter');

/**
 * MAIN REQUEST ENTRY POINT
 */
router.post('/requests', async (req, res) => {
    const record = {
        correlation_id: req.body.correlation_id || require('crypto').randomUUID(),
        requester: req.body.requester,
        action: req.body.action,
        target_user: req.body.target_user,
        target_resource: req.body.target_resource,
        justification: req.body.justification
    };

    try {
        // ✅ STEP 1: APPROVAL
        const approvalResult = await determineApproval(record, {
            log: console.log
        });

        // ✅ If still pending — return immediately
        if (!approvalResult.approved) {
            await appendRequestEvent({
                correlation_id: record.correlation_id,
                event_name: 'APPROVAL_PENDING',
                actor: record.requester,
                event_details: {
                    message: 'Waiting for approval'
                }
            });

            return res.json({
                status: 'approval_pending',
                request: approvalResult.requestRecord
            });
        }

        // ✅ STEP 2: EXECUTION START
        await updateRequest(
            record.correlation_id,
            {
                current_status: 'execution_started',
                current_step: 'EXECUTING'
            },
            'SYSTEM'
        );

        await appendRequestEvent({
            correlation_id: record.correlation_id,
            event_name: 'EXECUTION_STARTED',
            actor: 'SYSTEM'
        });

        // ✅ EXECUTE
        const executionResult = await routeExecution(record);

        await appendRequestEvent({
            correlation_id: record.correlation_id,
            event_name: 'EXECUTION_COMPLETED',
            actor: 'SYSTEM',
            event_details: executionResult
        });

        await updateRequest(
            record.correlation_id,
            {
                execution_status: 'SUCCESS'
            },
            'SYSTEM'
        );

        // ✅ STEP 3: VERIFICATION START
        await appendRequestEvent({
            correlation_id: record.correlation_id,
            event_name: 'VERIFICATION_STARTED',
            actor: 'SYSTEM'
        });

        const verificationResult = await routeVerification(record);

        await appendRequestEvent({
            correlation_id: record.correlation_id,
            event_name: 'VERIFICATION_COMPLETED',
            actor: 'SYSTEM',
            event_details: verificationResult
        });

        await updateRequest(
            record.correlation_id,
            {
                verification_status: 'PASSED',
                completion_status: 'COMPLETED_VERIFIED',
                current_status: 'completed_verified',
                current_step: 'COMPLETED'
            },
            'SYSTEM'
        );

        // ✅ STEP 4: FINAL COMPLETION
        await appendRequestEvent({
            correlation_id: record.correlation_id,
            event_name: 'REQUEST_COMPLETED',
            actor: 'SYSTEM'
        });

        return res.json({
            status: 'completed_verified',
            execution: executionResult,
            verification: verificationResult
        });

    } catch (error) {
        console.error(error);

        await appendRequestEvent({
            correlation_id: record.correlation_id,
            event_name: 'REQUEST_FAILED',
            actor: 'SYSTEM',
            event_details: {
                error: error.message
            }
        });

        await updateRequest(
            record.correlation_id,
            {
                current_status: 'failed',
                current_step: 'FAILED'
            },
            'SYSTEM'
        );

        return res.status(500).json({
            error: 'Request failed',
            details: error.message
        });
    }
});

module.exports = router;