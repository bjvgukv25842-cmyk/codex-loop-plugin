import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  createDevWorkerRuntimeInput,
  devWorkerInvocationSnapshot
} from "../../src/orchestrator/sdk-dev-worker-stage.ts";
import type { DevWorkerInvocationDiff, DevWorkerInvocationSnapshot } from "../../src/orchestrator/sdk-dev-worker-stage-types.ts";
import { ensureEvalSqliteHome } from "../../src/runtime/eval-sqlite-home.ts";
import type { RuntimeAdapter } from "../../src/runtime/runtime-adapter.ts";

const repoRoot = process.cwd();
const reportDir = resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
const targetRepo = resolve(repoRoot, "tmp/sdk-orchestrated/gate6b-smoke-target");
const jsonPath = resolve(reportDir, "dev-worker-vs-gate6b-diff.json");
const reportPath = resolve(reportDir, "DevWorkerVsGate6BDiffReport.md");

function main(): void {
  const diff = buildDevWorkerVsGate6bDiff();
  writeJson(jsonPath, diff);
  writeFileSync(reportPath, renderReport(diff), "utf8");
  process.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
  process.exitCode = diff.status === "PASS" ? 0 : 2;
}

export function buildDevWorkerVsGate6bDiff(options: { repoRoot?: string; targetRepo?: string; sqliteHome?: string } = {}): DevWorkerInvocationDiff {
  const root = options.repoRoot ?? repoRoot;
  const sqliteHome = options.sqliteHome ?? ensureEvalSqliteHome(root).path;
  const target = options.targetRepo ?? targetRepo;
  const modelCatalogJson = resolveModelCatalogJson(root);
  const adapter = {} as RuntimeAdapter;
  const smoke = createDevWorkerRuntimeInput({
    loop_run_id: "loop_gate6b_dev_worker_smoke",
    task_id: "task_gate6b_dev_worker_smoke",
    target_repo: target,
    prd_path: "docs/PRD.md",
    task_graph_path: "docs/TASK_GRAPH.json",
    model: process.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: modelCatalogJson,
    sqlite_home: sqliteHome,
    sandbox: "workspace-write",
    timeout_ms: 180_000,
    runtime_adapter: adapter,
    repo_root: root,
    report_dir: resolve(root, "evals/sdk-orchestrated/reports/sdk-startup-triage"),
    invocation_trace_label: "gate6b-dev-worker-smoke-output-lite"
  });
  const gate6b = createDevWorkerRuntimeInput({
    loop_run_id: "loop_gate6b_smoke",
    task_id: "task_validate_project_name",
    target_repo: target,
    prd_path: "docs/PRD.md",
    task_graph_path: "docs/TASK_GRAPH.json",
    model: process.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: modelCatalogJson,
    sqlite_home: sqliteHome,
    sandbox: "workspace-write",
    timeout_ms: 180_000,
    runtime_adapter: adapter,
    repo_root: root,
    report_dir: resolve(root, "evals/sdk-orchestrated/reports/sdk-startup-triage"),
    invocation_trace_label: "gate6b-smoke-dev-worker"
  });
  return diffSnapshots(devWorkerInvocationSnapshot(smoke, root), devWorkerInvocationSnapshot(gate6b, root));
}

export function diffSnapshots(smoke: DevWorkerInvocationSnapshot, gate6b: DevWorkerInvocationSnapshot): DevWorkerInvocationDiff {
  const keys: Array<keyof DevWorkerInvocationSnapshot> = [
    "workingDirectory",
    "model",
    "model_catalog_json",
    "sqlite_home",
    "sandboxMode",
    "skipGitRepoCheck",
    "outputSchemaHash",
    "promptHash",
    "promptLength",
    "prdPath",
    "taskGraphPath",
    "sdkMethod",
    "runOptions",
    "envKeys",
    "configKeys",
    "targetRepoGitStatus"
  ];
  const differences = keys
    .filter((key) => JSON.stringify(smoke[key]) !== JSON.stringify(gate6b[key]))
    .map((key) => ({
      field: key,
      dev_worker_smoke: smoke[key],
      gate6b_smoke_dev_worker: gate6b[key]
    }));
  return {
    status: differences.length === 0 ? "PASS" : "NEEDS_REVISION",
    critical_diff_count: differences.length,
    differences
  };
}

function renderReport(diff: DevWorkerInvocationDiff): string {
  return [
    "# Dev Worker vs Gate 6B Invocation Diff",
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
