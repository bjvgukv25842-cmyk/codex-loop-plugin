import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { detectCodexSdkDependency } from "../../src/runtime/sdk-capability-detect.ts";

interface CodexSdkDiagnosis {
  node_version: string;
  package_manager: "npm";
  package_json_has_codex_sdk: boolean;
  package_lock_has_codex_sdk: boolean;
  npm_ls_codex_sdk_ok: boolean;
  dynamic_import_codex_sdk_ok: boolean;
  codex_sdk_version: string;
  codex_sdk_export_keys: string[];
  cwd: string;
  project_root: string;
  recommended_fix: string;
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const dependency = await detectCodexSdkDependency(projectRoot);
  const npmLs = runReadonlyCommand("npm", ["ls", "@openai/codex-sdk"]);
  const diagnosis: CodexSdkDiagnosis = {
    node_version: process.version,
    package_manager: "npm",
    package_json_has_codex_sdk: dependency.package_json_has_codex_sdk,
    package_lock_has_codex_sdk: dependency.package_lock_has_codex_sdk,
    npm_ls_codex_sdk_ok: npmLs.exitCode === 0 || dependency.npm_ls_codex_sdk_ok,
    dynamic_import_codex_sdk_ok: dependency.dynamic_import_codex_sdk_ok,
    codex_sdk_version: dependency.codex_sdk_version || readLockedSdkVersion(projectRoot),
    codex_sdk_export_keys: dependency.codex_sdk_export_keys,
    cwd: process.cwd(),
    project_root: projectRoot,
    recommended_fix: recommendedFix({
      packageJsonHasSdk: dependency.package_json_has_codex_sdk,
      packageLockHasSdk: dependency.package_lock_has_codex_sdk,
      npmLsOk: npmLs.exitCode === 0 || dependency.npm_ls_codex_sdk_ok,
      dynamicImportOk: dependency.dynamic_import_codex_sdk_ok,
      codexExportOk: dependency.codex_named_export_available,
      failureCategory: dependency.failure_category,
      errorMessage: dependency.error_message
    })
  };
  process.stdout.write(`${JSON.stringify(diagnosis, null, 2)}\n`);
}

function runReadonlyCommand(command: string, args: string[]): { exitCode: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function readLockedSdkVersion(projectRoot: string): string {
  try {
    const lock = JSON.parse(readFileSync(resolve(projectRoot, "package-lock.json"), "utf8")) as {
      packages?: Record<string, { version?: string }>;
    };
    return lock.packages?.["node_modules/@openai/codex-sdk"]?.version ?? "";
  } catch {
    return "";
  }
}

function recommendedFix(input: {
  packageJsonHasSdk: boolean;
  packageLockHasSdk: boolean;
  npmLsOk: boolean;
  dynamicImportOk: boolean;
  codexExportOk: boolean;
  failureCategory: string;
  errorMessage: string;
}): string {
  if (!input.packageJsonHasSdk) {
    return "Add the official @openai/codex-sdk dependency with npm install @openai/codex-sdk.";
  }
  if (!input.packageLockHasSdk) {
    return "Run npm install so package-lock.json records @openai/codex-sdk.";
  }
  if (!input.npmLsOk) {
    return "Run npm install in the project so node_modules contains @openai/codex-sdk.";
  }
  if (!input.dynamicImportOk) {
    return `Fix the project-local SDK install or Node ESM resolution; dynamic import failed with ${input.failureCategory}: ${input.errorMessage}`;
  }
  if (!input.codexExportOk) {
    return "The installed @openai/codex-sdk does not expose Codex; install the official package version expected by the runtime.";
  }
  return "SDK dependency is declared, installed, dynamically importable, and exposes Codex. It is safe to retry the feature planner parity smoke only when approved.";
}

await main();
