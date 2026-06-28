# Codex Loop Plugin Implementation Plan

## Project Goal

Build `codex-loop-plugin`, a loop-driven Codex plugin and skill system that turns a project goal into a modular multi-agent delivery loop.

The loop must preserve project memory in files, split work into modules, evaluate implementation evidence, repair failed work, and leave each module resumable without relying on prior chat history.

## User-Visible Outcome

A developer can copy or install this plugin into a Codex project and ask:

> Use Codex Loop to implement this feature until evaluator checks pass.

Codex will then:

1. Create or update a PRD.
2. Create acceptance criteria.
3. Create a task graph.
4. Dispatch bounded development tasks.
5. Evaluate results against evidence.
6. Repair failed work only.
7. Save state and artifacts.
8. Produce a final delivery report.

## Module Map

### M0: Project Memory & Scaffold

**Responsibility:** Establish source-of-truth documents, project memory, module plan, progress log, decisions log, base directories, package scripts, and TypeScript/test scaffolding.

**Acceptance:** Required files and placeholder directories exist; M0 docs explain goals, module order, and Loop rules; validation scripts pass or unavailable commands are recorded; no business logic exists.

**Done status:** Complete.

### M1: Core Schemas and Types

**Responsibility:** Define LoopRun, AgentProfile, TaskGraph, TaskNode, Artifact, EvalReport, RepairRequest, ContextCapsule, and ModuleProgress contracts.

**Acceptance:** JSON Schema draft 2020-12 files exist under `schemas/`; TypeScript types and runtime validation helpers exist under `src/core/`; valid and invalid fixtures exercise required fields and business rules; `npm run typecheck`, `npm test`, and `npm run validate` pass; no state store, MCP server, CLI, hooks, or business loop is implemented.

**Outputs:**

- `schemas/common.schema.json`
- `schemas/loop-run.schema.json`
- `schemas/agent-profile.schema.json`
- `schemas/task-node.schema.json`
- `schemas/task-graph.schema.json`
- `schemas/artifact.schema.json`
- `schemas/eval-report.schema.json`
- `schemas/repair-request.schema.json`
- `schemas/context-capsule.schema.json`
- `schemas/module-progress.schema.json`
- `src/core/types.ts`
- `src/core/schema-registry.ts`
- `src/core/validate.ts`
- `src/core/errors.ts`
- `src/core/index.ts`
- `tests/core/schema.test.ts`
- `tests/fixtures/valid/*.json`
- `tests/fixtures/invalid/*.json`

**Done status:** Complete.

### M2: Codex Plugin Manifest

**Responsibility:** Finalize `.codex-plugin/plugin.json` for the plugin package, add local display metadata and placeholder assets, and provide a manifest loader/validator for development.

**Acceptance:** Manifest contains the required `codex-loop` metadata and future `skills`, `mcpServers`, and `hooks` pointers; local manifest validation and tests pass; missing future companion files are reported as warnings; no skills, MCP server, hooks logic, or publication workflow is implemented.

**Outputs:**

- `.codex-plugin/plugin.json`
- `assets/icon.svg`
- `assets/logo.svg`
- `src/plugin/manifest.ts`
- `src/plugin/validate-manifest.ts`
- `tests/plugin/manifest.test.ts`

**Done status:** Complete.

### M3: Loop Skills

**Responsibility:** Create Codex skills for codex-loop, PRD planning, task decomposition, scoped development, read-only evaluation, context distillation, and integration management workflows.

**Acceptance:** Required skill files have valid frontmatter; descriptions contain specific trigger/use/do-not-use guidance; codex-loop defines all loop phases; evaluator is read-only; context-distiller outputs ContextCapsule; dev-worker enforces scope; local skill validation and tests pass; no custom agent TOML, state store, MCP server, hooks, or orchestrator is implemented.

**Outputs:**

- `skills/codex-loop/SKILL.md`
- `skills/codex-loop/references/loop-state-machine.md`
- `skills/codex-loop/references/output-contracts.md`
- `skills/prd-planner/SKILL.md`
- `skills/task-decomposer/SKILL.md`
- `skills/dev-worker/SKILL.md`
- `skills/evaluator/SKILL.md`
- `skills/context-distiller/SKILL.md`
- `skills/integration-manager/SKILL.md`
- `src/skills/validate-skills.ts`
- `tests/skills/skills.test.ts`

**Done status:** Complete.

### M4: Custom Agent Definitions

**Responsibility:** Define Planner, Dev Worker, Evaluator, Context Distiller, Integration Manager, and reviewer agents with explicit role contracts and sandbox boundaries.

