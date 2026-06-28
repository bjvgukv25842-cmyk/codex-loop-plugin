# test-coverage-002 Evidence Freshness Check

Treatment result path: evals/effectiveness/reports/test-coverage-002/treatment-result.json
Treatment result mtime: 2026-06-24T13:47:20.879Z
Final report exists: false
Final report path: 
Final report mtime: 

## Evidence Sources
- evals/effectiveness/reports/test-coverage-002/baseline-result.json: 2026-06-24T13:43:06.535Z
- evals/effectiveness/reports/test-coverage-002/treatment-result.json: 2026-06-24T13:47:20.879Z
- evals/effectiveness/datasets/m12-mini.jsonl: 2026-06-24T13:18:11.594Z
- /Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/reports/test-coverage-002/treatment-diff.patch: 2026-06-24T13:47:20.877Z
- /Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/reports/test-coverage-002/treatment-validation.log: 
- /Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/runs/test-coverage-002/treatment/target-repo/docs/PRD.md: 2026-06-24T13:44:20.763Z
- /Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/runs/test-coverage-002/treatment/target-repo/docs/TASK_GRAPH.json: 2026-06-24T13:44:20.763Z
- /Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/runs/test-coverage-002/treatment/target-repo/artifacts/planner-result.json: 2026-06-24T13:44:20.764Z

## Stale Files Ignored
- None

## Users
- compare used latest treatment result: true
- report used latest treatment result: true
- gate used latest treatment result: false

## Recommended Fixes
- Do not ignore current non-PASS treatment evidence.
- Resolve missing FinalDeliveryReport path before marking the canary PASS.

