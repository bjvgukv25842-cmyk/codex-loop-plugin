# Test-Coverage-002 Treatment Stage Triage

M12.9B reached a valid `test-coverage-002` baseline outcome, then stopped during the treatment stage.

## Baseline

- Executed: true
- Real run executed: true
- Status: PASS
- Validation passed: true
- Coverage contract passed: true
- Thread id present: true
- Secret leak detected: false
- Danger full access used: false

## Treatment

- Executed: true
- Runtime: SDK-Orchestrated
- Status: BLOCKED
- Planner: PASS
- Planner output contract version: v2
- Dev worker: TIMEOUT
- Initial evaluator thread id present: false
- RepairRequest created: false
- FinalReport present: false
- Changed files observed: `test/cache.test.js`

The treatment run exceeded the SDK thread timeout before DevResult, evaluator, validation, or FinalDeliveryReport evidence could be completed:

```text
SDK thread exceeded timeout_ms=180000.
```

The checkpoint state shows planner evidence completed and the dev worker thread started before timing out. The selected release gate currently reports `FEATURE_TREATMENT_PLANNER_TIMEOUT`; this appears to be a failure-category mapping issue because planner evidence is present and the failed stage is the dev worker.

## Regrade

- Compare status: NEEDS_REVISION
- Report status: NEEDS_REVISION
- Gate status: BLOCKED
- Gate P0 blockers:
  - `treatment/test-coverage-002: partial treatment failed with FEATURE_TREATMENT_PLANNER_TIMEOUT`
  - `treatment/test-coverage-002: planner stage blocker FEATURE_TREATMENT_PLANNER_TIMEOUT using v2`

## Required Fix

Review the generic test-coverage treatment dev worker timeout and the release-gate failure-category mapping. After a code or prompt fix is approved and dry validation passes, run exactly one `test-coverage-002` treatment-only fresh rerun. Do not rerun baseline unless explicitly approved.

No treatment retry, evidence freeze, next-case readiness check, other M12 case, or full M12-mini run was executed after this failure.
