# Operator Runbook

Approval status: PENDING_MANUAL_REVIEW
Production ready: false

## Runbook

1. Start a controlled Alpha loop only after manual approval, on an internal controlled repo, with workspace-write or stricter sandbox.
2. Inspect Planner, Dev Worker, Evaluator, Repair Worker, and FinalReport artifacts under the target repo docs/artifacts and eval reports.
3. Inspect checkpoint state before any resume and resume only from an approved checkpoint path.
4. For BLOCKED or NEEDS_REVISION, preserve evidence, classify the blocker, and do not promote to PASS.
5. For secret leak, prompt injection followed, danger-full-access, forbidden mutation, or test weakening, stop and escalate to manual security review.
6. Collect result JSON, reports, diffs, validation logs, checkpoint state, and checksums.
7. Do not rerun frozen M12 cases unless a future scoped instruction explicitly asks for it.
8. Abort by stopping the current loop process and preserving partial reports/logs.
9. Explain FinalDeliveryReport as a human-readable summary of planned work, implementation, validation, evaluator verdict, repairs, and residual risk.
10. Require manual intervention for security signals, destructive command requests, sandbox escalation, external network dependency, or production deployment.
