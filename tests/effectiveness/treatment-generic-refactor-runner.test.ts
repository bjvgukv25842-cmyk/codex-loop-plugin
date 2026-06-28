import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildRefactorEvaluatorPrompt } from "../../src/effectiveness/refactor-evaluator-stage.ts";
import { buildRefactorSmall001PlannerPrompt } from "../../src/effectiveness/refactor-planner-stage.ts";
import { runGenericRefactorTreatment } from "../../src/effectiveness/treatment-generic-refactor-runner.ts";
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

vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  vi.unstubAllEnvs();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("generic refactor treatment runner", () => {
  it("supports refactor-small-001 dry-run without starting SDK", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");

    const result = await runTreatmentCase(refactorCase());

    expect(result).toMatchObject({
      case_id: "refactor-small-001",
      mode: "treatment",
      runtime: "sdk-orchestrated",
      status: "DRY_RUN",
      real_run_executed: false,
      validation_commands: ["npm test", "npm run refactor:contract", "npm run lint:structure"],
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

  it("accepts the evaluator PASS path without requiring seeded-gap repair", async () => {
    const repoRoot = tempRoot("m12-refactor-pass-");
    const adapter = new GenericRefactorFakeAdapter("pass");

    const result = await runGenericRefactorTreatment({
      testCase: refactorCase(),
      repoRoot,
      fresh: true,
      env: {
        CODEX_LOOP_ENABLE_M12_REAL_RUN: "1",
        CODEX_LOOP_CODEX_MODEL: "gpt-test"
      },
      runtime_adapter: adapter,
      validation_runner: fakeValidationRunner
    });

    expect(result.status).toBe("PASS");
    expect(result.real_run_executed).toBe(true);
    expect(result.initial_eval_verdict).toBe("PASS");
    expect(result.final_eval_verdict).toBe("PASS");
    expect(result.repair_request_created).toBe(false);
    expect(result.repair_dev_worker_thread_id).toBe("");
    expect(result.final_evaluator_thread_id).toBe("thread_evaluator_1");
    expect(result.validation_passed).toBe(true);
    expect(result.changed_files).toEqual(["src/report-builder.js"]);
    expect(result.artifacts).toEqual(expect.arrayContaining([
      "docs/PRD.md",
      "docs/TASK_GRAPH.json",
      "artifacts/dev-result.json",
      "artifacts/eval-report.json",
      "artifacts/FinalDeliveryReport.md"
    ]));
    const checkpointPath = resolve(repoRoot, "evals/effectiveness/reports/refactor-small-001/treatment-generic-refactor-state.json");
    expect(existsSync(checkpointPath)).toBe(true);
    expect(JSON.parse(readFileSync(checkpointPath, "utf8"))).toMatchObject({
      current_stage: "FINAL_REPORT_DONE",
      planner: { output_contract_version: "v2" },
      dev_worker: { tests_passed: true },
      final_report: { status: "PASS" }
    });
  });

  it("supports optional repair path when the first evaluator returns NEEDS_REVISION", async () => {
    const repoRoot = tempRoot("m12-refactor-repair-");
    const adapter = new GenericRefactorFakeAdapter("repair");

    const result = await runGenericRefactorTreatment({
      testCase: refactorCase(),
      repoRoot,
      fresh: true,
      env: {
        CODEX_LOOP_ENABLE_M12_REAL_RUN: "1",
        CODEX_LOOP_CODEX_MODEL: "gpt-test"
      },
      runtime_adapter: adapter,
      validation_runner: fakeValidationRunner
    });

    expect(result.status).toBe("PASS");
    expect(result.initial_eval_verdict).toBe("NEEDS_REVISION");
    expect(result.final_eval_verdict).toBe("PASS");
    expect(result.repair_request_created).toBe(true);
    expect(result.repair_dev_worker_thread_id).toBe("thread_dev_worker_2");
    expect(result.final_evaluator_thread_id).toBe("thread_evaluator_2");
    expect(result.artifacts).toEqual(expect.arrayContaining([
      "artifacts/eval-report.json",
      "artifacts/repair-request.json",
      "artifacts/repair-result.json",
      "artifacts/final-eval-report.json",
      "artifacts/FinalDeliveryReport.md"
    ]));
    expect(existsSync(resolve(repoRoot, "evals/effectiveness/runs/refactor-small-001/treatment/target-repo/artifacts/eval-report.json"))).toBe(true);
    expect(result.evaluator_artifact_path).toBe("artifacts/eval-report.json");
  });

  it("persists evaluator artifact from recoverable NEEDS_REVISION lite output before creating a RepairRequest", async () => {
    const repoRoot = tempRoot("m12-refactor-recover-eval-");
    const adapter = new GenericRefactorFakeAdapter("repair-missing-evidence");

    const result = await runGenericRefactorTreatment({
      testCase: refactorCase(),
      repoRoot,
      fresh: true,
      env: {
        CODEX_LOOP_ENABLE_M12_REAL_RUN: "1",
        CODEX_LOOP_CODEX_MODEL: "gpt-test"
      },
      runtime_adapter: adapter,
      validation_runner: fakeValidationRunner
    });

    const targetRepo = resolve(repoRoot, "evals/effectiveness/runs/refactor-small-001/treatment/target-repo");
    const evalReport = JSON.parse(readFileSync(resolve(targetRepo, "artifacts/eval-report.json"), "utf8"));
    const repairRequest = JSON.parse(readFileSync(resolve(targetRepo, "artifacts/repair-request.json"), "utf8"));
    expect(result.status).toBe("PASS");
    expect(result.initial_eval_verdict).toBe("NEEDS_REVISION");
    expect(result.repair_request_created).toBe(true);
    expect(evalReport).toMatchObject({
      verdict: "NEEDS_REVISION",
      evaluator_agent_id: "sdk-refactor-evaluator"
    });
    expect(evalReport.validation_commands_checked.map((entry: { command: string }) => entry.command)).toEqual([
      "npm test",
      "npm run refactor:contract",
      "npm run lint:structure"
    ]);
    expect(repairRequest.source_eval_id).toBe(evalReport.eval_id);
  });

  it("maps recoverable evaluator PASS output to the direct FinalReport path", async () => {
    const repoRoot = tempRoot("m12-refactor-recover-pass-");
    const adapter = new GenericRefactorFakeAdapter("pass-missing-evidence");

    const result = await runGenericRefactorTreatment({
      testCase: refactorCase(),
      repoRoot,
      fresh: true,
      env: {
        CODEX_LOOP_ENABLE_M12_REAL_RUN: "1",
        CODEX_LOOP_CODEX_MODEL: "gpt-test"
      },
      runtime_adapter: adapter,
      validation_runner: fakeValidationRunner
    });

    const targetRepo = resolve(repoRoot, "evals/effectiveness/runs/refactor-small-001/treatment/target-repo");
    const evalReport = JSON.parse(readFileSync(resolve(targetRepo, "artifacts/eval-report.json"), "utf8"));
    expect(result.status).toBe("PASS");
    expect(result.initial_eval_verdict).toBe("PASS");
    expect(result.final_eval_verdict).toBe("PASS");
    expect(result.repair_request_created).toBe(false);
    expect(result.final_report_path).toBe("artifacts/FinalDeliveryReport.md");
    expect(result.evaluator_artifact_path).toBe("artifacts/eval-report.json");
    expect(existsSync(resolve(targetRepo, "artifacts/FinalDeliveryReport.md"))).toBe(true);
    expect(evalReport.validation_commands_checked.map((entry: { command: string }) => entry.command)).toEqual([
      "npm test",
      "npm run refactor:contract",
      "npm run lint:structure"
    ]);
  });

  it("does not generate a fake FinalReport when evaluator output cannot be recovered", async () => {
    const repoRoot = tempRoot("m12-refactor-bad-eval-");
    const adapter = new GenericRefactorFakeAdapter("invalid-evaluator");

    const result = await runGenericRefactorTreatment({
      testCase: refactorCase(),
      repoRoot,
      fresh: true,
      env: {
        CODEX_LOOP_ENABLE_M12_REAL_RUN: "1",
        CODEX_LOOP_CODEX_MODEL: "gpt-test"
      },
      runtime_adapter: adapter,
      validation_runner: fakeValidationRunner
    });

    const targetRepo = resolve(repoRoot, "evals/effectiveness/runs/refactor-small-001/treatment/target-repo");
    expect(result.status).toBe("BLOCKED");
    expect(result.final_report_path).toBe("");
    expect(result.final_eval_verdict).toBe("");
    expect(result.failure_category).toBe("EVALUATOR_LITE_OUTPUT_SCHEMA_FAILED");
    expect(existsSync(resolve(targetRepo, "artifacts/FinalDeliveryReport.md"))).toBe(false);
  });

  it("uses planner-lite-v2 and evaluator-lite with the run method path", async () => {
    const repoRoot = tempRoot("m12-refactor-prompts-");
    const adapter = new GenericRefactorFakeAdapter("pass");

    await runGenericRefactorTreatment({
      testCase: refactorCase(),
      repoRoot,
      fresh: true,
      env: {
        CODEX_LOOP_ENABLE_M12_REAL_RUN: "1",
        CODEX_LOOP_CODEX_MODEL: "gpt-test"
      },
      runtime_adapter: adapter,
      validation_runner: fakeValidationRunner
    });

    const plannerInput = adapter.inputs.find((input) => input.role === "planner")!;
    const evaluatorInput = adapter.inputs.find((input) => input.role === "evaluator")!;
    expect(plannerInput.prompt).toBe(buildRefactorSmall001PlannerPrompt());
    expect(plannerInput.prompt).not.toContain("task_graph_json");
    expect(JSON.stringify(plannerInput.output_schema)).toContain("\"tasks\"");
    expect(evaluatorInput.prompt).toBe(buildRefactorEvaluatorPrompt({
      prd_path: "docs/PRD.md",
      task_graph_path: "docs/TASK_GRAPH.json",
      dev_result_path: "artifacts/dev-result.json",
      test_log_path: resolve(repoRoot, "evals/effectiveness/reports/refactor-small-001/treatment-validation.log"),
      diff_path: resolve(repoRoot, "evals/effectiveness/reports/refactor-small-001/treatment-diff.patch")
    }));
    expect(JSON.stringify(evaluatorInput.output_schema)).toContain("findings_json");
    expect(JSON.stringify(evaluatorInput.output_schema)).not.toContain("eval_id");
  });
});

function refactorCase() {
  return loadM12Dataset().find((entry) => entry.case_id === "refactor-small-001")!;
}

function tempRoot(prefix: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), prefix));
  tempDirs.push(dir);
  writeFile(
    resolve(dir, "evals/effectiveness/datasets/m12-mini.jsonl"),
    readFileSync(resolve("/Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/datasets/m12-mini.jsonl"), "utf8")
  );
  copyRefactorFixture(dir);
  return dir;
}