**Acceptance:** Required agent TOML files exist; read-only agents use `read-only`; write-capable agents use `workspace-write`; planner, dev worker, evaluator, context distiller, and integration manager instructions include required output contracts; project agent concurrency config exists; local agent validation and tests pass; no Orchestrator, MCP server, hooks, state store, or business loop is implemented.

**Outputs:**

- `.codex/agents/planner.toml`
- `.codex/agents/dev-worker.toml`
- `.codex/agents/evaluator.toml`
- `.codex/agents/context-distiller.toml`
- `.codex/agents/integration-manager.toml`
- `.codex/agents/test-reviewer.toml`
- `.codex/agents/architecture-reviewer.toml`
- `.codex/config.toml`
- `src/agents/validate-agents.ts`
- `tests/agents/agents.test.ts`

**Done status:** Complete.

### M5: Local Loop State Store

**Responsibility:** Create local JSON file-based state persistence for runs, agents, tasks, artifacts, eval reports, context capsules, and events.

**Acceptance:** `LoopStore` interface exists; JSON store implements core CRUD; schema-backed writes use M1 runtime validation; writes use temp-file then rename; duplicate ids fail clearly; `CODEX_LOOP_STATE_DIR` can redirect state files; tests cover required store operations; no MCP server, CLI state machine, hooks, remote database, or real state data is implemented.

**Outputs:**

- `src/state/types.ts`
- `src/state/paths.ts`
- `src/state/json-file.ts`
- `src/state/store.ts`
- `src/state/json-store.ts`
- `src/state/index.ts`
- `tests/state/json-store.test.ts`
- `state/.gitkeep`

**Done status:** Complete.

### M6: MCP Loop Store

**Responsibility:** Expose M5 local loop state operations as state-only MCP tools over a local STDIO server.

**Acceptance:** `.mcp.json` configures the `codex_loop_store` server; MCP tool handlers call the M5 `LoopStore` instead of duplicating storage; tools cover LoopRun, AgentProfile, TaskNode, Artifact, EvalReport, RepairRequest, ContextCapsule, and EventLog operations; writes return `id`, `status`, and `event_id`; invalid payloads and missing objects return structured errors; local MCP tests, typecheck, and validate pass; no Orchestrator CLI, hooks, shell execution, network access, or source-code mutation is implemented.

**Outputs:**

- `.mcp.json`
- `src/mcp/server.ts`
- `src/mcp/tools.ts`
- `src/mcp/tool-schemas.ts`
- `src/mcp/tool-results.ts`
- `src/mcp/index.ts`
- `tests/mcp/tools.test.ts`
- M5 repair request store support required by the M6 repair tools.

**Done status:** Complete.

### M7: Orchestrator CLI

**Responsibility:** Add the local loop state machine, evaluation gate, repair dispatcher, context capsule command, report builder, runtime adapter boundary, and CLI commands for init, plan, run, status, eval, repair, capsule, and report.

**Acceptance:** State-machine legal transitions and illegal transitions are tested; EvaluationGate advances PASS reports and creates RepairRequest records for NEEDS_REVISION reports; CLI `loop init` creates a LoopRun and default agents; CLI `loop status` reads status, module, tasks, and recent events; CLI `loop run` advances one step only and returns RuntimeAdapter TODO when real Codex execution would be needed; CLI repair/capsule/report commands write their expected artifacts; typecheck, tests, and validate pass; no real Codex SDK call, hooks, network access, or infinite loop is implemented.

**Outputs:**

- `src/orchestrator/state-machine.ts`
- `src/orchestrator/controller.ts`
- `src/orchestrator/evaluation-gate.ts`
- `src/orchestrator/repair-dispatcher.ts`
- `src/orchestrator/context-manager.ts`
- `src/orchestrator/report-builder.ts`
- `src/orchestrator/runtime-adapter.ts`
- `src/orchestrator/index.ts`
- `src/cli/index.ts`
- `src/cli/commands/*.ts`
- `tests/orchestrator/state-machine.test.ts`
- `tests/orchestrator/evaluation-gate.test.ts`
- `tests/cli/cli.test.ts`

**Done status:** Complete.

### M8: Hooks Integration

**Responsibility:** Add lifecycle hooks for session context loading, validation command capture, context capsule generation before compaction, subagent output collection, and stop-time progress checks.

**Acceptance:** `hooks/hooks.json` configures SessionStart, PostToolUse, PreCompact, SubagentStop, and Stop handlers; hook scripts parse JSON input and return structured results; PostToolUse records validation events; PreCompact writes ContextCapsule drafts to state and artifacts; SubagentStop saves EvalReport-like output only when a verdict exists; Stop returns bounded continuation hints; hook tests, typecheck, and validate pass; hooks do not execute arbitrary shell, access the network, delete files, auto-fix code, commit git changes, or loop indefinitely.

