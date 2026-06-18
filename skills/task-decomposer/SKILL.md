---
name: task-decomposer
description: "Trigger with $task-decomposer, task graph, decompose PRD, split work, dependencies, or owner_agent_type assignment. Use after PRD and acceptance criteria exist to create docs/TASK_GRAPH.json. Do not use for coding, repair, evaluation, or long-term state storage."
---

# Task Decomposer Skill

## Purpose

Turn PRD and acceptance criteria into a schema-compatible TaskGraph.

## Inputs

- docs/PRD.md.
- docs/ACCEPTANCE_CRITERIA.md.
- docs/IMPLEMENTATION_PLAN.md.
- schemas/task-graph.schema.json and schemas/task-node.schema.json.

## Process

1. Read PRD and acceptance criteria.
2. Identify modules and tasks.
3. Assign `dependencies` so tasks can run safely.
4. Assign `owner_agent_type` using M1 AgentType values.
5. Add likely files, non-goals, acceptance criteria, validation commands, and risk level.
6. Write `docs/TASK_GRAPH.json`.
7. Validate shape against M1 schema when validation tooling exists.

## Dependency Rules

- Tasks that modify the same files should not run in parallel.
- Evaluation tasks depend on development tasks.
- Repair tasks depend on EvalReport findings.
- Integration tasks depend on evaluator PASS.

## Owner Assignment

- Planning tasks: `planner`.
- Development tasks: `dev_worker`.
- Evaluation tasks: `evaluator`.
- Test review tasks: `test_reviewer`.
- Architecture review tasks: `architecture_reviewer`.
- Context recovery tasks: `context_distiller`.
- Integration tasks: `integration_manager`.

## Validation Commands

Every task must include at least one validation command or a reason validation cannot run.

## Output

Write TaskGraph JSON conforming to `schemas/task-graph.schema.json`.

## Stop Conditions

Stop after `docs/TASK_GRAPH.json` is created or updated, or when PRD/acceptance criteria are insufficient.
