const mockApprovalProvider = require('./approvalProviders/mockApprovalProvider');

function getApprovalProvider() {
    const provider = String(process.env.APPROVAL_PROVIDER || 'MOCK').trim().toUpperCase();

    switch (provider) {
        case 'MOCK':
            return mockApprovalProvider;
        default:
            throw new Error(`Unsupported approval provider: ${provider}`);
    }
}

module.exports = {
    getApprovalProvider
};