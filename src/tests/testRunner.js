"use strict";

/**
 * testRunner
 *
 * Full integration test harness for the enterprise IAM runtime.
 *
 * What it does:
 * 1. Seeds test requests
 * 2. Exercises request APIs
 * 3. Triggers reconciliation
 * 4. Runs scheduler
 * 5. Evaluates alerts
 * 6. Validates dashboard + metrics + scheduler endpoints
 * 7. Uses assertion checks so failures stop the run with clear messages
 */

const assert = require("assert/strict");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000/api";

const results = {
    assertions_passed: 0,
    assertions_failed: 0,
    completed_steps: []
};

function recordPass(name) {
    results.assertions_passed += 1;
    results.completed_steps.push({ step: name, status: "passed" });
}

function recordFailure(name, error) {
    results.assertions_failed += 1;
    results.completed_steps.push({
        step: name,
        status: "failed",
        message: error && error.message ? error.message : String(error)
    });
}

function assertCheck(name, fn) {
    try {
        fn();
        recordPass(name);
    } catch (error) {
        recordFailure(name, error);
        throw error;
    }
}

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * HTTP helper
 */
async function http(method, path, body) {
    const response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined
    });

    const text = await response.text();
    let parsed;

    try {
        parsed = JSON.parse(text);
    } catch {
        parsed = text;
    }

    return {
        status: response.status,
        body: parsed
    };
}

