import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { writeFeaturePlannerInvocationDiff } from "../../scripts/effectiveness/diff-feature-planner-vs-repair-planner.ts";
import { runFeaturePlannerSmoke } from "../../scripts/effectiveness/run-feature-planner-smoke.ts";
import { verifyFeaturePlannerSmoke } from "../../scripts/effectiveness/verify-feature-planner-smoke.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("feature planner smoke harness", () => {
  it("defaults to blocked without starting a real SDK thread", async () => {
    const repoRoot = tempRoot("feature-planner-smoke-blocked-");
    const result = await runFeaturePlannerSmoke({
      repoRoot,
      env: {}
    });
    const verify = verifyFeaturePlannerSmoke(repoRoot);

    expect(result.status).toBe("BLOCKED_FEATURE_PLANNER_SMOKE_NOT_ENABLED");
    expect(result.real_sdk_run_executed).toBe(false);
    expect(result.sdk_diagnosis.dynamic_import_codex_sdk_ok).toBe(true);
    expect(result.sdk_diagnosis.codex_named_export_available).toBe(true);
    expect(result.sdk_diagnosis.codex_sdk_export_keys).toContain("Codex");
    expect(verify.status).toBe("PASS");
    expect(verify.sdk_dependency_detected).toBe(true);
    expect(verify.sdk_dynamic_import_ok).toBe(true);
    expect(verify.ready_for_one_feature_planner_parity_smoke).toBe(true);
  });

  it("passes parity mode with mock SDK", async () => {
    const repoRoot = tempRoot("feature-planner-smoke-parity-");
    const result = await runFeaturePlannerSmoke({
      repoRoot,
      env: {
        CODEX_LOOP_ENABLE_M12_FEATURE_PLANNER_SMOKE: "1",
        CODEX_LOOP_FEATURE_PLANNER_SMOKE_MODE: "parity",
        CODEX_LOOP_FEATURE_PLANNER_SMOKE_MOCK: "pass"
      }
    });

    expect(result.status).toBe("PASS");
    expect(result.planner_thread_started).toBe(true);
    expect(result.structured_output_valid).toBe(true);
    expect(result.real_sdk_run_executed).toBe(false);
  });

  it("passes lite-minimal mode with mock SDK", async () => {
    const repoRoot = tempRoot("feature-planner-smoke-lite-");
    const result = await runFeaturePlannerSmoke({
      repoRoot,
      env: {
        CODEX_LOOP_ENABLE_M12_FEATURE_PLANNER_SMOKE: "1",
        CODEX_LOOP_FEATURE_PLANNER_SMOKE_MODE: "lite-minimal",
        CODEX_LOOP_FEATURE_PLANNER_SMOKE_MOCK: "pass"
      }
    });

    expect(result.status).toBe("PASS");
    expect(result.tasks_count).toBeGreaterThanOrEqual(1);
    expect(result.no_task_graph_json).toBe(true);
  });

  it("passes exact mode with mock SDK and marks rerun readiness", async () => {
    const repoRoot = tempRoot("feature-planner-smoke-exact-");
    const result = await runFeaturePlannerSmoke({
      repoRoot,
      env: {
        CODEX_LOOP_ENABLE_M12_FEATURE_PLANNER_SMOKE: "1",
        CODEX_LOOP_FEATURE_PLANNER_SMOKE_MODE: "exact",
        CODEX_LOOP_FEATURE_PLANNER_SMOKE_MOCK: "pass"
      }
    });

    expect(result.status).toBe("PASS");
    expect(result.ready_for_feature_treatment_fresh_rerun).toBe(true);
  });

  it("classifies parity pass plus lite-minimal fail as output failure in sequence", async () => {
    const repoRoot = tempRoot("feature-planner-smoke-lite-fail-");
    const parity = await runFeaturePlannerSmoke({
      repoRoot,
      mode: "parity",
      env: {
        CODEX_LOOP_ENABLE_M12_FEATURE_PLANNER_SMOKE: "1",
        CODEX_LOOP_FEATURE_PLANNER_SMOKE_MOCK: "pass"
      }
    });
    const lite = await runFeaturePlannerSmoke({
      repoRoot,
      mode: "lite-minimal",
      env: {
        CODEX_LOOP_ENABLE_M12_FEATURE_PLANNER_SMOKE: "1",
        CODEX_LOOP_FEATURE_PLANNER_SMOKE_MOCK: "fail"
      }
    });
    const category = parity.status === "PASS" && lite.status !== "PASS"
      ? "FEATURE_PLANNER_LITE_V2_OUTPUT_FAILURE"
      : "";

    expect(category).toBe("FEATURE_PLANNER_LITE_V2_OUTPUT_FAILURE");
  });

  it("classifies lite-minimal pass plus exact fail as prompt timeout or complexity in sequence", async () => {
    const repoRoot = tempRoot("feature-planner-smoke-exact-fail-");
    const lite = await runFeaturePlannerSmoke({
      repoRoot,
      mode: "lite-minimal",
      env: {
        CODEX_LOOP_ENABLE_M12_FEATURE_PLANNER_SMOKE: "1",
        CODEX_LOOP_FEATURE_PLANNER_SMOKE_MOCK: "pass"
      }
    });
    const exact = await runFeaturePlannerSmoke({
      repoRoot,
      mode: "exact",
      env: {
        CODEX_LOOP_ENABLE_M12_FEATURE_PLANNER_SMOKE: "1",
        CODEX_LOOP_FEATURE_PLANNER_SMOKE_MOCK: "fail"
      }
    });
    const category = lite.status === "PASS" && exact.status !== "PASS"
      ? "FEATURE_PLANNER_PROMPT_TIMEOUT_OR_COMPLEXITY"
      : "";

    expect(category).toBe("FEATURE_PLANNER_PROMPT_TIMEOUT_OR_COMPLEXITY");
  });

  it("invocation diff detects prompt length differences", () => {
    const repoRoot = tempRoot("feature-planner-diff-");
    writeTrace(resolve(repoRoot, "evals/effectiveness/reports/feature-small-001/sdk-stage-logs/generic-planner-invocation-trace-redacted.json"), {
      prompt: { length: 1200, hash: "feature" },
      run_options: { outputSchemaHash: "4eb7a92b5497403e234940e49f9dcdf234d805eb037f1dc3d6683b8651f330de", usesRunStreamed: true },
      start_thread_options: { workingDirectory: resolve(repoRoot, "feature"), sandboxMode: "read-only", model: "gpt-test" },
      constructor_options: { config_values_redacted: { sqlite_home: "/tmp/sqlite", model_catalog_json: "/tmp/catalog.json", model: "gpt-test" } },
      sdk_api_method: "runStreamed"
    });
    writeTrace(resolve(repoRoot, "evals/effectiveness/reports/repair-loop-001/sdk-stage-logs/gate6b2-planner-invocation-trace-redacted.json"), {
      prompt: { length: 400, hash: "repair" },
      run_options: { outputSchemaHash: "4eb7a92b5497403e234940e49f9dcdf234d805eb037f1dc3d6683b8651f330de", usesRunStreamed: true },
      start_thread_options: { workingDirectory: resolve(repoRoot, "repair"), sandboxMode: "read-only", model: "gpt-test" },
      constructor_options: { config_values_redacted: { sqlite_home: "/tmp/sqlite", model_catalog_json: "/tmp/catalog.json", model: "gpt-test" } },
      sdk_api_method: "runStreamed"
    });
    writeTrace(resolve(repoRoot, "evals/effectiveness/reports/feature-small-001/sdk-stage-logs/planner-schema-invocation-trace-redacted.json"), {
      planner_output_contract_version: "v2"
    });
    writeTrace(resolve(repoRoot, "evals/effectiveness/reports/repair-loop-001/sdk-stage-logs/planner-schema-invocation-trace-redacted.json"), {
      planner_output_contract_version: "v2"
    });

    const diff = writeFeaturePlannerInvocationDiff(repoRoot);

    expect(diff.critical_diffs).toContain("promptLength");
    expect(diff.failure_category).toBe("FEATURE_PLANNER_PROMPT_TOO_LARGE");
  });
});

function tempRoot(prefix: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), prefix));
  tempDirs.push(dir);
  mkdirSync(resolve(dir, "evals/effectiveness/reports/feature-small-001"), { recursive: true });
  mkdirSync(resolve(dir, "evals/effectiveness/runs/feature-small-001/treatment/target-repo"), { recursive: true });
  mkdirSync(resolve(dir, ".codex-eval/sqlite"), { recursive: true });
  return dir;
}

function writeTrace(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  expect(readFileSync(path, "utf8").length).toBeGreaterThan(0);
}
