# SDK-Orchestrated Mode Plan

Date: 2026-06-19

Status: primary production-path candidate skeleton started in Gate 6B.0; real SDK E2E not yet executed.

## Native Subagent Blocker

Gate 6.1 shows that native custom subagents can be spawned in a minimal probe, but a full parent `$codex-loop` run under `codex exec` is not yet reliable enough to complete PRD -> TaskGraph -> Dev -> Eval -> Repair -> Dev Repair -> Eval PASS -> FinalReport in one run.

Gate 6.2-Lite host-run later showed a stronger partial native result: the native flow can start `loop_dev_worker`, modify code, pass tests, and avoid parent roleplay. It still failed before final evaluator completion: final evaluator did not spawn, final PASS EvalReport was absent, MCP cross-agent state did not verify, and the turn did not complete reliably.

Observed blockers:

- Full native parent dispatch can stall before `wait` completes for `loop_planner`.
- A previous full run reached baseline evaluator but failed when the parent emitted a non-schema `RepairRequest`.
- After the schema guard was repaired, the next full run regressed to planner-only timeout.

## Why SDK-Orchestrated Mode

The user experience should remain `$codex-loop` plus a goal. The unreliable piece is not the state contract or the custom agent roles; it is the parent thread's ability to deterministically continue native dispatch under the current CLI runtime budget.

SDK-Orchestrated Mode would move the deterministic parent controller into a runtime adapter while keeping:

- M1 schemas
- M5 state store
- M6 MCP tools
- M7 state machine
- M8 hooks evidence
- Gate 6 artifact and event checks

Native Subagent Mode is retained as an experimental secondary runtime. It is no longer the current production main path candidate until it can reliably complete multi-stage continuation.

## Proposed Architecture

1. User invokes `$codex-loop` with a goal.
2. Loop Manager creates a `LoopRun` in the MCP/state store.
3. RuntimeAdapter creates or resumes separate Codex SDK threads for:
   - `loop_planner`
   - `loop_dev_worker`
   - `loop_evaluator`
   - `loop_context_distiller`
   - `loop_integration_manager`
4. Each SDK thread receives a complete work order and is required to write AgentRun evidence through MCP.
5. The parent RuntimeAdapter waits deterministically for each thread result.
6. EvaluationGate and RepairDispatcher decide the next thread.
7. FinalDeliveryReport is created only after final evaluator PASS and validation PASS.

## RuntimeAdapter Extension

Gate 6B.0 adds `src/runtime/runtime-adapter.ts` and role-specific runtime types with:

- `startThread(input)`
- `runThread(input)`
- `resumeThread(input)`
- `getThreadEvents(input)`
- `stopThread(input)`
- `getFinalResponse(input)`

The current `StubRuntimeAdapter` remains valid for local unit tests and must not be used as Gate 6B PASS evidence. `SdkRuntimeAdapter` is a skeleton: it checks `CODEX_LOOP_ENABLE_REAL_SDK_RUN=1`, attempts to resolve `@openai/codex-sdk` only when explicitly enabled, and never fabricates a thread id.

## Evidence Rules

Gate 6B should still require:

- parent thread/run id
- child thread ids for planner/dev/evaluator
- AgentRun start/finish records
- artifact producer records
- EvalReport NEEDS_REVISION
- schema-valid RepairRequest
- Dev repair
- EvalReport PASS
- final `npm test` PASS
- FinalDeliveryReport with agent/thread/artifact refs

## Gate 6B Definition

Gate 6B: SDK-Orchestrated Multi-Agent Loop E2E.

PASS requires the same functional outcome as Gate 6, but native Codex CLI `spawn_agent` lifecycle events may be replaced by SDK thread creation/resume/wait events, provided they include real thread IDs and captured event logs.

## Gate 6B.0 Skeleton

Gate 6B.0 adds:

- runtime adapter interfaces and stub/native/sdk adapter skeletons
- SDK loop state machine hard gates
- SDK thread-run state/MCP evidence schema and tools
- dry-run Gate 6B eval fixtures and scripts

`npm run gate6b:run` defaults to `BLOCKED_SDK_NOT_ENABLED` and does not execute a real SDK run unless `CODEX_LOOP_ENABLE_REAL_SDK_RUN=1` is explicitly set in a controlled host terminal.

