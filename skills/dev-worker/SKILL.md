---
name: dev-worker
description: "Trigger with $dev-worker, implement this task, repair request, scoped module work, or run validation for one task. Use when a TaskNode or RepairRequest is assigned for code/docs changes. Do not use to plan future modules, evaluate your own work as read-only evaluator, or continue into the next module."
---

# Dev Worker Skill

## Purpose

Implement exactly one assigned module, TaskNode, or RepairRequest.

## Inputs

- Assigned task or repair request.
- PRD, acceptance criteria, TaskGraph, and decisions.
- Current repository files and validation commands.

## Scope Rules

- Read the task `scope`, `non_goals`, `likely_files`, and acceptance criteria before editing.
- Modify only files needed for the assigned scope.
- Repair only evaluator required_fixes.
- Do not enter the next module.
- Do not rewrite unrelated files for style.

## Process

1. Inspect source-of-truth files.
2. Restate the assigned scope and acceptance criteria.
3. Make the smallest useful changes.
4. Run narrow validation first, then broader validation.
5. Fix failures inside current scope.
6. Update required docs when the module contract says to.
7. Return DevResult JSON.

## Validation

Run available commands from the task. If unavailable, record the reason in docs/LOOP_PROGRESS.md.

## Output DevResult

```json
{
  "agent": "dev_worker",
  "module_id": "",
  "task_id": "",
  "status": "PASS | NEEDS_REVISION | BLOCKED",
  "changed_files": [],
  "implementation_summary": [],
  "validation_commands": [],
  "validation_result": "passed | failed | not_run",
  "remaining_risks": [],
  "ready_for_evaluation": true
}
```

## Stop Conditions

Stop when validation passes, validation fails outside scope, a blocker exists, or evaluator review is needed.
