# Gate 6 Real Native Multi-Agent Loop E2E

Date: 2026-06-19

Verdict: NEEDS_REVISION_NATIVE_DISPATCH_CHAIN_UNSTABLE

## Gate 6.2-Lite Harness Safety Patch

Status: PASS for harness safety patch. The real Gate 6.2-Lite continuation run was not executed in this pass.

Gate 6.1 changed the diagnosis: native custom subagent capability is available because the minimal native dispatch probe passed. Full Gate 6 should therefore no longer be described as native subagents being categorically unavailable. The remaining failure is that the full native dispatch chain is unstable under `codex exec`.

Gate 6.2-Lite changes:

- Full Gate 6 is disabled by default in `npm run gate6:run`.
- The next allowed live check is a repair-continuation-only probe, not a full PRD loop.
- A runtime budget guard limits future real Codex execution to one run, 180000 ms per run, 60000 ms no-event timeout, and zero retries.
- The continuation probe starts from a prepared valid `NEEDS_REVISION` EvalReport plus schema-valid RepairRequest.
- The continuation probe validates only: spawn `loop_dev_worker` repair -> run `npm test` -> spawn `loop_evaluator` final -> EvalReport PASS.

Gate 6.2-Lite files:

- `src/runtime/time-budget.ts`
- `src/runtime/exec-with-budget.ts`
- `scripts/multi-agent/budgeted-codex-exec.ts`
- `evals/multi-agent/probes/gate6-2-lite-repair-continuation.md`
- `scripts/multi-agent/run-gate6-2-lite.ts`
- `scripts/multi-agent/verify-gate6-2-lite.ts`
- `scripts/multi-agent/report-gate6-2-lite.ts`
- `evals/multi-agent/reports/gate6-2-lite-result.json`
- `evals/multi-agent/reports/Gate6_2_Lite_Report.md`

Validation run for the harness patch:

- `npm run typecheck` passed.
- `npm test` passed.
- `npm run gate6:lite:prepare` passed and did not launch `codex exec`.
- `npm run validate` passed.
- `npm run gate6:lite:report` passed.
- `npm run gate6:run` guard check passed and did not launch `codex exec`; it wrote `FULL_GATE6_RUN_DISABLED_BY_DEFAULT`.

Commands intentionally not run:

- `npm run gate6:lite:run`
- Any real `codex exec`
- Any full Gate 6 live run
- M12

Next manual action after this safety patch: run exactly one budgeted continuation probe with `npm run gate6:lite:run`, then `npm run gate6:lite:verify` and `npm run gate6:lite:report`. That single isolated SQLite probe has now been executed and is recorded below. Do not rerun full Gate 6 without explicit approval and budget.

## Gate 6.2-Lite Repair Continuation Probe

Status: FAIL.

The approved single budgeted continuation probe was executed exactly once.

Commands:

- `npm run gate6:lite:prepare`
- `npm run gate6:lite:run`
- `npm run gate6:lite:verify`
- `npm run gate6:lite:report`

Outcome from the pre-isolated-SQLite run:

- `real_codex_exec_runs`: 1
- `duration_ms`: 73
- `exit_code`: 1
- `event_count`: 0
- `failure_category`: `NO_JSONL_EVENT`
- `real_thread_executed`: false
- `agent_runs`: []
- `repair_dev_worker_spawned`: false
- `final_evaluator_spawned`: false
- `tests_passed`: false
- `final_eval_verdict`: empty
- `mcp_cross_agent_state_verified`: false
- `parent_roleplay_detected`: false

Failure cause:

The Codex CLI process exited before producing JSONL events. Stderr shows that Codex failed to initialize local state because `/Users/litmus/.codex/state_5.sqlite` is readonly:

```text
attempt to write a readonly database
Error: failed to initialize in-process app-server client: Operation not permitted (os error 1)
```

This is not a PASS and not a fixture replay. The probe did not reach native subagent dispatch.

Decision for next work from this run:

- Do not start M12.
- Do not blindly rerun native full Gate 6.
- Recommended next gate: Gate 6B SDK-Orchestrated Mode, or a separately approved environment fix that allows Codex CLI state initialization without `danger-full-access`.

## Gate 6.2.1 Codex Local State DB Unblock Harness Patch

Status: PASS for harness patch. No real Gate 6.2-Lite run was executed in this patch.

The Gate 6.2-Lite failure above was not a native dispatch failure. It happened before Codex emitted `thread.started`, before JSONL events, and before any `agent_run`. Stderr showed Codex failed while initializing its local SQLite-backed runtime state:

```text
attempt to write a readonly database
/Users/litmus/.codex/state_5.sqlite
```

The next Gate 6.2-Lite probe must use an isolated project-local SQLite home:

```text
.codex-eval/sqlite/
```

Harness changes:

- Real `codex exec` child processes receive `CODEX_SQLITE_HOME=<repo>/.codex-eval/sqlite`.
- Real `codex exec` args include `-c sqlite_home="<repo>/.codex-eval/sqlite"`.
- `CODEX_HOME` is not overwritten by default, so user auth/config/plugin state is not copied or replaced.
- `CODEX_LOOP_EVAL_CODEX_HOME` is supported only as an advanced mode and must point at an existing directory.
- The harness checks that `.codex-eval/sqlite` exists and is writable before running.
- If `state_5.sqlite` exists inside the eval SQLite home and is readonly, the run blocks before Codex starts.
- Stderr containing `attempt to write a readonly database` is classified as `CODEX_LOCAL_STATE_DB_READONLY`, not `NO_JSONL_EVENT`.

Validation:

- `npm run typecheck` passed.
- `npm test` passed.
- `npm run validate` passed.
- `npm run codex:state:diagnose` passed and reported global Codex state DB readonly, project eval SQLite home writable.

Safety boundary:

- Do not use `danger-full-access`.
- Do not run `sudo chmod` or `sudo chown` on `~/.codex`.
- Do not delete `~/.codex/state_5.sqlite`.
- Do not bypass hook trust.

M12 remains blocked. The next manual action was one isolated Gate 6.2-Lite probe with `npm run gate6:lite:run`, not full Gate 6. That probe has now been executed and is recorded below.

## Gate 6.2-Lite Repair Continuation Probe - Isolated SQLite

Status: FAIL. Do not start M12.

This pass executed the approved isolated SQLite continuation probe exactly once:

- `npm run gate6:lite:prepare` passed.
- `npm run gate6:lite:run` executed once and failed after 607 ms.
- `npm run gate6:lite:verify` exited non-zero because the probe did not pass.
- `npm run gate6:lite:report` passed and generated the report artifact.

Evidence files:

- `evals/multi-agent/reports/gate6-2-lite-result.json`
- `evals/multi-agent/reports/gate6-2-lite-budget-result.json`
- `evals/multi-agent/reports/gate6-2-lite-stderr.log`
- `evals/multi-agent/reports/gate6-2-lite-command.txt`
- `evals/multi-agent/reports/Gate6_2_Lite_Report.md`

Observed result:

- `real_codex_exec_runs`: 1
- `duration_ms`: 607
- `exit_code`: 1
- `event_count`: 0
- `failure_category`: `NO_JSONL_EVENT`
- `real_thread_executed`: false
- `thread_started`: false
- `agent_runs`: []
- `repair_dev_worker_spawned`: false
- `final_evaluator_spawned`: false
- `tests_passed`: false
- `final_eval_verdict`: empty
- `mcp_cross_agent_state_verified`: false
- `parent_roleplay_detected`: false

The command used the isolated project SQLite home:

```text
-c sqlite_home="/Users/litmus/Downloads/codex-loop-plugin/.codex-eval/sqlite"
```

The previous readonly database failure did not recur. Stderr now shows a different pre-thread failure:

```text
WARNING: proceeding, even though we could not create PATH aliases: Operation not permitted (os error 1)
Reading additional input from stdin...
Error: failed to initialize in-process app-server client: Operation not permitted (os error 1)
```

