# Codex Local State Troubleshooting

## Purpose

Gate 6 native validation uses real `codex exec`. The Codex CLI may need a writable SQLite-backed runtime state directory before it can emit JSONL events such as `thread.started`.

Gate 6.2-Lite previously failed before native dispatch because Codex attempted to write `/Users/litmus/.codex/state_5.sqlite`, which was readonly in the current sandbox.

## Safe Diagnostic

Run:

```bash
npm run codex:state:diagnose
```

The diagnostic is read-only. It may inspect `codex --version`, `codex doctor` availability, path existence, and writability, but it must not run `chmod`, `chown`, `rm`, `mv`, SQLite repair, or write to `~/.codex`.

## Isolated Eval SQLite Home

Gate 6.2-Lite now uses:

```text
.codex-eval/sqlite/
```

The real `codex exec` child process receives:

```text
CODEX_SQLITE_HOME=<repo>/.codex-eval/sqlite
-c sqlite_home="<repo>/.codex-eval/sqlite"
```

This isolates eval runtime state from the user's global `~/.codex/state_5.sqlite` while preserving normal `CODEX_HOME` auth/config/plugin behavior.

## Advanced Mode

If needed, set:

```bash
CODEX_LOOP_EVAL_CODEX_HOME=/absolute/existing/directory
```

This directory must already exist. The harness does not copy secrets, auth, tokens, or plugin credentials into it.

## Failure Classification

If stderr contains:

```text
attempt to write a readonly database
```

Gate 6.2-Lite classifies the run as:

```text
CODEX_LOCAL_STATE_DB_READONLY
```

If no JSONL event exists and stderr is empty, only then use:

```text
NO_JSONL_EVENT
```

## Gate 6.2.2 Startup Triage Result

Date: 2026-06-20

The isolated SQLite home removed the previous readonly database failure, but a minimal read-only `codex exec --json` smoke still failed before `thread.started`.

Smoke command characteristics:

- `--json`
- `--sandbox read-only`
- `CODEX_SQLITE_HOME=<repo>/.codex-eval/sqlite`
- `-c sqlite_home="<repo>/.codex-eval/sqlite"`
- no output schema
- no plugin workflow
- no MCP override
- no file writes

Observed stderr:

```text
WARNING: proceeding, even though we could not create PATH aliases: Operation not permitted (os error 1)
Reading additional input from stdin...
Error: failed to initialize in-process app-server client: Operation not permitted (os error 1)
```

The startup triage classifies this as:

```text
SANDBOX_OR_PERMISSION_ERROR
```

Because the minimal smoke failed, output-schema handling was not tested. Do not rerun Gate 6.2-Lite until the minimal read-only smoke can emit a `thread.started` JSONL event.

## Safety Boundary

Do not fix this by using `danger-full-access`, bypassing hook trust, deleting `~/.codex/state_5.sqlite`, or changing ownership/permissions of the user's global Codex directory from this harness.
