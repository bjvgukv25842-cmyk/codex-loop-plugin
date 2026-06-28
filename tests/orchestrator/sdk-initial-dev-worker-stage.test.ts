import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildInitialDevWorkerSeededGapPrompt,
  runInitialDevWorkerSeededGapStage
} from "../../src/orchestrator/sdk-initial-dev-worker-stage.ts";
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

describe("runInitialDevWorkerSeededGapStage", () => {
  it("passes when baseline tests pass and full tests fail as the seeded gap", async () => {
    const targetRepo = createTargetRepo();
    const adapter = new FakeRuntimeAdapter(validSeededGapOutput(), targetRepo, true);

    const result = await runInitialDevWorkerSeededGapStage(stageInput(targetRepo, adapter));

    expect(result.status).toBe("PASS");
    expect(result.dev_worker_thread_id).toBe("thread_initial_dev_worker");
    expect(result.known_gap_seeded).toBe(true);
    expect(result.baseline_tests_passed).toBe(true);
    expect(result.full_tests_expected_to_fail).toBe(true);
    expect(result.full_tests_failed).toBe(true);
    expect(JSON.parse(readFileSync(resolve(targetRepo, "artifacts/dev-result.json"), "utf8"))).toEqual(
      expect.objectContaining({
        known_gap_seeded: true,
        baseline_tests_passed: true,
        full_tests_failed: true,
        created_by_thread_id: "thread_initial_dev_worker"
      })
    );
    expect(adapter.inputs[0]?.prompt).toContain("Do not reject whitespace-only strings");
    expect(adapter.inputs[0]?.prompt).toBe(buildInitialDevWorkerSeededGapPrompt({ prd_path: "docs/PRD.md", task_graph_path: "docs/TASK_GRAPH.json" }));
  });

  it("fails when the seeded gap is not preserved", async () => {
    const targetRepo = createTargetRepo();
    const adapter = new FakeRuntimeAdapter(
      validSeededGapOutput({
        full_tests_failed: false
      }),
      targetRepo,
      true
    );

    const result = await runInitialDevWorkerSeededGapStage(stageInput(targetRepo, adapter));

    expect(result.status).toBe("FAILED");
    expect(result.failure_category).toBe("SEEDED_GAP_NOT_PRESERVED");
  });

  it("fails when baseline tests fail", async () => {
    const targetRepo = createTargetRepo();
    const adapter = new FakeRuntimeAdapter(
      validSeededGapOutput({
        baseline_tests_passed: false
      }),
      targetRepo,
      true
    );

    const result = await runInitialDevWorkerSeededGapStage(stageInput(targetRepo, adapter));

    expect(result.status).toBe("FAILED");
    expect(result.failure_category).toBe("INITIAL_DEV_BASELINE_TESTS_FAILED");
  });

  it("fails when source did not change", async () => {
    const targetRepo = createTargetRepo();
    const adapter = new FakeRuntimeAdapter(validSeededGapOutput(), targetRepo, false);

    const result = await runInitialDevWorkerSeededGapStage(stageInput(targetRepo, adapter));

    expect(result.status).toBe("FAILED");
    expect(result.failure_category).toBe("INITIAL_DEV_NO_FILE_CHANGE");
  });
});

function stageInput(targetRepo: string, adapter: RuntimeAdapter) {
  return {
    loop_run_id: "loop_test",
    task_id: "task_test",
    target_repo: targetRepo,
    prd_path: "docs/PRD.md",
    task_graph_path: "docs/TASK_GRAPH.json",
    sqlite_home: "/tmp/sqlite",
    sandbox: "workspace-write" as const,
    timeout_ms: 180_000,
    runtime_adapter: adapter,
    repo_root: targetRepo,
    report_dir: resolve(targetRepo, "reports")
  };
}

function validSeededGapOutput(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    status: "PASS",
    changed_files: ["src/project-name.js"],
    baseline_tests_run: true,
    baseline_tests_passed: true,
    full_tests_run: true,
    full_tests_expected_to_fail: true,
    full_tests_failed: true,
    known_gap_seeded: true,
    summary: "Initial implementation intentionally preserves whitespace-only gap.",
    ...overrides
  });
}

