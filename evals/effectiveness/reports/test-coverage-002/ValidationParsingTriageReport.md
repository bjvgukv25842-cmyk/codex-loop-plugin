# Test-Coverage-002 Validation Parsing Triage

Treatment status: PASS
Treatment validation_passed: true
Treatment coverage_contract_passed: true
Compare status before fix: NEEDS_REVISION

## Command Results
- npm test from treatment-result: FAIL
- npm test from log parser: PASS
- npm run coverage:contract from treatment-result: PASS
- npm run coverage:contract from log parser: PASS

## Mismatch
Mismatch detected: true
The previous parser treated the Node test summary line "fail 0" as a generic failure marker for the npm test command section. The command-specific parser now treats fail 0 as PASS and fail >0 as FAIL.

## Validation Logs
- /Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/reports/test-coverage-002/treatment-validation.log: 2026-06-25T07:19:49.087Z

## Recommended Fixes
- Prefer treatment-result.validation_command_results only when they are internally consistent with aggregate validation and current referenced logs.
- Parse multi-command validation logs by command section, not by scanning the full log for generic failure words.
- Do not let stale triage or timeout logs override the current treatment-result validation_log_paths evidence.
