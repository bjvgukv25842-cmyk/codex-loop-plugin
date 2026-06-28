# Gate 5 Real Codex Thread E2E Validation

Date: 2026-06-18

Status: PASS

This validation used a real `codex exec --json` child thread and captured real JSONL events. It was not a fixture replay, and it did not use the M7 `RuntimeAdapter` stub as evidence.

## Gate 6.2-Lite Native Dispatch Safety Update

Date: 2026-06-19

Gate 5 remains PASS for a single real Codex thread. Gate 6 native multi-agent orchestration remains non-PASS, but the classification is now more precise:

`NEEDS_REVISION_NATIVE_DISPATCH_CHAIN_UNSTABLE`

The native subagent capability probe passed, so the environment is not missing native subagent support outright. Full Gate 6 still cannot be treated as PASS because the dispatch chain has not reliably completed `loop_dev_worker` repair, final `loop_evaluator`, passing `npm test`, MCP cross-agent state, and FinalReport evidence in one real run.

Gate 6.2-Lite added a runtime budget guard and a repair-continuation-only probe harness:

- Single real `codex exec` budget: 180000 ms.
- No-event timeout: 60000 ms.
- Max real Codex exec runs: 1.
- Max retries: 0.
- Full Gate 6 run disabled by default.

The harness patch was validated with `npm run typecheck`, `npm test`, `npm run gate6:lite:prepare`, `npm run validate`, and `npm run gate6:lite:report`. No real Gate 6.2-Lite `codex exec` run was executed in this pass.

M12 remains blocked until a real native multi-agent evidence path passes.

## Gate 6.2.2 Codex Exec Startup Triage Update

Date: 2026-06-20

Gate 5 remains PASS for the historical single real Codex thread evidence captured on 2026-06-18. Current Gate 6.2.2 startup triage shows that the present constrained eval environment cannot start even a minimal read-only `codex exec --json` thread with isolated SQLite.

Minimal smoke result:

- `status`: FAIL
- `thread_started`: false
- `event_count`: 0
- `failure_category`: `SANDBOX_OR_PERMISSION_ERROR`
- stderr: `failed to initialize in-process app-server client: Operation not permitted`

Because the minimal smoke failed, the output-schema smoke was not run. This means current Gate 6.2-Lite failures are blocked before plugin, MCP, native subagent dispatch, repair continuation, or output schema handling.

Evidence:

- `evals/multi-agent/reports/gate6-2-lite-startup-triage.json`
- `evals/multi-agent/reports/Gate6_2_Lite_Startup_Triage_Report.md`
- `evals/multi-agent/reports/codex-exec-smoke-result.json`

M12 remains blocked.

## Gate 6B.0 SDK-Orchestrated Mode Update

Date: 2026-06-20

Gate 5 remains PASS for single-thread real Codex execution. Native multi-agent Gate 6 remains non-PASS.

The latest native host-run evidence shows partial native capability:

- real thread executed
- `loop_dev_worker` started
- code changed
- tests passed
- parent roleplay was not detected

The same host-run still did not prove the full loop:

- final evaluator did not spawn
- final EvalReport PASS was not created
- MCP cross-agent state did not verify
- the run ended with `NO_EVENT_TIMEOUT`

Project direction: Native Mode is now experimental/secondary. SDK-Orchestrated Mode is the primary production-path candidate, but Gate 6B.0 is only a skeleton and dry-run. No real SDK E2E was executed, and M12 remains blocked.

## Gate 6.1 Native Dispatch RCA Update

Date: 2026-06-19T10:54:06Z

Gate 5 remains PASS for a single real Codex thread. Gate 6 remains non-PASS for native multi-agent orchestration, so M12 must not start.

Latest Gate 6.1 evidence:

- Native dispatch probe PASS: parent thread `019edf39-8f8b-7b93-a1f5-3694e01b2297` spawned `loop_planner` and `loop_evaluator`, waited for both, and recorded AgentRun plus artifact producer evidence.
- Full Gate 6 rerun reached `loop_planner`, `loop_dev_worker`, and baseline `loop_evaluator` with MCP cross-agent state verified, then stopped because the parent submitted an invalid `RepairRequest` payload to `repair_create_request`.
- The RepairRequest schema guard has been repaired in skill/target instructions and tests.
- A later full Gate 6 rerun with refreshed cache regressed to one planner spawn and no completed wait before timeout.

Current Gate 6.1 result:

- `native_dispatch_probe_status`: PASS
- `gate6_rerun_status`: BLOCKED_NATIVE_SUBAGENTS_UNAVAILABLE
- `final_eval_verdict`: empty
- `tests_passed`: false
- `ready_for_M12_effectiveness_eval`: false

