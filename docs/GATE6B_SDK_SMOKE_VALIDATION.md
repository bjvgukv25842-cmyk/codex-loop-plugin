# Gate 6B.1 SDK Smoke Validation

Date: 2026-06-20

Status: real adapter integration patch ready for one manual smoke. M12 remains blocked.

## Purpose

Gate 6B.1 creates a short, manually triggered Real SDK smoke harness for SDK-Orchestrated Mode. It is designed to prove only the first three SDK thread roles in a controlled target repo:

1. `planner` thread, `read-only`
2. `dev_worker` thread, `workspace-write`
3. `evaluator` thread, `read-only`

This gate is not the full repair loop. It does not run repair dev worker, final evaluator, context distiller, full Gate 6, native `codex exec`, or M12.

## Safety Defaults

`npm run gate6b:smoke:run` must not start real SDK threads unless:

```bash
CODEX_LOOP_ENABLE_REAL_SDK_RUN=1
```

Without that explicit environment variable, the run returns:

```json
{
  "status": "BLOCKED_SDK_NOT_ENABLED",
  "real_sdk_run_executed": false
}
```

The smoke harness also checks:

- Node.js major version is at least 18.
- `@openai/codex-sdk` can be resolved before any real run.
- Project-local `.codex-eval/sqlite` is usable through `CODEX_SQLITE_HOME`.
- `CODEX_HOME` is not overridden by default.
- Maximum SDK threads is 3.
- Each SDK thread timeout is at most 180000 ms.
- Maximum retries is 0.

The harness does not auto-install SDK dependencies and does not copy auth, tokens, or secrets. If `@openai/codex-sdk` is not resolvable, the harness records the missing prerequisite and a real smoke is not ready until the user explicitly approves dependency installation or otherwise provides the SDK.

Gate 6B.1A removes the intentional real-path stub. When `CODEX_LOOP_ENABLE_REAL_SDK_RUN=1` is set, the smoke runner now uses `SdkRuntimeAdapter`, which calls the installed SDK through `Codex.startThread()` and `thread.runStreamed()` / `thread.run()`. This path is covered by mock SDK tests in this patch, but was not executed against the real SDK in this turn.

## Gate 6B.1B Model Catalog Startup Classification

A manual real SDK smoke after Gate 6B.1A failed before any planner/dev/evaluator thread started because Codex model catalog refresh could not decode the configured provider response:

```text
codex_models_manager
failed to refresh available models
missing field `models`
body: {"data":[...],"object":"list"}
```

Gate 6B.1B classifies this startup failure as `CODEX_MODEL_CATALOG_REFRESH_FAILED`, not `SDK_THREAD_FAILED`. This means the evidence did not reach SDK thread orchestration and must not be interpreted as planner/dev/evaluator failure.

The smoke harness now supports controlled runtime overrides:

- `CODEX_LOOP_CODEX_MODEL`: passed as Codex config `model`.
- `CODEX_LOOP_MODEL_CATALOG_JSON`: passed as Codex config `model_catalog_json` after the file exists.
- `CODEX_LOOP_CODEX_PROFILE`: returns `BLOCKED_SDK_PROFILE_UNSUPPORTED` with the installed TypeScript SDK contract because no profile option is exposed.

Before retrying a real SDK smoke after this failure, run model catalog triage:

```bash
npm run codex:model:catalog:diagnose
npm run codex:model:catalog:parse
```

If `codex debug models --bundled` succeeds and writes `evals/sdk-orchestrated/model-catalog-bundled.json`, the next single real smoke can be retried with:

```bash
CODEX_LOOP_MODEL_CATALOG_JSON="$(pwd)/evals/sdk-orchestrated/model-catalog-bundled.json" \
CODEX_LOOP_ENABLE_REAL_SDK_RUN=1 \
npm run gate6b:smoke:run
```

## Gate 6B.1D SDK-vs-CLI Parity

After model catalog triage passed, a direct CLI parity smoke in the same target repo produced `thread.started`, an agent message `SDK_TARGET_DIRECT_CLI_OK`, and `turn.completed`. The later real SDK smoke still failed before planner `thread_id` with only:

