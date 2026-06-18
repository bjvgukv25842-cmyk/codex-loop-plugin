---
name: codex-loop
description: Run a modular PRD to development to evaluation to repair loop for Codex plugin and software engineering projects. Use when the user asks Codex to implement a project progressively, coordinate agents, split work into modules, or continue until evaluator checks pass.
---

# Codex Loop Skill

## Purpose

Turn a user's project goal into a modular, evidence-checked delivery loop.

This skill must reduce one-off prompting. It should keep Codex working through a clear loop:

Goal → PRD → Task Graph → Module Implementation → Evaluation → Repair → Validation → Progress Recording → Next Module.

## Hard Rules

Do not implement the entire project at once.

Work one module at a time.

State must be written to project files. Chat history is not the source of truth.

Before every module, read:

- AGENTS.md
- .agent/PLANS.md
- docs/IMPLEMENTATION_PLAN.md
- docs/LOOP_PROGRESS.md
- docs/DECISIONS.md

After every module, update:

- docs/IMPLEMENTATION_PLAN.md
- docs/LOOP_PROGRESS.md
- docs/DECISIONS.md when decisions are made

## Loop Phases

### 1. Goal Normalization

Convert the user's request into:

- outcome
- constraints
- boundaries
- success criteria
- validation surface
- stop conditions

Ask questions only for blocking ambiguity.

### 2. PRD Generation

Create or update:

- docs/PRD.md
- docs/ACCEPTANCE_CRITERIA.md

The PRD must include:

- user goal
- non-goals
- user flows
- functional requirements
- non-functional requirements
- acceptance criteria
- risks

### 3. Task Graph Generation

Create or update:

- docs/TASK_GRAPH.json

Each task must include:

- task_id
- module_id
- owner_agent_type
- dependencies
- scope
- files likely affected
- acceptance criteria
- validation commands
- risk level

### 4. Module Implementation

For the current module:

1. Inspect relevant files.
2. Produce a short implementation contract.
3. Make the smallest useful changes.
4. Run validation.
5. Record results.
6. Stop if blocked.

### 5. Evaluation

Evaluation must be read-only.

Evaluator must output:

- PASS or NEEDS_REVISION
- findings
- file references
- evidence
- required fixes
- validation commands

### 6. Repair

If evaluation returns NEEDS_REVISION:

1. Create a repair request.
2. Repair only the listed findings.
3. Rerun validation.
4. Re-evaluate.

### 7. Context Recovery

If context becomes noisy, long, or unreliable:

1. Generate a Context Capsule.
2. Save it under artifacts/context-capsules/.
3. Continue from the capsule.

### 8. Stop Conditions

Stop when:

- current module passes validation
- evaluator returns PASS
- required user approval is needed
- environment is blocked
- maximum repair iterations reached
- next module requires confirmation

## Required Module Output

At the end of each module, return:

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
