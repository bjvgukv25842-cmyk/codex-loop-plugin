import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildFeatureSmall001PlannerPrompt, runGenericFeatureEvaluatorRetry, runGenericFeatureTreatment } from "../../src/effectiveness/treatment-generic-feature-runner.ts";
import { featureEvaluatorRetryEligibility, type GenericFeatureCheckpointState, type GenericFeatureCheckpointStage } from "../../src/effectiveness/generic-feature-checkpoint-state.ts";
import { analyzeFeatureTreatmentTimeline } from "../../src/effectiveness/feature-treatment-stage-timeline.ts";
import type { RuntimeAdapter } from "../../src/runtime/runtime-adapter.ts";
import type {
  RuntimeEventsInput,
  RuntimeFinalResponseInput,
  RuntimeStopThreadInput,
  RuntimeThreadEventsResult,
  RuntimeThreadInput,
  RuntimeThreadRefInput,
  RuntimeThreadResult
} from "../../src/runtime/runtime-types.ts";
import type { RuntimeRole } from "../../src/runtime/runtime-types.ts";
import { loadM12Dataset } from "../../scripts/effectiveness/dataset.ts";
import { validDevWorkerLiteOutput } from "../orchestrator/parse-dev-worker-lite-output.test.ts";
import { validPlannerLiteV2Output } from "../orchestrator/planner-lite-v2-output.test.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("generic feature treatment runner", () => {
  it("accepts the evaluator PASS path without seeded-gap repair", async () => {
    const repoRoot = tempRoot("m12-feature-pass-");
    const testCase = featureCase();
    const adapter = new GenericFeatureFakeAdapter("pass");

    const result = await runGenericFeatureTreatment({
      testCase,
      repoRoot,
      fresh: true,
      env: {
        CODEX_LOOP_ENABLE_M12_REAL_RUN: "1",
        CODEX_LOOP_CODEX_MODEL: "gpt-test"
      },
      runtime_adapter: adapter
    });

    expect(result.status).toBe("PASS");
    expect(result.initial_eval_verdict).toBe("PASS");
    expect(result.final_eval_verdict).toBe("PASS");
    expect(result.repair_request_created).toBe(false);
    expect(result.initial_dev_worker?.known_gap_seeded).toBe(false);
    expect(result.validation_passed).toBe(true);
    expect(result.changed_files).toContain("src/project-name.js");
    expect(result.artifacts).toEqual(expect.arrayContaining([
      "docs/PRD.md",
      "docs/TASK_GRAPH.json",
      "artifacts/dev-result.json",
      "artifacts/eval-report.json",
      "artifacts/FinalDeliveryReport.md"
    ]));
    expect(result.checkpoint_state_path).toContain("treatment-generic-feature-state.json");
    expect(existsSync(result.checkpoint_state_path!)).toBe(true);
    const checkpoint = JSON.parse(readFileSync(result.checkpoint_state_path!, "utf8")) as { current_stage: string; planner: { output_contract_version: string } };
    expect(checkpoint.current_stage).toBe("FINAL_REPORT_DONE");
    expect(checkpoint.planner.output_contract_version).toBe("v2");
  });

  it("supports the optional repair path when the first evaluator returns NEEDS_REVISION", async () => {
    const repoRoot = tempRoot("m12-feature-repair-");
    const testCase = featureCase();
    const adapter = new GenericFeatureFakeAdapter("repair");

    const result = await runGenericFeatureTreatment({
      testCase,
      repoRoot,
      fresh: true,
      env: {
        CODEX_LOOP_ENABLE_M12_REAL_RUN: "1",
        CODEX_LOOP_CODEX_MODEL: "gpt-test"
      },
      runtime_adapter: adapter
    });

    expect(result.status).toBe("PASS");
    expect(result.initial_eval_verdict).toBe("NEEDS_REVISION");
    expect(result.final_eval_verdict).toBe("PASS");
    expect(result.repair_request_created).toBe(true);
    expect(result.repair_dev_worker_thread_id).toBe("thread_dev_worker_2");
    expect(result.final_evaluator_thread_id).toBe("thread_evaluator_2");
    expect(result.artifacts).toEqual(expect.arrayContaining([
      "artifacts/repair-request.json",
      "artifacts/repair-result.json",
      "artifacts/final-eval-report.json",
      "artifacts/FinalDeliveryReport.md"
    ]));
  });

  it("classifies planner no-event timeout and persists partial planner evidence", async () => {
    const repoRoot = tempRoot("m12-feature-planner-timeout-");
    const testCase = featureCase();
    const adapter = new PlannerTimeoutFakeAdapter();

    const result = await runGenericFeatureTreatment({
      testCase,
      repoRoot,
      fresh: true,
      env: {
        CODEX_LOOP_ENABLE_M12_REAL_RUN: "1",
        CODEX_LOOP_CODEX_MODEL: "gpt-test"
      },
      runtime_adapter: adapter
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.failure_category).toBe("FEATURE_TREATMENT_PLANNER_TURN_NO_EVENT_TIMEOUT");
    expect(result.planner_thread_id).toBe("thread_planner_timeout");
    expect(result.planner_stage_attempted).toBe(true);
    expect(result.planner_stage_completed).toBe(false);
    expect(result.planner_output_contract_version).toBe("v2");
    expect(result.planner_last_event_type).toBe("thread.started");
    expect(result.planner_elapsed_ms).toBe(180000);
    expect(result.planner_event_count).toBe(1);
    expect(result.checkpoint_state_path).toContain("treatment-generic-feature-state.json");
    expect(existsSync(result.checkpoint_state_path!)).toBe(true);
    const checkpoint = JSON.parse(readFileSync(result.checkpoint_state_path!, "utf8")) as { current_stage: string; planner: { failure_category: string; thread_id: string; event_count: number; elapsed_ms: number; last_event_type: string } };
    expect(checkpoint.current_stage).toBe("FAILED");
    expect(checkpoint.planner.failure_category).toBe("FEATURE_TREATMENT_PLANNER_TURN_NO_EVENT_TIMEOUT");
    expect(checkpoint.planner.thread_id).toBe("thread_planner_timeout");
    expect(checkpoint.planner.event_count).toBe(1);
    expect(checkpoint.planner.elapsed_ms).toBe(180000);
    expect(checkpoint.planner.last_event_type).toBe("thread.started");
  });

  it("uses planner-lite-v2 with concise feature prompt and no task_graph_json string", async () => {
    const repoRoot = tempRoot("m12-feature-prompt-");
    const testCase = featureCase();
    const adapter = new GenericFeatureFakeAdapter("pass");

    await runGenericFeatureTreatment({
      testCase,
      repoRoot,
      fresh: true,
      env: {
        CODEX_LOOP_ENABLE_M12_REAL_RUN: "1",
        CODEX_LOOP_CODEX_MODEL: "gpt-test"
      },
      runtime_adapter: adapter
    });

    const plannerInput = adapter.inputs.find((input) => input.role === "planner")!;
    expect(plannerInput.prompt).toBe(buildFeatureSmall001PlannerPrompt());
    expect(plannerInput.prompt).not.toContain("task_graph_json");
    expect(JSON.stringify(plannerInput.output_schema)).toContain("\"tasks\"");
    expect(JSON.stringify(plannerInput.output_schema)).not.toContain("task_graph_json");
  });

  it("uses evaluator-lite schema and concise evaluator prompt for feature treatment", async () => {
    const repoRoot = tempRoot("m12-feature-evaluator-prompt-");
    const testCase = featureCase();
    const adapter = new GenericFeatureFakeAdapter("pass");

    await runGenericFeatureTreatment({
      testCase,
      repoRoot,
      fresh: true,
      env: {
        CODEX_LOOP_ENABLE_M12_REAL_RUN: "1",
        CODEX_LOOP_CODEX_MODEL: "gpt-test"
      },
      runtime_adapter: adapter
    });

    const evaluatorInput = adapter.inputs.find((input) => input.role === "evaluator")!;
    expect(evaluatorInput.prompt.length).toBeLessThanOrEqual(700);
    expect(evaluatorInput.prompt).toContain("feature-small-001");
    expect(evaluatorInput.prompt).toContain("Return evaluator-lite JSON only");
    expect(JSON.stringify(evaluatorInput.output_schema)).toContain("findings_json");
    expect(JSON.stringify(evaluatorInput.output_schema)).not.toContain("eval_id");
  });

  it("supports feature-small-002 using the generic feature direct PASS path", async () => {
    const repoRoot = tempRoot("m12-feature-002-pass-");
    const testCase = featureCase("feature-small-002");
    const adapter = new GenericFeatureFakeAdapter("pass");

    const result = await runGenericFeatureTreatment({
      testCase,
      repoRoot,
      fresh: true,
      env: {
        CODEX_LOOP_ENABLE_M12_REAL_RUN: "1",
        CODEX_LOOP_CODEX_MODEL: "gpt-test"
      },
      runtime_adapter: adapter
    });

    expect(result.status).toBe("PASS");
    expect(result.case_id).toBe("feature-small-002");
    expect(result.initial_eval_verdict).toBe("PASS");
    expect(result.final_eval_verdict).toBe("PASS");
    expect(result.repair_request_created).toBe(false);
    expect(result.changed_files).toContain("src/project-slug.js");
    expect(result.initial_dev_worker?.file_change_verified).toBe(true);
    expect(result.artifacts).toEqual(expect.arrayContaining([
      "docs/PRD.md",
      "docs/TASK_GRAPH.json",
      "artifacts/dev-result.json",
      "artifacts/eval-report.json",
      "artifacts/FinalDeliveryReport.md"
    ]));

    const plannerInput = adapter.inputs.find((input) => input.role === "planner")!;
    const devWorkerInput = adapter.inputs.find((input) => input.role === "dev_worker")!;
    const evaluatorInput = adapter.inputs.find((input) => input.role === "evaluator")!;
    expect(plannerInput.prompt).toContain("project route slugs");
    expect(plannerInput.prompt).toContain("src/project-slug.js");
    expect(devWorkerInput.prompt).toContain("normalizeProjectSlug");
    expect(evaluatorInput.prompt).toContain("feature-small-002");
    expect(evaluatorInput.prompt).toContain("lowercase ASCII letters");
  });

  it("classifies planner completion without dev worker startup", async () => {
    const repoRoot = tempRoot("m12-feature-dev-not-started-");
    const testCase = featureCase();
    const adapter = new DevWorkerNotStartedFakeAdapter();

    const result = await runGenericFeatureTreatment({
      testCase,
      repoRoot,
      fresh: true,
      env: {
        CODEX_LOOP_ENABLE_M12_REAL_RUN: "1",
        CODEX_LOOP_CODEX_MODEL: "gpt-test"
      },
      runtime_adapter: adapter
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.planner_stage_completed).toBe(true);
    expect(result.failure_category).toBe("FEATURE_TREATMENT_DEV_WORKER_NOT_STARTED_AFTER_PLANNER");
    expect(result.dev_worker_thread_id).toBe("");
  });

  it("classifies evaluator no-event timeout and preserves stage thread ids", async () => {
    const repoRoot = tempRoot("m12-feature-evaluator-timeout-");
    const testCase = featureCase();
    const adapter = new EvaluatorTimeoutFakeAdapter();

    const result = await runGenericFeatureTreatment({
      testCase,
      repoRoot,
      fresh: true,
      env: {
        CODEX_LOOP_ENABLE_M12_REAL_RUN: "1",
        CODEX_LOOP_CODEX_MODEL: "gpt-test"
      },
      runtime_adapter: adapter
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.failure_category).toBe("FEATURE_TREATMENT_EVALUATOR_TURN_NO_EVENT_TIMEOUT");
    expect(result.planner_thread_id).toBe("thread_planner_1");
    expect(result.dev_worker_thread_id).toBe("thread_dev_worker_1");
    expect(result.initial_evaluator_thread_id).toBe("thread_evaluator_timeout");
    expect(result.initial_evaluator_events_path).toContain("generic-evaluator-events.jsonl");
    expect(result.initial_evaluator_prompt_length).toBeGreaterThan(0);
    expect(result.last_completed_stage).toBe("dev_worker");
    expect(result.first_failed_stage).toBe("evaluator");
  });

  it("allows evaluator checkpoint retry without rerunning planner or dev worker", async () => {
    const repoRoot = tempRoot("m12-feature-evaluator-retry-");
    const testCase = featureCase();
    const checkpointPath = resolve(repoRoot, "evals/effectiveness/reports/feature-small-001/treatment-generic-feature-state.json");
    writeCheckpoint(checkpointPath, "DEV_WORKER_DONE");
    const adapter = new GenericFeatureFakeAdapter("pass");

    const retry = await runGenericFeatureEvaluatorRetry({
      testCase,
      repoRoot,
      env: {
        CODEX_LOOP_CODEX_MODEL: "gpt-test"
      },
      runtime_adapter: adapter
    });

    expect(retry.status).toBe("PASS");
    expect(retry.planner_rerun).toBe(false);
    expect(retry.dev_worker_rerun).toBe(false);
    expect(adapter.inputs.map((input) => input.role)).toEqual(["evaluator"]);
  });

  it("checks evaluator retry eligibility from checkpoint state", () => {
    const state = checkpointState("FAILED");

    const eligibility = featureEvaluatorRetryEligibility(state);

    expect(eligibility.eligible).toBe(true);
    expect(eligibility.planner_thread_id).toBe("thread_planner");
    expect(eligibility.dev_worker_thread_id).toBe("thread_dev_worker");
  });

  it("uses stage timeline to correct stale planner timeout when evaluator thread exists", () => {
    const repoRoot = tempRoot("m12-feature-stale-timeout-");
    const checkpointPath = resolve(repoRoot, "evals/effectiveness/reports/feature-small-001/treatment-generic-feature-state.json");
    writeFile(checkpointPath, JSON.stringify({
      case_id: "feature-small-001",
      current_stage: "FAILED",
      planner: {
        status: "PASS",
        thread_id: "thread_planner",
        prd_path: "docs/PRD.md",
        task_graph_path: "docs/TASK_GRAPH.json",
        stage_attempted: true,
        stage_completed: true,
        output_contract_version: "v2"
      },
      dev_worker: {
        status: "PASS",
        thread_id: "thread_dev_worker",
        file_change_verified: true,
        tests_passed: true,
        dev_result_path: "artifacts/dev-result.json"
      },
      evaluator: {
        status: "TIMEOUT",
        thread_id: "thread_evaluator",
        eval_verdict: "",
        eval_report_path: "artifacts/eval-report.json"
      },
      repair_request: {},
      repair_dev_worker: {},
      final_evaluator: {},
      final_report: {},
      errors: ["SDK thread exceeded timeout_ms=180000."]
    }, null, 2));

    const analysis = analyzeFeatureTreatmentTimeline({
      case_id: "feature-small-001",
      variant: "treatment",
      status: "BLOCKED",
      failure_category: "FEATURE_TREATMENT_PLANNER_TURN_NO_EVENT_TIMEOUT",
      planner_thread_id: "thread_planner",
      dev_worker_thread_id: "thread_dev_worker",
      initial_evaluator_thread_id: "thread_evaluator",
      checkpoint_state_path: checkpointPath
    });

    expect(analysis.corrected_failure_category).toBe("FEATURE_TREATMENT_EVALUATOR_TURN_NO_EVENT_TIMEOUT");
    expect(analysis.failure_category_was_stale_or_inconsistent).toBe(true);
    expect(analysis.last_completed_stage).toBe("dev_worker");
    expect(analysis.first_failed_stage).toBe("evaluator");
    expect(analysis.stage_timeline.map((entry) => [entry.stage, entry.started, entry.completed])).toEqual([
      ["planner", true, true],
      ["dev_worker", true, true],
      ["evaluator", true, false],
      ["final_report", false, false]
    ]);
  });
});

function featureCase(caseId = "feature-small-001") {
  return loadM12Dataset().find((entry) => entry.case_id === caseId)!;
}

function tempRoot(prefix: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), prefix));
  tempDirs.push(dir);
  mkdirSync(resolve(dir, "evals/effectiveness/datasets"), { recursive: true });
  writeFile(
    resolve(dir, "evals/effectiveness/datasets/m12-mini.jsonl"),
    readFileSync(resolve("/Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/datasets/m12-mini.jsonl"), "utf8")
  );
  mkdirSync(resolve(dir, "evals/effectiveness/fixtures"), { recursive: true });
  copyFeatureFixture(dir);
  return dir;
}

