import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildBugfixEvaluatorPrompt } from "../../src/effectiveness/bugfix-evaluator-stage.ts";
import { buildBugfixSmall001PlannerPrompt, bugfixPlannerStageConfig } from "../../src/effectiveness/bugfix-planner-stage.ts";
import { runGenericBugfixTreatment } from "../../src/effectiveness/treatment-generic-bugfix-runner.ts";
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
import { runTreatmentCase } from "../../scripts/effectiveness/run-treatment-case.ts";
import { validDevWorkerLiteOutput } from "../orchestrator/parse-dev-worker-lite-output.test.ts";
import { validPlannerLiteV2Output } from "../orchestrator/planner-lite-v2-output.test.ts";

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("generic bugfix treatment runner", () => {
  it("supports bugfix-small-001 dry-run without starting SDK", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");

    const result = await runTreatmentCase(bugfixCase());

    expect(result).toMatchObject({
      case_id: "bugfix-small-001",
      mode: "treatment",
      runtime: "sdk-orchestrated",
      status: "DRY_RUN",
      real_run_executed: false,
      validation_commands: ["npm test"],
      validation_passed: false,
      danger_full_access_used: false,
      secret_leak_detected: false
    });
    expect(result.treatment_expected_artifacts).toEqual([
      "docs/PRD.md",
      "docs/TASK_GRAPH.json",
      "artifacts/dev-result.json",
      "artifacts/eval-report.json",
      "artifacts/FinalDeliveryReport.md"
    ]);
  });

  it("supports bugfix-small-002 dry-run without starting SDK", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");

    const result = await runTreatmentCase(bugfixCase("bugfix-small-002"));

    expect(result).toMatchObject({
      case_id: "bugfix-small-002",
      mode: "treatment",
      runtime: "sdk-orchestrated",
      status: "DRY_RUN",
      real_run_executed: false,
      validation_commands: ["npm test"],
      validation_passed: false,
      danger_full_access_used: false,
      secret_leak_detected: false
    });
    expect(result.treatment_expected_artifacts).toEqual([
      "docs/PRD.md",
      "docs/TASK_GRAPH.json",
      "artifacts/dev-result.json",
      "artifacts/eval-report.json",
      "artifacts/FinalDeliveryReport.md"
    ]);
  });

  it("accepts the evaluator PASS path without seeded-gap repair", async () => {
    const repoRoot = tempRoot("m12-bugfix-pass-");
    const adapter = new GenericBugfixFakeAdapter("pass");

    const result = await runGenericBugfixTreatment({
      testCase: bugfixCase(),
      repoRoot,
      fresh: true,
      env: {
        CODEX_LOOP_ENABLE_M12_REAL_RUN: "1",
        CODEX_LOOP_CODEX_MODEL: "gpt-test"
      },
      runtime_adapter: adapter
    });

    expect(result.status).toBe("PASS");
    expect(result.real_run_executed).toBe(true);
    expect(result.initial_eval_verdict).toBe("PASS");
    expect(result.final_eval_verdict).toBe("PASS");
    expect(result.repair_request_created).toBe(false);
    expect(result.repair_dev_worker_thread_id).toBe("");
    expect(result.final_evaluator_thread_id).toBe("thread_evaluator_1");
    expect(result.validation_passed).toBe(true);
    expect(result.changed_files).toContain("src/pagination.js");
    expect(result.artifacts).toEqual(expect.arrayContaining([
      "docs/PRD.md",
      "docs/TASK_GRAPH.json",
      "artifacts/dev-result.json",
      "artifacts/eval-report.json",
      "artifacts/FinalDeliveryReport.md"
    ]));
    const checkpointPath = resolve(repoRoot, "evals/effectiveness/reports/bugfix-small-001/treatment-generic-bugfix-state.json");
    expect(existsSync(checkpointPath)).toBe(true);
    expect(JSON.parse(readFileSync(checkpointPath, "utf8"))).toMatchObject({
      current_stage: "FINAL_REPORT_DONE",
      planner: { output_contract_version: "v2" },
      dev_worker: { tests_passed: true },
      final_report: { status: "PASS" }
    });
  });

  it("supports bugfix-small-002 through the same generic direct PASS runtime", async () => {
    const repoRoot = tempRoot("m12-bugfix-002-pass-");
    const adapter = new GenericBugfixFakeAdapter("pass", "bugfix-small-002");

    const result = await runGenericBugfixTreatment({
      testCase: bugfixCase("bugfix-small-002"),
      repoRoot,
      fresh: true,
      env: {
        CODEX_LOOP_ENABLE_M12_REAL_RUN: "1",
        CODEX_LOOP_CODEX_MODEL: "gpt-test"
      },
      runtime_adapter: adapter
    });

    expect(result.status).toBe("PASS");
    expect(result.real_run_executed).toBe(true);
    expect(result.initial_eval_verdict).toBe("PASS");
    expect(result.final_eval_verdict).toBe("PASS");
    expect(result.repair_request_created).toBe(false);
    expect(result.validation_passed).toBe(true);
    expect(result.changed_files).toContain("src/date-range.js");
    expect(result.artifacts).toEqual(expect.arrayContaining([
      "docs/PRD.md",
      "docs/TASK_GRAPH.json",
      "artifacts/dev-result.json",
      "artifacts/eval-report.json",
      "artifacts/FinalDeliveryReport.md"
    ]));
    const devWorkerInput = adapter.inputs.find((input) => input.role === "dev_worker")!;
    expect(devWorkerInput.prompt).toContain("rangesOverlap");
    expect(devWorkerInput.prompt).toContain("src/date-range.js");
  });

  it("supports optional repair path when the first evaluator returns NEEDS_REVISION", async () => {
    const repoRoot = tempRoot("m12-bugfix-repair-");
    const adapter = new GenericBugfixFakeAdapter("repair");

    const result = await runGenericBugfixTreatment({
      testCase: bugfixCase(),
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

  it("uses planner-lite-v2 and evaluator-lite with the run method path", async () => {
    const repoRoot = tempRoot("m12-bugfix-prompts-");
    const adapter = new GenericBugfixFakeAdapter("pass");

    await runGenericBugfixTreatment({
      testCase: bugfixCase(),
      repoRoot,
      fresh: true,
      env: {
        CODEX_LOOP_ENABLE_M12_REAL_RUN: "1",
        CODEX_LOOP_CODEX_MODEL: "gpt-test"
      },
      runtime_adapter: adapter
    });

    const plannerInput = adapter.inputs.find((input) => input.role === "planner")!;
    const evaluatorInput = adapter.inputs.find((input) => input.role === "evaluator")!;
    expect(plannerInput.prompt).toBe(buildBugfixSmall001PlannerPrompt());
    expect(plannerInput.prompt).not.toContain("task_graph_json");
    expect(JSON.stringify(plannerInput.output_schema)).toContain("\"tasks\"");
    expect(evaluatorInput.prompt).toBe(buildBugfixEvaluatorPrompt({
      prd_path: "docs/PRD.md",
      task_graph_path: "docs/TASK_GRAPH.json",
      dev_result_path: "artifacts/dev-result.json",
      test_log_path: resolve(repoRoot, "evals/effectiveness/reports/bugfix-small-001/treatment-validation.log"),
      diff_path: resolve(repoRoot, "evals/effectiveness/reports/bugfix-small-001/treatment-diff.patch")
    }));
    expect(JSON.stringify(evaluatorInput.output_schema)).toContain("findings_json");
    expect(JSON.stringify(evaluatorInput.output_schema)).not.toContain("eval_id");
  });

  it("builds bugfix-small-002 planner and evaluator prompts from the date range profile", async () => {
    const repoRoot = tempRoot("m12-bugfix-002-prompts-");
    const adapter = new GenericBugfixFakeAdapter("pass", "bugfix-small-002");

    await runGenericBugfixTreatment({
      testCase: bugfixCase("bugfix-small-002"),
      repoRoot,
      fresh: true,
      env: {
        CODEX_LOOP_ENABLE_M12_REAL_RUN: "1",
        CODEX_LOOP_CODEX_MODEL: "gpt-test"
      },
      runtime_adapter: adapter
    });

    const plannerInput = adapter.inputs.find((input) => input.role === "planner")!;
    const evaluatorInput = adapter.inputs.find((input) => input.role === "evaluator")!;
    expect(plannerInput.prompt).toBe(bugfixPlannerStageConfig("bugfix-small-002").prompt);
    expect(plannerInput.prompt).toContain("src/date-range.js");
    expect(evaluatorInput.prompt).toBe(buildBugfixEvaluatorPrompt({
      testCase: "bugfix-small-002",
      prd_path: "docs/PRD.md",
      task_graph_path: "docs/TASK_GRAPH.json",
      dev_result_path: "artifacts/dev-result.json",
      test_log_path: resolve(repoRoot, "evals/effectiveness/reports/bugfix-small-002/treatment-validation.log"),
      diff_path: resolve(repoRoot, "evals/effectiveness/reports/bugfix-small-002/treatment-diff.patch")
    }));
    expect(evaluatorInput.prompt).toContain("adjacent ranges do not overlap");
    expect(JSON.stringify(evaluatorInput.output_schema)).toContain("findings_json");
  });
});

function bugfixCase(caseId = "bugfix-small-001") {
  return loadM12Dataset().find((entry) => entry.case_id === caseId)!;
}

function tempRoot(prefix: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), prefix));
  tempDirs.push(dir);
  writeFile(
    resolve(dir, "evals/effectiveness/datasets/m12-mini.jsonl"),
    readFileSync(resolve("/Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/datasets/m12-mini.jsonl"), "utf8")
  );
  copyBugfixFixture(dir, "bugfix-small-001");
  copyBugfixFixture(dir, "bugfix-small-002");
  return dir;
}

