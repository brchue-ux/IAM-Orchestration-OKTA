function emitControlPlaneEvent(context, eventName, payload = {}, severity = 'Information') {
    const envelope = {
        schemaVersion: '1.0',
        layer: 'control-plane',
        eventName,
        severity,
        timestamp: new Date().toISOString(),

        requestId: payload.requestId || null,
        correlationId: payload.correlationId || null,

        agent: payload.agent || null,
        actionFamily: payload.actionFamily || null,

        status: payload.status || null,
        riskTier: payload.riskTier || null,

        executionState: payload.executionState || null,
        verificationState: payload.verificationState || null,
        rollbackState: payload.rollbackState || null,

        failureClass: payload.failureClass || null,

        details: payload.details || {}
    };

    if (context?.log) {
        context.log(JSON.stringify(envelope));
    }
}

module.exports = {
    emitControlPlaneEvent
};