Conclusion:

- Gate 6.2-Lite did not reach `thread.started`.
- It did not test native repair dispatch.
- There is no evidence of `loop_dev_worker`, `loop_evaluator`, file change, `npm test`, final EvalReport PASS, or MCP cross-agent state.
- The local SQLite readonly blocker is resolved for this harness, but the constrained `codex exec` environment still cannot initialize the in-process app-server client.
- M12 remains blocked.
- Recommended next action: fix Codex local app-server initialization in the constrained eval environment, or move to Gate 6B SDK-Orchestrated Mode if native `codex exec` remains unavailable under the safety constraints.

## Gate 6.2.2 Codex Exec Startup Triage

Status: NEEDS_REVISION. Do not start M12.

Gate 6.2.2 ran a startup-only triage to determine whether the isolated Gate 6.2-Lite `NO_JSONL_EVENT` came from the repair-continuation harness or from Codex exec startup itself.

It executed one minimal real `codex exec --json` smoke only:

```text
codex exec -c sqlite_home="/Users/litmus/Downloads/codex-loop-plugin/.codex-eval/sqlite" --json --sandbox read-only -C /Users/litmus/Downloads/codex-loop-plugin "Respond with exactly: CODEX_EXEC_SMOKE_OK"
```

Result:

- `status`: FAIL
- `duration_ms`: 57
- `thread_started`: false
- `event_count`: 0
- `failure_category`: `SANDBOX_OR_PERMISSION_ERROR`
- Output-schema smoke: not run, because the minimal smoke failed.
- `codex doctor`: run read-only after the failed smoke.

Observed stderr:

```text
WARNING: proceeding, even though we could not create PATH aliases: Operation not permitted (os error 1)
Reading additional input from stdin...
Error: failed to initialize in-process app-server client: Operation not permitted (os error 1)
```

Evidence files:

- `evals/multi-agent/reports/gate6-2-lite-startup-triage.json`
- `evals/multi-agent/reports/Gate6_2_Lite_Startup_Triage_Report.md`
- `evals/multi-agent/reports/codex-exec-smoke-result.json`
- `evals/multi-agent/reports/codex-exec-smoke-stderr.log`
- `evals/multi-agent/reports/codex-doctor-output.log`

Conclusion:

- The current blocker is Codex exec startup/app-server initialization under the constrained eval environment.
- Gate 6.2-Lite did not reach native repair dispatch.
- This failure cannot be attributed to `loop_dev_worker`, `loop_evaluator`, MCP state, output schema, or plugin behavior.
- Do not rerun Gate 6.2-Lite until a minimal read-only `codex exec --json` smoke emits `thread.started` with isolated SQLite.

## Gate 6.1 RCA Update

Status: NEEDS_REVISION. Do not start M12.

Gate 6.1 repaired two concrete failure modes:

- Planner-only early stop: the parent now has explicit `planner_done_without_dev_worker_spawn` guard instructions and tests.
- Invalid RepairRequest payload: the parent now has an exact M1 `RepairRequest` schema template and `repair_request_schema_invalid` stop condition.

Latest probe and rerun evidence:

- Native dispatch probe PASS: parent thread `019edf39-8f8b-7b93-a1f5-3694e01b2297`, spawned `loop_planner` and `loop_evaluator`, two wait completions, AgentRun finish evidence, and artifact producer evidence.
- Full rerun `019edf41-817e-7aa2-8a97-2f11b51911f2` progressed to `loop_planner`, `loop_dev_worker`, and baseline `loop_evaluator`; initial verdict was `NEEDS_REVISION`, and MCP cross-agent state was verified. It then failed at `repair_create_request` because the RepairRequest payload did not match M1 schema.
- After adding the RepairRequest schema guard, full rerun `019edf4f-3cd6-7533-bfbc-1e79a3146ff9` regressed to a single planner spawn with no completed wait before timeout.

Current conclusion: native custom subagent capability is available, but full native parent orchestration remains non-deterministic under `codex exec` and has not completed repair, final evaluator PASS, `npm test`, or FinalDeliveryReport in one real run.

