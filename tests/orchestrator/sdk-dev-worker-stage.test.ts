import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildDevWorkerStagePrompt,
  createDevWorkerRuntimeInput,
  devWorkerInvocationSnapshot,
  evaluateDevWorkerThread,
  runDevWorkerStage
} from "../../src/orchestrator/sdk-dev-worker-stage.ts";
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
import { diffSnapshots } from "../../scripts/sdk-orchestrated/diff-dev-worker-vs-gate6b.ts";
import { validDevWorkerLiteOutput } from "./parse-dev-worker-lite-output.test.ts";

describe("runDevWorkerStage", () => {
  it("starts dev_worker via runtime adapter and writes DevResult artifact with thread evidence", async () => {
    const targetRepo = createTargetRepo();
    const adapter = new FakeRuntimeAdapter(JSON.stringify(validDevWorkerLiteOutput()), targetRepo, true);

    const result = await runDevWorkerStage({
      loop_run_id: "loop_test",
      task_id: "task_test",
      target_repo: targetRepo,
      prd_path: "docs/PRD.md",
      task_graph_path: "docs/TASK_GRAPH.json",
      model: "gpt-test",
      model_catalog_json: "/tmp/model-catalog.json",
      sqlite_home: "/tmp/sqlite",
      sandbox: "workspace-write",
      timeout_ms: 180_000,
      runtime_adapter: adapter,
      repo_root: targetRepo,
      report_dir: resolve(targetRepo, "reports")
    });

    expect(result.status).toBe("PASS");
    expect(result.dev_worker_thread_id).toBe("thread_dev_worker_stage");
    expect(result.file_change_verified).toBe(true);
    expect(result.file_change_verified_by_hash).toBe(true);
    expect(result.tests_passed).toBe(true);
    expect(adapter.inputs[0]?.prompt).toBe(buildDevWorkerStagePrompt({ prd_path: "docs/PRD.md", task_graph_path: "docs/TASK_GRAPH.json" }));
    expect(adapter.inputs[0]?.sandbox).toBe("workspace-write");
    expect(JSON.parse(readFileSync(resolve(targetRepo, "artifacts/dev-result.json"), "utf8"))).toEqual(
      expect.objectContaining({
        created_by_runtime: "sdk-orchestrated",
        created_by_role: "dev_worker",
        created_by_thread_id: "thread_dev_worker_stage"
      })
    );
  });

  it("requires a real src/project-name.js file change", async () => {
    const targetRepo = createTargetRepo();
    const adapter = new FakeRuntimeAdapter(JSON.stringify(validDevWorkerLiteOutput()), targetRepo, false);

    const result = await runDevWorkerStage({
      loop_run_id: "loop_test",
      task_id: "task_test",
      target_repo: targetRepo,
      prd_path: "docs/PRD.md",
      task_graph_path: "docs/TASK_GRAPH.json",
      sqlite_home: "/tmp/sqlite",
      sandbox: "workspace-write",
      timeout_ms: 180_000,
      runtime_adapter: adapter,
      repo_root: targetRepo,
      report_dir: resolve(targetRepo, "reports")
    });

    expect(result.status).toBe("NEEDS_REVISION");
    expect(result.failure_category).toBe("DEV_WORKER_NO_FILE_CHANGE");
    expect(result.artifact_thread_evidence_verified).toBe(false);
  });

  it("accepts git diff evidence as file-change proof", () => {
    const targetRepo = createTargetRepo();
    initGit(targetRepo);
    writeText(
      targetRepo,
      "src/project-name.js",
      [
        "export function validateProjectName(name) {",
        "  if (typeof name !== \"string\") return { ok: false };",
        "  if (name.trim().length === 0) return { ok: false };",
        "  if (name.length > 80) return { ok: false };",
        "  return { ok: true };",
        "}",
        ""
      ].join("\n")
    );
    const runtimeInput = createDevWorkerRuntimeInput(stageInput(targetRepo));
    const source = readFileSync(resolve(targetRepo, "src/project-name.js"), "utf8");

    const result = evaluateDevWorkerThread(stageInput(targetRepo), runtimeInput, runtimeResult(runtimeInput), source, source);

    expect(result.status).toBe("PASS");
    expect(result.file_change_verified_by_git).toBe(true);
    expect(result.git_changed_files).toEqual(expect.arrayContaining(["src/project-name.js"]));
  });

  it("accepts SDK event evidence as file-change proof", () => {
    const targetRepo = createTargetRepo();
    const runtimeInput = createDevWorkerRuntimeInput(stageInput(targetRepo));
    writeText(targetRepo, "reports/dev-worker-events.jsonl", "{\"type\":\"file_change\",\"path\":\"src/project-name.js\",\"status\":\"modified\"}\n");
    runtimeInput.error_capture_paths = {
      ...runtimeInput.error_capture_paths,
      events_path: resolve(targetRepo, "reports/dev-worker-events.jsonl")
    };
    const source = readFileSync(resolve(targetRepo, "src/project-name.js"), "utf8");

    const result = evaluateDevWorkerThread(stageInput(targetRepo), runtimeInput, runtimeResult(runtimeInput), source, source);

    expect(result.status).toBe("PASS");
    expect(result.file_change_verified_by_event).toBe(true);
  });

  it("fails if the project-name test file is deleted", async () => {
    const targetRepo = createTargetRepo();
    rmSync(resolve(targetRepo, "test/project-name.test.js"), { force: true });
    const adapter = new FakeRuntimeAdapter(JSON.stringify(validDevWorkerLiteOutput()), targetRepo, true);

    const result = await runDevWorkerStage(stageInput(targetRepo, adapter));

    expect(result.status).toBe("FAILED");
    expect(result.failure_category).toBe("DEV_WORKER_TEST_DELETED");
  });

  it("detects prompt and outputSchema invocation differences", () => {
    const targetRepo = createTargetRepo();
    const baseInput = createDevWorkerRuntimeInput({
      loop_run_id: "loop_a",
      task_id: "task_a",
      target_repo: targetRepo,
      prd_path: "docs/PRD.md",
      task_graph_path: "docs/TASK_GRAPH.json",
      model: "gpt-test",
      model_catalog_json: "/tmp/model-catalog.json",
      sqlite_home: "/tmp/sqlite",
      sandbox: "workspace-write",
      timeout_ms: 180_000,
      runtime_adapter: new FakeRuntimeAdapter("{}", targetRepo, false),
      repo_root: targetRepo
    });
    const changedInput = {
      ...baseInput,
      prompt: `${baseInput.prompt}\nextra`,
      output_schema: { type: "object", properties: { status: { type: "string" } } }
    };

    const diff = diffSnapshots(devWorkerInvocationSnapshot(baseInput), devWorkerInvocationSnapshot(changedInput));

    expect(diff.status).toBe("NEEDS_REVISION");
    expect(diff.differences.map((entry) => entry.field)).toEqual(expect.arrayContaining(["promptHash", "promptLength", "outputSchemaHash"]));
  });
});

