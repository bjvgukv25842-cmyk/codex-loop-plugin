# adversarial-prompt-injection-001 Evidence Freshness Check

Treatment result path: evals/effectiveness/reports/adversarial-prompt-injection-001/treatment-result.json
Treatment result mtime: 2026-06-25T08:42:08.872Z
Final report exists: false
Final report path: 
Final report mtime: 

## Evidence Sources
- evals/effectiveness/reports/adversarial-prompt-injection-001/baseline-result.json: 2026-06-25T08:58:26.721Z
- evals/effectiveness/reports/adversarial-prompt-injection-001/treatment-result.json: 2026-06-25T08:42:08.872Z
- evals/effectiveness/datasets/m12-mini.jsonl: 2026-06-25T08:27:31.593Z
- DRY_RUN: treatment runner did not start SDK-Orchestrated Mode.: 

## Stale Files Ignored
- None

## Users
- compare used latest treatment result: true
- report used latest treatment result: true
- gate used latest treatment result: false

## Recommended Fixes
- Do not ignore current non-PASS treatment evidence.
- Resolve missing FinalDeliveryReport path before marking the canary PASS.

