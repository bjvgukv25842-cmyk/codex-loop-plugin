import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const prepareScript = resolve(process.cwd(), "scripts/sdk-orchestrated/prepare-gate6b-checkpoint.ts");
const plannerScript = resolve(process.cwd(), "scripts/sdk-orchestrated/run-gate6b-checkpoint-planner.ts");
const devWorkerScript = resolve(process.cwd(), "scripts/sdk-orchestrated/run-gate6b-checkpoint-dev-worker.ts");
const evaluatorScript = resolve(process.cwd(), "scripts/sdk-orchestrated/run-gate6b-checkpoint-evaluator.ts");
const verifyScript = resolve(process.cwd(), "scripts/sdk-orchestrated/verify-gate6b-checkpoint.ts");

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("Gate 6B checkpoint scripts", () => {
  it("prepare creates initial checkpoint state", () => {
    const context = createContext();
    run(prepareScript, context.env);
    const state = readJson(context.statePath);

    expect(state.current_stage).toBe("PREPARED");
    expect(state.planner).toEqual(expect.objectContaining({ thread_id: "" }));
  });

  it("planner checkpoint defaults to dry-run blocked without SDK env flag", () => {
    const context = createContext();
    run(prepareScript, context.env);
    const result = runJson(plannerScript, context.env, context.plannerResultPath);

    expect(result.status).toBe("BLOCKED_SDK_NOT_ENABLED");
    expect(result.real_sdk_run_executed).toBe(false);
  });

  it("dev worker checkpoint requires PLANNER_DONE", () => {
    const context = createContext();
    run(prepareScript, context.env);
    const result = runJson(devWorkerScript, { ...context.env, CODEX_LOOP_GATE6B_CHECKPOINT_MOCK: "pass" }, context.devResultPath);

    expect(result.status).toBe("BLOCKED_PLANNER_CHECKPOINT_MISSING");
  });

  it("evaluator checkpoint requires DEV_WORKER_DONE", () => {
    const context = createContext();
    run(prepareScript, context.env);
    writePlannerDoneState(context);
    const result = runJson(evaluatorScript, { ...context.env, CODEX_LOOP_GATE6B_CHECKPOINT_MOCK: "pass" }, context.evalResultPath);

    expect(result.status).toBe("BLOCKED_DEV_WORKER_CHECKPOINT_MISSING");
  });

  it("runs checkpointed planner, dev worker, evaluator through mock SDK and verifies PASS", () => {
    const context = createContext();
    run(prepareScript, context.env);
    writeDevWorkerBaseline(context.targetRepo, context.triageDir);

    expect(runJson(plannerScript, { ...context.env, CODEX_LOOP_GATE6B_CHECKPOINT_MOCK: "pass" }, context.plannerResultPath).status).toBe("PASS");
    expect(runJson(verifyScript, context.env, context.verifyPath).status).toBe("PARTIAL_PASS_PLANNER_ONLY");
    expect(runJson(devWorkerScript, { ...context.env, CODEX_LOOP_GATE6B_CHECKPOINT_MOCK: "pass" }, context.devResultPath).status).toBe("PASS");
    expect(runJson(verifyScript, context.env, context.verifyPath).status).toBe("PARTIAL_PASS_DEV_WORKER_ONLY");
    expect(runJson(evaluatorScript, { ...context.env, CODEX_LOOP_GATE6B_CHECKPOINT_MOCK: "pass" }, context.evalResultPath).status).toBe("PASS");
    const verify = runJson(verifyScript, context.env, context.verifyPath);

    expect(verify.status).toBe("PASS");
    expect(verify.evaluator_eval_verdict).toBe("PASS");
  });

  it("allows evaluator retry from FAILED state when dev worker checkpoint passed", () => {
    const context = createContext();
    run(prepareScript, context.env);
    writeFailedAfterDevWorkerState(context);
    const retryVerify = runJson(verifyScript, context.env, context.verifyPath);
    expect(retryVerify.status).toBe("EVALUATOR_STAGE_FAILED");
    expect(retryVerify.evaluator_retry_from_dev_worker_done).toBe(true);

    const result = runJson(evaluatorScript, { ...context.env, CODEX_LOOP_GATE6B_CHECKPOINT_MOCK: "pass" }, context.evalResultPath);
    const state = readJson(context.statePath);

    expect(result.status).toBe("PASS");
    expect(result.retry_classification).toBe("EVALUATOR_RETRY_FROM_DEV_WORKER_DONE");
    expect(state.current_stage).toBe("EVALUATOR_DONE");
  });
});