**Outputs:**

- `hooks/hooks.json`
- `hooks/session_start.ts`
- `hooks/post_tool_use.ts`
- `hooks/pre_compact.ts`
- `hooks/subagent_stop.ts`
- `hooks/stop.ts`
- `src/hooks/input-types.ts`
- `src/hooks/hook-utils.ts`
- `tests/hooks/hooks-config.test.ts`
- `tests/hooks/post-tool-use.test.ts`
- `tests/hooks/pre-compact.test.ts`
- `tests/hooks/stop.test.ts`
- `docs/PLUGIN_BOUNDARIES.md`

**Done status:** Complete.

### M9: Demo Fixture and End-to-End Loop

**Responsibility:** Create a sample repo fixture and run a PRD to TaskGraph to DevResult to EvalReport NEEDS_REVISION to RepairRequest to EvalReport PASS to ContextCapsule to FinalReport proof loop.

**Acceptance:** `examples/demo-repo` contains PRD, acceptance criteria, TaskGraph, tiny `validateProjectName` implementation, tests, DevResult, NEEDS_REVISION EvalReport, RepairRequest, PASS EvalReport, ContextCapsule, and FinalDeliveryReport artifacts; e2e test validates schemas and drives EvaluationGate through repair and PASS states; typecheck, tests, and validate pass; no frontend framework, network access, real Codex thread, or M10 release polish is implemented.

**Outputs:**

- `examples/demo-repo/README.md`
- `examples/demo-repo/docs/PRD.md`
- `examples/demo-repo/docs/ACCEPTANCE_CRITERIA.md`
- `examples/demo-repo/docs/TASK_GRAPH.json`
- `examples/demo-repo/src/sample-feature.ts`
- `examples/demo-repo/tests/sample-feature.test.ts`
- `examples/demo-repo/artifacts/dev-result.json`
- `examples/demo-repo/artifacts/eval-report-needs-revision.json`
- `examples/demo-repo/artifacts/repair-request.json`
- `examples/demo-repo/artifacts/eval-report-pass.json`
- `examples/demo-repo/artifacts/context-capsule.json`
- `examples/demo-repo/artifacts/FinalDeliveryReport.md`
- `tests/e2e/demo-loop.test.ts`
- `docs/EXAMPLES.md`

**Done status:** Complete.

### M10: Documentation and Release Polish

**Responsibility:** Complete installation, usage, architecture, plugin boundaries, security model, MCP tools, hooks, agents, skills, examples, troubleshooting, release checklist, README, and final delivery report docs.

**Acceptance:** README and required docs explain what the plugin is, why the loop exists, how to install/use/configure/validate/demo it, what is implemented, what remains stubbed, and what the safety boundaries are; final report exists; typecheck, tests, validate, and build pass; no publication or real Codex SDK runtime integration is claimed.

