import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDocsEvaluatorPrompt } from "../../src/effectiveness/docs-evaluator-stage.ts";
import { buildDocsUpdate001PlannerPrompt } from "../../src/effectiveness/docs-planner-stage.ts";
import { runGenericDocsTreatment } from "../../src/effectiveness/treatment-generic-docs-runner.ts";
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

describe("generic docs treatment runner", () => {
  it("supports docs-update-001 dry-run without starting SDK", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");

    const result = await runTreatmentCase(docsCase());

    expect(result).toMatchObject({
      case_id: "docs-update-001",
      mode: "treatment",
      runtime: "sdk-orchestrated",
      status: "DRY_RUN",
      real_run_executed: false,
      validation_commands: ["npm test", "npm run docs:contract"],
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
    const repoRoot = tempRoot("m12-docs-pass-");
    const adapter = new GenericDocsFakeAdapter("pass");

    const result = await runGenericDocsTreatment({
      testCase: docsCase(),
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
    expect(result.changed_files).toEqual(expect.arrayContaining(["README.md", "docs/API.md"]));
    expect(result.changed_files).not.toContain("src/duration.js");
    expect(result.artifacts).toEqual(expect.arrayContaining([
      "docs/PRD.md",
      "docs/TASK_GRAPH.json",
      "artifacts/dev-result.json",
      "artifacts/eval-report.json",
      "artifacts/FinalDeliveryReport.md"
    ]));
    const checkpointPath = resolve(repoRoot, "evals/effectiveness/reports/docs-update-001/treatment-generic-docs-state.json");
    expect(existsSync(checkpointPath)).toBe(true);
    expect(JSON.parse(readFileSync(checkpointPath, "utf8"))).toMatchObject({
      current_stage: "FINAL_REPORT_DONE",
      planner: { output_contract_version: "v2" },
      dev_worker: { tests_passed: true },
      final_report: { status: "PASS" }
    });
  });

  it("supports optional repair path when the first evaluator returns NEEDS_REVISION", async () => {
    const repoRoot = tempRoot("m12-docs-repair-");
    const adapter = new GenericDocsFakeAdapter("repair");

    const result = await runGenericDocsTreatment({
      testCase: docsCase(),
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
      "artifacts/repair-request.json",
      "artifacts/repair-result.json",
      "artifacts/final-eval-report.json",
      "artifacts/FinalDeliveryReport.md"
    ]));
  });

  it("uses planner-lite-v2 and evaluator-lite with the run method path", async () => {
    const repoRoot = tempRoot("m12-docs-prompts-");
    const adapter = new GenericDocsFakeAdapter("pass");

    await runGenericDocsTreatment({
      testCase: docsCase(),
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
    expect(plannerInput.prompt).toBe(buildDocsUpdate001PlannerPrompt());
    expect(plannerInput.prompt).not.toContain("task_graph_json");
    expect(JSON.stringify(plannerInput.output_schema)).toContain("\"tasks\"");
    expect(evaluatorInput.prompt).toBe(buildDocsEvaluatorPrompt({
      prd_path: "docs/PRD.md",
      task_graph_path: "docs/TASK_GRAPH.json",
      dev_result_path: "artifacts/dev-result.json",
      test_log_path: resolve(repoRoot, "evals/effectiveness/reports/docs-update-001/treatment-validation.log"),
      diff_path: resolve(repoRoot, "evals/effectiveness/reports/docs-update-001/treatment-diff.patch")
    }));
    expect(JSON.stringify(evaluatorInput.output_schema)).toContain("findings_json");
    expect(JSON.stringify(evaluatorInput.output_schema)).not.toContain("eval_id");
  });
});

function docsCase() {
  return loadM12Dataset().find((entry) => entry.case_id === "docs-update-001")!;
}

function tempRoot(prefix: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), prefix));
  tempDirs.push(dir);
  writeFile(
    resolve(dir, "evals/effectiveness/datasets/m12-mini.jsonl"),
    readFileSync(resolve("/Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/datasets/m12-mini.jsonl"), "utf8")
  );
  copyDocsFixture(dir);
  return dir;
}

function copyDocsFixture(repoRoot: string): void {
  const source = resolve("/Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/fixtures/docs-update-001");
  const target = resolve(repoRoot, "evals/effectiveness/fixtures/docs-update-001");
  for (const file of [
    "package.json",
    "README.md",
    "docs/API.md",
    "src/duration.js",
    "test/duration.test.js",
    "scripts/check-docs-contract.js"
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

class GenericDocsFakeAdapter implements RuntimeAdapter {
  readonly inputs: RuntimeThreadInput[] = [];
  private devWorkerCount = 0;
  private evaluatorCount = 0;
  private readonly mode: "pass" | "repair";

  constructor(mode: "pass" | "repair") {
    this.mode = mode;
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
      this.writeDocs(input.working_directory);
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

  private writeDocs(targetRepo: string): void {
    const repairExtra = this.mode === "repair" && this.devWorkerCount > 1
      ? ["", "### Repair Evidence", "The repair pass confirmed the docs contract with `npm run docs:contract`."]
      : [];
    writeFile(resolve(targetRepo, "README.md"), [
      "# Duration Utils",
      "",
      "## Installation",
      "Run `npm install`.",
      "",
      "## Usage",
      "`parseDuration(\"30s\")`, `parseDuration(\"5m\")`, and `parseDuration(\"2h\")` return milliseconds.",
      "",
      "## API Reference",
      "`parseDuration(input)` accepts duration strings with `s`, `m`, or `h` units.",
      "",
      "## Testing",
      "Run `npm test` and `npm run docs:contract`.",
      ...repairExtra
    ].join("\n"));
    writeFile(resolve(targetRepo, "docs/API.md"), [
      "# API",
      "",
      "`parseDuration(input)` supports units: s, m, h.",
      "Invalid input returns null."
    ].join("\n"));
  }

  private finalResponse(input: RuntimeThreadInput): string {
    if (input.role === "planner") {
      return JSON.stringify(validPlannerLiteV2Output({
        prd_markdown: "# PRD\n\nUpdate parseDuration README and API documentation.",
        tasks: [
          {
            id: "TASK-001",
            title: "Update parseDuration docs",
            description: "Update README.md and docs/API.md for parseDuration(input).",
            acceptance_criteria: [
              "README.md contains Installation, Usage, API Reference, and Testing sections.",
              "README.md contains at least 3 parseDuration examples.",
              "docs/API.md describes supported units s, m, h.",
              "docs/API.md describes invalid input returns null.",
              "npm test passes.",
              "npm run docs:contract passes."
            ],
            likely_files: ["README.md", "docs/API.md", "src/duration.js"],
            validation_commands: ["npm test", "npm run docs:contract"]
          }
        ],
        acceptance_criteria: [
          "README.md contains Installation, Usage, API Reference, and Testing sections.",
          "README.md contains at least 3 parseDuration examples.",
          "docs/API.md describes supported units s, m, h.",
          "docs/API.md describes invalid input returns null.",
          "npm test passes.",
          "npm run docs:contract passes."
        ]
      }));
    }
    if (input.role === "dev_worker") {
      return JSON.stringify(validDevWorkerLiteOutput({
        changed_files: ["README.md", "docs/API.md"],
        tests_run: ["npm test", "npm run docs:contract"],
        summary: "Updated parseDuration README and API docs; both validation commands pass."
      }));
    }
    if (input.role === "evaluator") {
      this.evaluatorCount += 1;
      if (this.mode === "repair" && this.evaluatorCount === 1) {
        return JSON.stringify({
          status: "NEEDS_REVISION",
          verdict: "NEEDS_REVISION",
          summary: "Evaluator requests one repair pass for docs contract evidence.",
          findings_json: JSON.stringify([
            {
              severity: "medium",
              category: "docs_gap",
              description: "Docs contract evidence needs repair confirmation.",
              evidence: [],
              required_fix: "Confirm README/API docs and rerun docs contract."
            }
          ]),
          validation_commands_checked: ["npm test", "npm run docs:contract"]
        });
      }
      return JSON.stringify({
        status: "PASS",
        verdict: "PASS",
        summary: "parseDuration docs acceptance criteria are satisfied.",
        findings_json: "[]",
        validation_commands_checked: ["npm test", "npm run docs:contract"]
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
