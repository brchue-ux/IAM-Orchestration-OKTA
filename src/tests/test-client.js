const axios = require('axios');

const BASE_URL = 'http://127.0.0.1:3000';

async function run() {
    try {
        // 1) READ-ONLY AUTHORIZED
        const readOnly = await axios.post(`${BASE_URL}/requests`, {
            requester: 'bchue@wm.com',
            action: 'LIST_GROUP_MEMBERS',
            target_type: 'GROUP',
            target_resource: 'iam-test-group'
        });

        console.log('\n=== READ ONLY (AUTHORIZED) ===');
        console.log(readOnly.data);

        // 2) WRITE AUTHORIZED
        const createWrite = await axios.post(`${BASE_URL}/requests`, {
            requester: 'chad@powers.com',
            action: 'ADD_USER_TO_GROUP',
            target_user: 'bchue@wm.com',
            target_type: 'GROUP',
            target_resource: 'iam-test-group',
            request_justification: 'standard access request'
        });

        console.log('\n=== CREATE WRITE REQUEST (AUTHORIZED) ===');
        console.log(createWrite.data);

        const writeId = createWrite.data.correlation_id;

        const approveWrite = await axios.patch(`${BASE_URL}/requests/${writeId}/approve`, {
            approved_by: 'manager@test.com',
            approval_notes: 'Approved for standard access'
        });

        console.log('\n=== APPROVE WRITE ===');
        console.log(approveWrite.data);

        const finalWrite = await axios.get(`${BASE_URL}/requests/${writeId}`);

        console.log('\n=== FINAL WRITE ===');
        console.log(finalWrite.data);

        // 3) WRITE DENIED
        try {
            const deniedWrite = await axios.post(`${BASE_URL}/requests`, {
                requester: 'analyst@company.com',
                action: 'ADD_USER_TO_GROUP',
                target_user: 'bchue@wm.com',
                target_type: 'GROUP',
                target_resource: 'iam-test-group',
                request_justification: 'should be denied'
            });

            console.log('\n=== DENIED WRITE (unexpected success) ===');
            console.log(deniedWrite.data);
        } catch (err) {
            console.log('\n=== DENIED WRITE (expected) ===');
            console.log(err.response.data);
        }

        // 4) HIGH-RISK SUBMISSION AUTHORIZED BUT HELD
        const highRisk = await axios.post(`${BASE_URL}/requests`, {
            requester: 'manager@test.com',
            action: 'SUSPEND_USER',
            target_type: 'USER',
            target_resource: 'bchue@wm.com',
            request_justification: 'high-risk request test'
        });

        console.log('\n=== HIGH RISK (HELD) ===');
        console.log(highRisk.data);

    } catch (err) {
        if (err.response) {
            console.error('\n=== ERROR RESPONSE ===');
            console.error(err.response.status);
            console.error(err.response.data);
        } else {
            console.error('\n=== ERROR ===');
            console.error(err.message);
        }
    }
}

run();