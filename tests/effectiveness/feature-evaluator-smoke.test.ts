import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  classifyFeatureEvaluatorParityFailure,
  featureEvaluatorExactPathMatchesTreatment,
  featureEvaluatorStageConfig,
  FEATURE_EVALUATOR_PARITY_PROMPT,
  FEATURE_EVALUATOR_PROMPT_MAX_LENGTH
} from "../../src/effectiveness/feature-evaluator-stage.ts";
import { updateFeatureEvaluatorSmokeReadinessFromResult } from "../../src/effectiveness/feature-evaluator-smoke-readiness.ts";
import { diffFeatureEvaluatorParityInvocation } from "../../scripts/effectiveness/diff-feature-evaluator-parity-invocation.ts";
import { parseFeatureEvaluatorCliParity } from "../../scripts/effectiveness/parse-feature-evaluator-cli-parity.ts";
import { printFeatureEvaluatorCliParity } from "../../scripts/effectiveness/print-feature-evaluator-cli-parity.ts";
import { writeFeatureEvaluatorParityTimeoutTriage } from "../../scripts/effectiveness/triage-feature-evaluator-parity-timeout.ts";
import { runFeatureEvaluatorSmoke } from "../../scripts/effectiveness/run-feature-evaluator-smoke.ts";
import { verifyFeatureEvaluatorSmoke } from "../../scripts/effectiveness/verify-feature-evaluator-smoke.ts";
import { writeFeatureEvaluatorTimeoutTriage } from "../../scripts/effectiveness/triage-feature-evaluator-timeout.ts";
import { writeSdkEvaluatorMethodTriage } from "../../scripts/effectiveness/triage-sdk-evaluator-method.ts";
import type {
  RuntimeAdapter
} from "../../src/runtime/runtime-adapter.ts";
import type {
  RuntimeEventsInput,
  RuntimeFinalResponseInput,
  RuntimeStopThreadInput,
  RuntimeThreadEventsResult,
  RuntimeThreadInput,
  RuntimeThreadRefInput,
  RuntimeThreadResult
} from "../../src/runtime/runtime-types.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("feature evaluator smoke harness", () => {
  it("defaults to blocked without starting a real SDK thread", async () => {
    const repoRoot = tempRoot("feature-evaluator-smoke-blocked-");
    const result = await runFeatureEvaluatorSmoke({
      repoRoot,
      env: {}
    });
    const verify = verifyFeatureEvaluatorSmoke(repoRoot);

    expect(result.status).toBe("BLOCKED_FEATURE_EVALUATOR_SMOKE_NOT_ENABLED");
    expect(result.real_sdk_run_executed).toBe(false);
    expect(result.sdk_method).toBe("run");
    expect(result.sdk_diagnosis.dynamic_import_codex_sdk_ok).toBe(true);
    expect(result.sdk_diagnosis.codex_named_export_available).toBe(true);
    expect(verify.status).toBe("PASS");
    expect(verify.ready_for_one_feature_evaluator_parity_smoke).toBe(true);
  });

  it("defaults evaluator parity to the SDK run method", async () => {
    const repoRoot = tempRoot("feature-evaluator-default-method-");
    const result = await runFeatureEvaluatorSmoke({
      repoRoot,
      env: {
        CODEX_LOOP_FEATURE_EVALUATOR_SMOKE_MOCK: "pass",
        CODEX_LOOP_ENABLE_M12_FEATURE_EVALUATOR_SMOKE: "1"
      }
    });

    expect(result.status).toBe("PASS");
    expect(result.sdk_method).toBe("run");
  });

  it("allows method=run to be configured explicitly", async () => {
    const repoRoot = tempRoot("feature-evaluator-run-method-");
    const adapter = new MethodRecordingAdapter("run");
    const result = await runFeatureEvaluatorSmoke({
      repoRoot,
      runtime_adapter: adapter,
      env: {
        CODEX_LOOP_ENABLE_M12_FEATURE_EVALUATOR_SMOKE: "1",
        CODEX_LOOP_EVALUATOR_PARITY_SDK_METHOD: "run"
      }
    });

    expect(result.status).toBe("PASS");
    expect(result.sdk_method).toBe("run");
    expect(adapter.methods).toEqual(["run"]);
  });

  it("allows method=runStreamed to be configured explicitly", async () => {
    const repoRoot = tempRoot("feature-evaluator-runstreamed-method-");
    const adapter = new MethodRecordingAdapter("runStreamed");
    const result = await runFeatureEvaluatorSmoke({
      repoRoot,
      runtime_adapter: adapter,
      env: {
        CODEX_LOOP_ENABLE_M12_FEATURE_EVALUATOR_SMOKE: "1",
        CODEX_LOOP_EVALUATOR_PARITY_SDK_METHOD: "runStreamed"
      }
    });

    expect(result.status).toBe("PASS");
    expect(result.sdk_method).toBe("runStreamed");
    expect(adapter.methods).toEqual(["runStreamed"]);
  });

  it("passes parity when SDK run final response contains the expected token", async () => {
    const repoRoot = tempRoot("feature-evaluator-run-pass-");
    const result = await runFeatureEvaluatorSmoke({
      repoRoot,
      runtime_adapter: new FixedResultAdapter({
        thread_id: "thread_run_parity",
        final_response: "FEATURE_EVALUATOR_PARITY_OK"
      }),
      env: {
        CODEX_LOOP_ENABLE_M12_FEATURE_EVALUATOR_SMOKE: "1",
        CODEX_LOOP_EVALUATOR_PARITY_SDK_METHOD: "run"
      }
    });

    expect(result.status).toBe("PASS");
    expect(result.evaluator_thread_started).toBe(true);
    expect(result.evaluator_thread_id).toBe("thread_run_parity");
    expect(result.final_response_contains_expected).toBe(true);
  });

  it("classifies SDK runStreamed thread and turn started without completion as parity turn no-event timeout", async () => {
    const repoRoot = tempRoot("feature-evaluator-runstreamed-timeout-");
    const eventsPath = resolve(repoRoot, "evals/effectiveness/reports/feature-small-001/sdk-stage-logs/feature-evaluator-smoke-parity-events.jsonl");
    writeFile(eventsPath, [
      "{\"type\":\"thread.started\",\"thread_id\":\"thread_evaluator_parity\"}",
      "{\"type\":\"turn.started\"}"
    ].join("\n"));
    const result = await runFeatureEvaluatorSmoke({
      repoRoot,
      runtime_adapter: new FixedResultAdapter({
        thread_id: "thread_evaluator_parity",
        status: "TIMEOUT",
        failure_category: "SDK_NO_EVENT_TIMEOUT",
        no_event_timeout: true,
        last_event_type: "turn.started",
        events_path: eventsPath,
        events: [
          { type: "thread.started", thread_id: "thread_evaluator_parity" },
          { type: "turn.started" }
        ]
      }),
      env: {
        CODEX_LOOP_ENABLE_M12_FEATURE_EVALUATOR_SMOKE: "1",
        CODEX_LOOP_EVALUATOR_PARITY_SDK_METHOD: "runStreamed"
      }
    });

    expect(result.status).toBe("FAIL");
    expect(result.failure_category).toBe("FEATURE_EVALUATOR_PARITY_TURN_NO_EVENT_TIMEOUT");
  });

  it("classifies SDK runStreamed event parser issues after CLI parity passed", async () => {
    const repoRoot = tempRoot("feature-evaluator-runstreamed-parser-");
    const eventsPath = resolve(repoRoot, "evals/effectiveness/reports/feature-small-001/sdk-stage-logs/feature-evaluator-smoke-parity-events.jsonl");
    writeFile(eventsPath, [
      "{\"type\":\"thread.started\",\"thread_id\":\"thread_evaluator_parity\"}",
      "{\"type\":\"turn.started\"}",
      "not-json"
    ].join("\n"));
    const result = await runFeatureEvaluatorSmoke({
      repoRoot,
      runtime_adapter: new FixedResultAdapter({
        thread_id: "thread_evaluator_parity",
        status: "FAILED",
        failure_category: "SDK_RUNSTREAMED_EVENT_STREAM_ISSUE",
        last_event_type: "turn.started",
        events_path: eventsPath,
        errors: ["stream parser failed"]
      }),
      env: {
        CODEX_LOOP_ENABLE_M12_FEATURE_EVALUATOR_SMOKE: "1",
        CODEX_LOOP_EVALUATOR_PARITY_SDK_METHOD: "runStreamed"
      }
    });

    expect(result.status).toBe("FAIL");
    expect(result.failure_category).toBe("SDK_EVALUATOR_RUNSTREAMED_EVENT_STREAM_ISSUE");
  });

  it("blocks SDK parity when its invocation differs from printed CLI parity", async () => {
    const repoRoot = tempRoot("feature-evaluator-cli-sdk-diff-");
    writeFile(resolve(repoRoot, "evals/effectiveness/reports/feature-small-001/evaluator-cli-parity-print.json"), JSON.stringify({
      target_repo: resolve(repoRoot, "different-target"),
      sqlite_home: resolve(repoRoot, ".codex-eval/sqlite"),
      model: "gpt-test",
      model_catalog_json: resolve(repoRoot, "evals/sdk-orchestrated/model-catalog-bundled.json"),
      prompt: FEATURE_EVALUATOR_PARITY_PROMPT
    }, null, 2));
    const result = await runFeatureEvaluatorSmoke({
      repoRoot,
      runtime_adapter: new MethodRecordingAdapter("run"),
      env: {
        CODEX_LOOP_ENABLE_M12_FEATURE_EVALUATOR_SMOKE: "1",
        CODEX_LOOP_CODEX_MODEL: "gpt-test",
        CODEX_LOOP_MODEL_CATALOG_JSON: resolve(repoRoot, "evals/sdk-orchestrated/model-catalog-bundled.json")
      }
    });

    expect(result.status).toBe("BLOCKED_EVALUATOR_PARITY_INVOCATION_DIFF");
    expect(result.real_sdk_run_executed).toBe(false);
  });

  it.each(["parity", "text-only", "output-minimal", "output-lite", "exact"] as const)("passes %s mode with mock SDK", async (mode) => {
    const repoRoot = tempRoot(`feature-evaluator-smoke-${mode}-`);
    seedEvaluatorPrerequisites(repoRoot, mode);
    const result = await runFeatureEvaluatorSmoke({
      repoRoot,
      env: {
        CODEX_LOOP_ENABLE_M12_FEATURE_EVALUATOR_SMOKE: "1",
        CODEX_LOOP_FEATURE_EVALUATOR_SMOKE_MODE: mode,
        CODEX_LOOP_FEATURE_EVALUATOR_SMOKE_MOCK: "pass"
      }
    });

    expect(result.status).toBe("PASS");
    expect(result.evaluator_thread_started).toBe(true);
    expect(result.structured_output_valid).toBe(true);
    expect(result.real_sdk_run_executed).toBe(false);
    expect(result.uses_full_eval_report_schema).toBe(false);
    if (mode === "output-lite" || mode === "exact") {
      expect(result.uses_evaluator_lite_schema).toBe(true);
      expect(result.eval_report_created).toBe(true);
      expect(result.eval_verdict).toBe("PASS");
    }
    if (mode === "exact") {
      expect(result.ready_for_feature_treatment_fresh_rerun).toBe(true);
    }
  });

  it("blocks text-only until evaluator parity passes", async () => {
    const repoRoot = tempRoot("feature-evaluator-text-only-blocked-");
    const result = await runFeatureEvaluatorSmoke({
      repoRoot,
      env: {
        CODEX_LOOP_ENABLE_M12_FEATURE_EVALUATOR_SMOKE: "1",
        CODEX_LOOP_FEATURE_EVALUATOR_SMOKE_MODE: "text-only",
        CODEX_LOOP_FEATURE_EVALUATOR_SMOKE_MOCK: "pass"
      }
    });

    expect(result.status).toBe("BLOCKED_EVALUATOR_PARITY_NOT_PASSED");
    expect(result.real_sdk_run_executed).toBe(false);
    expect(result.ready_for_feature_treatment_fresh_rerun).toBe(false);
  });

  it("uses a short evaluator-lite prompt and not the full EvalReport schema", () => {
    const config = featureEvaluatorStageConfig({
      prd_path: "docs/PRD.md",
      task_graph_path: "docs/TASK_GRAPH.json",
      dev_result_path: "artifacts/dev-result.json",
      test_log_path: "treatment-validation.log",
      diff_path: "treatment-diff.patch"
    });

    expect(config.prompt_length).toBeLessThanOrEqual(FEATURE_EVALUATOR_PROMPT_MAX_LENGTH);
    expect(config.uses_evaluator_lite_schema).toBe(true);
    expect(config.uses_full_eval_report_schema).toBe(false);
    expect(JSON.stringify(config.output_schema)).toContain("findings_json");
    expect(JSON.stringify(config.output_schema)).not.toContain("eval_id");
    expect(featureEvaluatorExactPathMatchesTreatment()).toBe(true);
  });

  it("writes evaluator timeout triage from existing evidence", () => {
    const repoRoot = tempRoot("feature-evaluator-timeout-triage-");
    const eventsPath = resolve(repoRoot, "evals/effectiveness/reports/feature-small-001/sdk-stage-logs/generic-evaluator-events.jsonl");
    writeFile(eventsPath, [
      "{\"type\":\"thread.started\",\"thread_id\":\"thread_evaluator_timeout\"}",
      "{\"type\":\"turn.started\"}"
    ].join("\n"));
    writeFile(resolve(repoRoot, "evals/effectiveness/reports/feature-small-001/sdk-stage-logs/generic-evaluator-invocation-trace-redacted.json"), JSON.stringify({
      target_repo: resolve(repoRoot, "target-repo"),
      target_repo_is_git: true,
      start_thread_options: { workingDirectory: resolve(repoRoot, "target-repo") },
      prompt: { length: 865, hash: "hash-old" },
      error_capture_paths: {
        events_path: eventsPath,
        stdout_path: resolve(repoRoot, "stdout.log"),
        stderr_path: resolve(repoRoot, "stderr.log")
      }
    }, null, 2));
    writeFile(resolve(repoRoot, "evals/effectiveness/reports/feature-small-001/treatment-result.json"), JSON.stringify({
      case_id: "feature-small-001",
      variant: "treatment",
      status: "BLOCKED",
      planner_thread_id: "thread_planner",
      planner_stage_completed: true,
      dev_worker_thread_id: "thread_dev_worker",
      initial_evaluator_thread_id: "thread_evaluator_timeout",
      failure_category: "SDK_NO_EVENT_TIMEOUT",
      initial_dev_worker: { file_change_verified: true }
    }, null, 2));

    const triage = writeFeatureEvaluatorTimeoutTriage(repoRoot);

    expect(triage.failure_category).toBe("FEATURE_TREATMENT_EVALUATOR_TURN_NO_EVENT_TIMEOUT");
    expect(triage.planner_completed).toBe(true);
    expect(triage.dev_worker_completed).toBe(true);
    expect(triage.evaluator_thread_started).toBe(true);
    expect(triage.evaluator_thread_id).toBe("thread_evaluator_timeout");
    expect(triage.event_count).toBe(2);
    expect(triage.uses_evaluator_lite_schema).toBe(true);
    expect(triage.uses_full_eval_report_schema).toBe(false);
  });

  it("classifies parity thread and turn started without completion as turn no-event timeout", () => {
    const category = classifyFeatureEvaluatorParityFailure({
      thread_id: "thread_evaluator_parity",
      failure_category: "SDK_NO_EVENT_TIMEOUT",
      status: "TIMEOUT",
      events: [
        { type: "thread.started", thread_id: "thread_evaluator_parity" },
        { type: "turn.started" }
      ],
      no_event_timeout: true
    });

    expect(category).toBe("FEATURE_EVALUATOR_PARITY_TURN_NO_EVENT_TIMEOUT");
  });

  it("classifies parity without thread id as startup no-event timeout", () => {
    const category = classifyFeatureEvaluatorParityFailure({
      failure_category: "SDK_NO_EVENT_TIMEOUT",
      status: "TIMEOUT",
      events: []
    });

    expect(category).toBe("FEATURE_EVALUATOR_PARITY_STARTUP_NO_EVENT_TIMEOUT");
  });

  it("classifies parity turn failed events", () => {
    const category = classifyFeatureEvaluatorParityFailure({
      thread_id: "thread_evaluator_parity",
      status: "FAILED",
      events: [
        { type: "thread.started", thread_id: "thread_evaluator_parity" },
        { type: "turn.started" },
        { type: "turn.failed" }
      ]
    });

    expect(category).toBe("FEATURE_EVALUATOR_PARITY_TURN_FAILED");
  });

  it("writes evaluator parity timeout triage from smoke evidence", () => {
    const repoRoot = tempRoot("feature-evaluator-parity-triage-");
    const eventsPath = resolve(repoRoot, "evals/effectiveness/reports/feature-small-001/sdk-stage-logs/feature-evaluator-smoke-parity-events.jsonl");
    writeFile(eventsPath, [
      "{\"type\":\"thread.started\",\"thread_id\":\"thread_evaluator_parity\"}",
      "{\"type\":\"turn.started\"}"
    ].join("\n"));
    writeFile(resolve(repoRoot, "evals/effectiveness/reports/feature-small-001/sdk-stage-logs/feature-evaluator-smoke-parity-invocation-trace-redacted.json"), JSON.stringify({
      target_repo: resolve(repoRoot, "evals/effectiveness/runs/feature-small-001/treatment/target-repo"),
      target_repo_is_git: true,
      constructor_options: {
        config_values_redacted: {
          sqlite_home: resolve(repoRoot, ".codex-eval/sqlite"),
          model_catalog_json: resolve(repoRoot, "evals/sdk-orchestrated/model-catalog-bundled.json"),
          model: "gpt-test"
        }
      },
      start_thread_options: {
        workingDirectory: resolve(repoRoot, "evals/effectiveness/runs/feature-small-001/treatment/target-repo"),
        sandboxMode: "read-only",
        model: "gpt-test"
      },
      run_options: { usesOutputSchema: false, usesRunStreamed: true },
      prompt: { length: FEATURE_EVALUATOR_PARITY_PROMPT.length, hash: "hash-parity" },
      sdk_api_method: "runStreamed",
      error_capture_paths: { events_path: eventsPath }
    }, null, 2));
    writeFile(resolve(repoRoot, "evals/effectiveness/reports/feature-small-001/feature-evaluator-smoke-result.json"), JSON.stringify({
      case_id: "feature-small-001",
      status: "FAIL",
      mode: "parity",
      real_sdk_run_executed: true,
      evaluator_thread_started: true,
      evaluator_thread_id: "thread_evaluator_parity",
      evaluator_events_path: eventsPath,
      failure_category: "SDK_NO_EVENT_TIMEOUT"
    }, null, 2));

    const triage = writeFeatureEvaluatorParityTimeoutTriage(repoRoot);

    expect(triage.failure_category).toBe("FEATURE_EVALUATOR_PARITY_TURN_NO_EVENT_TIMEOUT");
    expect(triage.turn_started).toBe(true);
    expect(triage.turn_completed).toBe(false);
    expect(triage.evaluator_thread_id).toBe("thread_evaluator_parity");
  });

  it("writes SDK evaluator method triage from CLI PASS and prior SDK timeout evidence", () => {
    const repoRoot = tempRoot("sdk-evaluator-method-triage-");
    writeFile(resolve(repoRoot, "evals/effectiveness/reports/feature-small-001/evaluator-cli-parity-result.json"), JSON.stringify({
      status: "PASS",
      likely_failure: "SDK_EVALUATOR_ADAPTER_OR_EVENT_STREAM_ISSUE",
      prompt: FEATURE_EVALUATOR_PARITY_PROMPT
    }, null, 2));
    writeFile(resolve(repoRoot, "evals/effectiveness/reports/feature-small-001/feature-evaluator-parity-timeout-triage.json"), JSON.stringify({
      failure_category: "FEATURE_EVALUATOR_PARITY_TURN_NO_EVENT_TIMEOUT",
      sdk_method: "runStreamed",
      working_directory: resolve(repoRoot, "target"),
      model: "gpt-test",
      model_catalog_json: "catalog",
      sqlite_home: "sqlite"
    }, null, 2));

    const triage = writeSdkEvaluatorMethodTriage(repoRoot);

    expect(triage.cli_parity_status).toBe("PASS");
    expect(triage.sdk_parity_previous_status).toBe("FAIL");
    expect(triage.sdk_method_previous).toBe("runStreamed");
    expect(triage.recommended_sdk_method_for_parity).toBe("run");
    expect(triage.runstreamed_no_event_timeout_risk).toBe(true);
  });

  it("parses evaluator CLI parity PASS without executing Codex", () => {
    const repoRoot = tempRoot("feature-evaluator-cli-pass-");
    writeFile(resolve(repoRoot, "evals/effectiveness/reports/feature-small-001/evaluator-cli-parity-events.jsonl"), [
      "{\"type\":\"thread.started\",\"thread_id\":\"thread_cli\"}",
      "{\"type\":\"turn.started\"}",
      "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"FEATURE_EVALUATOR_PARITY_OK\"}}",
      "{\"type\":\"turn.completed\"}"
    ].join("\n"));
    writeFile(resolve(repoRoot, "evals/effectiveness/reports/feature-small-001/evaluator-cli-parity-stderr.log"), "");

    const result = parseFeatureEvaluatorCliParity(repoRoot);

    expect(result.status).toBe("PASS");
    expect(result.executed).toBe(false);
    expect(result.likely_failure).toBe("SDK_EVALUATOR_ADAPTER_OR_EVENT_STREAM_ISSUE");
  });

  it("prints evaluator CLI parity command without executing Codex", () => {
    const repoRoot = tempRoot("feature-evaluator-cli-print-");

    const result = printFeatureEvaluatorCliParity(repoRoot, {
      CODEX_LOOP_CODEX_MODEL: "gpt-test"
    });

    expect(result.status).toBe("PRINT_ONLY");
    expect(result.executed).toBe(false);
    expect(result.command).toContain("codex exec --json --sandbox read-only");
    expect(result.command).toContain("FEATURE_EVALUATOR_PARITY_OK");
  });

  it("parses evaluator CLI parity FAIL without executing Codex", () => {
    const repoRoot = tempRoot("feature-evaluator-cli-fail-");
    writeFile(resolve(repoRoot, "evals/effectiveness/reports/feature-small-001/evaluator-cli-parity-events.jsonl"), "{\"type\":\"thread.started\",\"thread_id\":\"thread_cli\"}");
    writeFile(resolve(repoRoot, "evals/effectiveness/reports/feature-small-001/evaluator-cli-parity-stderr.log"), "timeout");

    const result = parseFeatureEvaluatorCliParity(repoRoot);

    expect(result.status).toBe("FAIL");
    expect(result.likely_failure).toBe("CODEX_CLI_TARGET_REPO_SANDBOX_MODEL_OR_RUNTIME_ISSUE");
  });

  it("detects evaluator parity sandbox invocation diff", () => {
    const repoRoot = tempRoot("feature-evaluator-invocation-diff-sandbox-");
    writeTrace(repoRoot, "feature-evaluator-smoke-parity-invocation-trace-redacted.json", {
      target_repo: resolve(repoRoot, "target"),
      start_thread_options: { workingDirectory: resolve(repoRoot, "target"), sandboxMode: "read-only", model: "gpt-test", skipGitRepoCheck: false },
      constructor_options: { config_keys: ["model"], config_values_redacted: { model: "gpt-test", model_catalog_json: "catalog", sqlite_home: "sqlite" } },
      run_options: { usesOutputSchema: false, usesRunStreamed: true },
      prompt: { length: 49, hash: "evaluator" },
      sdk_api_method: "runStreamed",
      error_capture_paths: { events_path: "evaluator-events" }
    });
    writeTrace(repoRoot, "feature-planner-smoke-parity-invocation-trace-redacted.json", {
      target_repo: resolve(repoRoot, "target"),
      start_thread_options: { workingDirectory: resolve(repoRoot, "target"), sandboxMode: "workspace-write", model: "gpt-test", skipGitRepoCheck: false },
      constructor_options: { config_keys: ["model"], config_values_redacted: { model: "gpt-test", model_catalog_json: "catalog", sqlite_home: "sqlite" } },
      run_options: { usesOutputSchema: false, usesRunStreamed: true },
      prompt: { length: 49, hash: "planner" },
      sdk_api_method: "runStreamed",
      error_capture_paths: { events_path: "planner-events" }
    });

    const diff = diffFeatureEvaluatorParityInvocation(repoRoot);

    expect(diff.status).toBe("NEEDS_REVISION");
    expect(diff.critical_diffs).toContain("sandboxMode");
  });

  it("detects evaluator parity SDK method invocation diff", () => {
    const repoRoot = tempRoot("feature-evaluator-invocation-diff-method-");
    writeTrace(repoRoot, "feature-evaluator-smoke-parity-invocation-trace-redacted.json", {
      target_repo: resolve(repoRoot, "target"),
      start_thread_options: { workingDirectory: resolve(repoRoot, "target"), sandboxMode: "read-only", model: "gpt-test", skipGitRepoCheck: false },
      constructor_options: { config_keys: ["model"], config_values_redacted: { model: "gpt-test", model_catalog_json: "catalog", sqlite_home: "sqlite" } },
      run_options: { usesOutputSchema: false, usesRunStreamed: true },
      prompt: { length: 49, hash: "same" },
      sdk_api_method: "runStreamed",
      error_capture_paths: { events_path: "events" }
    });
    writeTrace(repoRoot, "feature-planner-smoke-parity-invocation-trace-redacted.json", {
      target_repo: resolve(repoRoot, "target"),
      start_thread_options: { workingDirectory: resolve(repoRoot, "target"), sandboxMode: "read-only", model: "gpt-test", skipGitRepoCheck: false },
      constructor_options: { config_keys: ["model"], config_values_redacted: { model: "gpt-test", model_catalog_json: "catalog", sqlite_home: "sqlite" } },
      run_options: { usesOutputSchema: false, usesRunStreamed: false },
      prompt: { length: 49, hash: "same" },
      sdk_api_method: "run",
      error_capture_paths: { events_path: "events" }
    });

    const diff = diffFeatureEvaluatorParityInvocation(repoRoot);

    expect(diff.status).toBe("NEEDS_REVISION");
    expect(diff.critical_diffs).toContain("sdkMethod");
  });
});

