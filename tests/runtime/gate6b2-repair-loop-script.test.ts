import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scripts = {
  prepare: resolve(process.cwd(), "scripts/sdk-orchestrated/prepare-gate6b2-repair-loop.ts"),
  planner: resolve(process.cwd(), "scripts/sdk-orchestrated/run-gate6b2-planner.ts"),
  devWorker: resolve(process.cwd(), "scripts/sdk-orchestrated/run-gate6b2-dev-worker.ts"),
  initialEvaluator: resolve(process.cwd(), "scripts/sdk-orchestrated/run-gate6b2-initial-evaluator.ts"),
  repairRequest: resolve(process.cwd(), "scripts/sdk-orchestrated/create-gate6b2-repair-request.ts"),
  repairDevWorker: resolve(process.cwd(), "scripts/sdk-orchestrated/run-gate6b2-repair-dev-worker.ts"),
  finalEvaluator: resolve(process.cwd(), "scripts/sdk-orchestrated/run-gate6b2-final-evaluator.ts"),
  finalReport: resolve(process.cwd(), "scripts/sdk-orchestrated/write-gate6b2-final-report.ts"),
  verify: resolve(process.cwd(), "scripts/sdk-orchestrated/verify-gate6b2-repair-loop.ts")
};

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("Gate 6B.2 repair-loop scripts", () => {
  it("prepare creates target repo and repair-loop state", () => {
    const context = createContext();
    const result = runJson(scripts.prepare, context.env, context.prepareResultPath);
    const state = readJson(context.statePath);
    const packageJson = readJson(resolve(context.targetRepo, "package.json"));

    expect(result.status).toBe("PASS");
    expect(state.current_stage).toBe("PREPARED");
    expect(result.seeded_gap_fixture_created).toBe(true);
    expect(result.initial_baseline_tests_failed).toBe(true);
    expect(result.initial_full_tests_failed).toBe(true);
    expect(packageJson.scripts).toEqual(
      expect.objectContaining({
        test: "npm run test:full",
        "test:baseline": "node --test test/project-name.baseline.test.js",
        "test:full": "node --test test/project-name.full.test.js"
      })
    );
    expect(readFileSync(resolve(context.targetRepo, "test/project-name.baseline.test.js"), "utf8")).not.toContain("whitespace-only");
    expect(readFileSync(resolve(context.targetRepo, "test/project-name.full.test.js"), "utf8")).toContain("whitespace-only");
  }, 15_000);

  it("planner defaults to dry-run blocked without SDK env flag", () => {
    const context = createContext();
    runJson(scripts.prepare, context.env, context.prepareResultPath);
    const result = runJson(scripts.planner, context.env, context.plannerResultPath);

    expect(result.status).toBe("BLOCKED_SDK_NOT_ENABLED");
    expect(result.real_sdk_run_executed).toBe(false);
  }, 15_000);

  it("initial dev worker defaults to dry-run blocked without SDK env flag", () => {
    const context = createContext();
    runJson(scripts.prepare, context.env, context.prepareResultPath);
    writePlannerDoneState(context);

    const result = runJson(scripts.devWorker, context.env, context.devResultPath);

    expect(result.status).toBe("BLOCKED_SDK_NOT_ENABLED");
    expect(result.real_sdk_run_executed).toBe(false);
  }, 15_000);

  it("runs full repair-loop harness through mock SDK and verifies PASS", () => {
    const context = createContext();
    runJson(scripts.prepare, context.env, context.prepareResultPath);

    expect(runJson(scripts.planner, mockEnv(context), context.plannerResultPath).status).toBe("PASS");
    const devWorker = runJson(scripts.devWorker, mockEnv(context), context.devResultPath);
    expect(devWorker.status).toBe("PASS");
    expect(devWorker.known_gap_seeded).toBe(true);
    expect(devWorker.baseline_tests_passed).toBe(true);
    expect(devWorker.full_tests_failed).toBe(true);
    expect(runJson(scripts.initialEvaluator, mockEnv(context), context.initialEvalResultPath).status).toBe("PASS");
    expect(runJson(scripts.repairRequest, context.env, context.repairRequestResultPath).status).toBe("PASS");
    expect(runJson(scripts.repairDevWorker, mockEnv(context), context.repairDevResultPath).status).toBe("PASS");
    expect(runJson(scripts.finalEvaluator, mockEnv(context), context.finalEvalResultPath).status).toBe("PASS");
    expect(runJson(scripts.finalReport, context.env, context.finalReportResultPath).status).toBe("PASS");
    const verify = runJson(scripts.verify, context.env, context.verifyPath);

    expect(verify.status).toBe("PASS");
    expect(verify.initial_eval_verdict).toBe("NEEDS_REVISION");
    expect(verify.final_eval_verdict).toBe("PASS");
    expect(verify.ready_for_m12).toBe(false);
  }, 20_000);

  it("blocks repair request when initial evaluator did not produce NEEDS_REVISION", () => {
    const context = createContext();
    runJson(scripts.prepare, context.env, context.prepareResultPath);
    writeInitialEvaluatorPassState(context);
    const result = runJson(scripts.repairRequest, context.env, context.repairRequestResultPath);

    expect(result.status).toBe("INITIAL_EVALUATOR_DID_NOT_CATCH_SEEDED_GAP");
  }, 15_000);
});