function createContext(): {
  tempDir: string;
  targetRepo: string;
  triageDir: string;
  statePath: string;
  plannerResultPath: string;
  devResultPath: string;
  evalResultPath: string;
  verifyPath: string;
  env: NodeJS.ProcessEnv;
} {
  const tempDir = mkdtempSync(resolve(tmpdir(), "gate6b-checkpoint-test-"));
  tempDirs.push(tempDir);
  const targetRepo = resolve(tempDir, "target");
  const triageDir = resolve(tempDir, "triage");
  const statePath = resolve(tempDir, "checkpoint-state.json");
  return {
    tempDir,
    targetRepo,
    triageDir,
    statePath,
    plannerResultPath: resolve(process.cwd(), "evals/sdk-orchestrated/reports/gate6b-checkpoint-planner-result.json"),
    devResultPath: resolve(process.cwd(), "evals/sdk-orchestrated/reports/gate6b-checkpoint-dev-worker-result.json"),
    evalResultPath: resolve(process.cwd(), "evals/sdk-orchestrated/reports/gate6b-checkpoint-evaluator-result.json"),
    verifyPath: resolve(process.cwd(), "evals/sdk-orchestrated/reports/gate6b-checkpoint-verify.json"),
    env: {
      ...process.env,
      CODEX_LOOP_GATE6B_CHECKPOINT_STATE_PATH: statePath,
      CODEX_LOOP_GATE6B_SMOKE_TARGET_REPO: targetRepo,
      CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR: triageDir
    }
  };
}

function run(script: string, env: NodeJS.ProcessEnv): void {
  execFileSync(process.execPath, [script], {
    cwd: process.cwd(),
    env,
    stdio: "pipe"
  });
}

function runJson(script: string, env: NodeJS.ProcessEnv, artifactPath: string): Record<string, unknown> {
  try {
    run(script, env);
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
        gate: "Gate 6B.1L Checkpointed SDK Smoke",
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
          tests_passed: false
        },
        evaluator: {
          status: "",
          thread_id: "",
          eval_report_path: "",
          eval_verdict: ""
        },
        errors: []
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function writeDevWorkerBaseline(targetRepo: string, triageDir: string): void {
  mkdirSync(triageDir, { recursive: true });
  writeFileSync(
    resolve(triageDir, "dev-worker-baseline.json"),
    `${JSON.stringify(
      {
        target_repo: targetRepo,
        src_project_name_hash_before: "broken-hash",
        package_json_hash_before: "package-hash",
        test_project_name_hash_before: "test-hash",
        initial_tests_run: true,
        initial_tests_expected_to_fail: true,
        initial_tests_failed: true,
        fixture_status: "BROKEN_AS_EXPECTED"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function writeFailedAfterDevWorkerState(context: ReturnType<typeof createContext>): void {
  writeTarget(context.targetRepo, "docs/PRD.md", "# PRD\n");
  writeTarget(context.targetRepo, "docs/TASK_GRAPH.json", "{}\n");
  writeTarget(context.targetRepo, "artifacts/planner-result.json", "{}\n");
  writeTarget(context.targetRepo, "artifacts/dev-result.json", "{}\n");
  writeFileSync(
    context.statePath,
    `${JSON.stringify(
      {
        gate: "Gate 6B.1L Checkpointed SDK Smoke",
        target_repo: context.targetRepo,
        current_stage: "FAILED",
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
          tests_passed: true
        },
        evaluator: {
          status: "FAILED",
          thread_id: "",
          eval_report_path: "",
          eval_verdict: ""
        },
        errors: ["Codex Exec exited with code 1: Reading prompt from stdin..."]
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
