import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = process.cwd();
const verifyPath = resolve(repoRoot, "evals/sdk-orchestrated/reports/gate6b-checkpoint-verify.json");
const statePath = resolve(repoRoot, "evals/sdk-orchestrated/reports/gate6b-checkpoint-state.json");
const reportPath = resolve(repoRoot, "evals/sdk-orchestrated/reports/Gate6B_Checkpointed_Smoke_Report.md");

function main(): void {
  const verify = readJson(verifyPath);
  const state = readJson(statePath);
  const lines = [
    "# Gate 6B.1L Checkpointed SDK Smoke Report",
    "",
    "Date: 2026-06-21",
    "",
    `Verify status: ${String(verify.status ?? "NOT_RUN")}`,
    `Current stage: ${String(state.current_stage ?? verify.current_stage ?? "UNKNOWN")}`,
    `Target repo: ${String(state.target_repo ?? "tmp/sdk-orchestrated/gate6b-smoke-target")}`,
    `Planner thread id: ${String(state.planner && typeof state.planner === "object" ? (state.planner as Record<string, unknown>).thread_id ?? "" : "")}`,
    `Dev worker thread id: ${String(state.dev_worker && typeof state.dev_worker === "object" ? (state.dev_worker as Record<string, unknown>).thread_id ?? "" : "")}`,
    `Evaluator thread id: ${String(state.evaluator && typeof state.evaluator === "object" ? (state.evaluator as Record<string, unknown>).thread_id ?? "" : "")}`,
    `Ready for Gate 6B.2: ${String(verify.ready_for_gate6b_2 === true)}`,
    "M12 blocked: true",
    "",
    "Gate 6B.1L replaces the legacy continuous three-thread smoke with checkpointed stage execution. Each stage is run and verified separately: planner, dev_worker, evaluator.",
    "",
    "Default checkpoint run scripts are dry-run blocked unless the matching real SDK env flag is set for one controlled host-terminal run.",
    "",
    "Next manual action: run checkpointed Gate 6B.1 one stage at a time: prepare, planner, dev-worker, evaluator, verify/report.",
    ""
  ];
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

main();
