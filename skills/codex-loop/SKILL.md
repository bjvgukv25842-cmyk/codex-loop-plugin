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
