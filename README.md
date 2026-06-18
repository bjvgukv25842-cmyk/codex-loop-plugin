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
|-- .codex-plugin/          # Codex plugin metadata
|-- artifacts/              # Future generated loop artifacts
|   |-- context-capsules/   # Future context recovery capsules
|   |-- eval-reports/       # Future evaluator outputs
|   `-- task-results/       # Future task execution outputs
|-- docs/                   # Implementation plan, progress, decisions, prompt templates
|-- hooks/                  # Future hook configs or scripts
|-- schemas/                # JSON Schema contracts shared by future modules
|-- skills/                 # Codex skills
|-- src/core/               # TypeScript types, schema registry, and validators
|-- state/                  # Future local loop state
|-- tests/                  # Schema tests and fixtures
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

M0 and M1 are complete. M2 is not started.

M1 provides core JSON Schemas, TypeScript types, runtime validation helpers, and schema fixtures/tests. No state store, MCP server, CLI, hook logic, or orchestration business logic has been implemented.

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

Plugin validation:

```bash
PYTHONPATH=/tmp/codex-loop-plugin-verify-py \
  /Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  /Users/litmus/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
```

## Continuing Work

Use [docs/MODULE_PROMPT_TEMPLATE.md](/Users/litmus/Downloads/codex-loop-plugin/docs/MODULE_PROMPT_TEMPLATE.md) for each future module. Work only on the current module, run validation, update docs, and stop before entering the next module.
