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

**Responsibility:** Define LoopRun, Agent, Task, Artifact, EvalReport, RepairRequest, and ContextCapsule contracts.

**Acceptance:** Schemas/types exist, examples validate, and no runtime orchestration is implemented.

**Done status:** Not started.

### M2: Codex Plugin Manifest

**Responsibility:** Finalize `.codex-plugin/plugin.json` for the plugin package.

**Acceptance:** Manifest validates with the plugin validator and references only existing plugin surfaces.

**Done status:** Not started.

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
- [ ] M1 Core Schemas and Types
- [ ] M2 Codex Plugin Manifest
- [ ] M3 Loop Skills
- [ ] M4 Custom Agent Definitions
- [ ] M5 Local Loop State Store
- [ ] M6 MCP Loop Store
- [ ] M7 Orchestrator CLI
- [ ] M8 Hooks Integration
- [ ] M9 Demo Fixture and End-to-End Loop
- [ ] M10 Documentation and Release Polish

## Current Repository State

M0 has created a resumable scaffold. The repository has source-of-truth docs, Codex plugin metadata, project-level Codex agent config, skill scaffold, placeholder directories, `package.json`, and `tsconfig.json`.

No schema, MCP server, CLI, hook logic, or orchestration business logic has been implemented.

## Validation Strategy

M0 validation uses:

- `package.json` script validation when npm is available.
- Bundled Node fallback when npm is unavailable.
- JSON parsing for `package.json`, `tsconfig.json`, and `.codex-plugin/plugin.json`.
- TOML parsing for `.codex/config.toml` and `.codex/agents/*.toml`.
- Plugin manifest validation.
- No-business-logic scans for implementation directories.

Future modules must add tests appropriate to their behavior.

## Recovery Notes

Current module: M0 complete.

Completed modules: M0.

Open issues: none for M0.

Next exact action: Start M1 Core Schemas and Types using `docs/MODULE_PROMPT_TEMPLATE.md`.

Validation status: passed with bundled Node fallback because global npm is not available in this shell.
