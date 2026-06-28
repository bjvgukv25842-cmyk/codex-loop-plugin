import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

export type SdkDependencyFailureCategory =
  | ""
  | "BLOCKED_SDK_NOT_INSTALLED"
  | "BLOCKED_SDK_IMPORT_FAILED"
  | "BLOCKED_NODE_VERSION_UNSUPPORTED"
  | "BLOCKED_SDK_EXPORT_MISSING_CODEX";

export interface CodexSdkDependencyStatus {
  package_name: "@openai/codex-sdk";
  detected: boolean;
  node_version: string;
  node_supported: boolean;
  package_json_has_codex_sdk: boolean;
  package_lock_has_codex_sdk: boolean;
  npm_ls_codex_sdk_ok: boolean;
  dynamic_import_codex_sdk_ok: boolean;
  codex_named_export_available: boolean;
  codex_sdk_version: string;
  codex_sdk_export_keys: string[];
  failure_category: SdkDependencyFailureCategory;
  error_message: string;
}

export interface SdkApiCapabilityMatrix {
  package_name: "@openai/codex-sdk";
  package_version: string;
  package_path: string;
  codex_named_export_available: boolean;
  new_codex_env_supported: boolean;
  start_thread_supported: boolean;
  resume_thread_supported: boolean;
  thread_run_supported: boolean;
  final_response_field: "finalResponse" | "final_response" | "unknown";
  items_field_supported: boolean;
  events_field_supported: boolean;
  output_schema_supported: boolean;
  run_streamed_supported: boolean;
  working_directory_supported: boolean;
  skip_git_repo_check_supported: boolean;
  sandbox_mode_supported: boolean;
  run_level_sandbox_supported: boolean;
  thread_model_supported: boolean;
  config_model_catalog_json_supported: boolean;
  config_sqlite_home_supported: boolean;
  config_supported: boolean;
  sdk_sandbox_control: "VERIFIED" | "UNVERIFIED" | "NOT_SUPPORTED";
  gaps: string[];
}

