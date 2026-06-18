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

## DEC-0012: M2 Manifest Reserves Future Integration Paths Without Implementing Them

- Date: 2026-06-18
- Decision: Include `skills`, `mcpServers`, and `hooks` path fields in `.codex-plugin/plugin.json`, but treat missing future companion files as local manifest warnings until M3, M6, and M8 implement those surfaces.
- Reason: The M2 module contract requires the manifest to point at future skills, MCP, and hooks locations while also prohibiting implementation of those modules now.
- Alternatives considered: Omitting `mcpServers` and `hooks` until their modules; rejected because it would not satisfy the M2 contract. Creating placeholder MCP or hook configs; rejected because it would blur module boundaries and imply behavior that does not exist.
- Impact: `src/plugin/validate-manifest.ts` reports missing future files as warnings, not errors. Official plugin ingestion validation may still reject `hooks` until the platform supports it; M2 records that compatibility risk instead of entering M6 or M8 early.

## DEC-0013: Treat M3 Skills as Workflow Contracts, Not Runtime Orchestration

- Date: 2026-06-18
- Decision: Implement M3 skills as reusable procedural contracts with static structure validation, while deferring durable state storage, MCP tools, hooks, and orchestration execution to later modules.
- Reason: Skills should guide Codex behavior for PRD, task decomposition, scoped development, evaluation, repair, context recovery, and integration without pretending to execute the loop or persist state themselves.
- Alternatives considered: Adding runtime loop orchestration inside skills; rejected because M3 explicitly prohibits business loop implementation. Deferring skill validation; rejected because later agents need reliable skill entrypoints before M4 and M5.
- Impact: `src/skills/validate-skills.ts` verifies skill frontmatter and key constraints, and future M4 agent definitions should align with these skill contracts.

## DEC-0014: Enforce Agent Permission Boundaries in Static Config

- Date: 2026-06-18
- Decision: Define planner, evaluator, context_distiller, test_reviewer, and architecture_reviewer as `read-only`, while dev_worker and integration_manager use `workspace-write`.
- Reason: Planner and evaluator-style agents must not mutate implementation state, while dev and integration roles need bounded write access to implement assigned work or update delivery docs.
- Alternatives considered: Giving every custom agent workspace-write access; rejected because it weakens evaluator and planning boundaries. Making every agent read-only; rejected because Dev Worker and Integration Manager must perform scoped writes in later modules.
- Impact: `.codex/agents/*.toml` records sandbox boundaries, and `src/agents/validate-agents.ts` fails validation if read-only agents request write access or write-capable agents lose their required sandbox mode.

## DEC-0015: Use JSON Files for the First Local Loop Store

- Date: 2026-06-18
- Decision: Implement M5 as a local JSON file store before introducing SQLite, Postgres, or remote persistence.
- Reason: JSON files are enough to make loop state durable, inspectable, and testable while keeping M5 dependency-free and aligned with the incremental module plan.
- Alternatives considered: SQLite; deferred because it adds migration and query concerns before the store interface is proven. Postgres or another remote database; rejected for M5 because the project needs a local-first source of truth and must not introduce remote infrastructure.
- Impact: `src/state/json-store.ts` implements `LoopStore` using JSON arrays and atomic temp-file rename writes. Future SQLite/Postgres implementations can implement the same interface without changing MCP or CLI callers.

## DEC-0016: Keep LoopEvent as an M5 Local Type for Now

- Date: 2026-06-18
- Decision: Define `LoopEvent` in `src/state/types.ts` with lightweight runtime checks instead of adding a new M1 JSON Schema during M5.
- Reason: M1 did not include an event schema in the core contract list, while M5 requires `state/events.json`. A local event type keeps the module small and avoids expanding the schema catalog beyond the requested M1 entities.
- Alternatives considered: Adding `schemas/event.schema.json`; deferred until M6/M7 reveal whether MCP and CLI need a formal external event contract. Storing untyped events; rejected because event log entries still need durable required fields.
- Impact: Schema-backed entities still use M1 `assertValid`; event entries require `event_id`, `loop_run_id`, `type`, `message`, `created_at`, `updated_at`, and object metadata.