**Outputs:**

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/INSTALLATION.md`
- `docs/USAGE.md`
- `docs/PLUGIN_BOUNDARIES.md`
- `docs/SECURITY_MODEL.md`
- `docs/MCP_TOOLS.md`
- `docs/HOOKS.md`
- `docs/AGENTS.md`
- `docs/SKILLS.md`
- `docs/EXAMPLES.md`
- `docs/TROUBLESHOOTING.md`
- `docs/RELEASE_CHECKLIST.md`
- `artifacts/FinalDeliveryReport.md`

**Done status:** Complete pending final validation.

## Progress

- [x] M0 Project Memory & Scaffold
- [x] M1 Core Schemas and Types
- [x] M2 Codex Plugin Manifest
- [x] M3 Loop Skills
- [x] M4 Custom Agent Definitions
- [x] M5 Local Loop State Store
- [x] M6 MCP Loop Store
- [x] M7 Orchestrator CLI
- [x] M8 Hooks Integration
- [x] M9 Demo Fixture and End-to-End Loop
- [x] M10 Documentation and Release Polish
- [ ] Gate 6 Real Native Multi-Agent Loop E2E

### Gate 6: Real Native Multi-Agent Loop E2E

**Responsibility:** Prove that `$codex-loop` can run as a parent Loop Manager and coordinate real native custom subagents instead of completing the loop by single-thread roleplay.

**Acceptance:** `codex exec --json` runs in an isolated target repo with `workspace-write`; reports capture parent `thread_id`, JSONL events, command executions, file changes, Agent Evidence Ledger records, MCP/state cross-agent evidence, `NEEDS_REVISION -> RepairRequest -> Dev Repair -> PASS`, passing `npm test`, and FinalDeliveryReport with `agent_run_id`/`thread_id`/artifact refs. If native subagent evidence is unavailable, the gate must return `BLOCKED_NATIVE_SUBAGENTS_UNAVAILABLE`.

**Outputs:**

- `evals/multi-agent/cases/gate6-native-loop.json`
- `evals/multi-agent/prompts/gate6-user-goal.md`
- `evals/multi-agent/schemas/gate6-result.schema.json`
- `scripts/multi-agent/run-gate6.ts`
- `scripts/multi-agent/parse-subagent-events.ts`
- `scripts/multi-agent/verify-agent-runs.ts`
- `scripts/multi-agent/verify-cross-agent-state.ts`
- `scripts/multi-agent/generate-gate6-report.ts`
- `docs/GATE6_NATIVE_MULTI_AGENT_VALIDATION.md`

**Done status:** In progress.

## Current Repository State

M0 has created a resumable scaffold. M1 has added the core data contract layer: JSON Schemas, matching TypeScript types, schema registry helpers, runtime validators, structured validation errors, fixtures, and tests. M2 has added the Codex plugin manifest, display assets, and local manifest validation. M3 has added reusable workflow skills and skill structure validation. M4 has added custom agent definitions, project agent concurrency config, and local agent validation. M5 has added the local JSON-backed LoopStore. M6 has exposed the LoopStore through state-only MCP tool handlers and a local STDIO MCP server. M7 has added a local state-machine CLI with evaluation, repair, context capsule, report, and runtime adapter stub boundaries. M8 has added lifecycle hook configuration, hook entry scripts, deterministic hook utilities, hook tests, and plugin trust-boundary docs. M9 has added a demo fixture and e2e proof that the core loop artifacts and state gates work together. M10 has added release-oriented docs and a final delivery report.

No real Codex runtime integration or plugin publication has been implemented.

### M12: Production Effectiveness Evaluation Harness

**Responsibility:** Compare plain Codex baseline runs with SDK-Orchestrated Codex Loop treatment runs through selected, evidence-gated M12 canaries.

**Current status:** M12.9G has frozen `test-coverage-002` selected canary PASS evidence after the approved dev-worker smoke sequence, one treatment-only fresh rerun, and a validation regrade fix. Baseline real PASS evidence was reused without rerun. Treatment real PASS evidence includes planner, dev worker, evaluator, validation, coverage contract, and FinalReport evidence. The regrade fix corrected a stale `npm test` FAIL mapping caused by parsing Node's `fail 0` summary as failure; compare/report/gate now pass for `test-coverage-002` while `production_ready` remains false.

**Safety boundary:** `production_ready` remains false. Full M12-mini real execution still requires explicit user approval and `CODEX_LOOP_ENABLE_M12_REAL_RUN=1`.

## Validation Strategy

M10 validation uses:

- `npm run typecheck`
- `npm test`
- `npm run validate`
- `npm run validate:manifest`
- `npm run validate:skills`
- `npm run validate:agents`

In the current shell, global `node` and `npm` are unavailable, so the same package scripts were executed with bundled Node and its directory prepended to `PATH`.

Future modules must add tests appropriate to their behavior, keep using the M1 schemas as shared contracts, attach their plugin surfaces to the M2 manifest paths, dispatch work according to the M3 skill contracts and M4 agent role boundaries, and use the M5 LoopStore/M6 MCP tools/M7 controller instead of ad hoc state files.

## Recovery Notes

Current module: M12.9G Test-Coverage-002 Validation Regrade Fix.

Completed modules: M0, M1, M2, M3, M4, M5, M6, M7, M8, M9, M10, Gate 6B.2 SDK-Orchestrated repair-loop proof, and selected M12 canaries through `test-coverage-002`.

Open issues: the next selected case, `adversarial-prompt-injection-001`, is blocked at static readiness because its fixture is not materialized and baseline/treatment runner support is missing. Full M12-mini real execution and production readiness remain unauthorized.

Next exact action: implement `adversarial-prompt-injection-001` fixture plus baseline and SDK-Orchestrated treatment runner support, then re-check static readiness before approving any real adversarial canary. Do not run the full dataset yet.

Validation status: M12.9G `npm run typecheck`, `npm test`, `npm run validate`, selected compare/report regrade-only, and selected gate all passed. `test-coverage-002` PASS evidence is frozen under `evidence/m12-test-coverage-002-canary-pass/`. No real M12 run was executed in M12.9G.
