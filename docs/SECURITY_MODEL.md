# Security Model

## Agent Sandboxes

- `planner`: read-only.
- `evaluator`: read-only.
- `context_distiller`: read-only.
- `test_reviewer`: read-only.
- `architecture_reviewer`: read-only.
- `dev_worker`: workspace-write.
- `integration_manager`: workspace-write.

`danger-full-access` should not be used as a default agent sandbox.

## Evaluator Rule

Evaluator agents are read-only. They inspect PRD, TaskGraph, diffs, artifacts, and validation evidence. They do not repair, mutate source files, or approve work without evidence.

## MCP Boundary

MCP tools are state-only. They:

- Read/write local loop state.
- Validate schema-backed payloads.
- Append events for writes.

They do not:

- Execute arbitrary shell.
- Access network services.
- Edit repository source files.
- Store secrets intentionally.

## Hooks Boundary

Hooks record lifecycle evidence and artifacts. They do not execute dangerous commands, auto-fix code, delete files, commit git changes, or loop indefinitely.

Hooks require user review/trust before execution.

## State Store Boundary

The state store is local JSON. Do not store secrets, API keys, credentials, tokens, or sensitive user data in state files or artifacts.

## Runtime Boundary

The current CLI uses `StubRuntimeAdapter`. It does not call a real Codex SDK runtime. A future runtime adapter must preserve the same safety boundaries and explicit user trust model.