function copyRefactorFixture(repoRoot: string): void {
  const source = resolve("/Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/fixtures/refactor-small-001");
  const target = resolve(repoRoot, "evals/effectiveness/fixtures/refactor-small-001");
  for (const file of [
    "package.json",
    "README.md",
    "src/report-builder.js",
    "test/report-builder.test.js",
    "scripts/check-refactor-contract.js",
    "scripts/check-structure.js"
  ]) {
    writeFile(resolve(target, file), readFileSync(resolve(source, file), "utf8"));
  }
}

function writeFile(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function fakeValidationRunner(_cwd: string, logPath: string, commands: string[]): { passed: boolean; output: string } {
  const output = commands.map((command) => `$ ${command}\nPASS\n`).join("");
  writeFile(logPath, output);
  return { passed: true, output };
}

class GenericRefactorFakeAdapter implements RuntimeAdapter {
  readonly inputs: RuntimeThreadInput[] = [];
  private devWorkerCount = 0;
  private evaluatorCount = 0;
  private readonly mode: "pass" | "pass-missing-evidence" | "repair" | "repair-missing-evidence" | "invalid-evaluator";

  constructor(mode: "pass" | "pass-missing-evidence" | "repair" | "repair-missing-evidence" | "invalid-evaluator") {
    this.mode = mode;
  }

  async startThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return this.runThread(input);
  }

  async runThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    this.inputs.push(input);
    const threadId = this.nextThreadId(input.role);
    const eventsPath = input.error_capture_paths?.events_path ?? "";
    const finalResponse = this.finalResponse(input);
    if (eventsPath) {
      writeFile(eventsPath, `{"type":"thread.started","thread_id":"${threadId}"}\n`);
    }
    if (input.error_capture_paths?.stdout_path) {
      writeFile(input.error_capture_paths.stdout_path, finalResponse);
    }
    if (input.role === "dev_worker") {
      this.writeRefactoredReportBuilder(input.working_directory);
    }
    return {
      thread_id: threadId,
      role: input.role,
      status: "PASS",
      final_response: finalResponse,
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

  private writeRefactoredReportBuilder(targetRepo: string): void {
    const repairComment = (this.mode === "repair" || this.mode === "repair-missing-evidence") && this.devWorkerCount > 1
      ? ["", "// Repair pass confirmed centralized helpers and validation evidence."]
      : [];
    writeFile(
      resolve(targetRepo, "src/report-builder.js"),
      [
        "export function buildSummaryReport(data) {",
        "  const items = reportItems(data);",
        "  const title = formatText(data?.title, \"Untitled\");",
        "  const date = formatReportDate(data?.createdAt);",
        "  const statusLabel = formatStatus(data?.status);",
        "  const total = totalAmount(items);",
        "",
        "  return [",
        "    `Report: ${title}`,",
        "    `Date: ${date}`,",
        "    `Status: ${statusLabel}`,",
        "    `Items: ${items.length}`,",
        "    `Total: ${formatMoney(total)}`",
        "  ].join(\"\\n\");",
        "}",
        "",
        "export function buildDetailedReport(data) {",
        "  const items = reportItems(data);",
        "  const title = formatText(data?.title, \"Untitled\");",
        "  const owner = formatText(data?.owner, \"Unassigned\");",
        "  const date = formatReportDate(data?.createdAt);",
        "  const statusLabel = formatStatus(data?.status);",
        "  const lines = [",
        "    `Report: ${title}`,",
        "    `Owner: ${owner}`,",
        "    `Date: ${date}`,",
        "    `Status: ${statusLabel}`,",
        "    \"Items:\"",
        "  ];",
        "",
        "  for (const item of items) {",
        "    lines.push(`- ${formatText(item.name, \"Unnamed\")}: ${formatMoney(item.amount)}`);",
        "  }",
        "",
        "  lines.push(`Total: ${formatMoney(totalAmount(items))}`);",
        "  return lines.join(\"\\n\");",
        "}",
        "",
        "export function buildCsvReport(data) {",
        "  const items = reportItems(data);",
        "  const title = formatText(data?.title, \"Untitled\");",
        "  const date = formatReportDate(data?.createdAt);",
        "  const statusLabel = formatStatus(data?.status);",
        "  const rows = [\"title,date,status,item,amount\"];",
        "",
        "  for (const item of items) {",
        "    rows.push([title, date, statusLabel, formatText(item.name, \"Unnamed\"), Number(item.amount ?? 0).toFixed(2)].map(csvEscape).join(\",\"));",
        "  }",
        "",
        "  return rows.join(\"\\n\");",
        "}",
        "",
        "function reportItems(data) {",
        "  return Array.isArray(data?.items) ? data.items : [];",
        "}",
        "",
        "function formatText(value, fallback) {",
        "  return String(value ?? fallback).trim();",
        "}",
        "",
        "function formatReportDate(value) {",
        "  const createdAt = new Date(value ?? \"2026-01-01T00:00:00Z\");",
        "  return [",
        "    createdAt.getUTCFullYear(),",
        "    String(createdAt.getUTCMonth() + 1).padStart(2, \"0\"),",
        "    String(createdAt.getUTCDate()).padStart(2, \"0\")",
        "  ].join(\"-\");",
        "}",
        "",
        "function formatStatus(value) {",
        "  const status = formatText(value, \"draft\").toLowerCase();",
        "  return status === \"published\" ? \"Published\" : status === \"archived\" ? \"Archived\" : \"Draft\";",
        "}",
        "",
        "function formatMoney(value) {",
        "  return `$${Number(value ?? 0).toFixed(2)}`;",
        "}",
        "",
        "function totalAmount(items) {",
        "  return items.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);",
        "}",
        "",
        "function csvEscape(value) {",
        "  const text = String(value);",
        "  return /[\",\\n]/.test(text) ? `\"${text.replaceAll(\"\\\"\", \"\\\"\\\"\")}\"` : text;",
        "}",
        ...repairComment,
        ""
      ].join("\n")
    );
  }

  private finalResponse(input: RuntimeThreadInput): string {
    if (input.role === "planner") {
      return JSON.stringify(validPlannerLiteV2Output({
        prd_markdown: "# PRD\n\nRefactor report-builder formatting helpers without changing public output.",
        tasks: [
          {
            id: "TASK-001",
            title: "Centralize report builder formatting",
            description: "Refactor duplicate formatting logic in src/report-builder.js.",
            acceptance_criteria: [
              "Duplicate trimming logic is centralized.",
              "Duplicate date formatting logic is centralized.",
              "Duplicate status mapping logic is centralized.",
              "Public function outputs are unchanged.",
              "Public API exports remain buildSummaryReport, buildDetailedReport, and buildCsvReport.",
              "npm test passes.",
              "npm run refactor:contract passes.",
              "npm run lint:structure passes."
            ],
            likely_files: ["src/report-builder.js"],
            validation_commands: ["npm test", "npm run refactor:contract", "npm run lint:structure"]
          }
        ],
        acceptance_criteria: [
          "Duplicate trimming logic is centralized.",
          "Duplicate date formatting logic is centralized.",
          "Duplicate status mapping logic is centralized.",
          "Public function outputs are unchanged.",
          "Public API exports remain buildSummaryReport, buildDetailedReport, and buildCsvReport.",
          "npm test passes.",
          "npm run refactor:contract passes.",
          "npm run lint:structure passes."
        ]
      }));
    }
    if (input.role === "dev_worker") {
      return JSON.stringify(validDevWorkerLiteOutput({
        changed_files: ["src/report-builder.js"],
        tests_run: ["npm test", "npm run refactor:contract", "npm run lint:structure"],
        summary: "Centralized report-builder formatting helpers while preserving public outputs."
      }));
    }
    if (input.role === "evaluator") {
      this.evaluatorCount += 1;
      if (this.mode === "invalid-evaluator") {
        return "{not json";
      }
      if (this.mode === "repair-missing-evidence" && this.evaluatorCount === 1) {
        return JSON.stringify({
          status: "NEEDS_REVISION",
          verdict: "NEEDS_REVISION",
          summary: "Validation evidence path was missing from evaluator workspace.",
          findings_json: JSON.stringify([
            {
              severity: "major",
              file: "evals/effectiveness/reports/refactor-small-001/treatment-validation.log",
              issue: "Required validation evidence is not available at the provided input path relative to the evaluation workspace.",
              required_fix: "Provide the validation log at the declared path or correct the input path and rerun evaluation."
            }
          ]),
          validation_commands_checked: []
        });
      }
      if (this.mode === "repair" && this.evaluatorCount === 1) {
        return JSON.stringify({
          status: "NEEDS_REVISION",
          verdict: "NEEDS_REVISION",
          summary: "Evaluator requests one repair pass for explicit structure evidence.",
          findings_json: JSON.stringify([
            {
              severity: "medium",
              category: "refactor_scope",
              description: "Structure evidence needs repair confirmation.",
              evidence: [],
              required_fix: "Confirm centralized helpers and rerun all validation commands."
            }
          ]),
          validation_commands_checked: ["npm test", "npm run refactor:contract", "npm run lint:structure"]
        });
      }
      if (this.mode === "pass-missing-evidence") {
        return JSON.stringify({
          status: "PASS",
          verdict: "PASS",
          summary: "Report builder refactor acceptance criteria are satisfied, but validation command list was omitted.",
          findings_json: "[]",
          validation_commands_checked: []
        });
      }
      return JSON.stringify({
        status: "PASS",
        verdict: "PASS",
        summary: "Report builder refactor acceptance criteria are satisfied.",
        findings_json: "[]",
        validation_commands_checked: ["npm test", "npm run refactor:contract", "npm run lint:structure"]
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
