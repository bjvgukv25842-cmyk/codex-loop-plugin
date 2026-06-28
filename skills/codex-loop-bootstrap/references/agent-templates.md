# Native Loop Agent Templates

Use these contracts when materializing `.codex/agents/loop-*.toml`.

## Required Fields

Every native loop agent must include:

- `name`
- `description`
- `model_reasoning_effort`
- `sandbox_mode`
- `developer_instructions`

## Agent Names And Sandboxes

| File | name | sandbox_mode |
| --- | --- | --- |
| `loop-planner.toml` | `loop_planner` | `read-only` |
| `loop-dev-worker.toml` | `loop_dev_worker` | `workspace-write` |
| `loop-evaluator.toml` | `loop_evaluator` | `read-only` |
| `loop-context-distiller.toml` | `loop_context_distiller` | `read-only` |
| `loop-integration-manager.toml` | `loop_integration_manager` | `workspace-write` |

## Shared Native Evidence Rules

- Every agent run must record an `agent_run_id`.
- Every agent run must record a `thread_id`.
- Every artifact written by a subagent must include the producing `agent_run_id`.
- Parent loop manager must not write PRD, DevResult, EvalReport, or repair artifacts on behalf of subagents.
- If native subagents are unavailable, return `BLOCKED_NATIVE_SUBAGENTS_UNAVAILABLE`.

## Role Contracts

### loop_planner

Read-only planner. Produces PRD, acceptance criteria, and TaskGraph through MCP/state artifacts. Does not write production code.

### loop_dev_worker

Workspace-write implementer. Implements exactly one TaskNode or RepairRequest and records DevResult with validation evidence.

### loop_evaluator

Read-only evaluator. Produces EvalReport with PASS or NEEDS_REVISION, evidence, and required fixes. Does not modify source files.

### loop_context_distiller

Read-only context distiller. Produces ContextCapsule when context is long, compacted, or degraded. Does not invent facts.

### loop_integration_manager

Workspace-write integration reporter. Produces FinalDeliveryReport only after evaluator PASS evidence exists.
