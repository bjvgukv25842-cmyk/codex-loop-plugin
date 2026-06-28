import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = process.cwd();
const reportDir = resolve(repoRoot, "evals/sdk-orchestrated/reports/model-catalog-triage");
const bundledFallbackPath = resolve(repoRoot, "evals/sdk-orchestrated/model-catalog-bundled.json");

function main(): void {
  mkdirSync(reportDir, { recursive: true });

  const version = runCodex(["--version"]);
  writeText("codex-version.txt", version.stdout);
  writeText("codex-version.stderr.log", version.stderr);

  const bundled = runCodex(["debug", "models", "--bundled"]);
  writeText("models-bundled.json", bundled.stdout);
  writeText("models-bundled.stderr.log", bundled.stderr);

  const remote = runCodex(["debug", "models"]);
  writeText("models-remote.json", remote.stdout);
  writeText("models-remote.stderr.log", remote.stderr);

  const bundledCatalogOk = isJsonObjectOrArray(bundled.stdout) && bundled.status === 0;
  if (bundledCatalogOk) {
    mkdirSync(dirname(bundledFallbackPath), { recursive: true });
    writeFileSync(bundledFallbackPath, ensureTrailingNewline(bundled.stdout), "utf8");
  }

  const result = {
    bundled_catalog_ok: bundledCatalogOk,
    remote_catalog_ok: isJsonObjectOrArray(remote.stdout) && remote.status === 0,
    remote_catalog_error_category: classifyModelCatalogOutput(`${remote.stdout}\n${remote.stderr}`),
    missing_field_models_detected: /missing field [`"]models[`"]/.test(`${remote.stdout}\n${remote.stderr}`),
    custom_provider_suspected: /"data"\s*:\s*\[/.test(`${remote.stdout}\n${remote.stderr}`),
    bundled_fallback_written: bundledCatalogOk && existsSync(bundledFallbackPath),
    bundled_fallback_path: bundledCatalogOk ? "evals/sdk-orchestrated/model-catalog-bundled.json" : "",
    recommended_fix: bundledCatalogOk
      ? "Retry one real SDK smoke with CODEX_LOOP_MODEL_CATALOG_JSON=$(pwd)/evals/sdk-orchestrated/model-catalog-bundled.json after reviewing the catalog."
      : "Inspect Codex model provider configuration; do not retry real SDK smoke until model catalog output parses successfully."
  };
  writeText("model-catalog-triage-result.json", JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function runCodex(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("codex", args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error ? result.error.message : "")
  };
}

function writeText(name: string, value: string): void {
  writeFileSync(resolve(reportDir, name), ensureTrailingNewline(value), "utf8");
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function isJsonObjectOrArray(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

function classifyModelCatalogOutput(value: string): string {
  if (/codex_models_manager|failed to refresh available models|missing field [`"]models[`"]|body:\s*\{"data"\s*:\s*\[/i.test(value)) {
    return "CODEX_MODEL_CATALOG_REFRESH_FAILED";
  }
  return value.trim().length > 0 ? "MODEL_CATALOG_COMMAND_FAILED" : "";
}

main();
