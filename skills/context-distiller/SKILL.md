---
name: context-distiller
description: "Trigger with $context-distiller, context capsule, compact context, restart thread, context is long, noisy, unreliable, or agent performance degraded. Use to generate a factual ContextCapsule from source-of-truth files. Do not use to change requirements, edit source code, repair work, or invent missing facts."
---

# Context Distiller Skill

## Purpose

Create a factual ContextCapsule so work can restart without relying on old chat context.

## When To Generate A Capsule

- Context is long, noisy, compacted, or unreliable.
- Agent performance is degrading.
- A thread restart is needed while preserving agent identity.
- A repair or evaluation state must be carried forward.

## Sources To Read

- AGENTS.md
- .agent/PLANS.md
- docs/IMPLEMENTATION_PLAN.md
- docs/LOOP_PROGRESS.md
- docs/DECISIONS.md
- docs/TASK_GRAPH.json when present
- EvalReport and RepairRequest artifacts when present
- Git status and recent changed files when relevant

## Compression Rules

- Preserve facts, not verbose logs.
- Keep open issues and evaluator findings.
- Preserve repair requests and validation status.
- Preserve `agent_id`, `agent_type`, `old_thread_id`, `current_module`, `current_task`, and `next_instruction`.
- Do not invent completed work or decisions.
- Do not omit unresolved findings.

## Output ContextCapsule

Return JSON conforming to `schemas/context-capsule.schema.json`.

Required fields include:

- `agent_id`
- `agent_type`
- `old_thread_id`
- `current_module`
- `current_task`
- `completed_modules`
- `completed_work`
- `open_issues`
- `evaluator_findings`
- `repair_requests`
- `decisions`
- `validation_status`
- `files_changed_recently`
- `source_of_truth_files`
- `next_instruction`
- `risks`

## Stop Conditions

Stop after producing the capsule and exact next instruction.
