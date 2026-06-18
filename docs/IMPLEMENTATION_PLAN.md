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

**Responsibility:** Create Codex skills for codex-loop, planner, developer, evaluator, and context distiller workflows.

**Acceptance:** Skill files validate and describe when to use each skill without implementing business logic.

**Done status:** Not started.

### M4: Custom Agent Definitions

**Responsibility:** Define Planner, Dev Worker, Evaluator, Context Distiller, Integration Manager, and reviewer agents.

**Acceptance:** Agent TOML files parse and enforce role boundaries, sandbox modes, and output contracts.

**Done status:** Not started.

### M5: Local Loop State Store

**Responsibility:** Create local file-based state persistence for runs, agents, tasks, events, artifacts, and statuses.

**Acceptance:** Local state read/write operations are validated with fixtures and do not require MCP.

**Done status:** Not started.

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
- [ ] M3 Loop Skills
- [ ] M4 Custom Agent Definitions
- [ ] M5 Local Loop State Store
- [ ] M6 MCP Loop Store
- [ ] M7 Orchestrator CLI
- [ ] M8 Hooks Integration
- [ ] M9 Demo Fixture and End-to-End Loop
- [ ] M10 Documentation and Release Polish

## Current Repository State

M0 has created a resumable scaffold. M1 has added the core data contract layer: JSON Schemas, matching TypeScript types, schema registry helpers, runtime validators, structured validation errors, fixtures, and tests. M2 has added the Codex plugin manifest, display assets, and local manifest validation.

No state store, MCP server, CLI, hook logic, or orchestration business logic has been implemented.

## Validation Strategy

M2 validation uses:

- `npm run typecheck`
- `npm test`
- `npm run validate`
- `npm run validate:manifest`

In the current shell, global `node` and `npm` are unavailable, so the same package scripts were executed with bundled Node and its directory prepended to `PATH`.

Future modules must add tests appropriate to their behavior, keep using the M1 schemas as shared contracts, and attach their plugin surfaces to the M2 manifest paths.

## Recovery Notes

Current module: M2 complete.

Completed modules: M0, M1, M2.

Open issues: official plugin validator currently rejects the reserved `hooks` field and requires `./.mcp.json` while M6 is not implemented.

Next exact action: Start M3 Loop Skills using `docs/MODULE_PROMPT_TEMPLATE.md`.

Validation status: local M2 validation passed using bundled Node to execute package scripts because global `node` and `npm` are not available in this shell.
