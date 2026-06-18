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

**Responsibility:** Expose loop state operations as MCP tools.

**Acceptance:** MCP tools read/write the same state contracts and pass local tool validation.

**Done status:** Not started.

### M7: Orchestrator CLI

**Responsibility:** Add CLI commands for init, run, status, eval, and repair.

**Acceptance:** CLI commands run against local fixtures and use existing state contracts.

**Done status:** Not started.

### M8: Hooks Integration

**Responsibility:** Add lifecycle hooks for progress capture, tool output capture, context capsule generation, and stop continuation.

**Acceptance:** Hook configuration is present and validated without unsafe side effects.

**Done status:** Not started.

### M9: Demo Fixture and End-to-End Loop

**Responsibility:** Create a sample repo or fixture and run a PRD to dev to eval to repair loop.

**Acceptance:** Demo evidence is written under artifacts and all validation commands are recorded.

**Done status:** Not started.

### M10: Documentation and Release Polish

**Responsibility:** Complete installation, usage, architecture, troubleshooting, and release docs.

**Acceptance:** README and docs are sufficient for a new Codex thread or developer to install, run, validate, and troubleshoot the plugin.

**Done status:** Not started.

## Progress

- [x] M0 Project Memory & Scaffold
- [x] M1 Core Schemas and Types
- [x] M2 Codex Plugin Manifest
- [x] M3 Loop Skills
- [x] M4 Custom Agent Definitions
- [x] M5 Local Loop State Store
- [ ] M6 MCP Loop Store
- [ ] M7 Orchestrator CLI
- [ ] M8 Hooks Integration
- [ ] M9 Demo Fixture and End-to-End Loop
- [ ] M10 Documentation and Release Polish

## Current Repository State

M0 has created a resumable scaffold. M1 has added the core data contract layer: JSON Schemas, matching TypeScript types, schema registry helpers, runtime validators, structured validation errors, fixtures, and tests. M2 has added the Codex plugin manifest, display assets, and local manifest validation. M3 has added reusable workflow skills and skill structure validation. M4 has added custom agent definitions, project agent concurrency config, and local agent validation. M5 has added the local JSON-backed LoopStore.

No MCP server, CLI, hook logic, or orchestration business logic has been implemented.

## Validation Strategy

M5 validation uses:

- `npm run typecheck`
- `npm test`
- `npm run validate`
- `npm run validate:manifest`
- `npm run validate:skills`
- `npm run validate:agents`

In the current shell, global `node` and `npm` are unavailable, so the same package scripts were executed with bundled Node and its directory prepended to `PATH`.

Future modules must add tests appropriate to their behavior, keep using the M1 schemas as shared contracts, attach their plugin surfaces to the M2 manifest paths, dispatch work according to the M3 skill contracts and M4 agent role boundaries, and use the M5 LoopStore instead of ad hoc state files.

## Recovery Notes

Current module: M5 complete.

Completed modules: M0, M1, M2, M3, M4, M5.

Open issues: official plugin validator currently rejects the reserved `hooks` field and requires `./.mcp.json` while M6 is not implemented.

Next exact action: Start M6 MCP Loop Store using `docs/MODULE_PROMPT_TEMPLATE.md`.

Validation status: local M5 validation passed using bundled Node to execute package scripts because global `node` and `npm` are not available in this shell.
