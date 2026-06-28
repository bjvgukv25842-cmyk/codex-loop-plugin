# Feature Treatment Composite Triage

Module: M12.2I Feature Evaluator Exact + Treatment Fresh Composite Gate

Status: NEEDS_REVISION

## Summary

The evaluator exact smoke passed and the `feature-small-001` treatment-only fresh canary completed with real SDK-Orchestrated evidence. The treatment result itself is PASS with planner, dev worker, initial evaluator, repair dev worker, and final evaluator thread ids present.

The composite gate is not frozen as PASS because regrade/report evidence is not clean: compare and report return NEEDS_REVISION, and the release gate returns PASS while still listing a severe task-success issue.

## Exact Smoke Evidence

- Status: PASS
- Evaluator thread id: `019ef3bd-93be-7e02-bf96-ffb7636fc90c`
- Eval report created: true
- Eval verdict: PASS
- Evaluator-lite schema used: true
- Full EvalReport schema used as SDK output schema: false
- Artifact thread evidence verified: true
- Secret leak detected: false
- Danger full access used: false

## Treatment Fresh Evidence

- Treatment status: PASS
- Real run executed: true
- Planner thread id: `019ef3be-a98f-7971-80b4-9905b03d4029`
- Dev Worker thread id: `019ef3bf-21fa-7340-9cbd-f31080d81f09`
- Initial Evaluator thread id: `019ef3c0-7736-77f0-b250-cbfe245b8d2b`
- Repair Dev Worker thread id: `019ef3c0-f016-7862-9ff8-f08b98123bd2`
- Final Evaluator thread id: `019ef3c1-e1c9-7942-befb-51fda10bf8bb`
- Initial evaluator verdict: NEEDS_REVISION
- Final evaluator verdict: PASS
- RepairRequest created: true
- FinalDeliveryReport present: true
- Validation passed: true
- Current stage: FINAL_REPORT_DONE

## Regrade Blocker

Regrade currently reports:

- Compare status: NEEDS_REVISION
- Report status: NEEDS_REVISION
- Gate status: PASS
- P0 blockers: none
- Severe issue: `treatment/feature-small-001: task-success: Missing acceptance evidence for 1 criteria.`

The missing criterion reported by the task-success grader is:

- `Reject names longer than 80 characters.`

Static evidence shows the implementation and tests do cover this behavior:

- `src/project-name.js` rejects `name.length > 80`.
- `test/project-name.test.js` includes `validateProjectName("x".repeat(81)).ok === false`.
- `treatment-validation.log` records `validation_passed=true`.
- `artifacts/final-eval-report.json` records final evaluator verdict PASS.

This points to a regrade evidence extraction/report staleness gap, not a fresh treatment runtime failure.

## Superseded Historical Triage

`feature-canary-triage.json` and `FeatureCanaryTriageReport.md` still describe an older planner-timeout blocked canary and must not be treated as the current fresh-run result.

`M12_Mini_Report.md` also still mixes historical evaluator timeout and missing-artifact issues with the current PASS treatment result. The report generator should suppress stale stage blockers when current `treatment-result.json` has `status=PASS` and `current_stage=FINAL_REPORT_DONE`.

## Next Action

Patch the task-success grader or evidence extraction so the over-80-character criterion is recognized from the current source/test/diff/final evaluator evidence, then rerun compare/report/gate in regrade-only mode only. Do not rerun treatment or continue to another case without explicit approval.
