---
name: codex-loop
description: "Trigger with $codex-loop, codex loop, run the loop, continue until evaluator passes, or modular PRD Dev Eval Repair requests. Use when coordinating a whole repository goal through PRD, TaskGraph, development, evaluation, repair, validation, context recovery, and final reporting. Do not use for single short answers, one-off edits that do not need planning/evaluation, or tasks where the user explicitly asks to skip the loop."
---

# Codex Loop Skill

## Purpose

Run a modular, evidence-checked delivery loop for a repository goal.

Use this skill to coordinate:

Goal -> PRD -> TaskGraph -> Dev -> Eval -> Repair -> Validation -> ContextCapsule -> Final Report.

For the detailed state machine, read [references/loop-state-machine.md](references/loop-state-machine.md).
For required JSON outputs, read [references/output-contracts.md](references/output-contracts.md).

## Inputs

- User goal or current module prompt.
- Source-of-truth files listed below.
- Current git diff, validation logs, artifacts, and task outputs when available.

## Source Of Truth

Before each module, read:

- AGENTS.md
- .agent/PLANS.md
- docs/IMPLEMENTATION_PLAN.md
- docs/LOOP_PROGRESS.md
- docs/DECISIONS.md
- schemas/
- tests/
- artifacts/ when relevant
- state/ when it exists

Chat history is never the only state source.

## Loop Phases

## Native Subagent Mode

In Gate 6 and all future native multi-agent validation runs, `$codex-loop` must use Native Subagent Mode.

### Native Subagent Rules

1. The main thread is the Loop Manager.
2. The main thread must not directly write PRD artifacts.
3. The main thread must not directly implement user business code.
4. The main thread must not directly write EvalReport artifacts.
5. The main thread must spawn `loop_planner` to generate PRD, acceptance criteria, and TaskGraph artifacts.
6. After planner artifacts exist, the main thread must spawn `loop_dev_worker` for the initial implementation task. The dev worker must write DevResult and produce a real code diff.
7. After initial DevResult exists, the main thread must spawn `loop_evaluator` for the baseline evaluation. If the implementation is still intentionally or actually broken, this EvalReport must be `NEEDS_REVISION`.
8. If the EvalReport is `NEEDS_REVISION`, the main thread must create or dispatch a RepairRequest that references the evaluator's EvalReport and findings.
9. After RepairRequest exists, the main thread must immediately spawn `loop_dev_worker` again with phase `repair`. The parent must not repair code itself.
10. After repair DevResult exists, the main thread must spawn `loop_evaluator` again for the final read-only evaluation.
11. If context is compacted or degraded, the main thread must spawn `loop_context_distiller` to produce ContextCapsule evidence.
12. If native subagent spawning is unavailable, stop with `BLOCKED_NATIVE_SUBAGENTS_UNAVAILABLE`.
13. The final report must list every subagent's `agent_run_id`, `thread_id`, and artifacts.
14. The parent must not set `mcp_cross_agent_state_verified` to true unless the MCP/state Agent Evidence Ledger proves the cross-agent writes.
15. The first `spawn_agent` prompt for each subagent must contain the complete work order: role, loop_run_id, task_id, module_id, phase, allowed files, required artifacts, MCP evidence calls, validation commands, and final JSON shape.
16. Do not spawn a subagent whose only instruction is to stand by, wait, or reply `READY`. A READY-only handshake is not a valid native subagent run.
17. Do not rely on `send_input` as the primary dispatch mechanism. Use it only to clarify a bounded question after the initial full work order has already been sent.
18. If a spawned subagent returns only `READY`, produces no artifact, or leaves no MCP/state evidence, treat that subagent run as failed and stop with `BLOCKED_NATIVE_SUBAGENT_NO_OUTPUT` or rerun the subagent with a full work order.
19. Planner completion is not a stop condition. If `loop_planner` returns `PASS`, the parent must continue in the same turn by spawning `loop_dev_worker`; do not output final JSON with only planner artifacts unless the planner reported `BLOCKED`.
20. Do not describe an incomplete native loop as an accidental interruption. If a subagent completed but the next required dispatch was not performed, report `NEEDS_REVISION` with the missing dispatch guard, or continue dispatching the next subagent immediately.