Next required action: run a narrower repair-loop continuation probe from a prepared valid `NEEDS_REVISION` EvalReport and schema-valid RepairRequest, or document/prepare SDK-Orchestrated Mode as Gate 6B. Do not treat the probe-only PASS as full Gate 6 PASS.

## Test Environment

| Item | Value |
| --- | --- |
| Host workspace | `/Users/litmus/Downloads/codex-loop-plugin` |
| Shell | `zsh` |
| Date/timezone | 2026-06-18, Asia/Shanghai |
| Filesystem mode | unrestricted local workspace |
| Target repo isolation | independent git repo under `tmp/real-thread/target-validate-project-name/` |
| Target sandbox | `workspace-write` for the main child thread |
| Resume smoke sandboxes | first `read-only`, then bounded `workspace-write` for capsule artifact only |

## Codex Version

`codex --version`:

```text
codex-cli 0.140.0-alpha.19
```

## Plugin Enable Status

Status: ENABLED

`codex plugin list --json` shows:

- `pluginId`: `codex-loop@codex-loop-proof`
- `name`: `codex-loop`
- `version`: `0.1.0`
- `installed`: `true`
- `enabled`: `true`
- `source.path`: `/Users/litmus/Downloads/codex-loop-plugin/tmp/plugin-marketplace/plugins/codex-loop`
- `marketplaceSource.source`: `/Users/litmus/Downloads/codex-loop-plugin/tmp/plugin-marketplace`

This proves the plugin is discoverable through a Codex marketplace path, installed, enabled, and not merely present as files in the repository.

## MCP Live Status

Status: PASS

Evidence file: `evals/real-thread/reports/gate5-mcp-live-check.json`

`npm run --silent real:verify-mcp` confirmed:

- `mcp_live_status`: `PASS`
- `tools_count`: `24`
- `missing_tools`: `[]`
- `shell_like_tool_names`: `[]`
- invalid EvalReport payload rejected: `true`
- valid EvalReport write succeeded: `true`
- write operations appended events: `true`
- structured `not_found` behavior observed: `true`

The real child thread itself made zero MCP tool calls. That is recorded as `mcp_tool_call_count = 0` and is not a Gate failure because Phase F only required recording it when absent.

## Hooks Trust Status

Hooks untrusted mode: PASS / degraded mode documented.

Hooks trusted mode: BLOCKED_MANUAL_REVIEW_REQUIRED.

No hook trust bypass was attempted. Live trusted hook execution still requires user review/trust in Codex. The Gate therefore records the boundary explicitly instead of pretending hooks ran with trust.

Follow-up gate: `docs/GATE5_2_HOOKS_TRUSTED_MODE.md`.

## Target Repo Path

`tmp/real-thread/target-validate-project-name/`

The target repo contains the intentionally broken starting implementation and the real child-thread outputs. The starting repo was initialized as required by Phase B with `git init`, `git add .`, and `git commit -m "initial broken target repo"`.

## Real Thread ID

`019edb1e-3a08-7101-85d0-f11a6680661f`

First JSONL event:

```json
{"type":"thread.started","thread_id":"019edb1e-3a08-7101-85d0-f11a6680661f"}
```

## Commands Run

Readiness and live checks:

```sh
codex --version
codex plugin list --json
npm run --silent real:verify-mcp
```

Target child thread:

```sh
codex exec --json --sandbox workspace-write --output-schema ../../../evals/real-thread/schemas/gate5-target-result.schema.json -o ../../../evals/real-thread/reports/gate5-target-final-output.json "$(cat ../../../evals/real-thread/prompts/gate5-target-thread-prompt.md)" > ../../../evals/real-thread/reports/gate5-target-events.jsonl 2> ../../../evals/real-thread/reports/gate5-target-stderr.log
```

Target validation:

```sh
cd tmp/real-thread/target-validate-project-name
npm test
```

Resume smoke:

```sh
codex exec --sandbox read-only resume --last ... --json
codex exec --sandbox workspace-write resume --last ... --json
```

Project validation after Phase J/K updates:

```sh
npm run typecheck
npm test
npm run validate
git diff --check
```

## Event Summary

Evidence file: `evals/real-thread/reports/gate5-event-summary.json`

| Field | Value |
| --- | --- |
| `thread_id` | `019edb1e-3a08-7101-85d0-f11a6680661f` |
| `event_count` | `136` |
| `turn_started_count` | `1` |
| `turn_completed_count` | `1` |
| `turn_failed_count` | `0` |
| `command_execution_count` | `72` |
| `npm_test_command_seen` | `true` |
| `file_change_event_count` | `18` |
| `mcp_tool_call_count` | `0` |
| `error_count` | `1` |

