const func = require("@azure/functions");

func.setup();

// Load each function-registration file here
require("./functions/SubmitRequest.js");

// Add more as you split them out:
// require("./functions/ApproveRequest.js");
// require("./functions/RejectRequest.js");
// require("./functions/ExecuteRequest.js");
// require("./functions/RequestStatus.js");
// require("./functions/AuditLog.js");