import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  createPlannerLiteRuntimeInput,
  plannerLiteInvocationSnapshot
} from "../../src/orchestrator/sdk-planner-lite-stage.ts";
import type { PlannerLiteInvocationDiff, PlannerLiteInvocationSnapshot } from "../../src/orchestrator/sdk-planner-stage-types.ts";
import { ensureEvalSqliteHome } from "../../src/runtime/eval-sqlite-home.ts";
import type { RuntimeAdapter } from "../../src/runtime/runtime-adapter.ts";

const repoRoot = process.cwd();
const reportDir = resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
const targetRepo = resolve(repoRoot, "tmp/sdk-orchestrated/gate6b-smoke-target");
const jsonPath = resolve(reportDir, "planner-lite-vs-gate6b-diff.json");
const reportPath = resolve(reportDir, "PlannerLiteVsGate6BDiffReport.md");

function main(): void {
  const diff = buildPlannerLiteVsGate6bDiff();
  writeJson(jsonPath, diff);
  writeFileSync(reportPath, renderReport(diff), "utf8");
  process.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
  process.exitCode = diff.status === "PASS" ? 0 : 2;
}

export function buildPlannerLiteVsGate6bDiff(options: { repoRoot?: string; targetRepo?: string; sqliteHome?: string } = {}): PlannerLiteInvocationDiff {
  const root = options.repoRoot ?? repoRoot;
  const sqliteHome = options.sqliteHome ?? ensureEvalSqliteHome(root).path;
  const target = options.targetRepo ?? targetRepo;
  const modelCatalogJson = resolveModelCatalogJson(root);
  const adapter = {} as RuntimeAdapter;
  const plannerSmoke = createPlannerLiteRuntimeInput({
    loop_run_id: "loop_gate6b_planner_smoke",
    task_id: "task_gate6b_planner_smoke",
    target_repo: target,
    model: process.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: modelCatalogJson,
    sqlite_home: sqliteHome,
    sandbox: "read-only",
    timeout_ms: 180_000,
    runtime_adapter: adapter,
    repo_root: root,
    report_dir: resolve(root, "evals/sdk-orchestrated/reports/sdk-startup-triage"),
    invocation_trace_label: "gate6b-planner-smoke-schema-output-lite"
  });
  const gate6bPlanner = createPlannerLiteRuntimeInput({
    loop_run_id: "loop_gate6b_smoke",
    task_id: "task_validate_project_name",
    target_repo: target,
    model: process.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: modelCatalogJson,
    sqlite_home: sqliteHome,
    sandbox: "read-only",
    timeout_ms: 180_000,
    runtime_adapter: adapter,
    repo_root: root,
    report_dir: resolve(root, "evals/sdk-orchestrated/reports/sdk-startup-triage"),
    invocation_trace_label: "gate6b-smoke-planner"
  });
  return diffSnapshots(
    plannerLiteInvocationSnapshot(plannerSmoke, root),
    plannerLiteInvocationSnapshot(gate6bPlanner, root)
  );
}

export function diffSnapshots(plannerLiteSmoke: PlannerLiteInvocationSnapshot, gate6bPlanner: PlannerLiteInvocationSnapshot): PlannerLiteInvocationDiff {
  const keys: Array<keyof PlannerLiteInvocationSnapshot> = [
    "workingDirectory",
    "model",
    "model_catalog_json",
    "sqlite_home",
    "sandboxMode",
    "skipGitRepoCheck",
    "outputSchemaHash",
    "promptHash",
    "promptLength",
    "sdkMethod",
    "runOptions",
    "envKeys",
    "configKeys",
    "targetRepoGitStatus"
  ];
  const differences = keys
    .filter((key) => JSON.stringify(plannerLiteSmoke[key]) !== JSON.stringify(gate6bPlanner[key]))
    .map((key) => ({
      field: key,
      planner_lite_smoke: plannerLiteSmoke[key],
      gate6b_smoke_planner: gate6bPlanner[key]
    }));
  return {
    status: differences.length === 0 ? "PASS" : "NEEDS_REVISION",
    critical_diff_count: differences.length,
    differences
  };
}

function renderReport(diff: PlannerLiteInvocationDiff): string {
  return [
    "# Planner Lite vs Gate 6B Invocation Diff",
    "",
    "Date: 2026-06-20",
    "",
    `Status: ${diff.status}`,
    `Critical diff count: ${diff.critical_diff_count}`,
    "",
    diff.differences.length > 0 ? JSON.stringify(diff.differences, null, 2) : "No critical invocation differences detected.",
    ""
  ].join("\n");
}

function resolveModelCatalogJson(root: string): string {
  const configured = process.env.CODEX_LOOP_MODEL_CATALOG_JSON;
  if (configured) return resolve(configured);
  const bundled = resolve(root, "evals/sdk-orchestrated/model-catalog-bundled.json");
  return existsSync(bundled) ? bundled : "";
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