export async function detectCodexSdkDependency(repoRoot = process.cwd()): Promise<CodexSdkDependencyStatus> {
  const packageJson = readJsonFile(resolve(repoRoot, "package.json"));
  const packageLock = readJsonFile(resolve(repoRoot, "package-lock.json"));
  const packageJsonHasCodexSdk = hasDependency(packageJson, "@openai/codex-sdk");
  const packageLockHasCodexSdk = hasPackageLockDependency(packageLock, "@openai/codex-sdk");
  const nodeSupported = getNodeMajorVersion() >= 18;
  const npmLsOk = canResolveCodexSdk(repoRoot);
  const base: CodexSdkDependencyStatus = {
    package_name: "@openai/codex-sdk",
    detected: false,
    node_version: process.version,
    node_supported: nodeSupported,
    package_json_has_codex_sdk: packageJsonHasCodexSdk,
    package_lock_has_codex_sdk: packageLockHasCodexSdk,
    npm_ls_codex_sdk_ok: npmLsOk,
    dynamic_import_codex_sdk_ok: false,
    codex_named_export_available: false,
    codex_sdk_version: readCodexSdkVersion(repoRoot),
    codex_sdk_export_keys: [],
    failure_category: "",
    error_message: ""
  };
  if (!nodeSupported) {
    return {
      ...base,
      failure_category: "BLOCKED_NODE_VERSION_UNSUPPORTED",
      error_message: `Node.js >= 18 required; current ${process.version}.`
    };
  }

  try {
    const sdk = await import("@openai/codex-sdk");
    const exportKeys = Object.keys(sdk).sort();
    const hasCodex = typeof (sdk as { Codex?: unknown }).Codex === "function";
    return {
      ...base,
      detected: hasCodex,
      dynamic_import_codex_sdk_ok: true,
      codex_named_export_available: hasCodex,
      codex_sdk_export_keys: exportKeys,
      failure_category: hasCodex ? "" : "BLOCKED_SDK_EXPORT_MISSING_CODEX",
      error_message: hasCodex ? "" : "@openai/codex-sdk imported, but Codex export is missing."
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const installedOrDeclared = packageJsonHasCodexSdk || packageLockHasCodexSdk || npmLsOk;
    return {
      ...base,
      failure_category: installedOrDeclared ? "BLOCKED_SDK_IMPORT_FAILED" : "BLOCKED_SDK_NOT_INSTALLED",
      error_message: message
    };
  }
}

export function detectSdkCapability(repoRoot = process.cwd()): SdkApiCapabilityMatrix {
  const packageJsonPath = resolve(repoRoot, "node_modules/@openai/codex-sdk/package.json");
  if (!existsSync(packageJsonPath)) {
    return missingMatrix(packageJsonPath);
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string; types?: string };
  const dtsPath = resolve(packageJsonPath, "..", packageJson.types ?? "dist/index.d.ts");
  const readmePath = resolve(packageJsonPath, "..", "README.md");
  const dts = existsSync(dtsPath) ? readFileSync(dtsPath, "utf8") : "";
  const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : "";
  const combined = `${dts}\n${readme}`;

  const matrix: SdkApiCapabilityMatrix = {
    package_name: "@openai/codex-sdk",
    package_version: packageJson.version ?? "unknown",
    package_path: packageJsonPath,
    codex_named_export_available: /declare class Codex|export \{[^}]*Codex/.test(dts) || /import \{ Codex \}/.test(readme),
    new_codex_env_supported: /constructor\(options\?: CodexOptions\)/.test(dts) && /env\?: Record<string, string>/.test(dts),
    start_thread_supported: /startThread\(options\?: ThreadOptions\): Thread/.test(dts),
    resume_thread_supported: /resumeThread\(id: string, options\?: ThreadOptions\): Thread/.test(dts),
    thread_run_supported: /run\(input: Input, turnOptions\?: TurnOptions\): Promise<Turn>/.test(dts),
    final_response_field: /finalResponse: string/.test(dts) ? "finalResponse" : "unknown",
    items_field_supported: /items: ThreadItem\[\]/.test(dts),
    events_field_supported: /events: AsyncGenerator<ThreadEvent>/.test(dts),
    output_schema_supported: /outputSchema\?: unknown/.test(dts) || /outputSchema/.test(combined),
    run_streamed_supported: /runStreamed\(input: Input, turnOptions\?: TurnOptions\): Promise<StreamedTurn>/.test(dts),
    working_directory_supported: /workingDirectory\?: string/.test(dts),
    skip_git_repo_check_supported: /skipGitRepoCheck\?: boolean/.test(dts),
    sandbox_mode_supported: /sandboxMode\?: SandboxMode/.test(dts) && /type SandboxMode = "read-only" \| "workspace-write" \| "danger-full-access"/.test(dts),
    run_level_sandbox_supported: /type TurnOptions = \{[^}]*sandboxMode/s.test(dts),
    thread_model_supported: /model\?: string/.test(dts),
    config_supported: /config\?: CodexConfigObject/.test(dts),
    config_model_catalog_json_supported: /type CodexConfigObject = \{\s*\[key: string\]: CodexConfigValue;\s*\}/.test(dts),
    config_sqlite_home_supported: /type CodexConfigObject = \{\s*\[key: string\]: CodexConfigValue;\s*\}/.test(dts),
    sdk_sandbox_control: "UNVERIFIED",
    gaps: []
  };

  matrix.sdk_sandbox_control = matrix.sandbox_mode_supported ? "VERIFIED" : "NOT_SUPPORTED";
  matrix.gaps = capabilityGaps(matrix);
  return matrix;
}

export async function canImportCodexSdk(): Promise<boolean> {
  return (await detectCodexSdkDependency()).detected;
}

export function canResolveCodexSdk(repoRoot = process.cwd()): boolean {
  if (existsSync(resolve(repoRoot, "node_modules/@openai/codex-sdk/package.json"))) {
    return true;
  }
  try {
    createRequire(resolve(repoRoot, "package.json")).resolve("@openai/codex-sdk");
    return true;
  } catch {
    return false;
  }
}

function missingMatrix(packageJsonPath: string): SdkApiCapabilityMatrix {
  return {
    package_name: "@openai/codex-sdk",
    package_version: "not_installed",
    package_path: packageJsonPath,
    codex_named_export_available: false,
    new_codex_env_supported: false,
    start_thread_supported: false,
    resume_thread_supported: false,
    thread_run_supported: false,
    final_response_field: "unknown",
    items_field_supported: false,
    events_field_supported: false,
    output_schema_supported: false,
    run_streamed_supported: false,
    working_directory_supported: false,
    skip_git_repo_check_supported: false,
    sandbox_mode_supported: false,
    run_level_sandbox_supported: false,
    thread_model_supported: false,
    config_model_catalog_json_supported: false,
    config_sqlite_home_supported: false,
    config_supported: false,
    sdk_sandbox_control: "NOT_SUPPORTED",
    gaps: ["SDK package is not installed."]
  };
}

function capabilityGaps(matrix: SdkApiCapabilityMatrix): string[] {
  const gaps: string[] = [];
  if (!matrix.codex_named_export_available) gaps.push("Codex named export not found.");
  if (!matrix.new_codex_env_supported) gaps.push("new Codex({ env }) support not found.");
  if (!matrix.start_thread_supported) gaps.push("startThread support not found.");
  if (!matrix.thread_run_supported) gaps.push("thread.run support not found.");
  if (!matrix.output_schema_supported) gaps.push("thread.run outputSchema support not found.");
  if (!matrix.run_streamed_supported) gaps.push("runStreamed support not found.");
  if (!matrix.working_directory_supported) gaps.push("workingDirectory support not found.");
  if (!matrix.skip_git_repo_check_supported) gaps.push("skipGitRepoCheck support not found.");
  if (!matrix.sandbox_mode_supported) gaps.push("sandboxMode support not found.");
  if (!matrix.thread_model_supported) gaps.push("ThreadOptions.model support not found.");
  if (!matrix.config_supported) gaps.push("Codex config override support not found.");
  if (!matrix.config_model_catalog_json_supported) gaps.push("Codex config object is not open enough for model_catalog_json.");
  if (!matrix.config_sqlite_home_supported) gaps.push("Codex config object is not open enough for sqlite_home.");
  return gaps;
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function hasDependency(value: unknown, name: string): boolean {
  if (!isRecord(value)) return false;
  return hasKey(value.dependencies, name) || hasKey(value.devDependencies, name) || hasKey(value.optionalDependencies, name);
}

function hasPackageLockDependency(value: unknown, name: string): boolean {
  if (!isRecord(value)) return false;
  if (hasDependency(value, name)) return true;
  const packages = value.packages;
  if (isRecord(packages) && isRecord(packages[`node_modules/${name}`])) return true;
  const dependencies = value.dependencies;
  return isRecord(dependencies) && isRecord(dependencies[name]);
}

function hasKey(value: unknown, key: string): boolean {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function readCodexSdkVersion(repoRoot: string): string {
  const packageJson = readJsonFile(resolve(repoRoot, "node_modules/@openai/codex-sdk/package.json"));
  return isRecord(packageJson) && typeof packageJson.version === "string" ? packageJson.version : "";
}

function getNodeMajorVersion(): number {
  return Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
