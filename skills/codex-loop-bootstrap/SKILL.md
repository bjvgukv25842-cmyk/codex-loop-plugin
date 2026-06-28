---
name: codex-loop-bootstrap
description: "Trigger with $codex-loop-bootstrap, bootstrap loop agents, materialize Codex Loop native subagents, or prepare Gate 6 native multi-agent validation. Use when a repository must ensure .codex/agents contains loop_* custom agent definitions before running Codex Loop. Do not use for product implementation, PRD writing, evaluation, or repair work."
---

# Codex Loop Bootstrap

## Purpose

Prepare a repository for native Codex Loop subagent execution.

This skill checks and materializes the custom agent definitions required by Gate 6 Native Subagent Mode. It does not implement user business logic.

## Inputs

- `.codex/agents/`
- `.codex/config.toml`
- `skills/codex-loop-bootstrap/references/agent-templates.md`

## Required Agents

- `loop-planner.toml`
- `loop-dev-worker.toml`
- `loop-evaluator.toml`
- `loop-context-distiller.toml`
- `loop-integration-manager.toml`

## Procedure

1. Inspect `.codex/agents/`.
2. Inspect `.codex/config.toml`.
3. Create missing loop agent TOML files from the templates.
4. Ensure `.codex/config.toml` contains:

```toml
[agents]
max_threads = 6
max_depth = 1
```

5. Run `npm run verify:agents`.
6. Output a BootstrapReport.

## Stop Conditions

- Stop as PASS when all required agent files and config settings exist.
- Stop as BLOCKED if the repository is not writable.
- Stop as NEEDS_REVISION if created files fail local validation.

## Required Output

```json
{
  "agent": "codex_loop_bootstrap",
  "status": "PASS | NEEDS_REVISION | BLOCKED",
  "custom_agents_materialized": [],
  "config_checked": true,
  "validation_commands": [],
  "remaining_risks": []
}
```
