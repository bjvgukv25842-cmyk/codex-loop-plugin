# Acceptance Criteria

- `validateProjectName("")` returns `{ valid: false, reason: "Project name is required." }`.
- `validateProjectName("   ")` returns `{ valid: false, reason: "Project name cannot be only whitespace." }`.
- `validateProjectName("a".repeat(81))` returns `{ valid: false, reason: "Project name must be 80 characters or fewer." }`.
- `validateProjectName("Codex Loop")` returns `{ valid: true }`.
- The demo test file covers all four rules.
- No UI, database, network, or real Codex thread is added.
