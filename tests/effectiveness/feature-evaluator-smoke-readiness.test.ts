import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  featureEvaluatorModeResultPath,
  gateFeatureEvaluatorSmokeMode,
  reconstructFeatureEvaluatorSmokeReadiness,
  updateFeatureEvaluatorSmokeReadinessFromResult,
  type FeatureEvaluatorSmokeResultLike
} from "../../src/effectiveness/feature-evaluator-smoke-readiness.ts";
import { runFeatureEvaluatorSmoke } from "../../scripts/effectiveness/run-feature-evaluator-smoke.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("feature evaluator smoke readiness", () => {
  it("writes parity PASS into readiness", () => {
    const repoRoot = tempRoot("feature-evaluator-readiness-parity-");
    updateFeatureEvaluatorSmokeReadinessFromResult(repoRoot, passResult("parity", "thread_parity"));

    const readiness = reconstructFeatureEvaluatorSmokeReadiness(repoRoot, { write: true });

    expect(readiness.parity.status).toBe("PASS");
    expect(readiness.parity.thread_id).toBe("thread_parity");
    expect(readiness.ready_for_output_minimal).toBe(false);
  });

  it("writes text-only PASS into readiness", () => {
    const repoRoot = tempRoot("feature-evaluator-readiness-text-");
    updateFeatureEvaluatorSmokeReadinessFromResult(repoRoot, passResult("parity", "thread_parity"));
    updateFeatureEvaluatorSmokeReadinessFromResult(repoRoot, passResult("text-only", "thread_text"));

    const readiness = reconstructFeatureEvaluatorSmokeReadiness(repoRoot, { write: true });

    expect(readiness.text_only.status).toBe("PASS");
    expect(readiness.text_only.thread_id).toBe("thread_text");
  });

  it("marks ready_for_output_minimal after parity and text-only PASS", () => {
    const repoRoot = tempRoot("feature-evaluator-readiness-output-minimal-");
    updateFeatureEvaluatorSmokeReadinessFromResult(repoRoot, passResult("parity", "thread_parity"));
    updateFeatureEvaluatorSmokeReadinessFromResult(repoRoot, passResult("text-only", "thread_text"));

    const readiness = reconstructFeatureEvaluatorSmokeReadiness(repoRoot, { write: true });

    expect(readiness.ready_for_output_minimal).toBe(true);
    expect(gateFeatureEvaluatorSmokeMode(readiness, "output-minimal").ok).toBe(true);
  });

  it("blocks output-lite before output-minimal with a specific category", () => {
    const repoRoot = tempRoot("feature-evaluator-readiness-output-lite-block-");
    updateFeatureEvaluatorSmokeReadinessFromResult(repoRoot, passResult("parity", "thread_parity"));
    updateFeatureEvaluatorSmokeReadinessFromResult(repoRoot, passResult("text-only", "thread_text"));

    const readiness = reconstructFeatureEvaluatorSmokeReadiness(repoRoot, { write: true });
    const gate = gateFeatureEvaluatorSmokeMode(readiness, "output-lite");

    expect(gate.ok).toBe(false);
    expect(gate.status).toBe("BLOCKED_EVALUATOR_OUTPUT_MINIMAL_NOT_PASSED");
  });

  it("does not clear parity/text-only PASS when output-lite is blocked", () => {
    const repoRoot = tempRoot("feature-evaluator-readiness-preserve-");
    updateFeatureEvaluatorSmokeReadinessFromResult(repoRoot, passResult("parity", "thread_parity"));
    updateFeatureEvaluatorSmokeReadinessFromResult(repoRoot, passResult("text-only", "thread_text"));
    updateFeatureEvaluatorSmokeReadinessFromResult(repoRoot, {
      ...blockedResult("output-lite", "BLOCKED_EVALUATOR_OUTPUT_MINIMAL_NOT_PASSED"),
      failure_category: "BLOCKED_EVALUATOR_OUTPUT_MINIMAL_NOT_PASSED"
    });

    const readiness = reconstructFeatureEvaluatorSmokeReadiness(repoRoot, { write: true });

    expect(readiness.parity.status).toBe("PASS");
    expect(readiness.text_only.status).toBe("PASS");
    expect(readiness.output_lite.status).toBe("BLOCKED");
    expect(readiness.blocked_attempt?.status).toBe("BLOCKED_EVALUATOR_OUTPUT_MINIMAL_NOT_PASSED");
  });

  it("marks ready_for_output_lite after output-minimal PASS", () => {
    const repoRoot = tempRoot("feature-evaluator-readiness-output-lite-");
    seedPasses(repoRoot, ["parity", "text-only", "output-minimal"]);

    const readiness = reconstructFeatureEvaluatorSmokeReadiness(repoRoot, { write: true });

    expect(readiness.ready_for_output_lite).toBe(true);
  });

  it("marks ready_for_exact after output-lite PASS", () => {
    const repoRoot = tempRoot("feature-evaluator-readiness-exact-");
    seedPasses(repoRoot, ["parity", "text-only", "output-minimal", "output-lite"]);

    const readiness = reconstructFeatureEvaluatorSmokeReadiness(repoRoot, { write: true });

    expect(readiness.ready_for_exact).toBe(true);
  });

  it("marks ready_for_treatment_rerun after exact PASS", () => {
    const repoRoot = tempRoot("feature-evaluator-readiness-treatment-");
    seedPasses(repoRoot, ["parity", "text-only", "output-minimal", "output-lite", "exact"]);

    const readiness = reconstructFeatureEvaluatorSmokeReadiness(repoRoot, { write: true });

    expect(readiness.ready_for_treatment_rerun).toBe(true);
  });

  it("reconstructs readiness from mode-specific results", () => {
    const repoRoot = tempRoot("feature-evaluator-readiness-reconstruct-");
    writeJson(featureEvaluatorModeResultPath(repoRoot, "parity"), passResult("parity", "thread_parity"));
    writeJson(featureEvaluatorModeResultPath(repoRoot, "text-only"), passResult("text-only", "thread_text"));

    const readiness = reconstructFeatureEvaluatorSmokeReadiness(repoRoot, { write: true });

    expect(readiness.parity.status).toBe("PASS");
    expect(readiness.text_only.status).toBe("PASS");
    expect(readiness.ready_for_output_minimal).toBe(true);
    expect(readiness.reconstruction_status).toBe("PASS");
  });

  it("dry-run does not start a real SDK thread", async () => {
    const repoRoot = tempRoot("feature-evaluator-readiness-dry-run-");
    const result = await runFeatureEvaluatorSmoke({ repoRoot, env: {} });

    expect(result.status).toBe("BLOCKED_FEATURE_EVALUATOR_SMOKE_NOT_ENABLED");
    expect(result.real_sdk_run_executed).toBe(false);
    expect(result.evaluator_thread_started).toBe(false);
  });

  it("dry-run does not overwrite existing mode-specific PASS evidence", async () => {
    const repoRoot = tempRoot("feature-evaluator-readiness-dry-preserve-");
    const pass = passResult("parity", "thread_parity");
    writeJson(featureEvaluatorModeResultPath(repoRoot, "parity"), pass);
    updateFeatureEvaluatorSmokeReadinessFromResult(repoRoot, pass);

    const result = await runFeatureEvaluatorSmoke({ repoRoot, env: {} });
    const stored = JSON.parse(readFileSync(featureEvaluatorModeResultPath(repoRoot, "parity"), "utf8")) as FeatureEvaluatorSmokeResultLike;

    expect(result.status).toBe("BLOCKED_FEATURE_EVALUATOR_SMOKE_NOT_ENABLED");
    expect(stored.status).toBe("PASS");
    expect(stored.evaluator_thread_id).toBe("thread_parity");
  });
});