function copyFeatureFixture(repoRoot: string): void {
  for (const caseId of ["feature-small-001", "feature-small-002"]) {
    const source = resolve(`/Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/fixtures/${caseId}`);
    const target = resolve(repoRoot, `evals/effectiveness/fixtures/${caseId}`);
    writeFile(resolve(target, "package.json"), readFileSync(resolve(source, "package.json"), "utf8"));
    writeFile(resolve(target, "README.md"), readFileSync(resolve(source, "README.md"), "utf8"));
    if (caseId === "feature-small-002") {
      writeFile(resolve(target, "src/project-slug.js"), readFileSync(resolve(source, "src/project-slug.js"), "utf8"));
      writeFile(resolve(target, "test/project-slug.test.js"), readFileSync(resolve(source, "test/project-slug.test.js"), "utf8"));
    } else {
      writeFile(resolve(target, "src/project-name.js"), readFileSync(resolve(source, "src/project-name.js"), "utf8"));
      writeFile(resolve(target, "test/project-name.test.js"), readFileSync(resolve(source, "test/project-name.test.js"), "utf8"));
    }
  }
}

function writeFile(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function writeCheckpoint(path: string, currentStage: GenericFeatureCheckpointStage): void {
  writeFile(path, JSON.stringify(checkpointState(currentStage), null, 2));
}

function checkpointState(currentStage: GenericFeatureCheckpointStage): GenericFeatureCheckpointState {
  return {
    case_id: "feature-small-001",
    current_stage: currentStage,
    planner: {
      status: "PASS",
      thread_id: "thread_planner",
      prd_path: "docs/PRD.md",
      task_graph_path: "docs/TASK_GRAPH.json",
      planner_result_path: "artifacts/planner-result.json",
      stage_attempted: true,
      stage_completed: true,
      output_contract_version: "v2"
    },
    dev_worker: {
      status: "PASS",
      thread_id: "thread_dev_worker",
      file_change_verified: true,
      tests_passed: true,
      dev_result_path: "artifacts/dev-result.json"
    },
    evaluator: {
      status: "TIMEOUT",
      thread_id: "thread_evaluator_timeout",
      eval_verdict: "",
      eval_report_path: "artifacts/eval-report.json"
    },
    repair_request: {},
    repair_dev_worker: {},
    final_evaluator: {},
    final_report: {},
    errors: []
  };
}

class GenericFeatureFakeAdapter implements RuntimeAdapter {
  readonly inputs: RuntimeThreadInput[] = [];
  private devWorkerCount = 0;
  private evaluatorCount = 0;

  constructor(private readonly mode: "pass" | "repair") {}

  async startThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return this.runThread(input);
  }

  async runThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return this.runThreadStreamed(input);
  }

  async runThreadStreamed(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    this.inputs.push(input);
    const threadId = this.nextThreadId(input.role);
    const eventsPath = input.error_capture_paths?.events_path ?? "";
    if (eventsPath) {
      writeFile(eventsPath, `{"type":"thread.started","thread_id":"${threadId}"}\n`);
    }
    if (input.role === "dev_worker") {
      if (input.prompt.includes("normalizeProjectSlug")) {
        writeFile(
          resolve(input.working_directory, "src/project-slug.js"),
          [
            "export function normalizeProjectSlug(input) {",
            "  const normalized = String(input ?? \"\").trim().toLowerCase().replaceAll(\" \", \"-\");",
            "  if (normalized.length === 0) throw new Error(\"empty slug\");",
            "  return normalized;",
            "}",
            ""
          ].join("\n")
        );
      } else {
        writeFile(
          resolve(input.working_directory, "src/project-name.js"),
          [
            "export function validateProjectName(name) {",
            "  if (typeof name !== \"string\") return { ok: false };",
            ...(this.mode === "repair" && this.devWorkerCount === 1
              ? ["  if (name.length === 0) return { ok: false };"]
              : ["  if (name.trim().length === 0) return { ok: false };"]),
            "  if (name.length > 80) return { ok: false };",
            "  return { ok: true };",
            "}",
            ""
          ].join("\n")
        );
      }
    }
    return {
      thread_id: threadId,
      role: input.role,
      status: "PASS",
      final_response: this.finalResponse(input),
      events: [],
      events_path: eventsPath,
      stdout_path: input.error_capture_paths?.stdout_path ?? "",
      stderr_path: input.error_capture_paths?.stderr_path ?? "",
      artifacts: [],
      sandbox_control: "VERIFIED",
      errors: []
    };
  }

  async resumeThread(input: RuntimeThreadRefInput): Promise<RuntimeThreadResult> {
    return this.stub(input.role);
  }

  async getThreadEvents(input: RuntimeEventsInput): Promise<RuntimeThreadEventsResult> {
    return { thread_id: input.thread_id, events_path: input.events_path ?? "", events: [], errors: [] };
  }

  async stopThread(input: RuntimeStopThreadInput): Promise<RuntimeThreadResult> {
    return { ...this.stub("context_distiller"), thread_id: input.thread_id };
  }

  async getFinalResponse(input: RuntimeFinalResponseInput): Promise<RuntimeThreadResult> {
    return { ...this.stub("context_distiller"), thread_id: input.thread_id };
  }

  private nextThreadId(role: RuntimeRole): string {
    if (role === "planner") return "thread_planner_1";
    if (role === "dev_worker") {
      this.devWorkerCount += 1;
      return `thread_dev_worker_${this.devWorkerCount}`;
    }
    if (role === "evaluator") return `thread_evaluator_${this.evaluatorCount + 1}`;
    return `thread_${role}`;
  }

  private finalResponse(input: RuntimeThreadInput): string {
    if (input.role === "planner") return JSON.stringify(validPlannerLiteV2Output());
    if (input.role === "dev_worker") {
      return JSON.stringify(input.prompt.includes("normalizeProjectSlug")
        ? validDevWorkerLiteOutput({
            changed_files: ["src/project-slug.js"],
            summary: "Fixed normalizeProjectSlug and tests pass."
          })
        : validDevWorkerLiteOutput());
    }
    if (input.role === "evaluator") {
      this.evaluatorCount += 1;
      if (this.mode === "repair" && this.evaluatorCount === 1) {
        return JSON.stringify({
          status: "NEEDS_REVISION",
          verdict: "NEEDS_REVISION",
          summary: "Whitespace-only project names are still accepted.",
          findings_json: JSON.stringify([
            {
              severity: "high",
              category: "correctness",
              description: "Whitespace-only project names are still accepted.",
              evidence: [],
              required_fix: "Reject names whose trimmed length is zero."
            }
          ]),
          validation_commands_checked: ["npm test"]
        });
      }
      return JSON.stringify({
        status: "PASS",
        verdict: "PASS",
        summary: "Acceptance criteria are satisfied.",
        findings_json: "[]",
        validation_commands_checked: ["npm test"]
      });
    }
    return "{}";
  }

  private stub(role: RuntimeRole): RuntimeThreadResult {
    return {
      thread_id: `thread_${role}`,
      role,
      status: "PASS",
      final_response: "{}",
      events: [],
      events_path: "",
      stdout_path: "",
      stderr_path: "",
      artifacts: [],
      errors: []
    };
  }
}