```text
Codex Exec exited with code 1: Reading prompt from stdin...
```

This is classified as `SDK_ADAPTER_INVOCATION_MISMATCH` when direct CLI parity is `PASS`, not as a generic `SDK_THREAD_FAILED`.

Gate 6B.1D adds a one-thread SDK parity smoke before the three-thread smoke:

```bash
npm run gate6b:sdk-parity:run
npm run gate6b:sdk-parity:verify
npm run gate6b:sdk-parity:report
```

By default this returns `BLOCKED_SDK_PARITY_NOT_ENABLED` and starts no real SDK thread. A real parity run requires:

```bash
CODEX_LOOP_ENABLE_REAL_SDK_PARITY=1 npm run gate6b:sdk-parity:run
```

`gate6b:smoke:run` now requires SDK parity PASS before starting planner/dev/evaluator SDK threads. If parity has not passed, a real three-thread smoke returns `BLOCKED_SDK_PARITY_NOT_PASSED`.

## Gate 6B.1E Planner Startup Slice

SDK parity PASS proves that one tiny read-only SDK thread can start. It does not prove the planner prompt, planner outputSchema, or planner artifact contract.

Gate 6B.1E therefore added planner-only smoke slices before retrying the three-thread smoke:

- `minimal`: prompt only, no outputSchema, expects `SDK_PLANNER_MINIMAL_OK`.
- `schema`: legacy alias for the planner outputSchema path.
- `exact`: the full Gate 6B.1 planner prompt and outputSchema shape.

Dry-run commands:

```bash
npm run gate6b:planner-smoke:run
npm run gate6b:planner-smoke:verify
npm run gate6b:planner-smoke:report
npm run gate6b:invocation-diff
```

The default planner smoke returns `BLOCKED_SDK_PLANNER_NOT_ENABLED` and starts no real SDK thread. A controlled real planner smoke requires exactly one explicit mode at a time:

```bash
CODEX_LOOP_ENABLE_REAL_SDK_PLANNER=1 \
CODEX_LOOP_PLANNER_SMOKE_MODE=minimal \
npm run gate6b:planner-smoke:run
```

If minimal passes, run schema triage slices one at a time. Do not retry automatically.

`gate6b:smoke:run` now requires all of the following before it can start planner/dev/evaluator SDK threads:

- SDK parity PASS.
- Planner parity-as-planner smoke PASS.
- Planner minimal smoke PASS.
- Planner schema-text-only smoke PASS.
- Planner schema-output-minimal smoke PASS.
- Planner schema-output-planner smoke PASS.

If planner schema smoke evidence is missing, the three-thread smoke returns `BLOCKED_PLANNER_SCHEMA_SMOKE_NOT_PASSED`.

## Gate 6B.1F Planner Minimal Timeout Triage

The first real planner minimal smoke timed out after 180000 ms without a planner `thread_id`. This is a blocker, not a pass.

Gate 6B.1F adds diagnostics before any schema, exact, or three-thread retry:

- streamed event JSONL capture at `planner-smoke-<mode>-events.jsonl`
- timeout classification for startup timeout, turn timeout, and no-event timeout
- `planner-timeout-triage.json`
- `PlannerTimeoutTriageReport.md`
- `parity-as-planner` mode

`parity-as-planner` uses the same prompt as SDK parity:

```text
Respond with exactly: SDK_TARGET_DIRECT_SDK_OK
```

It keeps the SDK parity working directory, model, model catalog, and SQLite home, but sets role metadata to `planner`. This isolates role metadata and planner harness behavior from prompt/schema complexity.

Run exactly one real `parity-as-planner` smoke only from a controlled host terminal:

```bash
CODEX_LOOP_ENABLE_REAL_SDK_PLANNER=1 \
CODEX_LOOP_PLANNER_SMOKE_MODE=parity-as-planner \
npm run gate6b:planner-smoke:run
```

If `parity-as-planner` passes, rerun planner minimal once. If it fails while SDK parity remains PASS, classify the blocker as `PLANNER_ROLE_INVOCATION_MISMATCH` and do not continue to schema/exact.

## Gate 6B.1G Planner Schema OutputSchema Triage