function buildTestRequestPatch(scenario, index) {
    const seed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${index}`;
    return {
        correlation_id: `test-${seed}`,
        request_id: `req-${seed}`,
        action_family: scenario.action_family || "app_assignment",
        current_status: scenario.current_status,
        waiting_on: scenario.waiting_on || null,
        reconciliation_attempts: scenario.reconciliation_attempts || 0,
        reconciliation_last_attempt_at: scenario.reconciliation_last_attempt_at || null,
        verification_result: scenario.verification_result || null,
        severity_hint: scenario.severity_hint || null
    };
}

/**
 * Step 1: seed deterministic request scenarios
 */
async function seedRequests() {
    console.log("🌱 Seeding test requests...");

    const scenarios = [
        {
            current_status: "completed_verified",
            verification_result: "verified_success"
        },
        {
            current_status: "verification_pending",
            verification_result: "verification_pending"
        },
        {
            current_status: "verification_inconclusive",
            verification_result: "verification_inconclusive"
        },
        {
            current_status: "failed",
            verification_result: "verified_failure"
        },
        {
            current_status: "failed",
            verification_result: "verified_failure",
            reconciliation_attempts: 3
        },
        {
            current_status: "verification_pending",
            verification_result: "verification_pending",
            waiting_on: "operations"
        },
        {
            current_status: "verification_pending",
            verification_result: "verification_pending",
            reconciliation_last_attempt_at: new Date(Date.now() - 900000).toISOString()
        }
    ];

    const created = [];

    for (let index = 0; index < scenarios.length; index += 1) {
        const payload = buildTestRequestPatch(scenarios[index], index);
        const response = await http("POST", "/requests", payload);

        assertCheck(`seed request status ${index + 1}`, function verifySeedStatus() {
            assert.equal(response.status, 200, `Expected 200 when creating request ${index + 1}`);
        });

        assertCheck(`seed request body ${index + 1}`, function verifySeedBody() {
            assert.ok(response.body && response.body.request, `Missing request body for seed ${index + 1}`);
            assert.equal(response.body.request.correlation_id, payload.correlation_id, "Correlation ID mismatch");
        });

        created.push(response.body.request);
    }

    console.log(`✅ Created ${created.length} requests`);
    return created;
}

/**
 * Step 2: check request store endpoints
 */
async function testRequestEndpoints(sample) {
    console.log("🔍 Testing request endpoints...");

    const listResponse = await http("GET", "/requests");
    assertCheck("GET /requests status", function verifyListStatus() {
        assert.equal(listResponse.status, 200, "GET /requests should return 200");
    });
    assertCheck("GET /requests body", function verifyListBody() {
        assert.ok(Array.isArray(listResponse.body.requests), "GET /requests should return an array");
        assert.ok(listResponse.body.requests.length >= 1, "GET /requests should contain at least one request");
    });

    const byCorrelation = await http("GET", `/requests/${sample.correlation_id}`);
    assertCheck("GET /requests/:correlationId status", function verifyCorrelationStatus() {
        assert.equal(byCorrelation.status, 200, "GET by correlation ID should return 200");
    });
    assertCheck("GET /requests/:correlationId body", function verifyCorrelationBody() {
        assert.ok(byCorrelation.body && byCorrelation.body.request, "GET by correlation ID should return a request");
        assert.equal(byCorrelation.body.request.correlation_id, sample.correlation_id, "GET by correlation ID mismatch");
    });

    const byRequestId = await http("GET", `/requests/by-request-id/${sample.request_id}`);
    assertCheck("GET /requests/by-request-id/:requestId status", function verifyRequestIdStatus() {
        assert.equal(byRequestId.status, 200, "GET by request ID should return 200");
    });
    assertCheck("GET /requests/by-request-id/:requestId body", function verifyRequestIdBody() {
        assert.ok(byRequestId.body && byRequestId.body.request, "GET by request ID should return a request");
        assert.equal(byRequestId.body.request.request_id, sample.request_id, "GET by request ID mismatch");
    });

    console.log("✅ Request endpoints OK");
}

/**
 * Step 3: trigger reconciliation request marker
 */
async function testReconciliation(sample) {
    console.log("🔁 Triggering reconciliation...");

    const response = await http("POST", `/requests/${sample.correlation_id}/reconcile`, {
        reason: "test_run",
        waiting_on: "operations"
    });

    assertCheck("POST /requests/:correlationId/reconcile status", function verifyReconcileStatus() {
        assert.equal(response.status, 200, "Reconcile endpoint should return 200");
    });
    assertCheck("POST /requests/:correlationId/reconcile body", function verifyReconcileBody() {
        assert.ok(response.body && response.body.request, "Reconcile endpoint should return request body");
        assert.equal(response.body.request.reconciliation_reason, "test_run", "Reconciliation reason was not persisted");
        assert.equal(response.body.request.waiting_on, "operations", "Waiting_on was not updated");
    });

    console.log("✅ Reconciliation triggered");
}

/**
 * Step 4: run scheduler
 */
async function runScheduler() {
    console.log("🧠 Running scheduler...");

    const response = await http("POST", "/control-plane/scheduler/run");

    assertCheck("POST /control-plane/scheduler/run status", function verifySchedulerStatus() {
        assert.equal(response.status, 200, "Scheduler run endpoint should return 200");
    });
    assertCheck("POST /control-plane/scheduler/run body", function verifySchedulerBody() {
        assert.ok(response.body && response.body.result, "Scheduler run should include result payload");
    });

    console.log("✅ Scheduler run complete");
}

/**
 * Step 5: evaluate alerts directly
 */
async function runAlertEvaluation() {
    console.log("🚨 Evaluating alerts...");

    const { evaluateAlerts, getActiveAlerts } = require("./src/control-plane/alertingService");
    const evaluation = await evaluateAlerts();
    const alerts = getActiveAlerts({ limit: 100 });

    assertCheck("evaluateAlerts return shape", function verifyAlertEvalShape() {
        assert.ok(evaluation && typeof evaluation === "object", "evaluateAlerts should return an object");
        assert.ok(Array.isArray(evaluation.alerts_created), "evaluateAlerts.alerts_created should be an array");
    });
    assertCheck("getActiveAlerts return shape", function verifyActiveAlertsShape() {
        assert.ok(Array.isArray(alerts), "getActiveAlerts should return an array");
    });

    console.log("✅ Alerts evaluated");
    return { evaluation, alerts };
}

/**
 * Step 6: validate observability endpoints
 */
async function validateControlPlane() {
    console.log("📊 Validating control-plane endpoints...");

    const dashboard = await http("GET", "/control-plane/dashboard");
    assertCheck("GET /control-plane/dashboard status", function verifyDashboardStatus() {
        assert.equal(dashboard.status, 200, "Dashboard endpoint should return 200");
    });
    assertCheck("GET /control-plane/dashboard body", function verifyDashboardBody() {
        assert.ok(dashboard.body && dashboard.body.request_summary, "Dashboard should include request_summary");
        assert.ok(dashboard.body.alerts_summary, "Dashboard should include alerts_summary");
        assert.ok(dashboard.body.metrics, "Dashboard should include metrics");
    });

    const scheduler = await http("GET", "/control-plane/scheduler");
    assertCheck("GET /control-plane/scheduler status", function verifySchedulerStateStatus() {
        assert.equal(scheduler.status, 200, "Scheduler state endpoint should return 200");
    });
    assertCheck("GET /control-plane/scheduler body", function verifySchedulerStateBody() {
        assert.ok(scheduler.body && scheduler.body.scheduler, "Scheduler state should include scheduler payload");
    });

    const metricsText = await http("GET", "/metrics");
    assertCheck("GET /metrics status", function verifyMetricsStatus() {
        assert.equal(metricsText.status, 200, "Metrics endpoint should return 200");
    });
    assertCheck("GET /metrics body", function verifyMetricsBody() {
        assert.ok(typeof metricsText.body === "string", "Metrics endpoint should return text/plain content");
    });

    const metricsJson = await http("GET", "/metrics/json");
    assertCheck("GET /metrics/json status", function verifyMetricsJsonStatus() {
        assert.equal(metricsJson.status, 200, "Metrics JSON endpoint should return 200");
    });
    assertCheck("GET /metrics/json body", function verifyMetricsJsonBody() {
        assert.ok(metricsJson.body && metricsJson.body.timestamp, "Metrics JSON should include a timestamp");
    });

    console.log("✅ Control-plane endpoints OK");
}

function printSummary() {
    console.log("\n================ TEST SUMMARY ================");
    console.log(`Assertions passed: ${results.assertions_passed}`);
    console.log(`Assertions failed: ${results.assertions_failed}`);
    console.log("Steps:");
    for (const step of results.completed_steps) {
        const suffix = step.message ? ` — ${step.message}` : "";
        console.log(`- ${step.status.toUpperCase()}: ${step.step}${suffix}`);
    }
    console.log("==============================================\n");
}

/**
 * Main test flow
 */
async function run() {
    console.log("🚀 Starting full IAM runtime test...\n");

    const seeded = await seedRequests();
    assertCheck("seeded request count", function verifySeededCount() {
        assert.ok(seeded.length >= 7, "Expected at least 7 seeded requests");
    });

    await testRequestEndpoints(seeded[0]);
    await testReconciliation(seeded[1]);
    await runScheduler();
    await sleep(1000);
    await runAlertEvaluation();
    await validateControlPlane();

    printSummary();

    if (results.assertions_failed > 0) {
        throw new Error(`Test run completed with ${results.assertions_failed} failed assertions.`);
    }

    console.log("🎉 TEST RUN COMPLETE");
}

run().catch((error) => {
    printSummary();
    console.error("❌ Test run crashed:", error.message || error);
    process.exitCode = 1;
});