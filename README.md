# codex-loop-plugin

`codex-loop-plugin` is a loop-driven Codex plugin and skill system for turning a project goal into a modular multi-agent delivery loop.

## Problem Background

Long Codex projects can lose coherence when work relies on chat history alone. Context grows, threads compact, validation evidence gets scattered, and agents can drift from the original plan.

This project creates a file-backed workflow so future Codex threads can continue from durable project memory: plans, progress, decisions, schemas, state, artifacts, and tests.

## Core Loop

1. Normalize the user goal.
2. Create or update a PRD.
3. Create acceptance criteria.
4. Create a task graph.
5. Implement one bounded module.
6. Evaluate implementation evidence.
7. Repair only evaluator findings.
8. Record validation, progress, decisions, and artifacts.
9. Continue to the next module only when the current module is complete.

## Directory Structure

```text
.
|-- .agent/                 # ExecPlan standard and planning memory
|-- .codex/                 # Project-level Codex config and custom agents
|-- .codex-plugin/          # Codex plugin manifest metadata
|-- assets/                 # Local plugin icon and logo placeholders
|-- artifacts/              # Future generated loop artifacts
|   |-- context-capsules/   # Future context recovery capsules
|   |-- eval-reports/       # Future evaluator outputs
|   `-- task-results/       # Future task execution outputs
|-- docs/                   # Implementation plan, progress, decisions, prompt templates
|-- hooks/                  # Future hook configs or scripts
|-- schemas/                # JSON Schema contracts shared by future modules
|-- skills/                 # Codex workflow skills
|-- src/core/               # TypeScript types, schema registry, and validators
|-- src/plugin/             # Plugin manifest loader and local validator
|-- src/skills/             # Skill structure validator
|-- state/                  # Future local loop state
|-- tests/                  # Schema, plugin manifest, and skill tests
|-- package.json            # Minimal scripts and metadata
`-- tsconfig.json           # TypeScript scaffold config
```

## Module Roadmap

- M0 Project Memory & Scaffold
- M1 Core Schemas and Types
- M2 Codex Plugin Manifest
- M3 Loop Skills
- M4 Custom Agent Definitions
- M5 Local Loop State Store
- M6 MCP Loop Store
- M7 Orchestrator CLI
- M8 Hooks Integration
- M9 Demo Fixture and End-to-End Loop
- M10 Documentation and Release Polish

## Current Status

M0, M1, M2, and M3 are complete. M4 is not started.

M1 provides core JSON Schemas, TypeScript types, runtime validation helpers, and schema fixtures/tests. M2 provides `.codex-plugin/plugin.json`, local plugin display metadata, placeholder SVG assets, and a local manifest validator. M3 provides reusable Codex workflow skills. No custom agent TOML implementation, state store, MCP server, CLI, hook logic, or orchestration business logic has been implemented.

## Plugin Structure

The local plugin entrypoint is [.codex-plugin/plugin.json](/Users/litmus/Downloads/codex-loop-plugin/.codex-plugin/plugin.json). It declares:

- `skills: "./skills/"`
- `mcpServers: "./.mcp.json"`
- `hooks: "./hooks/hooks.json"`
- `interface.composerIcon: "./assets/icon.svg"`
- `interface.logo: "./assets/logo.svg"`

This repository is still in local development. M4 will formalize custom agent definitions, M6 will add the MCP server configuration and implementation, and M8 will add hooks configuration and lifecycle behavior.

Hooks are intentionally not executable yet. Future hook behavior must require user trust and explicit installation before it runs.

## Skills

Use these skill entrypoints in future Codex sessions:

- `$codex-loop`: coordinate the full PRD -> TaskGraph -> Dev -> Eval -> Repair -> Validation -> ContextCapsule -> Final Report loop.
- `$prd-planner`: create or update `docs/PRD.md` and `docs/ACCEPTANCE_CRITERIA.md`.
- `$task-decomposer`: turn PRD and acceptance criteria into schema-compatible `docs/TASK_GRAPH.json`.
- `$dev-worker`: implement exactly one scoped task, module, or repair request.
- `$evaluator`: perform read-only evaluation and return EvalReport JSON.
- `$context-distiller`: generate ContextCapsule JSON for thread restart or context recovery.
- `$integration-manager`: check evaluator-approved modules and produce final delivery reporting.

## How To Run

Preferred validation command when npm is available:

```bash
npm run validate
```

Current environment fallback when global `node` or `npm` is not available:

```bash
PATH=/Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
  /Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --run validate
```

Local manifest validation:

```bash
npm run validate:manifest
```

Local skill validation:

```bash
npm run validate:skills
```

Official plugin validator status:

```bash
PYTHONPATH=/tmp/codex-loop-plugin-verify-py \
  /Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  /Users/litmus/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
```

The official validator currently rejects the reserved `hooks` field and requires `./.mcp.json` when `mcpServers` is present. M2 keeps those pointers because later modules must attach to them, but treats missing future companion files as local warnings until M6 and M8.

## Continuing Work

Use [docs/MODULE_PROMPT_TEMPLATE.md](/Users/litmus/Downloads/codex-loop-plugin/docs/MODULE_PROMPT_TEMPLATE.md) for each future module. Work only on the current module, run validation, update docs, and stop before entering the next module.