Planner parity-as-planner and planner minimal smokes passed, but the legacy planner schema smoke failed before a thread id with:

```text
Codex Exec exited with code 1: Reading prompt from stdin...
```

Gate 6B.1G splits the schema path into three narrower slices:

- `schema-text-only`: no outputSchema; prompt asks for JSON text `{ "status": "PASS", "message": "SDK_PLANNER_SCHEMA_TEXT_ONLY_OK" }`.
- `schema-output-minimal`: uses a tiny outputSchema with `status` and `message`; prompt asks for `{ "status": "PASS", "message": "SDK_PLANNER_OUTPUT_MINIMAL_OK" }`.
- `schema-output-planner`: uses the current planner smoke outputSchema. The old `schema` mode is kept as an alias to this mode.

Schema modes write a redacted invocation trace to:

```text
evals/sdk-orchestrated/reports/sdk-startup-triage/planner-schema-invocation-trace-redacted.json
```

The trace records mode, output schema kind, schema hash, prompt hash, working directory, model, model catalog path, sandbox, SDK method, and option key names. It must not contain auth, token, or secret values.

New failure classifications:

- `PLANNER_SCHEMA_TEXT_ONLY_FAILED`: JSON text-only prompt failed.
- `SDK_OUTPUT_SCHEMA_INVOCATION_FAILED`: text-only JSON works but minimal SDK outputSchema path fails.
- `SDK_OUTPUT_SCHEMA_CAUSES_THREAD_START_FAILURE`: outputSchema path fails before `thread.started` with the prompt-only child-exit symptom.
- `PLANNER_SCHEMA_COMPLEXITY_OR_FORMAT_FAILURE`: minimal outputSchema works but planner outputSchema fails.

Print-only CLI parity helpers are available:

```bash
npm run gate6b:planner-schema-cli:print
npm run gate6b:planner-schema-cli:parse
```

The print command only prints direct `codex exec` commands for manual comparison; it does not execute them.

Gate 6B.1G still treated `schema-output-planner` as a required slice. Gate 6B.1H supersedes that gate with planner-lite.

## Gate 6B.1H Planner Schema Compatibility Repair

Planner `schema-output-minimal` passed, but full `schema-output-planner` failed before `thread.started` with the prompt-only child-exit symptom. This isolates the problem to the complete planner outputSchema shape rather than SDK runtime, planner role metadata, JSON text, or minimal outputSchema.

Gate 6B.1H adds:

- `schema-output-lite`: a flat SDK outputSchema with `status`, `prd_markdown`, `task_graph_json`, `acceptance_criteria`, and `risks`.
- Orchestrator post-processing that parses `task_graph_json` and validates it against the full `task-graph` schema.
- Schema analysis reports at `planner-schema-analysis.json` and `PlannerSchemaAnalysisReport.md`.
- Failure categories for planner-lite post-processing, including `PLANNER_TASK_GRAPH_JSON_INVALID`, `PLANNER_TASK_GRAPH_SCHEMA_INVALID`, `PLANNER_PRD_EMPTY`, and `PLANNER_ACCEPTANCE_CRITERIA_EMPTY`.

`schema-output-planner` remains available as a diagnostic mode. It is no longer a Gate 6B.1 prerequisite.

`gate6b:smoke:run` now requires SDK parity PASS plus planner `parity-as-planner`, `minimal`, `schema-text-only`, `schema-output-minimal`, and `schema-output-lite` PASS before it can start the three-thread smoke. M12 remains blocked.

## Gate 6B.1I Three-Thread Planner Path Alignment

Planner `schema-output-lite` has real PASS evidence, but a later three-thread Gate 6B.1 smoke still failed at planner startup. Gate 6B.1I therefore removes the remaining duplicated planner logic from the three-thread smoke path.

The shared stage is:

```text
src/orchestrator/sdk-planner-lite-stage.ts
runPlannerLiteStage(input)
```

Both planner smoke `schema-output-lite` mode and Gate 6B.1 three-thread smoke now use this same function for:

