# Gate 6B.1 SDK-Orchestrated Smoke Report

Date: 2026-06-20

Run status: BLOCKED_USE_CHECKPOINTED_SMOKE
Verify status: PASS
Real SDK run executed: false
SDK dependency detected: true
SDK sandbox control: UNVERIFIED
Failure category: BLOCKED_USE_CHECKPOINTED_SMOKE
Planner smoke gate passed: true
Dev worker smoke gate passed: true
Planner lite stage shared: true
Planner stage impl: runPlannerLiteStage
TaskGraph schema valid: false
Dev worker stage shared: true
Dev worker stage impl: runDevWorkerStage
Schema-output-planner required: false
Sequential execution enforced: true
Stage execution order: []
Target repo: tmp/sdk-orchestrated/gate6b-smoke-target
Thread budget: max 3 SDK threads, 180000 ms each, zero retries
M12 blocked: true

Gate 6B.1 is a three-thread SDK smoke harness: planner, dev_worker, evaluator. It is not the full repair-loop E2E and cannot unblock M12.

Default dry-run behavior is expected to return `BLOCKED_SDK_NOT_ENABLED` unless `CODEX_LOOP_ENABLE_REAL_SDK_RUN=1` is explicitly set in a controlled host terminal.

SDK parity passed: true

The three-thread SDK smoke must not start until SDK parity, planner smoke slices (`parity-as-planner`, `minimal`, `schema-text-only`, `schema-output-minimal`, `schema-output-lite`), and dev worker smoke slices (`parity`, `minimal-fix`, `output-lite`) have all produced PASS evidence. `schema-output-planner` is diagnostic-only and is not a Gate 6B.1 prerequisite.

If a real SDK smoke fails before thread startup with Codex model catalog refresh errors, classify it as `CODEX_MODEL_CATALOG_REFRESH_FAILED` and run `npm run codex:model:catalog:diagnose` before retrying.

Next manual action: use checkpointed Gate 6B.1: `npm run gate6b:checkpoint:prepare`, then planner, dev-worker, evaluator, verify, and report one stage at a time.

