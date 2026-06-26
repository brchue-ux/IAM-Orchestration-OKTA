/**
 * Azure Functions entry point for the Node.js v4 programming model.
 *
 * Purpose:
 * - Load function registration files.
 * - Keep runtime bootstrap minimal and predictable.
 *
 * Notes:
 * - Function handlers are registered inside the required files using app.http(...).
 * - Do NOT call func.setup() here.
 */

// Load function registration file(s)
require("./functions/SubmitRequest.js");

// Future split-out registrations can be added here if needed:
// require("./functions/ApproveRequest.js");
// require("./functions/RejectRequest.js");
// require("./functions/ExecuteRequest.js");
// require("./functions/RequestStatus.js");
// require("./functions/AuditLog.js");