- planner-lite prompt
- planner-lite outputSchema
- SDKRuntimeAdapter input
- streamed SDK invocation shape
- TaskGraph post-processing
- PRD / TaskGraph / planner-result artifact creation
- artifact metadata with `created_by_runtime`, `created_by_role`, and `created_by_thread_id`

Gate 6B.1 smoke is sequential:

1. `runPlannerLiteStage`
2. verify planner artifacts
3. dev worker
4. verify file change and tests
5. evaluator
6. verify EvalReport PASS

If planner-lite fails, dev worker does not start. If dev worker does not produce file-change and passing test evidence, evaluator does not start.

Invocation parity is recorded by:

```bash
npm run gate6b:planner-lite-diff
```

This writes:

```text
evals/sdk-orchestrated/reports/sdk-startup-triage/planner-lite-vs-gate6b-diff.json
evals/sdk-orchestrated/reports/sdk-startup-triage/PlannerLiteVsGate6BDiffReport.md
```

If a critical difference is detected, Gate 6B.1 dry-run blocks with `BLOCKED_PLANNER_STAGE_INVOCATION_DIFF`. `schema-output-planner` remains diagnostic-only and is not required for Gate 6B.1.

## Target Repo

The smoke target is:

```text
tmp/sdk-orchestrated/gate6b-smoke-target/
```

It contains an intentionally broken `validateProjectName(name)` implementation and Node test coverage for:

- Empty string rejected.
- Whitespace-only string rejected.
- Names longer than 80 characters rejected.
- Valid project names accepted.

## PASS Standard

Gate 6B.1 can pass only when a real SDK smoke run proves:

- Planner, dev worker, and evaluator threads all started.
- All three thread IDs are non-empty.
- Planner and evaluator sandboxes are `read-only`.
- Dev worker sandbox is `workspace-write`.
- PRD and TaskGraph artifacts exist.
- Dev worker modifies `src/project-name.js`.
- `npm test` passes in the target repo.
- EvalReport exists with verdict `PASS`.
- Artifacts carry SDK thread evidence.
- No `danger-full-access` was used.
- No secret leakage is detected.

## Gate 6B.1J Dev Worker Stage Slice & Alignment

Gate 6B.1 has moved past the planner startup blocker. The current blocker is the dev_worker stage, so the smoke harness now requires Dev Worker-only slices before any three-thread retry:

- `parity`: role `dev_worker`, workspace-write sandbox, tiny response, no outputSchema, no file changes.
- `minimal-fix`: role `dev_worker`, workspace-write sandbox, modify `src/project-name.js`, run `npm test`, return DevResult text JSON, no outputSchema.
- `output-lite`: role `dev_worker`, workspace-write sandbox, shared `runDevWorkerStage`, flat DevResult lite outputSchema, source diff check, `npm test` evidence, and DevResult artifact metadata.

The shared stage is:

```text
src/orchestrator/sdk-dev-worker-stage.ts
runDevWorkerStage(input)
```

Both Dev Worker `output-lite` smoke and Gate 6B.1 three-thread smoke use this same function for the dev_worker prompt, DevResult lite outputSchema, `workspace-write` sandbox, runtime input, `src/project-name.js` source-diff verification, `npm test` evidence verification, and `artifacts/dev-result.json` metadata.

Gate 6B.1 smoke is guarded in order:

1. SDK parity must be PASS.
2. Planner slices must be PASS.
3. Dev Worker slices must be PASS.
4. `runPlannerLiteStage`.
5. `runDevWorkerStage`.
6. evaluator.

If any Dev Worker slice is missing or non-PASS, `gate6b:smoke:run` returns `BLOCKED_DEV_WORKER_SMOKE_NOT_PASSED` and does not start planner, dev_worker, or evaluator SDK threads.

Invocation parity is recorded by:

```bash
npm run gate6b:dev-worker-diff
```

This writes:

```text
evals/sdk-orchestrated/reports/sdk-startup-triage/dev-worker-vs-gate6b-diff.json
evals/sdk-orchestrated/reports/sdk-startup-triage/DevWorkerVsGate6BDiffReport.md
```

If a critical difference is detected, Gate 6B.1 blocks with `BLOCKED_DEV_WORKER_STAGE_INVOCATION_DIFF`.

