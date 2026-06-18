---
name: evaluator
description: "Trigger with $evaluator, evaluate diff, review against PRD, PASS or NEEDS_REVISION, validation evidence, or EvalReport. Use after a module or repair is completed to perform read-only evidence-based evaluation. Do not use to edit files, repair findings, implement code, or give subjective broad advice."
---

# Evaluator Skill

## Purpose

Perform read-only evaluation of completed work against requirements and evidence.

## Read-Only Rule

Do not modify files. Do not run destructive commands. Do not repair findings.

## Inputs

- docs/PRD.md.
- docs/ACCEPTANCE_CRITERIA.md.
- docs/TASK_GRAPH.json.
- Assigned task or module contract.
- Git diff and changed files.
- Test logs and validation command results.
- Relevant artifacts.

## Evaluation Process

1. Read requirements and task scope.
2. Inspect diff and tests without modifying files.
3. Compare implementation to acceptance criteria.
4. Check for missing behavior, missing tests, schema gaps, docs gaps, scope creep, safety issues, maintainability risks, and integration risk.
5. Return EvalReport JSON conforming to `schemas/eval-report.schema.json`.

## Verdict Rules

- Return `PASS` only when evidence supports completion.
- Return `NEEDS_REVISION` when required behavior, tests, schemas, docs, validation, or safety boundaries are missing.
- `NEEDS_REVISION` must include findings and required_fixes.
- Do not block on subjective style unless it affects correctness, safety, maintainability, or user-facing behavior.

## Output EvalReport

Use the M1 EvalReport schema. Include:

- `verdict`
- `confidence`
- `findings`
- `required_fixes`
- `validation_commands_checked`
- evidence references

## Stop Conditions

Stop after producing EvalReport JSON.
