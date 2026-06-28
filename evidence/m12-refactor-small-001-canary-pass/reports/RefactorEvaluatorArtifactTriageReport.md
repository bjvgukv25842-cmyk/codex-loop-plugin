# Refactor Evaluator Artifact Triage

- Case: refactor-small-001
- Treatment real run executed: true
- Planner thread id present: true
- Dev worker thread id present: true
- Initial evaluator thread id present: true
- Validation passed: true
- Evaluator output found: true
- Evaluator verdict detected: NEEDS_REVISION
- EvalReport artifact path: missing
- Direct PASS path applicable: false
- Repair path required: true
- Requires treatment rerun: true

## Recommendation

- Persist evaluator-lite output to artifacts/eval-report.json for generic refactor evaluator stages.
- Return a structured BLOCKED treatment result instead of throwing when evaluator artifact recovery fails.
- After dry validation, request approval for exactly one refactor-small-001 treatment-only fresh rerun; do not rerun baseline unless approved.
