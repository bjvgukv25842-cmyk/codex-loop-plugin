import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const initialEvaluatorScript = resolve(process.cwd(), "scripts/sdk-orchestrated/run-gate6b2-initial-evaluator.ts");
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("run-gate6b2-initial-evaluator", () => {
  it("blocks when initial dev worker did not satisfy the seeded-gap contract", () => {
    const context = createContext();
    writeSeededGapState(context, { known_gap_seeded: false });

    const result = runJson(initialEvaluatorScript, context.env, context.resultPath);

    expect(result.status).toBe("INITIAL_DEV_SEEDED_GAP_CONTRACT_FAILED");
    expect(result.real_sdk_run_executed).toBe(false);
  });
});

function createContext(): {
  tempDir: string;
  targetRepo: string;
  statePath: string;
  resultPath: string;
  env: NodeJS.ProcessEnv;
} {
  const tempDir = mkdtempSync(resolve(tmpdir(), "gate6b2-initial-evaluator-test-"));
  tempDirs.push(tempDir);
  const targetRepo = resolve(tempDir, "target");
  const statePath = resolve(tempDir, "repair-loop-state.json");
  return {
    tempDir,
    targetRepo,
    statePath,
    resultPath: resolve(process.cwd(), "evals/sdk-orchestrated/reports/gate6b2-initial-evaluator-result.json"),
    env: {
      ...process.env,
      CODEX_LOOP_GATE6B2_STATE_PATH: statePath,
      CODEX_LOOP_GATE6B2_TARGET_REPO: targetRepo,
      CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR: resolve(tempDir, "triage")
    }
  };
}

function writeSeededGapState(context: ReturnType<typeof createContext>, devWorkerOverrides: Record<string, unknown>): void {
  writeTarget(context.targetRepo, "docs/PRD.md", "# PRD\n");
  writeTarget(context.targetRepo, "docs/TASK_GRAPH.json", "{}\n");
  writeTarget(context.targetRepo, "artifacts/planner-result.json", "{}\n");
  writeTarget(context.targetRepo, "artifacts/dev-result.json", "{}\n");
  writeFileSync(
    context.statePath,
    `${JSON.stringify(
      {
        gate: "Gate 6B.2 SDK-Orchestrated Repair Loop E2E",
        target_repo: context.targetRepo,
        current_stage: "DEV_DONE",
        planner: {
          status: "PASS",
          thread_id: "thread_planner",
          prd_path: "docs/PRD.md",
          task_graph_path: "docs/TASK_GRAPH.json",
          planner_result_path: "artifacts/planner-result.json",
          artifact_thread_evidence_verified: true
        },
        dev_worker: {
          status: "PASS",
          thread_id: "thread_dev",
          dev_result_path: "artifacts/dev-result.json",
          file_change_verified: true,
          baseline_tests_passed: true,
          full_tests_expected_to_fail: true,
          full_tests_failed: true,
          known_gap_seeded: true,
          ...devWorkerOverrides
        },
        initial_evaluator: {
          status: "",
          thread_id: "",
          eval_report_path: "",
          eval_verdict: ""
        },
        repair_request: {
          status: "",
          repair_request_path: "",
          source_eval_report_path: "",
          required_fixes_count: 0
        },
        repair_dev_worker: {
          status: "",
          thread_id: "",
          repair_result_path: "",
          file_change_verified: false,
          tests_passed: false
        },
        final_evaluator: {
          status: "",
          thread_id: "",
          eval_report_path: "",
          eval_verdict: ""
        },
        final_report: {
          status: "",
          path: ""
        },
        errors: []
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function runJson(script: string, env: NodeJS.ProcessEnv, artifactPath: string): Record<string, unknown> {
  try {
    execFileSync(process.execPath, [script], {
      cwd: process.cwd(),
      env,
      stdio: "pipe"
    });
  } catch {
    // Blocking results still write their JSON artifact.
  }
  return JSON.parse(readFileSync(artifactPath, "utf8")) as Record<string, unknown>;
}

function writeTarget(root: string, path: string, value: string): void {
  const absolute = resolve(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, "utf8");
}
