---
created_by_runtime: sdk-orchestrated
created_by_role: planner
created_by_thread_id: 019ee983-5a6a-7f10-bf21-4c7085eb816b
---

# PRD: Gate 6B.2 Repair Loop Target

## Goal
Repair the seeded project-name validator so the SDK-orchestrated repair loop can demonstrate a failing eval, focused repair, passing validation, and evaluator handoff.

## Background
The target repository is an isolated JavaScript package with a minimal validator in `src/project-name.js`. Existing tests require empty names and names longer than 80 characters to be rejected, and the repair request adds the missing behavior: whitespace-only project names must also be rejected.

## User-Visible Outcome
`validateProjectName(name)` returns `{ ok: false }` for invalid project names and `{ ok: true }` for valid project names, with local test evidence available through `npm test`.

## Scope
- Inspect the current implementation, tests, and repair request.
- Implement the smallest validation change in `src/project-name.js`.
- Preserve baseline and full test behavior.
- Report validation evidence for evaluator review.

## Non-Goals
- No UI work.
- No database or persistence changes.
- No broad refactor.
- No package metadata changes unless validation cannot otherwise run.

## Functional Requirements
- Reject empty strings.
- Reject whitespace-only strings using trim-equivalent behavior.
- Reject names longer than 80 characters.
- Accept normal non-empty project names within the length limit.

## Validation
Run `npm test`, which invokes the full Node test suite for the target package.
