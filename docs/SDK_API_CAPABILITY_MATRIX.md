# SDK API Capability Matrix

Date: 2026-06-20

Installed package: `@openai/codex-sdk@0.141.0`

Local source of truth inspected:

- `node_modules/@openai/codex-sdk/package.json`
- `node_modules/@openai/codex-sdk/README.md`
- `node_modules/@openai/codex-sdk/dist/index.d.ts`

## Matrix

| Capability | Local evidence | Status |
| --- | --- | --- |
| `import { Codex } from "@openai/codex-sdk"` | README quickstart and `dist/index.d.ts` export `Codex` | supported |
| `new Codex({ env })` | `CodexOptions.env?: Record<string, string>` | supported |
| `new Codex({ config })` | `CodexOptions.config?: CodexConfigObject` | supported |
| `codex.startThread()` | `startThread(options?: ThreadOptions): Thread` | supported |
| `codex.resumeThread(id)` | `resumeThread(id: string, options?: ThreadOptions): Thread` | supported |
| `thread.run(prompt)` | `run(input: Input, turnOptions?: TurnOptions): Promise<Turn>` | supported |
| Final response field | `Turn.finalResponse: string` | `finalResponse` |
| Items field | `Turn.items: ThreadItem[]` | supported |
| Streamed events | `runStreamed(...): Promise<StreamedTurn>` and `StreamedTurn.events` | supported |
| Output schema | `TurnOptions.outputSchema?: unknown` | supported |
| Working directory | `ThreadOptions.workingDirectory?: string` | supported |
| Git repo check override | `ThreadOptions.skipGitRepoCheck?: boolean` | supported |
| Sandbox | `ThreadOptions.sandboxMode?: "read-only" \| "workspace-write" \| "danger-full-access"` | API-supported |
| Run-level sandbox | `TurnOptions` has only `outputSchema` and `signal` | unsupported |
| Thread model override | `ThreadOptions.model?: string` | supported |
| Config `model_catalog_json` | `CodexOptions.config?: CodexConfigObject` with open `[key: string]` | supported as config override |
| Config `sqlite_home` | `CodexOptions.config?: CodexConfigObject` with open `[key: string]` | supported as config override |
| Constructor profile option | no `profile` field in `CodexOptions` or `ThreadOptions` | unsupported |
| Network control | `ThreadOptions.networkAccessEnabled?: boolean` | supported |
| Approval policy | `ThreadOptions.approvalPolicy?: "never" \| "on-request" \| "on-failure" \| "untrusted"` | supported |

## Current Assessment

The installed SDK exposes the API needed for Gate 6B.1A:

- `Codex`
- `startThread`
- `resumeThread`
- `thread.run`
- `thread.runStreamed`
- `outputSchema`
- `env`
- `config`
- `config.model_catalog_json`
- `config.sqlite_home`
- `ThreadOptions.model`
- `workingDirectory`
- `skipGitRepoCheck`
- `sandboxMode`

`sandboxMode` is thread-level only in the installed types. `thread.run()` and `thread.runStreamed()` accept `TurnOptions`, which include `outputSchema` and `signal` but no run-level sandbox option.

`sdk_sandbox_control` is recorded as `VERIFIED` at the SDK API contract level because `ThreadOptions.sandboxMode` is present in the installed type definitions. A later real smoke must still confirm runtime evidence before claiming Gate 6B.1 real PASS.

## Known Boundaries

- Gate 6B.1A does not run real SDK threads.
- Gate 6B.1A does not prove the complete repair loop.
- Gate 6B.1D adds SDK-vs-CLI parity tracing before retrying the three-thread smoke.
- Gate 6B.1E adds planner-only smoke slices and invocation diffing before retrying the three-thread smoke.
- Gate 6B.1G splits planner schema validation into text-only JSON, minimal outputSchema, and planner outputSchema slices before any three-thread retry.
- Gate 6B.1H moves full planner/TaskGraph validation out of SDK outputSchema and into Orchestrator post-processing through planner-lite output.
- M12 remains blocked until a full Gate 6B repair-loop E2E passes.
