# Codex SDK Dependency Troubleshooting

This project uses the official `@openai/codex-sdk` package for SDK-Orchestrated Mode.

## Diagnosis Command

Run:

```bash
npm run codex:sdk:diagnose
```

The command is read-only. It checks:

- Node.js version.
- `package.json` dependency declaration.
- `package-lock.json` dependency entry.
- `npm ls @openai/codex-sdk`.
- `import("@openai/codex-sdk")`.
- Whether the imported module exposes the `Codex` export.

It does not start a Codex thread, run SDK tasks, copy auth files, or print secrets.

## Expected Ready State

```json
{
  "package_json_has_codex_sdk": true,
  "package_lock_has_codex_sdk": true,
  "npm_ls_codex_sdk_ok": true,
  "dynamic_import_codex_sdk_ok": true,
  "codex_sdk_export_keys": ["Codex", "Thread"]
}
```

The exact export list may grow, but `Codex` must be present.

## Failure Categories

- `BLOCKED_SDK_NOT_INSTALLED`: the dependency is not declared or installed in the project.
- `BLOCKED_SDK_IMPORT_FAILED`: the dependency is declared or installed but ESM dynamic import failed.
- `BLOCKED_NODE_VERSION_UNSUPPORTED`: Node.js is below 18.
- `BLOCKED_SDK_EXPORT_MISSING_CODEX`: dynamic import succeeded, but the official `Codex` export is missing.

## Repair Guidance

If `package.json` does not declare the SDK:

```bash
npm install @openai/codex-sdk
```

If `package.json` and `package-lock.json` already declare it but `npm ls` or dynamic import fails:

```bash
npm install
```

Do not install a similar package name, do not install globally to bypass the project dependency, and do not copy auth or secret files into the repository.

## M12 Feature Planner Smoke Boundary

`npm run m12:feature-planner-smoke:run` checks SDK dependency readiness before checking the real planner-smoke flag. If the SDK is importable but the flag is not set, the safe expected status is:

```json
{
  "status": "BLOCKED_FEATURE_PLANNER_SMOKE_NOT_ENABLED",
  "real_sdk_run_executed": false
}
```

A real planner smoke still requires explicit approval and `CODEX_LOOP_ENABLE_M12_FEATURE_PLANNER_SMOKE=1`. M12 full runs remain blocked unless separately approved.
