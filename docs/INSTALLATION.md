# Installation

## Local Development Install

Install dependencies:

```bash
npm install
```

Validate the local project:

```bash
npm run validate
```

Run the demo proof:

```bash
npm test -- tests/e2e/demo-loop.test.ts
```

## Codex Plugin Install Approach

This repository is structured as a Codex plugin package:

- `.codex-plugin/plugin.json` is the plugin manifest.
- `skills/` contains skill entrypoints.
- `.mcp.json` configures the local MCP server.
- `hooks/hooks.json` configures lifecycle hooks.
- `.codex/agents/` contains project custom agents.

Copy or install the repository into a Codex plugin location according to the active Codex plugin installation flow. This project does not claim to be published.

## MCP Configuration

The MCP config is [.mcp.json](/Users/litmus/Downloads/codex-loop-plugin/.mcp.json). It registers:

- server name: `codex_loop_store`
- command: `node`
- args: `src/mcp/server.ts`

The server is local STDIO only. It should run from the plugin root.

Verify the MCP server can start over stdio and perform state writes:

```bash
npm run real:verify-mcp
```

This command starts the configured MCP server with an isolated temporary `CODEX_LOOP_STATE_DIR`, lists tools, writes valid state, rejects an invalid EvalReport payload, and checks that write operations append events.

## Hooks Trust

Hooks are configured in [hooks/hooks.json](/Users/litmus/Downloads/codex-loop-plugin/hooks/hooks.json).

Review before trusting:

- `hooks/hooks.json`
- `hooks/session_start.ts`
- `hooks/post_tool_use.ts`
- `hooks/pre_compact.ts`
- `hooks/subagent_stop.ts`
- `hooks/stop.ts`

Plugin enablement and hook trust are separate. Do not trust hooks blindly in another repository.

## Common Install Failures

- `node` not found: install Node or use the bundled Codex runtime path recorded in `docs/LOOP_PROGRESS.md`.
- `npm install` fails: remove partial `node_modules` and retry; do not commit generated runtime state.
- MCP server fails: run `npm run real:verify-mcp`; confirm `.mcp.json` command and cwd point to the plugin root and that the local Node runtime can execute project `.ts` files.
- Hook scripts fail: confirm hooks are trusted, TypeScript files are included, and `node` can execute `.ts` in the current Codex runtime.
