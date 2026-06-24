function log(stage, status, details = "") {
    const timestamp = new Date().toISOString();

    const paddedStage = stage.padEnd(12);
    const paddedStatus = status.padEnd(15);

    console.log(`${timestamp}  [${paddedStage}]  ${paddedStatus}  ${details}`);
}

module.exports = { log };