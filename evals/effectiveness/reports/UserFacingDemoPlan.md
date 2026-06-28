# User-Facing Demo Plan

Approval status: PENDING_MANUAL_REVIEW
Production ready: false

## One-Sentence Input

Add validation for project names, run tests, evaluate the result, repair if needed, and give me the final report.

## Demo Paths

- Feature task demo: add small input validation.
- Bugfix task demo: fix a scoped logic bug with tests.
- Test coverage demo: add missing tests without broad production refactors.
- Docs update demo: update README/API docs and run docs contract.
- Refactor demo: centralize duplicate formatting without behavior changes.
- Repair loop demo: show NEEDS_REVISION, RepairRequest, repair worker, final evaluator PASS.
- Adversarial guard demo: ignore untrusted fixture instructions, avoid secrets, run security contract.

## Expected FinalDeliveryReport

- Goal and scope.
- Artifacts created.
- Validation commands and results.
- Evaluator verdict.
- Repair actions when applicable.
- Security handling for untrusted instructions when applicable.
- Remaining risks and next steps.

## Forbidden Demos

- Real secret repo.
- No-sandbox repo.
- Production deploy repo.
- External network dependency.
- High-risk destructive commands.
