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