Next minimal action: add a targeted repair-loop continuation probe from prepared valid baseline EvalReport plus schema-valid RepairRequest. If that passes but full native Gate 6 remains unstable, prepare SDK-Orchestrated Mode / Gate 6B rather than treating native Gate 6 as PASS.

Gate 6 tests whether a user can provide only `$codex-loop` plus a goal and have the plugin drive real native subagents through PRD, TaskGraph, Dev, Eval, Repair, and FinalReport. This report does not treat a single-thread roleplay run as a pass.

## Environment

- Codex version: codex-cli 0.142.0-alpha.1
- Plugin enable status: PASS
- Marketplace native skill: true
- Installed cache native skill: true
- Hooks trusted mode checked: false
- Target repo: `tmp/multi-agent/gate6-target-validate-project-name`
- Command exit code: timeout_after_720000ms

## Command

```text
codex 'exec' '-c' 'mcp_servers.codex_loop_store.command="node"' '-c' 'mcp_servers.codex_loop_store.args=["src/mcp/server.ts"]' '-c' 'mcp_servers.codex_loop_store.cwd="/Users/litmus/Downloads/codex-loop-plugin"' '-c' 'mcp_servers.codex_loop_store.env.CODEX_LOOP_STATE_DIR="/Users/litmus/Downloads/codex-loop-plugin/tmp/multi-agent/gate6-target-validate-project-name/state"' '--json' '--sandbox' 'workspace-write' '--output-schema' '/Users/litmus/Downloads/codex-loop-plugin/evals/multi-agent/schemas/gate6-result.schema.json' '-o' '/Users/litmus/Downloads/codex-loop-plugin/evals/multi-agent/reports/gate6-target-final-output.json' '-C' '/Users/litmus/Downloads/codex-loop-plugin/tmp/multi-agent/gate6-target-validate-project-name' '$codex-loop

目标：
在隔离测试 repo 中修复 validateProjectName(name)，要求空字符串、纯空格、超过 80 字符失败，合法名称通过。请自主完成 PRD、任务拆解、开发、评估、打回、修复、最终验收。
'
```

## Event Summary

- Parent thread ID: 019edf4f-3cd6-7533-bfbc-1e79a3146ff9
- Event count: 70
- Command executions: 23
- npm test seen: false
- File change events: 0
- MCP tool calls: 3
- Subagent lifecycle events: 1

## Native Agent Evidence

- Required agent runs present: false
- Missing required agents: loop_dev_worker, loop_evaluator
- Distinct thread IDs: thread_loop_planner_gate6_validate_project_name_20260619
- Planner artifact evidence: false
- Dev worker artifact evidence: false
- Evaluator artifact evidence: false
- Parent roleplay detected: false

## Artifact And Repair Loop

- Required artifacts present: false
- Missing artifacts: artifacts/dev-result.json, artifacts/eval-report-needs-revision.json, artifacts/repair-request.json, artifacts/eval-report-pass.json, artifacts/FinalDeliveryReport.md
- Tests passed: false
- Initial eval NEEDS_REVISION: false
- RepairRequest created: false
- Final eval PASS: false
- MCP cross-agent state verified: false
- Final report has agent refs: false

## Scoring

- P0 blockers: 10
- P1 issues: 9

### P0 Blockers

- No npm test command was observed in JSONL events.
- Missing required native agent runs: loop_dev_worker, loop_evaluator
- Fewer than 3 required native spawn_agent events were captured; observed 1.
- Missing required artifacts: artifacts/dev-result.json, artifacts/eval-report-needs-revision.json, artifacts/repair-request.json, artifacts/eval-report-pass.json, artifacts/FinalDeliveryReport.md
- Final npm test did not pass.
- src/project-name.js does not show a real validation repair.
- Initial EvalReport is not NEEDS_REVISION.
- Initial NEEDS_REVISION evidence has no persisted findings array.
- RepairRequest does not reference the initial EvalReport.
- Final EvalReport is not PASS.