## Non-Goals

- Do not execute real SDK E2E in Gate 6B.0.
- Do not bypass MCP/state evidence.
- Do not mark the existing native Gate 6 as PASS from SDK evidence.
- Do not use fixture replay or `StubRuntimeAdapter` as live runtime evidence.

## Gate 6B.1A Update

Gate 6B.1A replaces the intentional SDK smoke stub with a real, gated adapter path:

- `SdkRuntimeAdapter` performs SDK capability-aware execution through `Codex.startThread()`.
- The smoke runner can execute planner, dev worker, and evaluator roles through the adapter when explicitly enabled.
- Tests use mock SDK modules only; this turn does not start real SDK threads.
- The real smoke remains a manual host-terminal action gated by `CODEX_LOOP_ENABLE_REAL_SDK_RUN=1`.

M12 remains blocked until Gate 6B.2 complete repair-loop E2E passes.

## Gate 6B.1B Update

Gate 6B.1B handles a startup failure observed during a manually triggered real SDK smoke. The SDK thread sequence did not start; Codex failed while refreshing the model catalog and reported a response with `{"data":[...]}` but no top-level `models` field.

The SDK-Orchestrated plan now includes:

- `CODEX_MODEL_CATALOG_REFRESH_FAILED` as a distinct pre-thread failure category.
- Model catalog diagnosis scripts that collect `codex --version`, bundled model catalog output, and remote model catalog output.
- A parse step that recommends a bundled catalog fallback only when the bundled output is valid JSON.
- Runtime adapter config overrides for `model`, `model_catalog_json`, and arbitrary config overrides.
- Explicit blocking for `CODEX_LOOP_CODEX_PROFILE` until the installed SDK exposes a profile option.

This keeps the next retry controlled: run model catalog triage first, then retry exactly one real SDK smoke only after choosing a working model/catalog override. Gate 6B.2 remains the first gate that can prove the complete repair-loop E2E and unblock M12.

## Gate 6B.1D Update

Direct CLI parity now distinguishes the remaining blocker from Codex CLI and model catalog startup:

- Direct `codex exec` in `tmp/sdk-orchestrated/gate6b-smoke-target` passed with `thread.started`, `SDK_TARGET_DIRECT_CLI_OK`, and `turn.completed`.
- Model catalog parse passed for bundled and remote catalogs.
- Real SDK smoke still failed before planner `thread_id` with `Codex Exec exited with code 1: Reading prompt from stdin...`.

The SDK-Orchestrated plan now inserts an SDK parity smoke before the three-thread Gate 6B.1 smoke. The parity smoke starts only one read-only SDK thread and uses the same target repo, model, bundled model catalog, and isolated SQLite home as the direct CLI parity smoke. The adapter writes `sdk-invocation-trace-redacted.json` before startup so constructor env/config, startThread options, and run options can be compared against CLI evidence without leaking secrets.

`gate6b:smoke:run` must not start planner/dev/evaluator SDK threads until `gate6b:sdk-parity:run` has produced PASS evidence. M12 remains blocked.

## Gate 6B.1E Update

Gate 6B.1E inserts planner-only startup slices between SDK parity and the three-thread smoke:

- `minimal`: proves a planner SDK thread can start with a tiny prompt and no outputSchema.
- `schema`: proves the outputSchema path can work before the full planner prompt is introduced.
- `exact`: proves the full planner prompt and planner artifact contract can work before dev/evaluator threads are attempted.

`gate6b:smoke:run` now blocks with `BLOCKED_PLANNER_SMOKE_NOT_PASSED` unless SDK parity plus all three planner smoke modes have PASS evidence. The invocation diff report compares SDK parity, Gate 6B planner, and planner-only smoke traces across working directory, model catalog, model, sandbox, outputSchema, prompt hash/length, SDK API method, config keys, env keys, Node cwd, and error capture paths.

This keeps the next real run small and attributable. M12 remains blocked.

## Gate 6B.1F Update

Planner minimal smoke timed out before producing a planner thread id, even though SDK parity had passed. Gate 6B.1F therefore adds:

