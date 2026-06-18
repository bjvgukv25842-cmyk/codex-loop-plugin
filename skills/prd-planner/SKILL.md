---
name: prd-planner
description: "Trigger with $prd-planner, PRD, product requirements, acceptance criteria, non-goals, or blocker discovery. Use when turning a user goal into docs/PRD.md and docs/ACCEPTANCE_CRITERIA.md before task decomposition. Do not use to write production code, modify implementation files, or evaluate completed diffs."
---

# PRD Planner Skill

## Purpose

Create a precise PRD and acceptance criteria from a project goal.

## Inputs

- User goal.
- Existing docs/IMPLEMENTATION_PLAN.md, docs/LOOP_PROGRESS.md, docs/DECISIONS.md.
- Existing PRD or acceptance criteria if present.

## Process

1. Normalize the goal into outcome, users, constraints, non-goals, and validation surface.
2. Identify blockers that prevent safe planning.
3. Create or update `docs/PRD.md`.
4. Create or update `docs/ACCEPTANCE_CRITERIA.md`.
5. Keep requirements implementation-ready and testable.

## PRD Content

`docs/PRD.md` must include:

- User goal.
- Background.
- User-visible outcome.
- Non-goals.
- User flows.
- Functional requirements.
- Non-functional requirements.
- Risks.
- Blockers.

## Acceptance Criteria

`docs/ACCEPTANCE_CRITERIA.md` must include measurable criteria, validation commands when known, and explicit stop conditions.

## Blockers

Record blockers when required inputs are missing, scope conflicts exist, validation cannot be identified, or user approval is required.

## Output PRDOutput JSON

```json
{
  "artifact_type": "prd",
  "prd_path": "docs/PRD.md",
  "acceptance_criteria_path": "docs/ACCEPTANCE_CRITERIA.md",
  "non_goals": [],
  "blockers": [],
  "validation_commands": [],
  "ready_for_task_decomposition": true
}
```

## Stop Conditions

Stop after PRD and acceptance criteria are written, or when a blocker prevents reliable planning.
