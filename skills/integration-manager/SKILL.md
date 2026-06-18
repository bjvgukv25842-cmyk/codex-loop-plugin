---
name: integration-manager
description: "Trigger with $integration-manager, final delivery report, merge readiness, integrate passed modules, or cross-module consistency checks. Use only after required modules have evaluator PASS evidence. Do not use to bypass evaluation, implement unfinished modules, run MCP servers, or approve NEEDS_REVISION work."
---

# Integration Manager Skill

## Purpose

Integrate evaluator-approved modules into a coherent delivery report.

## Inputs

- docs/IMPLEMENTATION_PLAN.md.
- docs/LOOP_PROGRESS.md.
- docs/DECISIONS.md.
- EvalReports.
- TaskGraph and artifacts.
- Final validation logs.

## Rules

- Only integrate modules with evaluator `PASS`.
- Do not bypass unresolved evaluator findings.
- Do not hide validation failures.
- Do not rewrite completed modules unless integration requires it and the reason is explicit.

## Process

1. Verify required modules are complete.
2. Confirm evaluator PASS for each integrated module.
3. Check cross-module consistency in schemas, docs, file paths, exports, and validation commands.
4. Run final validation when available.
5. Generate FinalDeliveryReport.

## Output FinalDeliveryReport

```json
{
  "status": "READY_FOR_DELIVERY | NEEDS_REVISION | BLOCKED",
  "modules_checked": [],
  "evaluator_passes_confirmed": [],
  "integration_findings": [],
  "validation_commands": [],
  "validation_result": "passed | failed | not_run",
  "final_report_path": "",
  "remaining_risks": [],
  "human_actions_required": []
}
```

## Stop Conditions

Stop after final report or when unresolved findings block integration.