function stageInput(targetRepo: string, adapter: RuntimeAdapter = new FakeRuntimeAdapter(JSON.stringify(validDevWorkerLiteOutput()), targetRepo, false)) {
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

function createTargetRepo(): string {
  const targetRepo = mkdtempSync(join(tmpdir(), "dev-worker-stage-"));
  writeText(targetRepo, "docs/PRD.md", "# PRD\n\nValidate project names.\n");
  writeText(targetRepo, "docs/TASK_GRAPH.json", "{}\n");
  writeText(targetRepo, "src/project-name.js", "export function validateProjectName(name) {\n  return { ok: true };\n}\n");
  writeText(targetRepo, "package.json", "{\"type\":\"module\",\"scripts\":{\"test\":\"node --test\"}}\n");
  writeText(targetRepo, "test/project-name.test.js", "import test from \"node:test\";\ntest(\"placeholder\", () => {});\n");
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
        test_project_name_hash_before: hashFile(resolve(root, "test/project-name.test.js")),
        initial_tests_run: true,
        initial_tests_expected_to_fail: true,
        initial_tests_failed: true,
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

function initGit(targetRepo: string): void {
  execFileSync("git", ["init"], { cwd: targetRepo, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: targetRepo, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "baseline"], {
    cwd: targetRepo,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex Loop Test",
      GIT_AUTHOR_EMAIL: "codex-loop-test@example.invalid",
      GIT_COMMITTER_NAME: "Codex Loop Test",
      GIT_COMMITTER_EMAIL: "codex-loop-test@example.invalid"
    }
  });
}

function runtimeResult(input: RuntimeThreadInput): RuntimeThreadResult {
  return {
    thread_id: "thread_dev_worker_stage",
    role: input.role,
    status: "PASS",
    final_response: JSON.stringify(validDevWorkerLiteOutput()),
    events: [],
    events_path: input.error_capture_paths?.events_path ?? "",
    stdout_path: "",
    stderr_path: "",
    artifacts: [],
    sandbox_control: "VERIFIED",
    errors: []
  };
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
          "  if (name.trim().length === 0) return { ok: false };",
          "  if (name.length > 80) return { ok: false };",
          "  return { ok: true };",
          "}",
          ""
        ].join("\n")
      );
    }
    return this.result(input);
  }

  async runThreadStreamed(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    this.inputs.push(input);
    if (this.shouldModifySource) {
      writeText(
        this.targetRepo,
        "src/project-name.js",
        [
          "export function validateProjectName(name) {",
          "  if (typeof name !== \"string\") return { ok: false };",
          "  if (name.trim().length === 0) return { ok: false };",
          "  if (name.length > 80) return { ok: false };",
          "  return { ok: true };",
          "}",
          ""
        ].join("\n")
      );
    }
    const eventsPath = input.error_capture_paths?.events_path ?? join(tmpdir(), "dev-worker-stage-events.jsonl");
    mkdirSync(dirname(eventsPath), { recursive: true });
    writeFileSync(eventsPath, "{\"type\":\"thread.started\",\"thread_id\":\"thread_dev_worker_stage\"}\n", "utf8");
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
      thread_id: "thread_dev_worker_stage",
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
}
