# Loop Progress

This file is the durable progress log for Codex Loop work. It must be updated after every module.

## Current Module

M1: Core Schemas and Runtime Types

## Completed Modules

- M0 Project Memory & Scaffold
- M1 Core Schemas and Runtime Types

## Current Status

M1 is complete. M2 is not started.

The project now has source-of-truth documents, plugin metadata, skill scaffold, custom agent definitions, and a core data contract layer.

M1 added:

- JSON Schema draft 2020-12 contracts for common definitions, LoopRun, AgentProfile, TaskNode, TaskGraph, Artifact, EvalReport, RepairRequest, ContextCapsule, and ModuleProgress.
- TypeScript interfaces and unions matching the schema field names.
- Schema registry helpers for listing, locating, and loading schemas.
- Runtime validation helpers using Ajv and structured validation errors.
- Business-rule validators for EvalReport and ContextCapsule cross-field requirements.
- Valid and invalid fixtures plus automated schema tests.

No state store, MCP server, CLI, hook logic, custom agent implementation, or business loop has been implemented.

## Recent Validation Result

Status: Passed with bundled Node PATH fallback.

Commands:

- `PATH=/Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH /Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /tmp/codex-loop-npm/package/bin/npm-cli.js run typecheck` (passed)
- `PATH=/Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH /Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /tmp/codex-loop-npm/package/bin/npm-cli.js test` (passed; 1 test file, 12 tests)
- `PATH=/Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH /Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /tmp/codex-loop-npm/package/bin/npm-cli.js run validate` (passed; typecheck plus 1 test file, 12 tests)
- `PATH=/Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH /Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --run typecheck` (passed)
- `PATH=/Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH /Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --run test` (passed; 1 test file, 12 tests)
- `PATH=/Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH /Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --run validate` (passed; typecheck plus 1 test file, 12 tests)

Result:

- All M1 schemas load.
- Valid fixtures pass schema validation.
- Invalid EvalReport and ContextCapsule fixtures fail as expected.
- EvalReport `NEEDS_REVISION` with empty `findings` fails business validation.
- ContextCapsule missing `next_instruction` fails business validation.
- TypeScript typechecking passes.

## Next Step

Start M2: Codex Plugin Manifest.

Use `docs/MODULE_PROMPT_TEMPLATE.md` and do not enter M3 until M2 is validated.

## Blockers

- Global `node` and `npm` are not available in the current shell environment. Use bundled Node with `PATH=/Users/litmus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH` until a package manager is available.
- GitHub CLI `gh` is not available in the current shell environment. Git remote and push use local `git`.

## M1 Outputs

- `schemas/common.schema.json`
- `schemas/loop-run.schema.json`
- `schemas/agent-profile.schema.json`
- `schemas/task-node.schema.json`
- `schemas/task-graph.schema.json`
- `schemas/artifact.schema.json`
- `schemas/eval-report.schema.json`
- `schemas/repair-request.schema.json`
- `schemas/context-capsule.schema.json`
- `schemas/module-progress.schema.json`
- `src/core/types.ts`
- `src/core/schema-registry.ts`
- `src/core/validate.ts`
- `src/core/errors.ts`
- `src/core/index.ts`
- `tests/core/schema.test.ts`
- `tests/fixtures/valid/loop-run.json`
- `tests/fixtures/valid/agent-profile.json`
- `tests/fixtures/valid/task-graph.json`
- `tests/fixtures/valid/eval-report-pass.json`
- `tests/fixtures/valid/eval-report-needs-revision.json`
- `tests/fixtures/valid/context-capsule.json`
- `tests/fixtures/invalid/eval-report-missing-verdict.json`
- `tests/fixtures/invalid/context-capsule-missing-next-instruction.json`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/LOOP_PROGRESS.md`
- `docs/DECISIONS.md`

## Recovery Notes

Current module: M1 complete.

Completed modules: M0, M1.

Open issues: none for M1.

Next exact action: implement M2 Codex Plugin Manifest.

Validation status: passed with bundled Node PATH fallback.

Known risks: global `node`/`npm` unavailable, `gh` unavailable, M2 must ensure plugin metadata references only existing plugin surfaces.