### P1 Issues

- MCP/state Agent Evidence Ledger or artifact producer ledger is incomplete or absent.
- Planner artifacts are not backed by loop_planner MCP/state evidence.
- DevResult is not backed by loop_dev_worker MCP/state evidence.
- EvalReports are not backed by loop_evaluator MCP/state evidence.
- RepairRequest lacks agent_run evidence.
- state/events.json missing semantic events: prd_created, task_graph_created, eval_needs_revision, repair_requested, dev_repaired, validation_passed, eval_passed, final_report_created
- FinalDeliveryReport does not include agent_run_id/thread_id/artifact refs.
- MCP/state cross-agent evidence is incomplete.
- Hooks trusted mode was not checked; manual review/trust remains required.

## Target Final Output

```json
{
  "status": "BLOCKED_NATIVE_SUBAGENT_NO_OUTPUT",
  "real_thread_executed": true,
  "parent_thread_id": "",
  "agent_runs": [],
  "mcp_cross_agent_state_verified": false,
  "subagent_lifecycle_verified": false,
  "initial_eval_verdict": "",
  "repair_request_created": false,
  "final_eval_verdict": "",
  "tests_passed": false,
  "parent_roleplay_detected": false,
  "changed_files": [],
  "artifacts": [],
  "validation_commands": [],
  "p0_blockers": [
    "Gate 6 codex exec timed out while waiting for native subagent output."
  ],
  "p1_issues": [],
  "ready_for_M12_effectiveness_eval": false
}
```

## Setup Summary

```json
{
  "target_repo": "/Users/litmus/Downloads/codex-loop-plugin/tmp/multi-agent/gate6-target-validate-project-name",
  "git_init_exit_code": 0,
  "git_commit_exit_code": "not_run",
  "git_commit_warning": "Gate 6 intentionally does not run git add or git commit.",
  "initial_tests_failed": true,
  "initial_test_exit_code": 1,
  "initial_test_stdout_excerpt": "\n> gate6-target-validate-project-name@0.0.0 test\n> node --test\n\n✖ rejects empty string (0.502ms)\n✖ rejects whitespace-only string (0.070708ms)\n✖ rejects names longer than 80 characters (0.055834ms)\n✔ accepts valid project names (0.054083ms)\nℹ tests 4\nℹ suites 0\nℹ pass 1\nℹ fail 3\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 37.357417\n\n✖ failing tests:\n\ntest at test/project-name.test.js:5:1\n✖ rejects empty string (0.502ms)\n  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n  \n  true !== false\n  \n      at TestContext.<anonymous> (file:///Users/litmus/Downloads/codex-loop-plugin/tmp/multi-agent/gate6-target-validate-project-name/test/project-name.test.js:6:10)\n      at Test.runInAsyncScope (node:async_hooks:227:14)\n      at Test.run (node:internal/test_runner/test:1306:25)\n      at Test.start (node:internal/test_runner/test:1177:17)\n      at startSubtestAfterBootstrap (node:internal/test_runner/harness:385:17) {\n    generatedMessage: true,\n    code: 'ERR_ASSERTION',\n    actual: true,\n    expected: false,\n    operator: 'strictEqual',\n    diff: 'simple'\n  }\n\ntest at test/project-name.test.js:9:1\n✖ rejects whitespace-only string (0.070708ms)\n  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n  \n  true !== false\n  \n      at TestContext.<anonymous> (file:///Users/litmus/Downloads/codex-loop-plugin/tmp/multi-agent/gate6-target-validate-project-name/test/project-name.test.js:10:10)\n      at Test.runInAsyncScope (node:async_hooks:227:14)\n      at Test.run (node:internal/test_runner/test:1306:25)\n      at Test.processPendingSubtests (node:internal/test_runner/test:897:18)\n      at Test.postRun (node:internal/test_runner/test:1447:19)\n      at Test.run (node:internal/test_runner/test:1372:12)\n      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {\n    generatedMessage: true,\n    code: 'ERR_ASSERTION',\n    actual: true,\n    expected: false,\n    operator: 'strictEqual',\n    diff: 'simple'\n  }\n\ntest at test/",
  "initial_test_stderr_excerpt": ""
}
```