### Required Native Loop Order

Native Subagent Mode must execute this order for Gate 6-style goals:

1. Bootstrap or verify `loop_*` agents.
2. Spawn `loop_planner` for PRD, acceptance criteria, and TaskGraph.
3. Spawn `loop_dev_worker` for the initial implementation task from the TaskGraph. It must write DevResult and produce code diff.
4. Spawn `loop_evaluator` for a read-only baseline evaluation of that implementation.
5. If evaluator returns `NEEDS_REVISION`, create a RepairRequest that references the EvalReport and finding ids.
6. Immediately spawn `loop_dev_worker` with that RepairRequest and phase `repair`.
7. Spawn `loop_evaluator` again for final evaluation.
8. Run validation commands such as `npm test` only after final evaluator `PASS`.
9. Spawn `loop_integration_manager` or write the final synthesis only after final evaluator `PASS` and validation passes.

Do not skip the evaluator just because tests obviously fail. The `NEEDS_REVISION` evidence is part of the loop proof. Do not skip the repair dev worker after a RepairRequest exists.

Every spawn in this order must be a full work-order spawn. The parent Loop Manager must not first spawn an idle subagent and then wait for it to become useful.

After each successful `wait`, immediately inspect the returned subagent JSON and transition to the next required dispatch. For Gate 6-style goals, a successful planner result with `next_required_phase: "spawn_loop_dev_worker_initial"` requires spawning `loop_dev_worker` before emitting any final parent output.

### Gate 6 Fast Path

For isolated Gate 6-style validation repos such as `validateProjectName(name)`, the parent Loop Manager must use a short deterministic path instead of open-ended exploration:

1. Read only `package.json`, `src/project-name.js`, `test/project-name.test.js`, `.codex/config.toml`, and the `loop-*` agent TOML files.
2. Do not run `npm run verify:agents` inside the isolated target repo unless that script exists in the target `package.json`.
3. Do not load unrelated skills such as generic TDD, code review, or launch/release skills during the parent dispatch run. Put any useful testing or review constraints directly in the subagent work order.
4. Create the LoopRun with the schema-required fields from this template:
   - `loop_run_id`
   - `project_id`
   - `user_goal`
   - `normalized_goal`
   - `status`
   - `current_module_id`
   - `current_iteration`
   - `max_iterations`
   - `source_of_truth_files`
   - `started_at`
   - `updated_at`
   - `completed_at`
   - `stop_conditions`
   - `budget`
   - `metadata`
5. Do not spend parent-run time reading repository-wide source, plugin source, unrelated docs, or broad search results after native agent availability is confirmed.
6. The planner work order must require a TaskGraph that conforms exactly to the M1 schema: each task must include `loop_run_id`, `owner_agent_id`, `reviewer_agent_id`, `dependencies`, `scope` as an array, `non_goals`, `likely_files` as FileRef objects, `validation_commands` as ValidationCommand objects, `revision_count`, `branch`, `worktree_path`, `artifact_ids`, `created_at`, `updated_at`, and `metadata`.
7. If planner returns a TaskGraph that is only JSON-parseable but not M1-shape-compatible, do not continue to dev. Report `NEEDS_REVISION` with `planner_task_graph_schema_invalid`, because invalid TaskGraph evidence cannot prove Gate 6.
8. Once planner passes and TaskGraph is M1-shape-compatible, spawn `loop_dev_worker` immediately. Do not read more reference material first.
9. The next parent action after successful planner wait must be a native `spawn_agent` call for `loop_dev_worker`; do not run extra discovery commands, do not load generic skills, and do not emit interim final JSON.
10. If the parent emits a status JSON, reads a generic skill, or runs a non-dispatch command after planner success but before spawning `loop_dev_worker`, record `parent_dispatch_guard_failed: "planner_done_without_dev_worker_spawn"` and keep Gate 6.1 at `NEEDS_REVISION`.
11. The parent must use `wait` after every `spawn_agent`. A `spawn_agent` event without a matching `wait` completion is not sufficient evidence that the subagent finished.
12. If `loop_dev_worker` returns `NEEDS_REVISION` after the initial implementation, the next dispatch must be `loop_evaluator` baseline. Do not let the parent repair or skip the evaluator.
13. When baseline evaluator returns `NEEDS_REVISION`, create `artifacts/repair-request.json` and call `repair_create_request` with the exact M1 `RepairRequest` schema: `repair_id`, `loop_run_id`, `task_id`, `module_id`, `source_eval_id`, `assigned_agent_id`, `findings`, `repair_instructions`, `allowed_scope`, `disallowed_scope`, `validation_commands`, `status`, `created_at`, and `updated_at`.
14. Do not use non-schema top-level RepairRequest fields such as `source_eval_report_path`, `finding_ids`, `required_fixes`, `created_by`, or `metadata`; MCP will reject them and the repair worker must not be spawned until a schema-valid RepairRequest exists.