## Gate 6B.1J.1 Dev Worker Fixture Reset & Mutation Evidence

Before running `minimal-fix` or `output-lite`, reset the target repo and write baseline mutation evidence:

```bash
npm run gate6b:dev-worker-smoke:prepare
```

The prepare step:

- Rebuilds `tmp/sdk-orchestrated/gate6b-smoke-target`.
- Writes the intentionally broken implementation:

```js
export function validateProjectName(name) {
  return { ok: true };
}
```

- Writes tests for empty string, whitespace-only string, names longer than 80 characters, and valid names.
- Ensures the target is a git repo when possible.
- Records SHA-256 hashes for `src/project-name.js`, `package.json`, and `test/project-name.test.js`.
- Runs `npm test` and requires it to fail.

The baseline artifact is:

```text
evals/sdk-orchestrated/reports/sdk-startup-triage/dev-worker-baseline.json
```

If the baseline is missing, minimal-fix/output-lite return `BLOCKED_DEV_WORKER_BASELINE_MISSING` before starting SDK. If the initial tests pass, they return `BLOCKED_TARGET_FIXTURE_NOT_BROKEN`.

Mutation is verified by three independent signals:

- Content hash changed from `src_project_name_hash_before`.
- `git diff --name-only` includes `src/project-name.js`.
- SDK event JSONL contains file-change evidence for `src/project-name.js`.

`file_change_verified` is true if any one of these is true. If `tests_passed = true` but mutation is not verified, the failure category remains `DEV_WORKER_NO_FILE_CHANGE`.

The verifier also requires:

- `src/project-name.js` exists.
- `package.json` exists.
- `test/project-name.test.js` exists.

Deleting the test file is `DEV_WORKER_TEST_DELETED`.

## Gate 6B.1K Planner TaskGraph Canonicalization

Planner-lite output is intentionally lightweight. The model returns `task_graph_json` as a JSON string that may contain fields such as `id`, `taskId`, `files`, `validation`, `depends_on`, and `acceptanceCriteria`.

The canonical boundary is now the Orchestrator:

```text
src/orchestrator/parse-planner-lite-output.ts
src/orchestrator/planner-task-graph-normalizer.ts
src/orchestrator/hydrate-planner-task-graph.ts
src/orchestrator/validate-planner-artifacts.ts
```

Planner post-processing now runs:

1. Parse planner-lite JSON.
2. Parse `task_graph_json`.
3. Normalize lightweight task fields.
4. Hydrate missing canonical fields such as `task_graph_id`, `loop_run_id`, `prd_artifact_id`, timestamps, agent assignments, `likely_files`, and `validation_commands`.
5. Remove model-only fields before artifact writing.
6. Validate the hydrated graph against `schemas/task-graph.schema.json`.

Failure categories are preserved:

- malformed `task_graph_json`: `PLANNER_TASK_GRAPH_JSON_INVALID`
- no task-like content to hydrate: `PLANNER_TASK_GRAPH_HYDRATION_FAILED`
- hydrated canonical graph still fails schema: `PLANNER_TASK_GRAPH_SCHEMA_INVALID`

Gate 6B.1 must not dispatch Dev Worker unless planner artifacts are hydrated and `task_graph_schema_valid` is effectively true through canonical schema validation.

## Gate 6B.1L Checkpointed SDK Smoke

The continuous three-thread smoke is now legacy-only because it can timeout inside a stage even when that same stage passes independently. Gate 6B.1 validation is checkpointed:

1. `npm run gate6b:checkpoint:prepare`
2. `npm run gate6b:checkpoint:planner`
3. `npm run gate6b:checkpoint:dev-worker`
4. `npm run gate6b:checkpoint:evaluator`
5. `npm run gate6b:checkpoint:verify`
6. `npm run gate6b:checkpoint:report`

Checkpoint state is persisted at:

```text
evals/sdk-orchestrated/reports/gate6b-checkpoint-state.json
```

Each stage defaults to safe blocked dry-run behavior unless the matching real SDK flag is explicitly set for one controlled host-terminal run:

