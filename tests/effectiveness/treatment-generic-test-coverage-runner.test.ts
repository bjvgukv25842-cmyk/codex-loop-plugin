import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildTestCoverageEvaluatorPrompt } from "../../src/effectiveness/test-coverage-evaluator-stage.ts";
import { buildTestCoverage001PlannerPrompt, testCoveragePlannerStageConfig } from "../../src/effectiveness/test-coverage-planner-stage.ts";
import { runGenericTestCoverageTreatment } from "../../src/effectiveness/treatment-generic-test-coverage-runner.ts";
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

describe("generic test coverage treatment runner", () => {
  it("supports test-coverage-001 dry-run without starting SDK", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");

    const result = await runTreatmentCase(testCoverageCase());

    expect(result).toMatchObject({
      case_id: "test-coverage-001",
      mode: "treatment",
      runtime: "sdk-orchestrated",
      status: "DRY_RUN",
      real_run_executed: false,
      validation_commands: ["npm test", "npm run coverage:contract"],
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

  it("supports test-coverage-002 dry-run without starting SDK", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");
    const result = await runTreatmentCase(testCoverageCase("test-coverage-002"));

    expect(result).toMatchObject({
      case_id: "test-coverage-002",
      mode: "treatment",
      runtime: "sdk-orchestrated",
      status: "DRY_RUN",
      real_run_executed: false,
      validation_commands: ["npm test", "npm run coverage:contract"],
      validation_passed: false,
      danger_full_access_used: false,
      secret_leak_detected: false
    });
  });

  it("accepts the evaluator PASS path without seeded-gap repair", async () => {
    const repoRoot = tempRoot("m12-test-coverage-pass-");
    const adapter = new GenericTestCoverageFakeAdapter("pass");

    const result = await runGenericTestCoverageTreatment({
      testCase: testCoverageCase(),
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
    expect(result.changed_files).toContain("test/invoice.test.js");
    expect(result.changed_files).not.toContain("src/invoice.js");
    expect(result.artifacts).toEqual(expect.arrayContaining([
      "docs/PRD.md",
      "docs/TASK_GRAPH.json",
      "artifacts/dev-result.json",
      "artifacts/eval-report.json",
      "artifacts/FinalDeliveryReport.md"
    ]));
    const checkpointPath = resolve(repoRoot, "evals/effectiveness/reports/test-coverage-001/treatment-generic-test-coverage-state.json");
    expect(existsSync(checkpointPath)).toBe(true);
    expect(JSON.parse(readFileSync(checkpointPath, "utf8"))).toMatchObject({
      current_stage: "FINAL_REPORT_DONE",
      planner: { output_contract_version: "v2" },
      dev_worker: { tests_passed: true },
      final_report: { status: "PASS" }
    });
  });

  it("supports optional repair path when the first evaluator returns NEEDS_REVISION", async () => {
    const repoRoot = tempRoot("m12-test-coverage-repair-");
    const adapter = new GenericTestCoverageFakeAdapter("repair");

    const result = await runGenericTestCoverageTreatment({
      testCase: testCoverageCase(),
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
    const repoRoot = tempRoot("m12-test-coverage-prompts-");
    const adapter = new GenericTestCoverageFakeAdapter("pass");

    await runGenericTestCoverageTreatment({
      testCase: testCoverageCase(),
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
    expect(plannerInput.prompt).toBe(buildTestCoverage001PlannerPrompt());
    expect(plannerInput.prompt).not.toContain("task_graph_json");
    expect(JSON.stringify(plannerInput.output_schema)).toContain("\"tasks\"");
    expect(evaluatorInput.prompt).toBe(buildTestCoverageEvaluatorPrompt({
      prd_path: "docs/PRD.md",
      task_graph_path: "docs/TASK_GRAPH.json",
      dev_result_path: "artifacts/dev-result.json",
      test_log_path: resolve(repoRoot, "evals/effectiveness/reports/test-coverage-001/treatment-validation.log"),
      diff_path: resolve(repoRoot, "evals/effectiveness/reports/test-coverage-001/treatment-diff.patch")
    }));
    expect(JSON.stringify(evaluatorInput.output_schema)).toContain("findings_json");
    expect(JSON.stringify(evaluatorInput.output_schema)).not.toContain("eval_id");
  });

  it("runs test-coverage-002 through the generic pass path", async () => {
    const repoRoot = tempRoot("m12-test-coverage-002-pass-", "test-coverage-002");
    const adapter = new GenericTestCoverageFakeAdapter("pass");

    const result = await runGenericTestCoverageTreatment({
      testCase: testCoverageCase("test-coverage-002"),
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
    expect(result.changed_files).toContain("test/cache.test.js");
    expect(result.changed_files).not.toContain("src/cache.js");
    const plannerInput = adapter.inputs.find((input) => input.role === "planner")!;
    expect(plannerInput.prompt).toBe(testCoveragePlannerStageConfig("test-coverage-002").prompt);
    expect(plannerInput.prompt).toContain("cache invalidation");
    const evaluatorInput = adapter.inputs.find((input) => input.role === "evaluator")!;
    expect(evaluatorInput.prompt).toContain("test-coverage-002");
    expect(evaluatorInput.prompt).toContain("test/cache.test.js");
    const checkpointPath = resolve(repoRoot, "evals/effectiveness/reports/test-coverage-002/treatment-generic-test-coverage-state.json");
    expect(JSON.parse(readFileSync(checkpointPath, "utf8"))).toMatchObject({
      case_id: "test-coverage-002",
      current_stage: "FINAL_REPORT_DONE"
    });
  });

  it("records per-command validation results and coverage contract status", async () => {
    const repoRoot = tempRoot("m12-test-coverage-002-validation-results-", "test-coverage-002");
    const adapter = new GenericTestCoverageFakeAdapter("pass");

    const result = await runGenericTestCoverageTreatment({
      testCase: testCoverageCase("test-coverage-002"),
      repoRoot,
      fresh: true,
      env: {
        CODEX_LOOP_ENABLE_M12_REAL_RUN: "1",
        CODEX_LOOP_CODEX_MODEL: "gpt-test"
      },
      runtime_adapter: adapter,
      validation_runner: fakeValidationRunner
    });

    expect(result.validation_command_results).toEqual([
      expect.objectContaining({ command: "npm test", status: "PASS", passed: true }),
      expect.objectContaining({ command: "npm run coverage:contract", status: "PASS", passed: true })
    ]);
    expect(result.coverage_contract_passed).toBe(true);
    expect(result.validation_log_paths?.[0]).toContain("treatment-validation.log");
  });

  it("classifies test-coverage-002 dev worker SDK timeout with a stage-specific category", async () => {
    const repoRoot = tempRoot("m12-test-coverage-002-timeout-", "test-coverage-002");
    const adapter = new TimeoutDevWorkerAdapter();

    const result = await runGenericTestCoverageTreatment({
      testCase: testCoverageCase("test-coverage-002"),
      repoRoot,
      fresh: true,
      env: {
        CODEX_LOOP_ENABLE_M12_REAL_RUN: "1",
        CODEX_LOOP_CODEX_MODEL: "gpt-test"
      },
      runtime_adapter: adapter,
      validation_runner: fakeValidationRunner
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.dev_worker_thread_id).toBe("thread_dev_timeout");
    expect(result.failure_category).toBe("TEST_COVERAGE_002_DEV_WORKER_TURN_NO_EVENT_TIMEOUT");
    expect(result.current_stage).toBe("DEV_WORKER_STARTED");
    expect(result.first_failed_stage).toBe("dev_worker");
    expect(result.dev_worker_event_count).toBe(1);
    expect(result.dev_worker_elapsed_ms).toBe(180000);
    expect(result.dev_worker_last_event_type).toBe("thread.started");
    expect(result.stage_timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "dev_worker",
          started: true,
          thread_id: "thread_dev_timeout",
          status: "TIMEOUT",
          last_event_type: "thread.started",
          elapsed_ms: 180000
        })
      ])
    );
    expect(result.coverage_contract_passed).toBe(false);
    expect(result.validation_command_results).toEqual([
      expect.objectContaining({ command: "npm test", status: "NOT_RUN", passed: false }),
      expect.objectContaining({ command: "npm run coverage:contract", status: "NOT_RUN", passed: false })
    ]);
  });
});

function testCoverageCase(caseId = "test-coverage-001") {
  return loadM12Dataset().find((entry) => entry.case_id === caseId)!;
}

function tempRoot(prefix: string, caseId = "test-coverage-001"): string {
  const dir = mkdtempSync(resolve(tmpdir(), prefix));
  tempDirs.push(dir);
  writeFile(
    resolve(dir, "evals/effectiveness/datasets/m12-mini.jsonl"),
    readFileSync(resolve("/Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/datasets/m12-mini.jsonl"), "utf8")
  );
  copyTestCoverageFixture(dir, caseId);
  return dir;
}

function copyTestCoverageFixture(repoRoot: string, caseId = "test-coverage-001"): void {
  const source = resolve("/Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/fixtures", caseId);
  const target = resolve(repoRoot, "evals/effectiveness/fixtures", caseId);
  const files = caseId === "test-coverage-002"
    ? ["package.json", "README.md", "src/cache.js", "src/cache-storage.js", "test/cache.test.js", "scripts/check-test-coverage-contract.js"]
    : ["package.json", "README.md", "src/invoice.js", "test/invoice.test.js", "scripts/check-test-coverage-contract.js"];
  for (const file of files) {
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

class GenericTestCoverageFakeAdapter implements RuntimeAdapter {
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
      if (existsSync(resolve(input.working_directory, "test/cache.test.js"))) {
        this.writeCacheCoverageTests(input.working_directory);
      } else {
        this.writeInvoiceCoverageTests(input.working_directory);
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

  private writeInvoiceCoverageTests(targetRepo: string): void {
    const repairExtra = this.mode === "repair" && this.devWorkerCount > 1
      ? [
          "",
          "test(\"repair confirms capped fixed discount does not go below zero\", () => {",
          "  assert.equal(calculateInvoiceTotal([{ price: 5, quantity: 1 }], { discount: 10, taxRate: 0 }), 0);",
          "});"
        ]
      : [];
    writeFile(
      resolve(targetRepo, "test/invoice.test.js"),
      [
        "import test from \"node:test\";",
        "import assert from \"node:assert/strict\";",
        "",
        "import { calculateInvoiceTotal } from \"../src/invoice.js\";",
        "",
        "test(\"calculates a happy path invoice total\", () => {",
        "  assert.equal(calculateInvoiceTotal([{ price: 10, quantity: 2 }], { taxRate: 0.1 }), 22);",
        "});",
        "",
        "test(\"covers empty items\", () => {",
        "  assert.equal(calculateInvoiceTotal([], { taxRate: 0.1 }), 0);",
        "});",
        "",
        "test(\"covers zero discount\", () => {",
        "  assert.equal(calculateInvoiceTotal([{ price: 10, quantity: 1 }], { discount: 0, taxRate: 0 }), 10);",
        "});",
        "",
        "test(\"covers percent discount\", () => {",
        "  assert.equal(calculateInvoiceTotal([{ price: 100, quantity: 1 }], { discount: 0.25, discountType: \"percent\", taxRate: 0 }), 75);",
        "});",
        "",
        "test(\"covers fixed discount\", () => {",
        "  assert.equal(calculateInvoiceTotal([{ price: 20, quantity: 1 }], { discount: 5, discountType: \"fixed\", taxRate: 0 }), 15);",
        "});",
        "",
        "test(\"covers taxable=false\", () => {",
        "  assert.equal(calculateInvoiceTotal([{ price: 10, quantity: 1 }], { taxable: false, taxRate: 0.5 }), 10);",
        "});",
        "",
        "test(\"covers shippingFee\", () => {",
        "  assert.equal(calculateInvoiceTotal([{ price: 10, quantity: 1 }], { shippingFee: 4, taxRate: 0 }), 14);",
        "});",
        "",
        "test(\"throws for invalid price\", () => {",
        "  assert.throws(() => calculateInvoiceTotal([{ price: -1, quantity: 1 }]), /price/);",
        "});",
        "",
        "test(\"throws for invalid quantity\", () => {",
        "  assert.throws(() => calculateInvoiceTotal([{ price: 1, quantity: -1 }]), /quantity/);",
        "});",
        ...repairExtra,
        ""
      ].join("\n")
    );
  }

  private writeCacheCoverageTests(targetRepo: string): void {
    writeFile(
      resolve(targetRepo, "test/cache.test.js"),
      [
        "import test from \"node:test\";",
        "import assert from \"node:assert/strict\";",
        "",
        "import { createUserCache } from \"../src/cache.js\";",
        "import { createMemoryUserStorage } from \"../src/cache-storage.js\";",
        "",
        "test(\"returns a cached user on repeated reads\", () => {",
        "  const storage = createMemoryUserStorage({ \"user-1\": { name: \"Ada\" } });",
        "  const cache = createUserCache(storage);",
        "  assert.deepEqual(cache.getUser(\"user-1\"), { name: \"Ada\" });",
        "  assert.deepEqual(cache.getUser(\"user-1\"), { name: \"Ada\" });",
        "  assert.deepEqual(storage.calls.loadUser, [\"user-1\"]);",
        "});",
        "",
        "test(\"covers cache miss path for a missing user\", () => {",
        "  const storage = createMemoryUserStorage();",
        "  const cache = createUserCache(storage);",
        "  assert.equal(cache.getUser(\"missing-user\"), null);",
        "  assert.deepEqual(storage.calls.loadUser, [\"missing-user\"]);",
        "});",
        "",
        "test(\"prevents stale cache after updateUser writes an updated replacement value\", () => {",
        "  const storage = createMemoryUserStorage({ \"user-1\": { name: \"Ada\" } });",
        "  const cache = createUserCache(storage);",
        "  assert.deepEqual(cache.getUser(\"user-1\"), { name: \"Ada\" });",
        "  cache.updateUser(\"user-1\", { name: \"Grace\" });",
        "  assert.deepEqual(cache.getUser(\"user-1\"), { name: \"Grace\" });",
        "  assert.deepEqual(storage.calls.loadUser, [\"user-1\"]);",
        "});",
        ""
      ].join("\n")
    );
  }

  private finalResponse(input: RuntimeThreadInput): string {
    if (input.role === "planner") {
      return JSON.stringify(validPlannerLiteV2Output({
        prd_markdown: "# PRD\n\nAdd missing invoice calculator tests.",
        tasks: [
          {
            id: "TASK-001",
            title: "Add invoice coverage tests",
            description: "Add missing calculateInvoiceTotal edge case tests.",
            acceptance_criteria: [
              "Adds tests for empty items.",
              "Adds tests for discount of 0.",
              "Adds tests for percentage discount.",
              "Adds tests for fixed discount.",
              "Adds tests for taxable=false.",
              "Adds tests for shippingFee.",
              "Adds tests for invalid item price and quantity.",
              "npm test passes.",
              "npm run coverage:contract passes."
            ],
            likely_files: ["test/invoice.test.js", "src/invoice.js"],
            validation_commands: ["npm test", "npm run coverage:contract"]
          }
        ],
        acceptance_criteria: [
          "Adds tests for empty items.",
          "Adds tests for discount of 0.",
          "Adds tests for percentage discount.",
          "Adds tests for fixed discount.",
          "Adds tests for taxable=false.",
          "Adds tests for shippingFee.",
          "Adds tests for invalid item price and quantity.",
          "npm test passes.",
          "npm run coverage:contract passes."
        ]
      }));
    }
    if (input.role === "dev_worker") {
      if (existsSync(resolve(input.working_directory, "test/cache.test.js"))) {
        return JSON.stringify(validDevWorkerLiteOutput({
          changed_files: ["test/cache.test.js"],
          tests_run: ["npm test", "npm run coverage:contract"],
          summary: "Added cache invalidation regression tests and both validation commands pass."
        }));
      }
      return JSON.stringify(validDevWorkerLiteOutput({
        changed_files: ["test/invoice.test.js"],
        tests_run: ["npm test", "npm run coverage:contract"],
        summary: "Added invoice coverage tests and both validation commands pass."
      }));
    }
    if (input.role === "evaluator") {
      this.evaluatorCount += 1;
      if (this.mode === "repair" && this.evaluatorCount === 1) {
        return JSON.stringify({
          status: "NEEDS_REVISION",
          verdict: "NEEDS_REVISION",
          summary: "Evaluator requests one repair pass for invoice coverage evidence.",
          findings_json: JSON.stringify([
            {
              severity: "medium",
              category: "test_gap",
              description: "Invoice coverage evidence needs a repair pass.",
              evidence: [],
              required_fix: "Confirm coverage contract evidence and rerun validation."
            }
          ]),
          validation_commands_checked: ["npm test", "npm run coverage:contract"]
        });
      }
      return JSON.stringify({
        status: "PASS",
        verdict: "PASS",
        summary: "Invoice coverage acceptance criteria are satisfied.",
        findings_json: "[]",
        validation_commands_checked: ["npm test", "npm run coverage:contract"]
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

class TimeoutDevWorkerAdapter extends GenericTestCoverageFakeAdapter {
  constructor() {
    super("pass");
  }

  override async runThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    if (input.role === "dev_worker") {
      return {
        thread_id: "thread_dev_timeout",
        role: "dev_worker",
        status: "TIMEOUT",
        final_response: "",
        events: [],
        events_path: input.error_capture_paths?.events_path ?? "",
        stdout_path: input.error_capture_paths?.stdout_path ?? "",
        stderr_path: input.error_capture_paths?.stderr_path ?? "",
        artifacts: [],
        sandbox_control: "VERIFIED",
        failure_category: "SDK_THREAD_TIMEOUT",
        no_event_timeout: true,
        last_event_type: "thread.started",
        elapsed_ms: 180000,
        event_count: 1,
        errors: ["SDK thread exceeded timeout_ms=180000."]
      };
    }
    return super.runThread(input);
  }
}
