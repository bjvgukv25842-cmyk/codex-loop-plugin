# Gate 6B SDK-Orchestrated Validation

Date: 2026-06-20

Status: skeleton only. M12 remains blocked.

## Background

Gate 6.2-Lite host-run proved Native Mode can start `loop_dev_worker`, produce a real file change, pass tests, and avoid parent roleplay. It did not complete the full continuation chain: final evaluator did not spawn, final PASS EvalReport was missing, MCP cross-agent state was not verified, and the turn did not complete reliably.

Native Subagent Mode is therefore retained as an experimental secondary runtime. SDK-Orchestrated Mode is now the primary production-path candidate.

## Gate 6B.0 Scope

Implemented in this gate:

- Runtime adapter interface and result contracts.
- `SdkRuntimeAdapter` skeleton with explicit `@openai/codex-sdk` dependency boundary.
- `NativeRuntimeAdapter` marked experimental.
- SDK loop state machine hard gates.
- SDK thread-run schema/state/MCP evidence tooling.
- Gate 6B dry-run scripts and eval fixture skeleton.

Not implemented in this gate:

- Real SDK E2E.
- Real SDK dependency installation.
- M12 effectiveness evaluation.
- Publication or release.

## Current Dry-Run Result

`npm run gate6b:run` without `CODEX_LOOP_ENABLE_REAL_SDK_RUN=1` produced:

```json
{
  "status": "BLOCKED_SDK_NOT_ENABLED",
  "real_sdk_run_executed": false,
  "m12_blocked": true
}
```

This is expected for Gate 6B.0. It is not a Gate 6B PASS.

## Gate 6B.1 Smoke Scope

Gate 6B.1 is a three-thread SDK smoke harness only:

- `planner` thread returns structured PRD / TaskGraph data; the orchestrator persists artifacts.
- `dev_worker` thread modifies the isolated target repo and runs `npm test`.
- `evaluator` thread performs read-only evaluation and returns PASS or NEEDS_REVISION.

Gate 6B.1 does not prove the full repair loop and does not unblock M12.

## Gate 6B.1A Adapter Integration

Gate 6B.1A implements the real SDK adapter path without running it in this turn:

- Dynamically imports `@openai/codex-sdk`.
- Instantiates `new Codex({ env, config })`.
- Injects `CODEX_SQLITE_HOME` through env and `sqlite_home` through config when provided.
- Starts threads with `sandboxMode`, `workingDirectory`, `skipGitRepoCheck`, `approvalPolicy: "never"`, and `networkAccessEnabled: false`.
- Uses `runStreamed()` when available to capture events.
- Falls back to `run()`.
- Extracts `thread_id` from `Thread.id` or `thread.started`.
- Fails with `THREAD_ID_MISSING` instead of fabricating ids.
- Keeps real execution disabled unless `CODEX_LOOP_ENABLE_REAL_SDK_RUN=1`.

The installed SDK API capability matrix is recorded in `docs/SDK_API_CAPABILITY_MATRIX.md`.

## Gate 6B.1B Model Catalog Startup Unblock Patch

A user-run real SDK smoke after Gate 6B.1A failed before thread startup with a Codex model catalog refresh error. The error body looked like an OpenAI-compatible list response with top-level `data`, while the Codex model catalog path expected a top-level `models` field. Gate 6B.1B records this as startup/runtime configuration evidence, not as a failed planner/dev/evaluator chain.

Implemented in Gate 6B.1B:

- `CODEX_MODEL_CATALOG_REFRESH_FAILED` failure classification.
- SDK error classifier coverage for `codex_models_manager`, `failed to refresh available models`, `missing field models`, and `body: {"data":[...]}`.
- `CODEX_LOOP_CODEX_MODEL` config override support.
- `CODEX_LOOP_MODEL_CATALOG_JSON` config override support with file existence validation.
- Explicit `BLOCKED_SDK_PROFILE_UNSUPPORTED` for `CODEX_LOOP_CODEX_PROFILE` because the installed SDK type contract exposes no profile option.
- Model catalog triage scripts: `npm run codex:model:catalog:diagnose` and `npm run codex:model:catalog:parse`.
- Bundled catalog fallback support through `evals/sdk-orchestrated/model-catalog-bundled.json` when `codex debug models --bundled` succeeds.

Gate 6B.1B does not run a real SDK thread and does not unblock M12. The next real SDK smoke should only be retried after model catalog triage chooses a working profile/model/catalog override.

## PASS Standard For Future Gate 6B.2

Gate 6B.2 may pass only with real SDK thread evidence for the complete repair loop:

- planner thread id
- dev worker thread id
- evaluator thread id
- repair dev worker thread id
- final evaluator thread id
- schema-valid artifacts
- `NEEDS_REVISION` initial EvalReport
- schema-valid RepairRequest
- final EvalReport `PASS`
- final validation passed
- MCP/state/artifact records with `created_by_runtime = "sdk-orchestrated"`

M12 remains blocked until Gate 6B real SDK E2E passes.

## Gate 6B.2.0 Repair Loop E2E Harness

Gate 6B.2.0 adds the checkpointed harness for the full SDK-Orchestrated repair-loop E2E. It does not run real SDK threads by default.

Checkpoint state:

```text
evals/sdk-orchestrated/reports/gate6b2-repair-loop-state.json
```

Target repo:

```text
tmp/sdk-orchestrated/gate6b2-repair-loop-target/
```

Supported checkpoint commands:

```bash
npm run gate6b2:prepare
npm run gate6b2:planner
npm run gate6b2:dev-worker
npm run gate6b2:initial-evaluator
npm run gate6b2:repair-request
npm run gate6b2:repair-dev-worker
npm run gate6b2:final-evaluator
npm run gate6b2:final-report
npm run gate6b2:verify
npm run gate6b2:report
```

Default behavior:

- Stage scripts do not start SDK threads unless the matching real SDK env flag is explicitly set.
- The seeded fixture is designed so the initial dev worker can leave a whitespace-only validation gap.
- Initial evaluator must return `NEEDS_REVISION`.
- RepairRequest is generated from the initial EvalReport.
- Repair dev worker must fix only the required repair scope and pass `npm test`.
- Final evaluator must return `PASS`.
- FinalDeliveryReport must include planner, dev worker, initial evaluator, repair dev worker, and final evaluator thread ids.

Gate 6B.2 PASS still requires real SDK thread evidence. The mock-only harness validation proves script/state behavior, not product effectiveness. M12 remains blocked until Gate 6B.2 real repair-loop E2E passes.

## Gate 6B.2.1 Initial Dev Worker Seeded-Gap Contract

Gate 6B.2.1 repairs the initial dev worker harness contract after the first real Gate 6B.2 attempt reached a dev worker thread but failed because the harness still judged the initial worker like a final fixer.

The Gate 6B.2 target fixture now separates validation into:

- `npm run test:baseline`: empty string fails, names longer than 80 fail, and valid names pass.
- `npm run test:full`: baseline checks plus whitespace-only names fail.

The initial broken implementation still returns `{ ok: true }`, so both baseline and full tests fail during prepare. The initial dev worker stage is now a dedicated seeded-gap stage:

- It must implement only baseline acceptance.
- It must intentionally preserve the whitespace-only gap.
- It must pass `npm run test:baseline`.
- It must record `known_gap_seeded = true`.
- It must treat full-test failure as expected, not as a harness failure.

The initial evaluator may run only after `known_gap_seeded = true`, `baseline_tests_passed = true`, and `full_tests_failed = true`. If it returns `PASS`, the harness classifies the result as `INITIAL_EVALUATOR_DID_NOT_CATCH_SEEDED_GAP`.

Repair dev worker remains the only stage that must make `npm run test:full` / `npm test` pass. Real SDK was not executed in this patch, and M12 remains blocked until a complete real Gate 6B.2 repair-loop E2E passes.

## Gate 6B.2 PASS: SDK-Orchestrated Repair Loop E2E

Gate 6B.2 has now passed with real SDK-Orchestrated repair-loop evidence. This proves SDK-Orchestrated Mode can complete the full loop:

```text
Planner -> Initial Dev Worker seeded gap -> Initial Evaluator NEEDS_REVISION -> RepairRequest -> Repair Dev Worker -> Final Evaluator PASS -> FinalDeliveryReport
```

Recorded final checkpoint facts:

- `current_stage = FINAL_REPORT_DONE`
- Planner: `PASS`
- Initial Dev Worker: `PASS` with `known_gap_seeded = true`
- Initial Evaluator verdict: `NEEDS_REVISION`
- RepairRequest: `PASS`
- Repair Dev Worker: `PASS` with `tests_passed = true`
- Final Evaluator verdict: `PASS`
- FinalDeliveryReport: generated
- `all_thread_ids_present = true`
- `artifact_thread_evidence_verified = true`
- `danger_full_access_used = false`
- `secret_leak_detected = false`
- `ready_for_m12 = true`

Result:

- SDK-Orchestrated Mode is now the primary proven runtime path for the complete repair loop.
- Native Mode remains experimental runtime.
- M12 Production Effectiveness Evaluation may begin in a separately scoped run.

This documentation update did not run real SDK threads, did not rerun Gate 6B.2, and did not start M12.
