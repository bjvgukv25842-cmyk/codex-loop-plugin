# Loop Progress

This file is the durable progress log for Codex Loop work. It must be updated after every module.

## Current Module

M4: Custom Agent Definitions

## Completed Modules

- M0 Project Memory & Scaffold
- M1 Core Schemas and Runtime Types
- M2 Plugin Manifest and Plugin Metadata
- M3 Loop Skills
- M4 Custom Agent Definitions

## Current Status

M4 is complete. M5 is not started.

The project now has source-of-truth documents, plugin metadata, a core data contract layer, local plugin manifest validation, reusable workflow skills, custom agent role definitions, and local agent config validation.

M4 added:

- Planner, Dev Worker, Evaluator, Context Distiller, Integration Manager, Test Reviewer, and Architecture Reviewer agent TOML definitions under `.codex/agents/`.
- `.codex/config.toml` with `[agents] max_threads = 6` and `max_depth = 1`.
- `src/agents/validate-agents.ts` for local agent field, sandbox, role contract, and config validation.
- `tests/agents/agents.test.ts` for required agent coverage.
- `npm run validate:agents` and inclusion in `npm run validate`.

No state store, MCP server, CLI, hook logic, or orchestration business loop has been implemented.

## Recent Validation Result

Status: Passed with bundled Node PATH fallback.

Commands:

- `PATH=/Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH /Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /tmp/codex-loop-npm/package/bin/npm-cli.js run typecheck` (passed)
- `PATH=/Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH /Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /tmp/codex-loop-npm/package/bin/npm-cli.js test` (passed; 4 test files, 32 tests)
- `PATH=/Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH /Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /tmp/codex-loop-npm/package/bin/npm-cli.js run validate:skills` (passed)
- `PATH=/Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH /Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /tmp/codex-loop-npm/package/bin/npm-cli.js run validate:agents` (passed)
- `PATH=/Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH /Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /tmp/codex-loop-npm/package/bin/npm-cli.js run validate` (passed; typecheck, 4 test files, 32 tests, manifest validation warnings, skill validation, agent validation)

Result:

- All required agent files exist.
- Required agent fields exist: `name`, `description`, and `developer_instructions`.
- Read-only agents use `sandbox_mode = "read-only"` and do not request workspace-write.
- Dev Worker and Integration Manager use `sandbox_mode = "workspace-write"`.
- Planner, Dev Worker, Evaluator, Context Distiller, and Integration Manager contain required role/output contracts.
- `.codex/config.toml` has the expected agent concurrency settings.

## Next Step

Start M5: Local Loop State Store.

Use `docs/MODULE_PROMPT_TEMPLATE.md` and do not enter M6 until M5 is validated.

## Blockers

- Global `node` and `npm` are not available in the current shell environment. Use bundled Node with `PATH=/Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH` until a package manager is available.
- GitHub CLI `gh` is not available in the current shell environment. Git remote and push use local `git`.
- Official plugin validator rejects the M2-required `hooks` pointer and requires `./.mcp.json` when `mcpServers` is present. M2 keeps these as reserved future paths per module requirements.

## M4 Outputs

- `.codex/agents/planner.toml`
- `.codex/agents/dev-worker.toml`
- `.codex/agents/evaluator.toml`
- `.codex/agents/context-distiller.toml`
- `.codex/agents/integration-manager.toml`
- `.codex/agents/test-reviewer.toml`
- `.codex/agents/architecture-reviewer.toml`
- `.codex/config.toml`
- `src/agents/validate-agents.ts`
- `tests/agents/agents.test.ts`
- `package.json`
- `README.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/LOOP_PROGRESS.md`
- `docs/DECISIONS.md`

## Recovery Notes

Current module: M4 complete.

Completed modules: M0, M1, M2, M3, M4.

Open issues: official plugin validator compatibility is deferred because M2 must reserve `mcpServers` and `hooks` paths before M6 and M8 implement them.

Next exact action: implement M5 Local Loop State Store.

Validation status: local M4 validation passed with bundled Node PATH fallback; official plugin validator incompatibility from M2 remains recorded.

Known risks: global `node`/`npm` unavailable, `gh` unavailable, official plugin validator may continue to fail until M6/M8 or manifest compatibility decisions are revisited.
