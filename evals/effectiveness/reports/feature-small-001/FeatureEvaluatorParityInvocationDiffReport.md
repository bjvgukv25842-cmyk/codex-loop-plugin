# Feature Evaluator Parity Invocation Diff

Status: NEEDS_REVISION
Failure category: EVALUATOR_PARITY_INVOCATION_DIFF_DETECTED
Compared invocations: feature-evaluator-parity, feature-planner-parity, dev-worker-parity-or-output-lite
Critical diffs: sqlite_home, sandboxMode, skipGitRepoCheck, promptLength, promptHash, sdkMethod, runStreamedUsage, outputSchemaUsage, outputSchemaHash, eventsPath

## Recommended Fixes
- Keep later evaluator smoke modes and treatment rerun blocked until evaluator parity is proven.
- Confirm the evaluator read-only sandbox matches the intended CLI parity command.
- Use CODEX_LOOP_EVALUATOR_PARITY_SDK_METHOD=run only as an explicitly approved diagnostic if CLI parity passes.
- Use the direct CLI parity prompt to determine whether prompt delivery or SDK event streaming is the blocker.

This report is generated from existing invocation traces only. It does not start SDK threads or Codex CLI.