### Gate 6 Work-Order Templates

For Gate 6-style `validateProjectName(name)` repos, keep the parent Loop Manager deterministic and send short complete work orders. The parent must not invent a new open-ended plan after planner completes.

Initial dev worker work order:

- Spawn `loop_dev_worker`.
- Phase: `implementation`.
- Required MCP calls: `agent_run_start`, `artifact_write_by_agent`, `agent_run_finish`.
- Allowed files: `src/project-name.js`, `artifacts/dev-result.json`.
- Required artifact: `artifacts/dev-result.json`.
- Required `artifact_write_by_agent` fields: `agent_run_id`, `agent_name: "loop_dev_worker"`, the same `thread_id` used for `agent_run_start`, `artifact_type: "dev_result"`, `artifact_path: "artifacts/dev-result.json"`, and `artifact_id: "artifact_dev_result_initial"`.
- Required behavior: make a real first-pass diff, but leave one evaluator-detectable acceptance gap so the baseline evaluator can return `NEEDS_REVISION` for repair-loop proof.
- Required validation: run `npm test` and record the honest result.
- Forbidden parent substitute: parent must not edit `src/project-name.js` or write `artifacts/dev-result.json`.
- Required final JSON: include `status`, `agent_name`, `agent_run_id`, `thread_id`, `changed_files`, `artifact`, `validation_commands`, `validation_result`, and `next_required_phase: "spawn_loop_evaluator_baseline"`.

Baseline evaluator work order:

- Spawn `loop_evaluator`.
- Phase: `baseline`.
- Required MCP calls: `agent_run_start`, `eval_report_write_by_agent`, `artifact_write_by_agent`, `agent_run_finish`.
- Required artifact: `artifacts/eval-report-needs-revision.json`.
- Required `artifact_write_by_agent` fields: `agent_run_id`, `agent_name: "loop_evaluator"`, the same `thread_id` used for `agent_run_start`, `artifact_type: "eval_report"`, `artifact_path: "artifacts/eval-report-needs-revision.json"`, and `artifact_id` equal to the EvalReport `eval_id`.
- Required verdict: `NEEDS_REVISION` with at least one finding and required fix when the first-pass implementation still violates acceptance criteria.
- Forbidden parent substitute: parent must not write EvalReport.
- Required final JSON: include `status`, `agent_name`, `agent_run_id`, `thread_id`, `eval_report`, `verdict: "NEEDS_REVISION"`, `findings_count`, and `next_required_phase: "create_repair_request"`.

RepairRequest parent action:

- Create `artifacts/repair-request.json`.
- Call MCP `repair_create_request` with `payload` equal to the file contents.
- The payload must follow `schemas/repair-request.schema.json` exactly.
- Minimal required fields: `repair_id`, `loop_run_id`, `task_id`, `module_id`, `source_eval_id`, `assigned_agent_id`, `findings`, `repair_instructions`, `allowed_scope`, `disallowed_scope`, `validation_commands`, `status`, `created_at`, `updated_at`.
- Use `status: "REPAIR_REQUESTED"` and `assigned_agent_id: "loop_dev_worker"`.
- Copy the evaluator finding objects into `findings`; do not replace them with only finding ids.
- Do not include `source_eval_report_path`, `finding_ids`, `required_fixes`, `created_by`, or `metadata` as top-level fields.
- If `repair_create_request` returns `ok: false`, stop with `NEEDS_REVISION` and `repair_request_schema_invalid`; do not claim RepairRequest exists and do not spawn repair worker.

Repair worker work order:

- Spawn `loop_dev_worker`.
- Phase: `repair`.
- Required input: `artifacts/repair-request.json`.
- Allowed files: `src/project-name.js`, `artifacts/dev-result.json`.
- Required `artifact_write_by_agent` fields: `agent_run_id`, `agent_name: "loop_dev_worker"`, the same `thread_id` used for `agent_run_start`, `artifact_type: "dev_result"`, `artifact_path: "artifacts/dev-result.json"`, and `artifact_id: "artifact_dev_result_repair"`.
- Required validation: run `npm test`; tests must pass before final evaluation.
- Forbidden parent substitute: parent must not repair source code.
- Required final JSON: include `status`, `agent_name`, `agent_run_id`, `thread_id`, `changed_files`, `artifact`, `validation_commands`, `validation_result`, and `next_required_phase: "spawn_loop_evaluator_final"`.

Final evaluator work order:

- Spawn `loop_evaluator`.
- Phase: `final`.
- Required artifact: `artifacts/eval-report-pass.json`.
- Required `artifact_write_by_agent` fields: `agent_run_id`, `agent_name: "loop_evaluator"`, the same `thread_id` used for `agent_run_start`, `artifact_type: "eval_report"`, `artifact_path: "artifacts/eval-report-pass.json"`, and `artifact_id` equal to the EvalReport `eval_id`.
- Required verdict: `PASS` only when acceptance criteria and validation evidence support it.
- Required final JSON: include `status`, `agent_name`, `agent_run_id`, `thread_id`, `eval_report`, `verdict: "PASS"`, and `next_required_phase: "run_final_validation"`.

If the parent reaches `TASK_GRAPH_READY` and the next JSONL event is not a `spawn_agent` for `loop_dev_worker`, Gate 6.1 must remain `NEEDS_REVISION` or `BLOCKED_NATIVE_SUBAGENTS_UNAVAILABLE`.

### Native Dispatch Guards

The parent Loop Manager must enforce these transition guards:

- `PRECHECK_OK -> SPAWN_PLANNER`: must spawn `loop_planner`; parent must not write PRD or TaskGraph.
- `PLANNER_DONE -> SPAWN_DEV_WORKER`: requires PRD and TaskGraph from `loop_planner`.
- `DEV_DONE -> SPAWN_EVALUATOR`: requires `loop_dev_worker` agent_run, DevResult, and real code diff.
- `EVAL_NEEDS_REVISION -> CREATE_REPAIR_REQUEST`: requires EvalReport `NEEDS_REVISION` with findings.
- `REPAIR_REQUEST_CREATED -> SPAWN_DEV_WORKER_REPAIR`: requires RepairRequest referencing EvalReport.
- `REPAIR_DONE -> SPAWN_EVALUATOR_FINAL`: requires `loop_dev_worker` repair agent_run and repair DevResult.
- `FINAL_EVAL_PASS -> RUN_VALIDATION`: requires final EvalReport `PASS`.
- `VALIDATION_PASS -> FINAL_REPORT`: requires final EvalReport `PASS` and passing validation command.

Forbidden transitions:

- Do not stop at `PLANNER_DONE`; planner-only evidence must be followed by `SPAWN_DEV_WORKER` in the same parent run.
- Without a `loop_dev_worker` agent_run, do not mark `DEV_DONE`.
- Without DevResult, do not start evaluation.
- Without EvalReport `NEEDS_REVISION`, do not create RepairRequest.
- Without RepairRequest, do not spawn repair worker.
- Without final EvalReport `PASS`, do not create FinalReport.
- Without passing tests, do not mark Gate 6 PASS.
- If parent directly writes PRD, DevResult, or EvalReport, set `parent_roleplay_detected: true` and block.

### Main Thread Allowed Actions

The parent Loop Manager may only:

- Run preflight checks.
- Bootstrap native loop agents.
- Spawn subagents.
- Wait for subagent results.
- Inspect MCP/state store.
- Record loop state transitions.
- Summarize the final result.

### Native Evidence Requirements

Each native subagent must record:

- `agent_run_id`
- `agent_name`
- `thread_id`
- `parent_thread_id`
- `task_id`
- `module_id`
- artifact references

Artifacts without `agent_run_id` are not valid Gate 6 evidence.

When the `codex_loop_store` MCP tools are available, use them exactly for evidence:

- `agent_run_start` at the beginning of every native subagent run.
- `artifact_write_by_agent` for PRD, acceptance criteria, TaskGraph, DevResult, ContextCapsule, and FinalReport evidence.
- `eval_report_write_by_agent` for every EvalReport.
- `repair_request_write_by_agent` for every RepairRequest.
- `loop_transition_record` for state transitions such as `EVAL_RUNNING -> REPAIR_REQUESTED`.

If MCP tools are unavailable, do not pretend they ran. Record `mcp_cross_agent_state_verified: false` and include `BLOCKED_MCP_AGENT_LEDGER_UNAVAILABLE` or a concrete MCP unavailability issue in the final result.

### Goal Normalization

Convert the user request into outcome, constraints, boundaries, success criteria, validation surface, and stop conditions. Ask only for blocking ambiguity.

### PRD Generation

Use `$prd-planner` behavior to create or update:

- docs/PRD.md
- docs/ACCEPTANCE_CRITERIA.md

### Task Graph Generation

Use `$task-decomposer` behavior to create or update:

- docs/TASK_GRAPH.json

The TaskGraph must follow the M1 `task-graph` schema.

### Module Implementation

Use `$dev-worker` behavior for exactly one current module, task, or repair request. Keep changes inside declared scope.

### Evaluation

Use `$evaluator` behavior. Evaluator is read-only and compares PRD, TaskGraph, acceptance criteria, diff, artifacts, and validation logs.

### Repair

If evaluation returns `NEEDS_REVISION`, create a RepairRequest and repair only listed findings. Rerun validation and re-evaluate.

### Validation

Run the narrowest useful validation first, then broader validation. Record commands and results in docs/LOOP_PROGRESS.md.

### Context Recovery

Use `$context-distiller` behavior when context is long, noisy, compacted, or unreliable. Save ContextCapsule artifacts under artifacts/context-capsules/ when artifact writing exists.

### Final Report

Use `$integration-manager` behavior only after evaluator PASS evidence exists for required modules.

## Stop Conditions

Stop when:

- Current module passes validation.
- Evaluator returns `PASS`.
- Repair requires user approval or reaches the maximum repair budget.
- Environment is blocked.
- Context restart is required.
- Next module requires confirmation.

## Rules

- Do not implement the whole project in one pass.
- Do not rely on chat context as the only source of truth.
- If validation or evaluation fails, repair the current module before moving on.
- Evaluator must be read-only.
- Context capsule must preserve `agent_id`, `old_thread_id`, `current_module`, `open_issues`, and `next_instruction`.
- Do not enter the next module unless the user explicitly asks or the loop contract allows it.

## Required Output JSON

```json
{
  "module_id": "M?",
  "status": "PASS | NEEDS_REVISION | BLOCKED",
  "changed_files": [],
  "validation_commands": [],
  "validation_result": "passed | failed | not_run",
  "evaluator_verdict": "PASS | NEEDS_REVISION | NOT_RUN",
  "remaining_risks": [],
  "next_module": "M?",
  "ready_to_continue": true
}
```
