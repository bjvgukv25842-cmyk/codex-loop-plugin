import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = process.cwd();
const reportDir = resolve(repoRoot, "evals/sdk-orchestrated/reports/model-catalog-triage");
const resultPath = resolve(reportDir, "model-catalog-triage-result.json");

function main(): void {
  const bundledStdout = readText("models-bundled.json");
  const bundledStderr = readText("models-bundled.stderr.log");
  const remoteStdout = readText("models-remote.json");
  const remoteStderr = readText("models-remote.stderr.log");
  const remoteCombined = `${remoteStdout}\n${remoteStderr}`;
  const bundledCatalogOk = isJsonObjectOrArray(bundledStdout) && !hasCommandError(bundledStderr);
  const remoteCatalogOk = isJsonObjectOrArray(remoteStdout) && !hasCommandError(remoteStderr);
  const parsed = {
    bundled_catalog_ok: bundledCatalogOk,
    remote_catalog_ok: remoteCatalogOk,
    remote_catalog_error_category: remoteCatalogOk ? "" : classifyModelCatalogOutput(remoteCombined),
    missing_field_models_detected: /missing field [`"]models[`"]/.test(remoteCombined),
    custom_provider_suspected: /"data"\s*:\s*\[/.test(remoteCombined),
    recommended_fix: bundledCatalogOk
      ? "Use CODEX_LOOP_MODEL_CATALOG_JSON=$(pwd)/evals/sdk-orchestrated/model-catalog-bundled.json for the next single real SDK smoke."
      : "Run codex:model:catalog:diagnose and inspect provider/model catalog output before retrying real SDK smoke."
  };
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
}

function readText(name: string): string {
  const path = resolve(reportDir, name);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function isJsonObjectOrArray(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

function hasCommandError(value: string): boolean {
  return /error|failed|missing field/i.test(value);
}

function classifyModelCatalogOutput(value: string): string {
  if (/codex_models_manager|failed to refresh available models|missing field [`"]models[`"]|body:\s*\{"data"\s*:\s*\[/i.test(value)) {
    return "CODEX_MODEL_CATALOG_REFRESH_FAILED";
  }
  return value.trim().length > 0 ? "MODEL_CATALOG_COMMAND_FAILED" : "";
}

main();
