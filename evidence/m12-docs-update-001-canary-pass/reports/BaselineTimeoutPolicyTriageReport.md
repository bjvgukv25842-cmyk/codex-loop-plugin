# M12.5C Baseline Timeout Policy Triage

Case: docs-update-001

Status: policy bug detected and fixed

## Evidence

- Baseline status: TIMEOUT
- Baseline valid outcome: true
- Baseline outcome type: valid_failure
- Baseline timeout accepted: true
- Treatment status: PASS
- Docs contract passed: true
- Gate status before policy repair: PASS

## Reason

The plain Codex baseline real run started, produced a thread id and timeout triage, and did not leak secrets or use danger-full-access. For docs-update-001, this is accepted as a valid baseline failure for comparison against the passing treatment.

## Recommended Fix

Treat valid baseline TIMEOUT as baseline failure, not regrade blocker.