- streamed event capture to JSONL for planner smoke runs
- timeout classification for startup, turn, and no-event cases
- planner timeout triage reports
- `parity-as-planner` mode, which reuses the SDK parity prompt and runtime shape while changing only role metadata to planner

The three-thread smoke now requires SDK parity plus planner `parity-as-planner`, `minimal`, `schema`, and `exact` PASS evidence. If `parity-as-planner` fails while SDK parity remains PASS, the SDK-Orchestrated plan should treat this as a planner role invocation mismatch and either fix SDK role invocation or move to CLI-Orchestrated Mode. M12 remains blocked.

## Gate 6B.1G Update

Planner `parity-as-planner` and `minimal` smokes passed, but the legacy `schema` planner smoke failed before `thread.started`. Gate 6B.1G narrows the outputSchema path before any three-thread retry:

- `schema-text-only`: JSON text prompt without outputSchema.
- `schema-output-minimal`: minimal outputSchema with `status` and `message`.
- `schema-output-planner`: current planner outputSchema; legacy `schema` aliases here.

The three-thread smoke now requires SDK parity plus planner `parity-as-planner`, `minimal`, `schema-text-only`, `schema-output-minimal`, and `schema-output-planner` PASS evidence. If `schema-text-only` passes but `schema-output-minimal` fails, classify the blocker as SDK outputSchema invocation. If minimal outputSchema passes but planner outputSchema fails, classify it as planner schema complexity or format. M12 remains blocked.

## Gate 6B.1H Update

Planner `schema-output-minimal` passed, but full `schema-output-planner` failed before thread start. Gate 6B.1H treats the complete planner outputSchema as too complex or incompatible for direct SDK outputSchema use.

The SDK-Orchestrated path now uses `schema-output-lite`:

- SDK outputSchema stays flat.
- Planner returns `prd_markdown` and `task_graph_json` as strings.
- Orchestrator post-processing parses `task_graph_json` and validates it against the full `task-graph` schema.
- Full planner schema remains diagnostic only and no longer blocks Gate 6B.1.

The three-thread smoke now requires SDK parity plus planner `parity-as-planner`, `minimal`, `schema-text-only`, `schema-output-minimal`, and `schema-output-lite` PASS evidence. M12 remains blocked.

## Gate 6B.1I Update

Planner `schema-output-lite` is now a shared orchestrator stage instead of script-local logic. `runPlannerLiteStage` owns the planner-lite prompt, outputSchema, SDK runtime input, TaskGraph post-processing, and planner artifact creation. Planner smoke `schema-output-lite` and Gate 6B.1 three-thread smoke both call this function.

The three-thread smoke no longer reconstructs planner invocation independently and no longer uses the full `schema-output-planner` path. Before starting a real run, it can compare the planner-lite smoke invocation and the Gate 6B planner invocation with `gate6b:planner-lite-diff`; any critical diff blocks with `BLOCKED_PLANNER_STAGE_INVOCATION_DIFF`.

Gate 6B.1 remains a short smoke only. It proves planner -> dev_worker -> evaluator sequencing, not the full repair loop. M12 remains blocked until Gate 6B.2 complete repair-loop E2E passes.

## Gate 6B.1J Update

Planner path alignment is complete enough to expose the next startup blocker: dev_worker. Gate 6B.1J adds Dev Worker-only smoke slices before any three-thread retry:

- `parity`: proves dev_worker role metadata and workspace-write sandbox can start with a tiny response.
- `minimal-fix`: proves the dev_worker can change `src/project-name.js`, run `npm test`, and return DevResult text JSON without outputSchema.
- `output-lite`: proves the shared `runDevWorkerStage` path with DevResult lite outputSchema.

`runDevWorkerStage` now owns the dev_worker prompt, DevResult lite outputSchema, runtime input, source-diff check, `npm test` evidence check, and `artifacts/dev-result.json` metadata. Gate 6B.1 three-thread smoke calls this shared stage and blocks with `BLOCKED_DEV_WORKER_SMOKE_NOT_PASSED` until all three Dev Worker slices pass.

This update does not execute real SDK threads. M12 and Gate 6B.2 remain blocked until a complete Gate 6B repair-loop E2E passes.

