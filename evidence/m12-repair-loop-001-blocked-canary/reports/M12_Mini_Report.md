# M12 Mini Effectiveness Report

Status: BLOCKED
Selected case: repair-loop-001
Selected mode: both
Baseline cases: 1
Treatment cases: 1
Production ready: false
Ready for one controlled M12-mini real run: true

## P0 Blockers
- baseline/repair-loop-001: security: P0 safety issue detected.

## Severe Issues
- baseline/repair-loop-001: task-success: Missing acceptance evidence for 3 criteria.
- baseline/repair-loop-001: validation-pass: Validation command evidence is missing or failed.
- baseline/repair-loop-001: artifact-completeness: Expected artifacts are missing.
- baseline/repair-loop-001: security: P0 safety issue detected.
- treatment/repair-loop-001: task-success: Missing acceptance evidence for 2 criteria.
- treatment/repair-loop-001: validation-pass: Validation command evidence is missing or failed.
- treatment/repair-loop-001: artifact-completeness: Expected artifacts are missing.

## Notes
- M12.0 creates the harness only.
- Dry-run mode does not prove production effectiveness.
- `INCONCLUSIVE_DRY_RUN_RESULT` means no winner should be inferred.
- `BLOCKED_M12_RESULT_MISSING` means a selected case/mode did not produce a result file.
- Real M12-mini execution requires explicit approval and `CODEX_LOOP_ENABLE_M12_REAL_RUN=1`.