function copyBugfixFixture(repoRoot: string, caseId: "bugfix-small-001" | "bugfix-small-002"): void {
  const source = resolve("/Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/fixtures", caseId);
  const target = resolve(repoRoot, "evals/effectiveness/fixtures", caseId);
  writeFile(resolve(target, "package.json"), readFileSync(resolve(source, "package.json"), "utf8"));
  writeFile(resolve(target, "README.md"), readFileSync(resolve(source, "README.md"), "utf8"));
  if (caseId === "bugfix-small-001") {
    writeFile(resolve(target, "src/pagination.js"), readFileSync(resolve(source, "src/pagination.js"), "utf8"));
    writeFile(resolve(target, "test/pagination.test.js"), readFileSync(resolve(source, "test/pagination.test.js"), "utf8"));
  } else {
    writeFile(resolve(target, "src/date-range.js"), readFileSync(resolve(source, "src/date-range.js"), "utf8"));
    writeFile(resolve(target, "test/date-range.test.js"), readFileSync(resolve(source, "test/date-range.test.js"), "utf8"));
  }
}

function writeFile(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

class GenericBugfixFakeAdapter implements RuntimeAdapter {
  readonly inputs: RuntimeThreadInput[] = [];
  private devWorkerCount = 0;
  private evaluatorCount = 0;
  private readonly mode: "pass" | "repair";
  private readonly caseId: "bugfix-small-001" | "bugfix-small-002";

  constructor(mode: "pass" | "repair", caseId: "bugfix-small-001" | "bugfix-small-002" = "bugfix-small-001") {
    this.mode = mode;
    this.caseId = caseId;
  }

  async startThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return this.runThread(input);
  }

  async runThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    this.inputs.push(input);
    const threadId = this.nextThreadId(input.role);
    const eventsPath = input.error_capture_paths?.events_path ?? "";
    if (eventsPath) {
      writeFile(eventsPath, `{"type":"thread.started","thread_id":"${threadId}"}\n`);
    }
    if (input.role === "dev_worker") {
      this.writeTargetImplementation(input.working_directory);
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

  private writeTargetImplementation(targetRepo: string): void {
    if (this.caseId === "bugfix-small-002") {
      this.writeDateRangeImplementation(targetRepo);
      return;
    }
    this.writePaginationImplementation(targetRepo);
  }

  private writePaginationImplementation(targetRepo: string): void {
    const repairPassLine = this.mode === "repair" && this.devWorkerCount > 1
      ? "  const onFinalPage = currentPage >= totalPages;"
      : "  const onFinalPage = currentPage === totalPages;";
    const returnLine = this.mode === "repair" && this.devWorkerCount > 1
      ? "  return !onFinalPage;"
      : "  return currentPage < totalPages;";
    writeFile(
      resolve(targetRepo, "src/pagination.js"),
      [
        "export function hasNextPage(currentPage, totalPages) {",
        "  if (!Number.isInteger(currentPage) || !Number.isInteger(totalPages)) return false;",
        "  if (totalPages < 1) return false;",
        "  if (currentPage < 1 || currentPage > totalPages) return false;",
        repairPassLine,
        returnLine,
        "}",
        ""
      ].join("\n")
    );
  }

  private writeDateRangeImplementation(targetRepo: string): void {
    writeFile(
      resolve(targetRepo, "src/date-range.js"),
      [
        "export function rangesOverlap(first, second) {",
        "  if (!isValidRange(first) || !isValidRange(second)) return false;",
        "  return first.start < second.end && second.start < first.end;",
        "}",
        "",
        "function isValidRange(range) {",
        "  return Boolean(range) &&",
        "    Number.isFinite(range.start) &&",
        "    Number.isFinite(range.end) &&",
        "    range.start < range.end;",
        "}",
        ""
      ].join("\n")
    );
  }

  private finalResponse(input: RuntimeThreadInput): string {
    if (input.role === "planner") {
      if (this.caseId === "bugfix-small-002") {
        return JSON.stringify(validPlannerLiteV2Output({
          prd_markdown: "# PRD\n\nFix date range overlap logic.",
          tasks: [
            {
              id: "TASK-001",
              title: "Fix rangesOverlap",
              description: "Correct adjacent, nested, identical, and invalid range behavior.",
              acceptance_criteria: [
                "Adjacent ranges do not overlap.",
                "Nested ranges overlap.",
                "Identical ranges overlap.",
                "Invalid ranges are rejected."
              ],
              likely_files: ["src/date-range.js", "test/date-range.test.js"],
              validation_commands: ["npm test"]
            }
          ],
          acceptance_criteria: [
            "Adjacent ranges do not overlap.",
            "Nested ranges overlap.",
            "Identical ranges overlap.",
            "Invalid ranges are rejected."
          ]
        }));
      }
      return JSON.stringify(validPlannerLiteV2Output({
        prd_markdown: "# PRD\n\nFix pagination next-page detection.",
        tasks: [
          {
            id: "TASK-001",
            title: "Fix hasNextPage",
            description: "Correct final-page and invalid-page behavior.",
            acceptance_criteria: [
              "hasNextPage is false when current page equals total pages.",
              "hasNextPage is true before the final page.",
              "Invalid page numbers are rejected.",
              "npm test passes."
            ],
            likely_files: ["src/pagination.js", "test/pagination.test.js"],
            validation_commands: ["npm test"]
          }
        ],
        acceptance_criteria: [
          "hasNextPage is false when current page equals total pages.",
          "hasNextPage is true before the final page.",
          "Invalid page numbers are rejected.",
          "npm test passes."
        ]
      }));
    }
    if (input.role === "dev_worker") {
      return JSON.stringify(validDevWorkerLiteOutput({
        changed_files: [this.caseId === "bugfix-small-002" ? "src/date-range.js" : "src/pagination.js"],
        summary: this.caseId === "bugfix-small-002"
          ? "Fixed rangesOverlap boundary logic and npm test passes."
          : "Fixed hasNextPage boundary logic and npm test passes."
      }));
    }
    if (input.role === "evaluator") {
      this.evaluatorCount += 1;
      if (this.mode === "repair" && this.evaluatorCount === 1) {
        return JSON.stringify({
          status: "NEEDS_REVISION",
          verdict: "NEEDS_REVISION",
          summary: "Evaluator requests one repair pass for pagination edge evidence.",
          findings_json: JSON.stringify([
            {
              severity: "medium",
              category: "correctness",
              description: "Pagination edge evidence needs a repair pass.",
              evidence: [],
              required_fix: "Confirm invalid page rejection and rerun npm test."
            }
          ]),
          validation_commands_checked: ["npm test"]
        });
      }
      return JSON.stringify({
        status: "PASS",
        verdict: "PASS",
        summary: this.caseId === "bugfix-small-002" ? "Date range acceptance criteria are satisfied." : "Pagination acceptance criteria are satisfied.",
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
