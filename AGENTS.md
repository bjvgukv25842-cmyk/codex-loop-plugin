# AGENTS.md

## Project Identity

This repository implements `codex-loop-plugin`, a loop-driven multi-agent workflow plugin for Codex.

The goal is to turn a user's project goal into a modular PRD → Task Graph → Development → Evaluation → Repair → Validation loop.

## Working Mode

Work incrementally by modules.

Do not implement the whole project in one pass.

The canonical module order is:

1. M0 Project scaffold and engineering rules
2. M1 Core schemas and types
3. M2 Codex plugin manifest
4. M3 Loop skills
5. M4 Custom agent definitions
6. M5 Local loop state store
7. M6 MCP loop store
8. M7 Orchestrator CLI
9. M8 Hooks integration
10. M9 Demo fixture and end-to-end loop
11. M10 Documentation and release polish

## Source of Truth

Do not rely on chat history as the only source of truth.

The source of truth is:

- docs/IMPLEMENTATION_PLAN.md
- docs/LOOP_PROGRESS.md
- docs/DECISIONS.md
- schemas/
- state/
- artifacts/
- tests/

After every module, update the relevant source-of-truth files.

## Module Completion Contract

Before implementing a module, state:

- module id
- goal
- files to inspect
- files likely to change
- validation commands
- risks

After implementing a module, report:

- changed files
- behavior added
- validation commands run
- validation result
- remaining risks
- next module

## Implementation Rules

Prefer small, reversible patches.

Use existing project patterns once they exist.

Do not introduce new dependencies unless necessary.

When adding dependencies, explain:

- why it is needed
- why standard library or existing dependencies are insufficient
- whether it is runtime or dev-only

## Testing Rules

When code changes are made, run the narrowest useful validation first.

Then run broader validation if available.

Preferred validation order:

1. typecheck
2. unit tests
3. lint
4. build
5. e2e or fixture test

If validation cannot run, record why in docs/LOOP_PROGRESS.md.

## Multi-Agent Rules

Use subagents only for bounded work.

Prefer subagents for:

- codebase exploration
- test gap analysis
- security review
- maintainability review
- documentation review
- context distillation

Be careful with parallel write-heavy work. Do not let multiple agents edit the same files at the same time.

## Evaluation Rules

Evaluator agents are read-only.

An evaluation must include:

- PASS or NEEDS_REVISION
- findings
- file references
- evidence
- required fixes
- validation commands

A module cannot be considered complete until evaluator findings are resolved or explicitly deferred with a reason.

## Repair Rules

Repair only the evaluator findings.

Do not expand scope during repair.

After repair, rerun the relevant validation commands.

## Context Recovery Rules

If context becomes long, noisy, or unreliable:

1. Generate a Context Capsule.
2. Record current module, completed work, open issues, decisions, commands run, and next instruction.
3. Continue from the capsule, not from memory alone.

## Documentation Rules

Keep these files updated:

- docs/IMPLEMENTATION_PLAN.md
- docs/LOOP_PROGRESS.md
- docs/DECISIONS.md
- README.md

Every module must leave the repository in a resumable state.