function tempRoot(prefix: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), prefix));
  tempDirs.push(dir);
  mkdirSync(resolve(dir, "evals/effectiveness/reports/feature-small-001/sdk-stage-logs"), { recursive: true });
  mkdirSync(resolve(dir, "evals/effectiveness/runs/feature-small-001/treatment/target-repo"), { recursive: true });
  mkdirSync(resolve(dir, ".codex-eval/sqlite"), { recursive: true });
  return dir;
}

function writeFile(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

function writeTrace(repoRoot: string, filename: string, value: unknown): void {
  writeFile(
    resolve(repoRoot, "evals/effectiveness/reports/feature-small-001/sdk-stage-logs", filename),
    JSON.stringify(value, null, 2)
  );
}

function seedEvaluatorPrerequisites(repoRoot: string, mode: "parity" | "text-only" | "output-minimal" | "output-lite" | "exact"): void {
  const order = ["parity", "text-only", "output-minimal", "output-lite"] as const;
  for (const prerequisite of order) {
    if (prerequisite === mode) break;
    const result = {
      case_id: "feature-small-001",
      status: "PASS",
      mode: prerequisite,
      evaluator_thread_started: true,
      evaluator_thread_id: `thread_${prerequisite}`,
      structured_output_valid: true,
      artifact_thread_evidence_verified: true,
      final_response_contains_expected: true,
      eval_verdict: prerequisite === "parity" ? "" : "PASS",
      sdk_method: "run",
      failure_category: ""
    } as const;
    writeFile(
      resolve(repoRoot, "evals/effectiveness/reports/feature-small-001", `feature-evaluator-smoke-${prerequisite}-result.json`),
      JSON.stringify(result, null, 2)
    );
    updateFeatureEvaluatorSmokeReadinessFromResult(repoRoot, result);
  }
}

class MethodRecordingAdapter implements RuntimeAdapter {
  readonly methods: Array<"run" | "runStreamed"> = [];
  private readonly expected: "run" | "runStreamed";

  constructor(expected: "run" | "runStreamed") {
    this.expected = expected;
  }

  async startThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return this.runThread(input);
  }

  async runThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    this.methods.push("run");
    return this.result(input, "run");
  }

  async runThreadStreamed(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    this.methods.push("runStreamed");
    return this.result(input, "runStreamed");
  }

  async resumeThread(input: RuntimeThreadRefInput): Promise<RuntimeThreadResult> {
    return this.result({ role: input.role } as RuntimeThreadInput, "run");
  }

  async getThreadEvents(input: RuntimeEventsInput): Promise<RuntimeThreadEventsResult> {
    return { thread_id: input.thread_id, events_path: input.events_path ?? "", events: [], errors: [] };
  }

  async stopThread(input: RuntimeStopThreadInput): Promise<RuntimeThreadResult> {
    return this.result({ role: "context_distiller" } as RuntimeThreadInput, this.expected);
  }

  async getFinalResponse(input: RuntimeFinalResponseInput): Promise<RuntimeThreadResult> {
    return this.result({ role: "context_distiller", thread_id: input.thread_id } as unknown as RuntimeThreadInput, this.expected);
  }

  private result(input: RuntimeThreadInput, method: "run" | "runStreamed"): RuntimeThreadResult {
    return {
      thread_id: `thread_${method}`,
      role: input.role,
      status: "PASS",
      final_response: "FEATURE_EVALUATOR_PARITY_OK",
      events: [],
      events_path: input.error_capture_paths?.events_path ?? "",
      stdout_path: input.error_capture_paths?.stdout_path ?? "",
      stderr_path: input.error_capture_paths?.stderr_path ?? "",
      artifacts: [],
      failure_category: method === this.expected ? "" : "UNEXPECTED_METHOD",
      errors: method === this.expected ? [] : ["Unexpected method."]
    };
  }
}

