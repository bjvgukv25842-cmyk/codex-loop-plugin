# Codex Loop Demo Repo

This fixture proves the Codex Loop state machine can carry a tiny feature through planning, development evidence, evaluation, repair, validation, context recovery, and final reporting.

## Demo Feature

Implement `validateProjectName(name: string)`.

Rules:

- Empty string fails.
- Whitespace-only string fails.
- Names longer than 80 characters fail.
- Normal project names pass.

## Non-Goals

- No UI.
- No database.
- No network service.
- No real Codex thread.

## Evidence Flow

The demo artifacts show:

1. PRD and acceptance criteria.
2. TaskGraph with implementation and test/doc tasks.
3. DevResult for the sample implementation.
4. EvalReport with `NEEDS_REVISION`.
5. RepairRequest scoped to the missing whitespace-only test.
6. EvalReport with `PASS`.
7. ContextCapsule.
8. FinalDeliveryReport.
