# Gate 5 Real Thread Checklist

Status: NEEDS_REVISION

## Evidence Captured

- [x] Real `codex exec --json` run completed.
- [x] Thread ID captured: `019eda85-0f71-73e1-b8b7-29351709299a`.
- [x] JSONL event log captured at `artifacts/real-thread/codex-events.jsonl`.
- [x] JSONL includes `thread.started`.
- [x] JSONL includes command execution events.
- [x] JSONL includes file change events.
- [x] Target repo PRD exists.
- [x] Target repo TaskGraph exists.
- [x] Initial evaluator artifact reports `NEEDS_REVISION`.
- [x] RepairRequest exists.
- [x] Dev repair changed implementation and tests.
- [x] Target repo tests pass after repair.
- [x] Final evaluator artifact reports `PASS`.
- [x] FinalDeliveryReport exists.
- [x] State events reference artifact IDs and paths.
- [x] Child command scan found no `git commit`, `git push`, `rm -rf`, `danger-full-access`, or env file read commands.
- [x] Parent project validation passes with bundled npm after isolating the nested target test artifact from Vitest false failure.
- [ ] Full Gate run avoided all forbidden actions.

## Blocking Finding

The outer tester setup created a local git commit in `tmp/real-thread/target-repo`:

```text
2cb0a9e (HEAD -> main) Initial real thread target fixture
```

This violates the user's Gate 5 rule: `Do not git commit`.

## Post-Processing Note

After the child thread completed, `tmp/real-thread/target-repo/tests/project-name.test.js` was adjusted so it remains valid under `node --test` and also registers mirror tests when the parent project's Vitest runner recursively discovers it. This prevents the temporary target repo from breaking parent validation. It is outer-tester post-processing, not child-thread evidence.

## Required Rerun Condition

To convert this Gate to PASS, rerun in a fresh `tmp/real-thread/target-repo` without `git init`, `git add`, or `git commit`, or ask for explicit approval before using a local target-repo commit as setup.

## Useful Rerun Commands

Project validation fallback:

```sh
PATH=/Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
  /Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  /tmp/codex-loop-npm/package/bin/npm-cli.js run validate
```

Target repo validation:

```sh
cd /Users/litmus/Downloads/codex-loop-plugin/tmp/real-thread/target-repo
PATH="/Applications/Codex.app/Contents/Resources/cua_node/bin:$PATH" npm test
```