class PlannerTimeoutFakeAdapter implements RuntimeAdapter {
  async startThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return this.runThreadStreamed(input);
  }

  async runThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return this.runThreadStreamed(input);
  }

  async runThreadStreamed(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    const eventsPath = input.error_capture_paths?.events_path ?? "";
    if (eventsPath) {
      writeFile(eventsPath, "{\"type\":\"thread.started\",\"thread_id\":\"thread_planner_timeout\"}\n");
    }
    return {
      thread_id: "thread_planner_timeout",
      role: input.role,
      status: "TIMEOUT",
      final_response: "",
      events: [],
      events_path: eventsPath,
      stdout_path: input.error_capture_paths?.stdout_path ?? "",
      stderr_path: input.error_capture_paths?.stderr_path ?? "",
      artifacts: [],
      errors: ["SDK thread exceeded timeout_ms=180000."],
      failure_category: "SDK_NO_EVENT_TIMEOUT",
      no_event_timeout: true,
      last_event_type: "thread.started",
      elapsed_ms: 180000
    };
  }

  async resumeThread(input: RuntimeThreadRefInput): Promise<RuntimeThreadResult> {
    return this.stub(input.role);
  }

  async getThreadEvents(input: RuntimeEventsInput): Promise<RuntimeThreadEventsResult> {
    return { thread_id: input.thread_id, events_path: input.events_path ?? "", events: [], errors: [] };
  }

  async stopThread(input: RuntimeStopThreadInput): Promise<RuntimeThreadResult> {
    return { ...this.stub("context_distiller"), thread_id: input.thread_id };
  }

  async getFinalResponse(input: RuntimeFinalResponseInput): Promise<RuntimeThreadResult> {
    return { ...this.stub("context_distiller"), thread_id: input.thread_id };
  }

  private stub(role: RuntimeRole): RuntimeThreadResult {
    return {
      thread_id: `thread_${role}`,
      role,
      status: "PASS",
      final_response: "{}",
      events: [],
      events_path: "",
      stdout_path: "",
      stderr_path: "",
      artifacts: [],
      errors: []
    };
  }
}