function createTargetRepo(): string {
  const targetRepo = mkdtempSync(resolve(tmpdir(), "initial-dev-worker-stage-"));
  writeText(targetRepo, "docs/PRD.md", "# PRD\n\nValidate project names.\n");
  writeText(targetRepo, "docs/TASK_GRAPH.json", "{}\n");
  writeText(targetRepo, "src/project-name.js", "export function validateProjectName(name) {\n  return { ok: true };\n}\n");
  writeText(targetRepo, "package.json", "{\"type\":\"module\",\"scripts\":{\"test\":\"npm run test:full\",\"test:baseline\":\"node --test test/project-name.baseline.test.js\",\"test:full\":\"node --test test/project-name.full.test.js\"}}\n");
  writeText(
    targetRepo,
    "test/project-name.baseline.test.js",
    [
      "import test from \"node:test\";",
      "import assert from \"node:assert/strict\";",
      "import { validateProjectName } from \"../src/project-name.js\";",
      "",
      "test(\"rejects empty string\", () => {",
      "  assert.equal(validateProjectName(\"\").ok, false);",
      "});",
      "",
      "test(\"rejects names longer than 80 characters\", () => {",
      "  assert.equal(validateProjectName(\"x\".repeat(81)).ok, false);",
      "});",
      "",
      "test(\"accepts valid project names\", () => {",
      "  assert.equal(validateProjectName(\"My Project\").ok, true);",
      "});",
      ""
    ].join("\n")
  );
  writeText(
    targetRepo,
    "test/project-name.full.test.js",
    [
      "import test from \"node:test\";",
      "import assert from \"node:assert/strict\";",
      "import { validateProjectName } from \"../src/project-name.js\";",
      "",
      "test(\"rejects empty string\", () => {",
      "  assert.equal(validateProjectName(\"\").ok, false);",
      "});",
      "",
      "test(\"rejects whitespace-only string\", () => {",
      "  assert.equal(validateProjectName(\"   \").ok, false);",
      "});",
      "",
      "test(\"rejects names longer than 80 characters\", () => {",
      "  assert.equal(validateProjectName(\"x\".repeat(81)).ok, false);",
      "});",
      "",
      "test(\"accepts valid project names\", () => {",
      "  assert.equal(validateProjectName(\"My Project\").ok, true);",
      "});",
      ""
    ].join("\n")
  );
  writeBaseline(targetRepo, resolve(targetRepo, "reports"));
  return targetRepo;
}

function writeText(root: string, path: string, value: string): void {
  const absolute = resolve(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, "utf8");
}

function writeBaseline(root: string, reportDir: string): void {
  writeText(
    reportDir,
    "dev-worker-baseline.json",
    `${JSON.stringify(
      {
        target_repo: root,
        src_project_name_hash_before: hashFile(resolve(root, "src/project-name.js")),
        package_json_hash_before: hashFile(resolve(root, "package.json")),
        test_project_name_hash_before: "",
        test_project_name_baseline_hash_before: hashFile(resolve(root, "test/project-name.baseline.test.js")),
        test_project_name_full_hash_before: hashFile(resolve(root, "test/project-name.full.test.js")),
        initial_tests_run: true,
        initial_tests_expected_to_fail: true,
        initial_tests_failed: true,
        initial_baseline_tests_run: true,
        initial_baseline_tests_failed: true,
        initial_full_tests_run: true,
        initial_full_tests_failed: true,
        seeded_gap_fixture_created: true,
        fixture_status: "BROKEN_AS_EXPECTED"
      },
      null,
      2
    )}\n`
  );
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

class FakeRuntimeAdapter implements RuntimeAdapter {
  readonly inputs: RuntimeThreadInput[] = [];

  constructor(
    private readonly finalResponse: string,
    private readonly targetRepo: string,
    private readonly shouldModifySource: boolean
  ) {}

  async startThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return this.runThread(input);
  }

  async runThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    this.inputs.push(input);
    if (this.shouldModifySource) {
      writeText(
        this.targetRepo,
        "src/project-name.js",
        [
          "export function validateProjectName(name) {",
          "  if (typeof name !== \"string\") return { ok: false };",
          "  if (name.length === 0) return { ok: false };",
          "  if (name.length > 80) return { ok: false };",
          "  return { ok: true };",
          "}",
          ""
        ].join("\n")
      );
    }
    return {
      thread_id: "thread_initial_dev_worker",
      role: input.role,
      status: "PASS",
      final_response: this.finalResponse,
      events: [],
      events_path: input.error_capture_paths?.events_path ?? "",
      stdout_path: "",
      stderr_path: "",
      artifacts: [],
      sandbox_control: "VERIFIED",
      errors: []
    };
  }

  async resumeThread(input: RuntimeThreadRefInput): Promise<RuntimeThreadResult> {
    return {
      thread_id: input.thread_id,
      role: input.role,
      status: "PASS",
      final_response: this.finalResponse,
      events: [],
      events_path: input.error_capture_paths?.events_path ?? "",
      stdout_path: "",
      stderr_path: "",
      artifacts: [],
      sandbox_control: "VERIFIED",
      errors: []
    };
  }

  async getThreadEvents(input: RuntimeEventsInput): Promise<RuntimeThreadEventsResult> {
    return { thread_id: input.thread_id, events_path: input.events_path ?? "", events: [], errors: [] };
  }

  async stopThread(input: RuntimeStopThreadInput): Promise<RuntimeThreadResult> {
    return {
      thread_id: input.thread_id,
      role: "dev_worker",
      status: "PASS",
      final_response: this.finalResponse,
      events: [],
      events_path: "",
      stdout_path: "",
      stderr_path: "",
      artifacts: [],
      sandbox_control: "VERIFIED",
      errors: []
    };
  }

  async getFinalResponse(input: RuntimeFinalResponseInput): Promise<RuntimeThreadResult> {
    return {
      thread_id: input.thread_id,
      role: "dev_worker",
      status: "PASS",
      final_response: this.finalResponse,
      events: [],
      events_path: "",
      stdout_path: "",
      stderr_path: "",
      artifacts: [],
      sandbox_control: "VERIFIED",
      errors: []
    };
  }
}
