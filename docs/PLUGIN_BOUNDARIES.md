# Plugin Boundaries

This document records the trust and execution boundaries for `codex-loop-plugin`.

## Local Development Status

The plugin is still a local development package. It defines skills, custom agents, a local MCP state server, a CLI, and lifecycle hooks, but it does not publish or install itself automatically.

## Hooks Require Trust

`hooks/hooks.json` points Codex lifecycle events at local TypeScript scripts in `hooks/`.

Plugin enablement and hook trust are separate concerns. A user should review and explicitly trust hooks before allowing them to execute in a repository.

## M8 Hook Boundaries

M8 hooks may:

- Read loop state from `state/*.json`.
- Append bounded events to the local `LoopStore`.
- Write ContextCapsule drafts under `artifacts/context-capsules/`.
- Write EvalReport-like artifacts under `artifacts/eval-reports/` only when a verdict exists.
- Emit structured hook results and warnings.

M8 hooks must not:

- Execute arbitrary shell commands.
- Auto-fix source code.
- Access the network.
- Delete files.
- Commit or push git changes.
- Trigger infinite continuation loops.
- Fabricate evaluator verdicts.

## Review Checklist

Before trusting hooks in a project:

- Review `hooks/hooks.json`.
- Review `hooks/*.ts`.
- Confirm `CODEX_LOOP_STATE_DIR` points at the intended state directory when overriding defaults.
- Confirm generated artifacts are acceptable under `artifacts/`.
- Run `npm run validate`.

## Capability Boundaries

### Plugin

The plugin can declare metadata, skills, MCP config, hooks config, and display assets. It cannot by itself guarantee installation, publication, hook trust, or runtime execution in every Codex surface.

### Skills

Skills can guide Codex behavior and output contracts. They do not persist state unless an agent writes files or uses MCP/state tools.

### MCP

MCP tools can read and write local loop state. They cannot execute arbitrary shell commands, access the network, edit source code, or perform validation on behalf of tests.

### Hooks

Hooks can capture lifecycle events and write bounded artifacts. They cannot auto-repair code, commit git changes, delete files, or trigger infinite continuation.

### Orchestrator CLI

The CLI can initialize local loop state, advance the state machine one step, process eval reports, create repair requests, create capsule drafts, and write reports. It does not call a real Codex SDK runtime.

## Known Limits

- There is no real Codex SDK runtime auto-dispatch yet.
- Evaluator output is evidence review; it is not the same as running tests.
- Context Capsules summarize important state but cannot guarantee zero information loss.
- The M9 demo is a local fixture proof, not a real autonomous Codex thread.
