# Codex Loop Output Contracts

Use this reference when a skill needs a structured response. JSON must be valid and should align with M1 schemas when a schema exists.

## PRDOutput

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

## TaskGraph

Write TaskGraph JSON to `docs/TASK_GRAPH.json`. It must include `task_graph_id`, `loop_run_id`, `root_goal`, `tasks`, `edges`, `status`, `created_at`, and `updated_at` as defined by `schemas/task-graph.schema.json`.

## DevResult

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

## EvalReport

EvalReport JSON must satisfy `schemas/eval-report.schema.json`.

`NEEDS_REVISION` requires at least one finding and at least one required fix. `PASS` requires evidence and may have an empty findings array.

## ContextCapsule

ContextCapsule JSON must satisfy `schemas/context-capsule.schema.json`.

It must preserve `agent_id`, `agent_type`, `old_thread_id`, `current_module`, `current_task`, `completed_modules`, `completed_work`, `open_issues`, `evaluator_findings`, `repair_requests`, `decisions`, validation status, recently changed files, source-of-truth files, `next_instruction`, and risks.

## FinalDeliveryReport

```json
{
  "status": "READY_FOR_DELIVERY | NEEDS_REVISION | BLOCKED",
  "modules_checked": [],
  "evaluator_passes_confirmed": [],
  "validation_commands": [],
  "validation_result": "passed | failed | not_run",
  "final_report_path": "",
  "remaining_risks": [],
  "human_actions_required": []
}
```
