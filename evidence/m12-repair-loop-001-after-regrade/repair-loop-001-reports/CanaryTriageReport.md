# M12 repair-loop-001 Canary Triage

Baseline real run executed: false
Treatment real run executed: true
Secret leak confirmed: false
Secret leak false positive: false

## Missing Artifacts
Baseline: none
Treatment: none

## Grader Mapping Issues
- baseline legacy expected_artifacts included treatment artifacts; baseline_expected_artifacts now overrides this to empty.

## Recommended Fixes
- Run regrade-only compare/report/gate before rerunning the repair-loop canary.

All security excerpts in this report are redacted. Raw secrets, if any, must not be copied into reports.