class FixedResultAdapter implements RuntimeAdapter {
  private readonly resultOverrides: Partial<RuntimeThreadResult>;

  constructor(resultOverrides: Partial<RuntimeThreadResult>) {
    this.resultOverrides = resultOverrides;
  }

  async startThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return this.runThread(input);
  }

  async runThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return this.result(input);
  }

  async runThreadStreamed(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return this.result(input);
  }

  async resumeThread(input: RuntimeThreadRefInput): Promise<RuntimeThreadResult> {
    return this.result({ role: input.role } as RuntimeThreadInput);
  }

  async getThreadEvents(input: RuntimeEventsInput): Promise<RuntimeThreadEventsResult> {
    return { thread_id: input.thread_id, events_path: input.events_path ?? "", events: [], errors: [] };
  }

  async stopThread(input: RuntimeStopThreadInput): Promise<RuntimeThreadResult> {
    return this.result({ role: "context_distiller", thread_id: input.thread_id } as unknown as RuntimeThreadInput);
  }

  async getFinalResponse(input: RuntimeFinalResponseInput): Promise<RuntimeThreadResult> {
    return this.result({ role: "context_distiller", thread_id: input.thread_id } as unknown as RuntimeThreadInput);
  }

  private result(input: RuntimeThreadInput): RuntimeThreadResult {
    return {
      thread_id: "",
      role: input.role,
      status: "PASS",
      final_response: "",
      events: [],
      events_path: input.error_capture_paths?.events_path ?? "",
      stdout_path: input.error_capture_paths?.stdout_path ?? "",
      stderr_path: input.error_capture_paths?.stderr_path ?? "",
      artifacts: [],
      errors: [],
      ...this.resultOverrides
    };
  }
}