- planner: `CODEX_LOOP_ENABLE_REAL_SDK_PLANNER=1`
- dev_worker: `CODEX_LOOP_ENABLE_REAL_SDK_DEV_WORKER=1`
- evaluator: `CODEX_LOOP_ENABLE_REAL_SDK_EVALUATOR=1`

The legacy continuous command:

```bash
npm run gate6b:smoke:run
```

now returns `BLOCKED_USE_CHECKPOINTED_SMOKE` by default and must not be used as Gate 6B.2 readiness evidence.

## Current Boundary

This patch creates the smoke harness, dry-run safety behavior, real SDK adapter path, model catalog startup triage/classification, SDK-vs-CLI parity gate, planner-only startup slices, planner-lite outputSchema, Planner TaskGraph hydration, Dev Worker-only startup slices, shared planner/dev_worker/evaluator stages, fixture reset, hash/git/event mutation evidence, checkpointed smoke state, and orchestrator post-processing validation. It does not execute real SDK threads in this turn. M12 remains blocked until Gate 6B.2 full repair-loop E2E passes.

## Commands

Checkpoint dry-run harness:

```bash
npm run gate6b:checkpoint:prepare
npm run gate6b:checkpoint:planner
npm run gate6b:checkpoint:dev-worker
npm run gate6b:checkpoint:evaluator
npm run gate6b:checkpoint:verify
npm run gate6b:checkpoint:report
```

Manual real SDK smoke is now run one checkpoint at a time after `@openai/codex-sdk` is resolvable and model catalog triage has selected a working configuration:

```bash
CODEX_LOOP_ENABLE_REAL_SDK_PLANNER=1 npm run gate6b:checkpoint:planner
CODEX_LOOP_ENABLE_REAL_SDK_DEV_WORKER=1 npm run gate6b:checkpoint:dev-worker
CODEX_LOOP_ENABLE_REAL_SDK_EVALUATOR=1 npm run gate6b:checkpoint:evaluator
```

Run each command exactly once and verify/report before continuing. The legacy continuous three-thread smoke is diagnostic-only and disabled by default.

Dev Worker slices, one at a time:

```bash
npm run gate6b:dev-worker-smoke:prepare

CODEX_LOOP_ENABLE_REAL_SDK_DEV_WORKER=1 \
CODEX_LOOP_DEV_WORKER_SMOKE_MODE=parity \
npm run gate6b:dev-worker-smoke:run

CODEX_LOOP_ENABLE_REAL_SDK_DEV_WORKER=1 \
CODEX_LOOP_DEV_WORKER_SMOKE_MODE=minimal-fix \
npm run gate6b:dev-worker-smoke:run

CODEX_LOOP_ENABLE_REAL_SDK_DEV_WORKER=1 \
CODEX_LOOP_DEV_WORKER_SMOKE_MODE=output-lite \
npm run gate6b:dev-worker-smoke:run
```

If triage produced a bundled catalog fallback, include it explicitly on the checkpoint stage being run:

```bash
CODEX_LOOP_MODEL_CATALOG_JSON="$(pwd)/evals/sdk-orchestrated/model-catalog-bundled.json" \
CODEX_LOOP_ENABLE_REAL_SDK_PLANNER=1 \
npm run gate6b:checkpoint:planner
```

After checkpointed runs:

```bash
npm run gate6b:checkpoint:verify
npm run gate6b:checkpoint:report
```

## Gate 6B.1L Dry-Run Validation Result

Latest dry-run validation was executed without any real SDK enablement flags:

- `npm run gate6b:checkpoint:prepare`: `PASS`, checkpoint state created at `PREPARED`.
- `npm run gate6b:checkpoint:planner`: `BLOCKED_SDK_NOT_ENABLED`, no SDK thread started.
- `npm run gate6b:checkpoint:dev-worker`: `BLOCKED_PLANNER_CHECKPOINT_MISSING`, because planner is not `PLANNER_DONE`.
- `npm run gate6b:checkpoint:evaluator`: `BLOCKED_DEV_WORKER_CHECKPOINT_MISSING`, because dev worker is not `DEV_WORKER_DONE`.
- `npm run gate6b:checkpoint:verify`: `NEEDS_REVISION`, `ready_for_gate6b_2=false`.
- `npm run gate6b:smoke:run`: `BLOCKED_USE_CHECKPOINTED_SMOKE`, confirming the legacy continuous smoke is disabled by default.
- `npm run gate6b:smoke:verify`: `PASS` for safe default behavior with `ready_for_one_real_sdk_smoke=false`.

