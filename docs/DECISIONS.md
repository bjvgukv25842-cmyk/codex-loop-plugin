# Decisions

This file records durable project decisions. Future agents must preserve these decisions unless a later entry explicitly supersedes them.

## Decision Record Format

Each decision must use this format:

- Date:
- Decision:
- Reason:
- Alternatives considered:
- Impact:

## DEC-0001: Adopt Modular Incremental Implementation

- Date: 2026-06-18
- Decision: Implement `codex-loop-plugin` one module at a time from M0 through M10.
- Reason: The project is a multi-agent orchestration system; incremental modules keep scope bounded, validation clear, and repairs localized.
- Alternatives considered: Implementing the full plugin in one pass; rejected because it would create too much unvalidated surface area.
- Impact: Every module must define scope, acceptance criteria, validation, progress updates, and recovery notes before the next module begins.

## DEC-0002: Chat Context Is Not the Only State Source

- Date: 2026-06-18
- Decision: Source-of-truth state must live in repository files such as docs, schemas, state, artifacts, and tests.
- Reason: Codex threads can become long, compacted, or unreliable; future agents must continue from files without needing prior chat history.
- Alternatives considered: Relying on conversation history and memory alone; rejected because it is not durable enough for multi-module work.
- Impact: Plans, progress, decisions, validation evidence, task outputs, and context capsules must be written to files as modules are implemented.

## DEC-0003: Build Local File State Before MCP and Orchestrator

- Date: 2026-06-18
- Decision: Implement local file-backed state first, then MCP state tools, then external orchestration surfaces.
- Reason: Local state is the simplest durable substrate and can be validated before introducing MCP or CLI orchestration complexity.
- Alternatives considered: Building MCP server or orchestrator first; rejected because it would force higher-level interfaces before contracts are stable.
- Impact: M1-M5 establish contracts and local persistence before M6-M8 expose MCP, CLI, and hooks.

## DEC-0004: M0 Contains No Business Logic

- Date: 2026-06-18
- Decision: M0 is limited to project memory, scaffold, docs, config, package scripts, and placeholder directories.
- Reason: M0's purpose is to make later work resumable, not to implement schemas, MCP, CLI, hooks, or runtime logic.
- Alternatives considered: Starting schema or CLI implementation during M0; rejected because the user explicitly prohibited entering M1 or later modules.
- Impact: Implementation directories contain only `.gitkeep` placeholders after M0.

## DEC-0005: No Dependencies in M0

- Date: 2026-06-18
- Decision: M0 uses no runtime or development package dependencies.
- Reason: The module only needs scaffold validation and project memory files.
- Alternatives considered: Adding TypeScript or test framework packages immediately; rejected until a later module needs executable TypeScript behavior.
- Impact: `package.json` scripts use Node-only checks; `tsconfig.json` is scaffold configuration, not yet enforced by `tsc`.

## DEC-0006: Use Bundled Node Fallback When NPM Is Unavailable

- Date: 2026-06-18
- Decision: Keep `npm run validate` as the intended validation command, but use bundled Node directly in this environment because global `npm` is not on `PATH`.
- Reason: Validation should run without adding dependencies or changing the user's shell environment.
- Alternatives considered: Installing npm or changing project dependencies; rejected as out of scope for M0.
- Impact: `docs/LOOP_PROGRESS.md` records the unavailable npm command and the bundled Node fallback evidence.

## DEC-0007: Connect Local Scaffold to GitHub Remote

- Date: 2026-06-18
- Decision: Initialize the local directory as a git repository on `main` and set `origin` to `https://github.com/bjvgukv25842-cmyk/codex-loop-plugin.git`.
- Reason: The user requested using the GitHub repository for this project, and the remote did not report an existing HEAD/main/master commit.
- Alternatives considered: Waiting for `gh` or creating a separate branch first; rejected because `gh` is unavailable and the remote appears empty.
- Impact: M0 scaffold can be committed and pushed as the repository's initial history using local `git`.

## DEC-0008: Use JSON Schema Draft 2020-12 as the Runtime Contract Dialect

- Date: 2026-06-18
- Decision: M1 schemas use JSON Schema draft 2020-12 with `$id`, explicit required fields, strict object shapes where practical, and shared definitions in `schemas/common.schema.json`.
- Reason: The schemas must be consumed by future state storage, MCP tools, CLI commands, hooks, evaluator reports, and context capsules without relying on TypeScript-only types.
- Alternatives considered: TypeScript-only interfaces; rejected because non-TypeScript surfaces still need durable runtime contracts. Older JSON Schema drafts; rejected because the M1 requirements specify draft 2020-12.
- Impact: Future modules must reuse these schema files rather than defining incompatible ad hoc payload shapes.

## DEC-0009: Add Ajv for Runtime JSON Schema Validation

- Date: 2026-06-18
- Decision: Add Ajv as the runtime JSON Schema validator and add `ajv-formats` for `date-time` format validation.
- Reason: M1 requires runtime validation of shared schemas. The standard library does not provide JSON Schema validation, and future file/MCP/CLI boundaries must reject malformed state before it becomes source-of-truth data.
- Alternatives considered: Hand-written validators; rejected because they would duplicate schemas and drift. Deferring runtime validation; rejected because M1 explicitly establishes the validation layer.
- Impact: `src/core/validate.ts` owns schema validation, while schemas remain the data-contract source of truth.

## DEC-0010: Keep Cross-Field Business Rules in TypeScript Validators

- Date: 2026-06-18
- Decision: Enforce EvalReport and ContextCapsule cross-field rules in `src/core/validate.ts` in addition to baseline JSON Schema validation.
- Reason: Some requirements, such as `NEEDS_REVISION` requiring findings, are clearer and easier to test as explicit business validation functions than as complex conditional schema composition.
- Alternatives considered: Encoding every rule in JSON Schema conditionals; deferred to avoid over-engineering M1. Ignoring the rules; rejected because the evaluator loop depends on them.
- Impact: Consumers should call `assertValid` or the business-rule validators at ingestion boundaries, not only inspect TypeScript types.

## DEC-0011: Add Vitest and TypeScript Tooling for M1 Validation

- Date: 2026-06-18
- Decision: Add minimal development dependencies for TypeScript typechecking, Vitest tests, and Node type declarations.
- Reason: M1 adds executable TypeScript behavior and must prove schemas load, fixtures validate, and required business rules fail when malformed.
- Alternatives considered: Node's built-in test runner; rejected because Vitest provides a small, familiar TypeScript-ready harness for this project. No test framework; rejected because M1 requires automated schema tests.
- Impact: `npm run typecheck`, `npm test`, and `npm run validate` become the M1 validation surface.