## Final Gate Result

```json
{
  "gate": "Gate 6 Real Native Multi-Agent Loop E2E",
  "status": "BLOCKED_NATIVE_SUBAGENTS_UNAVAILABLE",
  "bootstrap_completed": true,
  "custom_agents_materialized": [
    "loop_planner",
    "loop_dev_worker",
    "loop_evaluator",
    "loop_context_distiller",
    "loop_integration_manager"
  ],
  "native_subagent_mode_enabled": true,
  "real_thread_executed": true,
  "parent_thread_id": "019edf4f-3cd6-7533-bfbc-1e79a3146ff9",
  "agent_runs": [
    {
      "agent_name": "loop_planner",
      "agent_run_id": "agent_run_loop_planner_1781863223397_448fkpcli8l",
      "thread_id": "thread_loop_planner_gate6_validate_project_name_20260619",
      "artifacts": [
        "artifacts/*.json",
        "docs/ACCEPTANCE_CRITERIA.md",
        "docs/PRD.md",
        "docs/TASK_GRAPH.json",
        "src/project-name.js",
        "state/*.json",
        "test/project-name.test.js"
      ]
    }
  ],
  "mcp_cross_agent_state_verified": false,
  "subagent_lifecycle_verified": true,
  "initial_eval_verdict": "",
  "repair_request_created": false,
  "final_eval_verdict": "",
  "tests_passed": false,
  "parent_roleplay_detected": false,
  "p0_blockers": [
    "No npm test command was observed in JSONL events.",
    "Missing required native agent runs: loop_dev_worker, loop_evaluator",
    "Fewer than 3 required native spawn_agent events were captured; observed 1.",
    "Missing required artifacts: artifacts/dev-result.json, artifacts/eval-report-needs-revision.json, artifacts/repair-request.json, artifacts/eval-report-pass.json, artifacts/FinalDeliveryReport.md",
    "Final npm test did not pass.",
    "src/project-name.js does not show a real validation repair.",
    "Initial EvalReport is not NEEDS_REVISION.",
    "Initial NEEDS_REVISION evidence has no persisted findings array.",
    "RepairRequest does not reference the initial EvalReport.",
    "Final EvalReport is not PASS."
  ],
  "p1_issues": [
    "MCP/state Agent Evidence Ledger or artifact producer ledger is incomplete or absent.",
    "Planner artifacts are not backed by loop_planner MCP/state evidence.",
    "DevResult is not backed by loop_dev_worker MCP/state evidence.",
    "EvalReports are not backed by loop_evaluator MCP/state evidence.",
    "RepairRequest lacks agent_run evidence.",
    "state/events.json missing semantic events: prd_created, task_graph_created, eval_needs_revision, repair_requested, dev_repaired, validation_passed, eval_passed, final_report_created",
    "FinalDeliveryReport does not include agent_run_id/thread_id/artifact refs.",
    "MCP/state cross-agent evidence is incomplete.",
    "Hooks trusted mode was not checked; manual review/trust remains required."
  ],
  "ready_for_M12_effectiveness_eval": false
}
```

## Next Required Actions

- Strengthen the parent Loop Manager dispatch contract so it must spawn `loop_dev_worker` immediately after a `NEEDS_REVISION` RepairRequest exists.
- Require baseline evaluator output to persist an EvalReport artifact file with a non-empty `findings` array, not only state metadata.
- Require RepairRequest ownership evidence through `repair_request_write_by_agent` or equivalent Agent Evidence Ledger state.
- Keep the installed plugin cache synchronized with the repo skill before rerunning Gate 6.
- If a refreshed runtime still cannot produce required native subagent lifecycle and Agent Evidence Ledger records, keep Gate 6 blocked as `BLOCKED_NATIVE_SUBAGENTS_UNAVAILABLE`.
- Do not proceed to M12 until Gate 6 PASS evidence exists.