This is the expected safe state for this patch: the harness is ready for a single controlled checkpoint planner run, but no real SDK evidence was produced and Gate 6B.2/M12 remain blocked.

## Gate 6B.1M Evaluator Stage Slices

After a real checkpointed run, planner and dev_worker checkpoints passed but evaluator failed before producing `thread_id` or EvalReport. Gate 6B.1M treats evaluator as the next isolated startup boundary.

Evaluator smoke commands:

```bash
npm run gate6b:evaluator-smoke:run
npm run gate6b:evaluator-smoke:verify
npm run gate6b:evaluator-smoke:report
```

Without `CODEX_LOOP_ENABLE_REAL_SDK_EVALUATOR=1`, `gate6b:evaluator-smoke:run` must return `BLOCKED_SDK_EVALUATOR_NOT_ENABLED` and start no SDK thread.

Real evaluator slices must be run one at a time:

```bash
CODEX_LOOP_ENABLE_REAL_SDK_EVALUATOR=1 \
CODEX_LOOP_EVALUATOR_SMOKE_MODE=parity \
npm run gate6b:evaluator-smoke:run

CODEX_LOOP_ENABLE_REAL_SDK_EVALUATOR=1 \
CODEX_LOOP_EVALUATOR_SMOKE_MODE=text-only \
npm run gate6b:evaluator-smoke:run

CODEX_LOOP_ENABLE_REAL_SDK_EVALUATOR=1 \
CODEX_LOOP_EVALUATOR_SMOKE_MODE=output-minimal \
npm run gate6b:evaluator-smoke:run

CODEX_LOOP_ENABLE_REAL_SDK_EVALUATOR=1 \
CODEX_LOOP_EVALUATOR_SMOKE_MODE=output-lite \
npm run gate6b:evaluator-smoke:run
```

The `output-lite` path uses `findings_json` as a string and hydrates canonical EvalReport locally. The full EvalReport schema is not embedded as SDK outputSchema for checkpoint evaluator.

Checkpoint evaluator retry:

- Allowed from `DEV_WORKER_DONE`.
- Allowed from `FAILED` when planner is PASS, dev_worker is PASS, dev_worker tests passed, and evaluator status is empty or FAILED.
- Still blocked when dev_worker checkpoint evidence is missing.

Gate 6B.2 and M12 remain blocked until evaluator slices and checkpoint evaluator retry have real PASS evidence.

## Gate 6B.1 Checkpointed PASS Evidence

The checkpointed Gate 6B.1 SDK smoke now has PASS evidence for all three required stages in `evals/sdk-orchestrated/reports/`.

Evidence files:

- `evals/sdk-orchestrated/reports/gate6b-checkpoint-state.json`
- `evals/sdk-orchestrated/reports/gate6b-checkpoint-evaluator-result.json`
- `evals/sdk-orchestrated/reports/gate6b-checkpoint-verify.json`

Recorded result:

```json
{
  "current_stage": "EVALUATOR_DONE",
  "planner_status": "PASS",
  "planner_thread_id": "019ee88a-4af1-7f20-80d2-731925c44aa0",
  "dev_worker_status": "PASS",
  "dev_worker_thread_id": "019ee88c-9cdf-72b0-bf62-cb3e8f563428",
  "dev_worker_tests_passed": true,
  "evaluator_status": "PASS",
  "evaluator_thread_id": "019ee8a9-3fc0-74c2-b975-d60d1dbaedea",
  "evaluator_verdict": "PASS",
  "ready_for_gate6b_2": true
}
```

Boundary:

- Gate 6B.1 checkpointed smoke is complete.
- This is still not a full repair-loop E2E proof.
- M12 remains blocked.
- The next gate is Gate 6B.2 SDK-Orchestrated Repair Loop E2E.