The one error event is the expected initial failing `npm test` against the deliberately broken implementation.

## Artifact Summary

Evidence file: `evals/real-thread/reports/gate5-artifact-check.json`

Required artifacts were present:

- `docs/PRD.md`
- `docs/ACCEPTANCE_CRITERIA.md`
- `docs/TASK_GRAPH.json`
- `artifacts/dev-result.json`
- `artifacts/eval-report-needs-revision.json`
- `artifacts/repair-request.json`
- `artifacts/eval-report-pass.json`
- `artifacts/FinalDeliveryReport.md`
- `state/events.json`

Changed files recorded by artifact check:

- `artifacts/FinalDeliveryReport.md`
- `artifacts/dev-result.json`
- `artifacts/eval-report-needs-revision.json`
- `artifacts/eval-report-pass.json`
- `artifacts/repair-request.json`
- `docs/ACCEPTANCE_CRITERIA.md`
- `docs/PRD.md`
- `docs/TASK_GRAPH.json`
- `src/project-name.js`
- `state/events.json`

Other artifact check results:

- required artifacts present: `true`
- tests passed: `true`
- forbidden changes: `[]`
- secret leak detected: `false`
- final report exists: `true`

## Repair Loop Summary

Evidence file: `evals/real-thread/reports/gate5-repair-loop-check.json`

| Check | Result |
| --- | --- |
| Initial eval was `NEEDS_REVISION` | `true` |
| Findings count | `1` |
| RepairRequest created | `true` |
| Final eval was `PASS` | `true` |
| Validation passed | `true` |
| Missing semantic events | `[]` |

Semantic events present:

- `loop_started`
- `prd_created`
- `task_graph_created`
- `eval_needs_revision`
- `repair_requested`
- `dev_repaired`
- `validation_passed`
- `eval_passed`
- `final_report_created`

## Resume / Context Capsule Summary

Evidence file: `evals/real-thread/reports/gate5-resume-check.json`

Status: PASS

- read-only resume exit code: `0`
- read-only write blocked: `true`
- workspace-write resume exit code: `0`
- context capsule exists: `true`
- required fields present: `true`
- modified `src` or tests: `false`
- capsule path: `artifacts/context-capsule-smoke.json`

The first resume proved thread continuation and read-only inspection. The second resume was bounded to create only the context capsule artifact and did not modify source or test files.

## Final Gate Result

PASS

Gate 5 satisfies Phase J:

- no P0 blockers
- zero counted P1 issues
- real `thread_id`
- JSONL event log
- real command executions
- real file changes
- `npm test` observed and final tests passed
- initial `NEEDS_REVISION`
- RepairRequest
- Dev Repair
- final `PASS`
- FinalDeliveryReport
- MCP live check
- explicit hooks trust status
- resume/context capsule smoke evidence

The scoring report exists in both locations:

- `evals/real-thread/reports/Gate5RealThreadE2EReport.md`
- `artifacts/real-thread/Gate5RealThreadE2EReport.md`

## Blockers

No blockers for Gate 5 PASS.

Known remaining project boundaries:

- Trusted hook execution still requires manual user review/trust in Codex.
- Real Codex SDK runtime dispatch is not implemented; M7 still intentionally uses a `RuntimeAdapter` stub.
- The plugin has not been published.
- Official plugin validator compatibility for the reserved `hooks` field remains a known risk outside the local validator.

## Next Required Actions

1. Human review of Gate 5 evidence and scoring report.
2. Decide whether to run final repository-wide validation immediately before any commit or PR.
3. If release is desired, prepare a release branch/PR without claiming published status.
4. If runtime automation is desired, scope a separate module for real Codex SDK runtime dispatch.
5. If hooks live execution must be proven, perform manual Codex hook review/trust and rerun hook-specific validation.
6. Do not treat Gate 5 as proof of native multi-agent orchestration. Gate 6.1 proved native spawn capability through a probe, but full Gate 6 remains `BLOCKED_NATIVE_SUBAGENTS_UNAVAILABLE` until `loop_dev_worker`, `loop_evaluator`, RepairRequest, repaired validation, final PASS, and cross-agent state evidence all complete in one real run.

## Historical Note

An earlier Gate 5 attempt against `tmp/real-thread/target-repo` was marked `NEEDS_REVISION` because its setup included an unrequested local target-repo commit. The current run is separate and follows the user's Phase B instruction to initialize and commit the isolated target repo fixture before launching the real child thread.
