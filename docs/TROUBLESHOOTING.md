# Troubleshooting

## Plugin Manifest Not Found

- Confirm `.codex-plugin/plugin.json` exists.
- Run `npm run validate:manifest`.
- Confirm relative paths start with `./`.

## Skills Do Not Trigger

- Confirm the skill folder exists under `skills/`.
- Confirm each `SKILL.md` has frontmatter with `name` and `description`.
- Run `npm run validate:skills`.
- Use the exact trigger, such as `$codex-loop`.

## MCP Server Fails To Start

- Confirm `.mcp.json` exists.
- Confirm `node` is available.
- Confirm the cwd is the plugin root.
- Run `npm run real:verify-mcp` to exercise the actual stdio server.
- Run `npm test -- tests/mcp/tools.test.ts`.
- If Node reports `ERR_MODULE_NOT_FOUND` for a local `.js` import while running `.ts` source, use `.ts` local import specifiers for files executed directly by Node.
- If Node reports `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, remove TypeScript syntax that Node strip-only execution cannot erase, such as constructor parameter properties, from the live server load path.
- Remember MCP tools are state-only and do not run shell commands.

## Hooks Do Not Execute

- Confirm hooks are trusted by the user.
- Confirm `hooks/hooks.json` exists.
- Confirm hook scripts can run with the local Node runtime.
- Run `npm test -- tests/hooks/hooks-config.test.ts tests/hooks/post-tool-use.test.ts tests/hooks/pre-compact.test.ts tests/hooks/stop.test.ts`.

## Schema Validation Fails

- Check required fields against `schemas/*.schema.json`.
- Use `validateWithSchema(schemaName, data)` or `assertValid(schemaName, data)`.
- For EvalReport, `NEEDS_REVISION` requires at least one finding.
- For ContextCapsule, `agent_id`, `old_thread_id`, `next_instruction`, `open_issues`, and `completed_work` are required.

## E2E Test Fails

- Run `npm test -- tests/e2e/demo-loop.test.ts`.
- Confirm `examples/demo-repo/docs/TASK_GRAPH.json` is valid.
- Confirm demo EvalReports use `loop_demo_001` and `TASK-002`.
- Confirm `EvaluationGate` can read the EvalReport from the test store.

## Context Capsule Missing Fields

- Confirm `agent_id`, `agent_type`, `old_thread_id`, `current_module`, `current_task`, `open_issues`, `completed_work`, and `next_instruction` exist.
- Run schema validation with `context-capsule`.
- Do not use a capsule as the only source of truth; it summarizes state.
