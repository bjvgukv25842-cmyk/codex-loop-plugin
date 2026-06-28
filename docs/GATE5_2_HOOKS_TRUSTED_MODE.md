# Gate 5.2 Hooks Trusted Mode Validation

Status: BLOCKED_MANUAL_REVIEW_REQUIRED

Gate 5.2 is the trusted-runtime hook validation gate. It must not bypass Codex hook trust. A static config test or direct mock handler call is not enough for PASS.

## Why This Gate Exists

Codex hook execution is trust-gated. Non-managed command hooks must be reviewed and trusted before they run, and trust is tied to the current hook definition hash. If `hooks/hooks.json` or referenced hook scripts change, Codex can require review again and skip untrusted hooks until the user trusts the new definition.

## Manual Prerequisites

1. Open the Codex hooks review / trust UI.
2. Review `hooks/hooks.json`.
3. Review these handlers:
   - `hooks/post_tool_use.ts`
   - `hooks/pre_compact.ts`
   - `hooks/subagent_stop.ts`
   - `hooks/stop.ts`
4. Trust the current hook definition.
5. Run a real Codex session that triggers the hooks.
6. Record runtime evidence under `evidence/gate5-2-hooks-trusted-mode/`.
7. Run `npm run real:verify-hooks`.

## PASS Criteria

- `PostToolUse` captures `npm test`.
- `PreCompact` generates a ContextCapsule.
- `SubagentStop` saves subagent output.
- `Stop` checks `docs/LOOP_PROGRESS.md`.
- No dangerous command is executed.
- No secret leak occurs.
- No infinite continuation is triggered.

## Evidence Contract

After manual trust and real hook execution, create:

`evidence/gate5-2-hooks-trusted-mode/hook-trust-summary.json`

Required shape:

```json
{
  "hook_definition_trusted": true,
  "post_tool_use_captured_npm_test": true,
  "pre_compact_generated_context_capsule": true,
  "subagent_stop_saved_output": true,
  "stop_checked_loop_progress": true,
  "no_dangerous_commands": true,
  "no_secret_leak": true,
  "no_infinite_continue": true,
  "files_scanned_for_safety": []
}
```

`files_scanned_for_safety` should list hook outputs, state files, and artifacts that `real:verify-hooks` should scan for dangerous commands and secret-like content.

## Current Validation Command

```sh
npm run real:verify-hooks
```

Current expected result before manual trust evidence exists:

```json
{
  "hooks_trusted_mode_status": "BLOCKED_MANUAL_REVIEW_REQUIRED"
}
```

## Current Boundary

Gate 5 remains PASS because it explicitly did not bypass hook trust and recorded trusted mode as not checked. Gate 5.2 must pass before Beta if trusted hook runtime execution is required for the Beta scope.
