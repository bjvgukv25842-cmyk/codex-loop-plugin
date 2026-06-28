# Refactor Treatment Stage Triage

M12.6B reached a valid `refactor-small-001` baseline outcome, then stopped during the treatment stage.

## Baseline

- Executed: true
- Real run executed: true
- Status: PASS
- Validation passed: true
- Thread id present: true
- Secret leak detected: false
- Danger full access used: false

## Treatment

- Executed: true
- Runtime: SDK-Orchestrated
- Planner: PASS
- Dev worker: PASS
- Initial evaluator: NEEDS_REVISION
- Current stage: EVALUATOR_DONE
- Treatment result file: missing
- RepairRequest created: false
- FinalReport present: false

The treatment run crashed while creating the RepairRequest:

```text
ENOENT: no such file or directory, open '.../evals/effectiveness/runs/refactor-small-001/treatment/target-repo/artifacts/eval-report.json'
```

The evaluator stdout did contain a `NEEDS_REVISION` payload, but the target repo did not contain `artifacts/eval-report.json`. `createRefactorRepairRequest` read that missing artifact directly and the process exited before writing `treatment-result.json`.

## Required Fix

Persist evaluator `NEEDS_REVISION` output to `artifacts/eval-report.json`, or make the repair-request creation step derive a schema-valid RepairRequest from the captured evaluator output when the artifact is missing.

No treatment retry, gate run, evidence freeze, next-case readiness check, or full M12-mini run was executed after this failure.
