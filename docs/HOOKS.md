# Hooks

Hook config lives in [hooks/hooks.json](/Users/litmus/Downloads/codex-loop-plugin/hooks/hooks.json).

| Event | Matcher | Script | Purpose | Risk | Test |
| --- | --- | --- | --- | --- | --- |
| `SessionStart` | `*` | `hooks/session_start.ts` | Reads active LoopRun and emits concise session context | Could expose too much state if expanded; keep output short | `tests/hooks/hooks-config.test.ts` |
| `PostToolUse` | `Bash` | `hooks/post_tool_use.ts` | Records validation command pass/fail events for test/lint/typecheck/build/validate | Misclassification of commands; does not suppress original output | `tests/hooks/post-tool-use.test.ts` |
| `PreCompact` | `*` | `hooks/pre_compact.ts` | Writes ContextCapsule draft to state and artifacts before compaction | Capsule may omit nuance; requires source-of-truth files | `tests/hooks/pre-compact.test.ts` |
| `SubagentStop` | `*` | `hooks/subagent_stop.ts` | Captures subagent output and saves EvalReport-like JSON with verdict | Must not fabricate missing verdicts | `tests/hooks/stop.test.ts` |
| `Stop` | `*` | `hooks/stop.ts` | Checks progress doc and emits bounded continuation hints | Must not create infinite continuation | `tests/hooks/stop.test.ts` |

## How To Test

```bash
npm test -- tests/hooks/hooks-config.test.ts tests/hooks/post-tool-use.test.ts tests/hooks/pre-compact.test.ts tests/hooks/stop.test.ts
```

## Trust Rule

Hooks require user review/trust before execution. They do not auto-fix code, run arbitrary shell commands, delete files, access the network, or commit git changes.