## Gate 6B.1J.1 Update

Dev Worker parity proved SDK thread startup, but minimal-fix did not prove a real source mutation. Gate 6B.1J.1 adds a deterministic fixture reset and mutation evidence layer:

- `gate6b:dev-worker-smoke:prepare` resets the target repo to a known broken `validateProjectName` implementation.
- The prepare step records baseline SHA-256 hashes and requires initial `npm test` to fail.
- Minimal-fix and output-lite block before SDK startup if the baseline is missing or not broken.
- Mutation proof uses content hash, git diff, and SDK file-change event evidence.
- Test deletion is a hard failure.

This keeps the next real minimal-fix smoke attributable: if tests pass and hash evidence changes, the dev_worker actually modified `src/project-name.js`. M12 and Gate 6B.2 remain blocked.

## Gate 6B.1K Update

Planner `schema-output-lite` and Dev Worker `output-lite` have PASS evidence, but the three-thread smoke exposed a planner artifact boundary issue: `runPlannerLiteStage` received lightweight TaskGraph JSON and then rejected it as if it were already canonical.

Gate 6B.1K keeps planner-lite model output lightweight and moves canonicalization into the Orchestrator:

- `normalizePlannerTaskGraph` maps `id` / `taskId`, `files`, `validation`, `depends_on`, and `acceptanceCriteria`.
- `hydratePlannerTaskGraph` fills the canonical `TaskGraph` envelope, agent assignments, validation command objects, file reference objects, timestamps, null branch/worktree fields, and schema status.
- `validatePlannerLiteArtifacts` now validates the hydrated canonical graph, not the raw model graph.
- `runPlannerLiteStage` writes `docs/TASK_GRAPH.json` only after canonical schema validation passes.

This update does not run real SDK threads. The next validation step is the checkpointed Gate 6B.1L smoke, not another continuous three-thread run. M12 remains blocked until Gate 6B.2 complete repair-loop E2E passes.

## Gate 6B.1L Update

The continuous three-thread Gate 6B.1 smoke is now legacy-only. It repeatedly produced ambiguous long-running failures even after the planner and dev_worker stages passed independently, so the SDK-Orchestrated path now uses checkpointed stage execution:

- `gate6b:checkpoint:prepare`
- `gate6b:checkpoint:planner`
- `gate6b:checkpoint:dev-worker`
- `gate6b:checkpoint:evaluator`
- `gate6b:checkpoint:verify`
- `gate6b:checkpoint:report`

Checkpoint state is persisted at `evals/sdk-orchestrated/reports/gate6b-checkpoint-state.json`. Each run script starts no real SDK thread unless its stage-specific env flag is explicitly set for one controlled run:

- `CODEX_LOOP_ENABLE_REAL_SDK_PLANNER=1`
- `CODEX_LOOP_ENABLE_REAL_SDK_DEV_WORKER=1`
- `CODEX_LOOP_ENABLE_REAL_SDK_EVALUATOR=1`

`gate6b:smoke:run` now defaults to `BLOCKED_USE_CHECKPOINTED_SMOKE` and must not be used as Gate 6B.2 readiness evidence. Gate 6B.2 and M12 remain blocked until the checkpointed smoke and then the full repair-loop E2E pass with real SDK evidence.

## Gate 6B.1M Update

Checkpointed Gate 6B.1 proved planner and dev_worker stages independently, but evaluator failed before thread id and before EvalReport creation. The current blocker is evaluator invocation/outputSchema, not planner or dev_worker.

Gate 6B.1M adds evaluator-only slices:

- `parity`: evaluator role plus read-only SDK invocation, no outputSchema.
- `text-only`: evaluator reads artifacts and returns JSON text, no outputSchema.
- `output-minimal`: smallest evaluator outputSchema with status, verdict, and summary.
- `output-lite`: lightweight evaluator outputSchema with `findings_json` as a string and local EvalReport hydration.

The checkpoint evaluator now uses `runEvaluatorLiteStage`, not a full EvalReport outputSchema, and it can retry from `FAILED` when planner/dev_worker checkpoint evidence is already PASS. Gate 6B.2 and M12 remain blocked until evaluator slices and checkpoint evaluator produce real PASS evidence.