class DevWorkerNotStartedFakeAdapter extends GenericFeatureFakeAdapter {
  constructor() {
    super("pass");
  }

  override async runThreadStreamed(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    if (input.role === "dev_worker") {
      return {
        thread_id: "",
        role: input.role,
        status: "BLOCKED",
        final_response: "",
        events: [],
        events_path: input.error_capture_paths?.events_path ?? "",
        stdout_path: input.error_capture_paths?.stdout_path ?? "",
        stderr_path: input.error_capture_paths?.stderr_path ?? "",
        artifacts: [],
        errors: ["Dev worker did not start."],
        failure_category: "DEV_WORKER_THREAD_STARTUP_FAILURE"
      };
    }
    return super.runThreadStreamed(input);
  }
}

class EvaluatorTimeoutFakeAdapter extends GenericFeatureFakeAdapter {
  constructor() {
    super("pass");
  }

  override async runThreadStreamed(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    if (input.role === "evaluator") {
      const eventsPath = input.error_capture_paths?.events_path ?? "";
      if (eventsPath) {
        writeFile(eventsPath, "{\"type\":\"thread.started\",\"thread_id\":\"thread_evaluator_timeout\"}\n{\"type\":\"turn.started\"}\n");
      }
      return {
        thread_id: "thread_evaluator_timeout",
        role: input.role,
        status: "TIMEOUT",
        final_response: "",
        events: [],
        events_path: eventsPath,
        stdout_path: input.error_capture_paths?.stdout_path ?? "",
        stderr_path: input.error_capture_paths?.stderr_path ?? "",
        artifacts: [],
        errors: ["SDK thread exceeded timeout_ms=180000."],
        failure_category: "SDK_NO_EVENT_TIMEOUT",
        no_event_timeout: true,
        last_event_type: "turn.started",
        elapsed_ms: 180000
      };
    }
    return super.runThreadStreamed(input);
  }
}