function createContext(): {
  tempDir: string;
  targetRepo: string;
  triageDir: string;
  statePath: string;
  prepareResultPath: string;
  plannerResultPath: string;
  devResultPath: string;
  initialEvalResultPath: string;
  repairRequestResultPath: string;
  repairDevResultPath: string;
  finalEvalResultPath: string;
  finalReportResultPath: string;
  verifyPath: string;
  env: NodeJS.ProcessEnv;
} {
  const tempDir = mkdtempSync(resolve(tmpdir(), "gate6b2-script-test-"));
  tempDirs.push(tempDir);
  const targetRepo = resolve(tempDir, "target");
  const triageDir = resolve(tempDir, "triage");
  const statePath = resolve(tempDir, "repair-loop-state.json");
  return {
    tempDir,
    targetRepo,
    triageDir,
    statePath,
    prepareResultPath: resolve(process.cwd(), "evals/sdk-orchestrated/reports/gate6b2-prepare-result.json"),
    plannerResultPath: resolve(process.cwd(), "evals/sdk-orchestrated/reports/gate6b2-planner-result.json"),
    devResultPath: resolve(process.cwd(), "evals/sdk-orchestrated/reports/gate6b2-dev-worker-result.json"),
    initialEvalResultPath: resolve(process.cwd(), "evals/sdk-orchestrated/reports/gate6b2-initial-evaluator-result.json"),
    repairRequestResultPath: resolve(process.cwd(), "evals/sdk-orchestrated/reports/gate6b2-repair-request-result.json"),
    repairDevResultPath: resolve(process.cwd(), "evals/sdk-orchestrated/reports/gate6b2-repair-dev-worker-result.json"),
    finalEvalResultPath: resolve(process.cwd(), "evals/sdk-orchestrated/reports/gate6b2-final-evaluator-result.json"),
    finalReportResultPath: resolve(process.cwd(), "evals/sdk-orchestrated/reports/gate6b2-final-report-result.json"),
    verifyPath: resolve(process.cwd(), "evals/sdk-orchestrated/reports/gate6b2-repair-loop-verify.json"),
    env: {
      ...process.env,
      CODEX_LOOP_GATE6B2_STATE_PATH: statePath,
      CODEX_LOOP_GATE6B2_TARGET_REPO: targetRepo,
      CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR: triageDir
    }
  };
}

function mockEnv(context: ReturnType<typeof createContext>): NodeJS.ProcessEnv {
  return {
    ...context.env,
    CODEX_LOOP_GATE6B2_MOCK: "pass"
  };
}

function runJson(script: string, env: NodeJS.ProcessEnv, artifactPath: string): Record<string, unknown> {
  try {
    execFileSync(process.execPath, [script], {
      cwd: process.cwd(),
      env,
      stdio: "pipe"
    });
  } catch {
    // Negative cases still write their result artifact.
  }
  return readJson(artifactPath);
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function writePlannerDoneState(context: ReturnType<typeof createContext>): void {
  writeTarget(context.targetRepo, "docs/PRD.md", "# PRD\n");
  writeTarget(context.targetRepo, "docs/TASK_GRAPH.json", "{}\n");
  writeTarget(context.targetRepo, "artifacts/planner-result.json", "{}\n");
  writeFileSync(
    context.statePath,
    `${JSON.stringify(
      {
        gate: "Gate 6B.2 SDK-Orchestrated Repair Loop E2E",
        target_repo: context.targetRepo,
        current_stage: "PLANNER_DONE",
        planner: {
          status: "PASS",
          thread_id: "thread_planner",
          prd_path: "docs/PRD.md",
          task_graph_path: "docs/TASK_GRAPH.json",
          planner_result_path: "artifacts/planner-result.json",
          artifact_thread_evidence_verified: true
        },
        dev_worker: {
          status: "",
          thread_id: "",
          dev_result_path: "",
          file_change_verified: false,
          baseline_tests_passed: false,
          full_tests_expected_to_fail: false,
          full_tests_failed: false,
          known_gap_seeded: false
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

function writeInitialEvaluatorPassState(context: ReturnType<typeof createContext>): void {
  writeTarget(context.targetRepo, "docs/PRD.md", "# PRD\n");
  writeTarget(context.targetRepo, "docs/TASK_GRAPH.json", "{}\n");
  writeTarget(context.targetRepo, "artifacts/planner-result.json", "{}\n");
  writeTarget(context.targetRepo, "artifacts/dev-result.json", "{}\n");
  writeTarget(context.targetRepo, "artifacts/eval-report-needs-revision.json", "{}\n");
  writeFileSync(
    context.statePath,
    `${JSON.stringify(
      {
        gate: "Gate 6B.2 SDK-Orchestrated Repair Loop E2E",
        target_repo: context.targetRepo,
        current_stage: "INITIAL_EVAL_DONE",
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
          known_gap_seeded: true
        },
        initial_evaluator: {
          status: "PASS",
          thread_id: "thread_eval",
          eval_report_path: "artifacts/eval-report-needs-revision.json",
          eval_verdict: "PASS"
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

function writeTarget(root: string, path: string, value: string): void {
  const absolute = resolve(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, "utf8");
}