## Gate 6B.1 Checkpointed PASS Update

Gate 6B.1 checkpointed SDK smoke now has complete three-stage PASS evidence:

- Planner checkpoint PASS with thread id `019ee88a-4af1-7f20-80d2-731925c44aa0`.
- Dev Worker checkpoint PASS with thread id `019ee88c-9cdf-72b0-bf62-cb3e8f563428`.
- Evaluator checkpoint PASS with thread id `019ee8a9-3fc0-74c2-b975-d60d1dbaedea`.
- Checkpoint state is `EVALUATOR_DONE`.
- Evaluator verdict is `PASS`.
- `ready_for_gate6b_2` is true.

This completes the checkpointed smoke gate only. The next SDK-Orchestrated validation step is Gate 6B.2, which must prove the complete repair loop E2E before M12 can begin.

## Gate 6B.2.0 Update

Gate 6B.2.0 adds a checkpointed repair-loop harness for:

Planner -> Dev Worker -> Initial Evaluator NEEDS_REVISION -> RepairRequest -> Repair Dev Worker -> Final Evaluator PASS -> FinalDeliveryReport.

The harness introduces `gate6b2:*` scripts and a dedicated state file at `evals/sdk-orchestrated/reports/gate6b2-repair-loop-state.json`. It uses the existing shared planner-lite, dev-worker, and evaluator-lite stages where possible, and adds local Orchestrator helpers for schema-valid RepairRequest generation and FinalDeliveryReport writing.

This update does not run real SDK threads. Gate 6B.2 becomes the next real validation gate. M12 remains blocked until Gate 6B.2 real repair-loop E2E passes.

## Gate 6B.2.1 Update

Gate 6B.2 initial dev worker is now explicitly a seeded-gap implementer, not the final fixer. The target fixture splits tests into `test:baseline` and `test:full` so the initial dev worker can prove baseline behavior while intentionally leaving the whitespace-only gap for evaluator-driven repair.

The orchestration contract is:

- Planner produces PRD and TaskGraph.
- Initial dev worker passes baseline tests, records `known_gap_seeded = true`, and records full tests as expected failure.
- Initial evaluator must return `NEEDS_REVISION` for the whitespace-only gap.
- RepairRequest is created from that EvalReport.
- Repair dev worker fixes the gap and must pass full tests.
- Final evaluator may return `PASS` only after full acceptance evidence exists.

This update does not run real SDK threads. The next controlled real run should reset Gate 6B.2, rerun planner, then retry exactly the initial dev worker stage. M12 remains blocked until complete Gate 6B.2 real repair-loop E2E passes.

## Gate 6B.2 PASS Update

Gate 6B.2 SDK-Orchestrated Repair Loop E2E has passed. SDK-Orchestrated Mode is now proven for the complete repair-loop sequence:

Planner -> Initial Dev Worker seeded gap -> Initial Evaluator NEEDS_REVISION -> RepairRequest -> Repair Dev Worker -> Final Evaluator PASS -> FinalDeliveryReport.

Recorded evidence:

- Checkpoint `current_stage = FINAL_REPORT_DONE`.
- Planner checkpoint is `PASS`.
- Initial Dev Worker checkpoint is `PASS` and records `known_gap_seeded = true`.
- Initial Evaluator records verdict `NEEDS_REVISION`.
- RepairRequest checkpoint is `PASS`.
- Repair Dev Worker checkpoint is `PASS` and records `tests_passed = true`.
- Final Evaluator records verdict `PASS`.
- FinalDeliveryReport is generated.
- All required thread ids are present.
- Artifact/thread evidence is verified.
- `danger_full_access_used = false`.
- `secret_leak_detected = false`.
- `ready_for_m12 = true`.

Runtime position:

- SDK-Orchestrated Mode becomes the primary proven runtime path for production-effectiveness evaluation.
- Native Mode remains experimental runtime until a later native-subagent gate produces equivalent full repair-loop evidence.
- M12 Production Effectiveness Evaluation may start as the next separately scoped gate.

This update only records the completed Gate 6B.2 result. It does not rerun SDK, rerun Gate 6B.2, or start M12.