function seedPasses(repoRoot: string, modes: Array<FeatureEvaluatorSmokeResultLike["mode"]>): void {
  for (const mode of modes) {
    if (typeof mode === "string") {
      updateFeatureEvaluatorSmokeReadinessFromResult(repoRoot, passResult(mode, `thread_${mode}`));
    }
  }
}

function passResult(mode: string, threadId: string): FeatureEvaluatorSmokeResultLike {
  return {
    case_id: "feature-small-001",
    status: "PASS",
    mode,
    evaluator_thread_started: true,
    evaluator_thread_id: threadId,
    structured_output_valid: true,
    artifact_thread_evidence_verified: true,
    final_response_contains_expected: true,
    eval_verdict: mode === "parity" ? "" : "PASS",
    sdk_method: "run",
    failure_category: ""
  };
}

function blockedResult(mode: string, status: string): FeatureEvaluatorSmokeResultLike {
  return {
    case_id: "feature-small-001",
    status,
    mode,
    evaluator_thread_started: false,
    evaluator_thread_id: "",
    structured_output_valid: false,
    artifact_thread_evidence_verified: false,
    final_response_contains_expected: false,
    failure_category: status
  };
}

function tempRoot(prefix: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), prefix));
  tempDirs.push(dir);
  mkdirSync(resolve(dir, "evals/effectiveness/reports/feature-small-001/sdk-stage-logs"), { recursive: true });
  mkdirSync(resolve(dir, "evals/effectiveness/runs/feature-small-001/treatment/target-repo"), { recursive: true });
  mkdirSync(resolve(dir, ".codex-eval/sqlite"), { recursive: true });
  return dir;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
