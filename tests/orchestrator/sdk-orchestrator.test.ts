import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { SdkOrchestrator } from "../../src/orchestrator/sdk-orchestrator.ts";
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
import { validPlannerLiteOutput } from "./parse-planner-lite-output.test.ts";
import { validDevWorkerLiteOutput } from "./parse-dev-worker-lite-output.test.ts";

describe("SdkOrchestrator planner path", () => {
  it("uses shared planner-lite stage instead of full planner outputSchema", async () => {
    const targetRepo = mkdtempSync(join(tmpdir(), "sdk-orchestrator-"));
    const adapter = new RecordingAdapter(JSON.stringify(validPlannerLiteOutput()));
    const orchestrator = new SdkOrchestrator({
      adapter,
      working_directory: targetRepo,
      loop_run_id: "loop_test",
      task_id: "task_test",
      goal: "Validate project names"
    });

    const result = await orchestrator.runPlannerLiteStage({
      sqlite_home: "/tmp/sqlite",
      model: "gpt-test",
      model_catalog_json: "/tmp/model-catalog.json",
      report_dir: resolve(targetRepo, "reports")
    });

    expect(result.status).toBe("PASS");
    expect(adapter.inputs).toHaveLength(1);
    expect(adapter.inputs[0]?.prompt).toContain("planner-lite output schema");
    expect(JSON.stringify(adapter.inputs[0]?.output_schema)).not.toContain("\"role\"");
    expect(readFileSync(resolve(targetRepo, "artifacts/planner-result.json"), "utf8")).toContain("created_by_role");
  });

  it("uses shared dev worker stage for workspace-write implementation", async () => {
    const targetRepo = mkdtempSync(join(tmpdir(), "sdk-orchestrator-dev-"));
    writeTarget(targetRepo, "src/project-name.js", "export function validateProjectName(name) {\n  return { ok: true };\n}\n");
    writeTarget(targetRepo, "package.json", "{\"type\":\"module\",\"scripts\":{\"test\":\"node --test\"}}\n");
    writeTarget(targetRepo, "test/project-name.test.js", "import test from \"node:test\";\ntest(\"placeholder\", () => {});\n");
    writeTarget(targetRepo, "docs/PRD.md", "# PRD\n\nValidate project names.\n");
    writeTarget(targetRepo, "docs/TASK_GRAPH.json", "{}\n");
    writeDevWorkerBaseline(targetRepo, resolve(targetRepo, "reports"));
    const adapter = new RecordingAdapter(JSON.stringify(validDevWorkerLiteOutput()), targetRepo, true);
    const orchestrator = new SdkOrchestrator({
      adapter,
      working_directory: targetRepo,
      loop_run_id: "loop_test",
      task_id: "task_test",
      goal: "Validate project names"
    });

    const result = await orchestrator.runDevWorkerStage({
      prd_path: "docs/PRD.md",
      task_graph_path: "docs/TASK_GRAPH.json",
      sqlite_home: "/tmp/sqlite",
      model: "gpt-test",
      model_catalog_json: "/tmp/model-catalog.json",
      report_dir: resolve(targetRepo, "reports")
    });

    expect(result.status).toBe("PASS");
    expect(adapter.inputs[0]?.role).toBe("dev_worker");
    expect(adapter.inputs[0]?.sandbox).toBe("workspace-write");
    expect(adapter.inputs[0]?.prompt).toContain("Return JSON matching the DevResult lite output schema.");
    expect(readFileSync(resolve(targetRepo, "artifacts/dev-result.json"), "utf8")).toContain("created_by_role");
  });
});

class RecordingAdapter implements RuntimeAdapter {
  readonly inputs: RuntimeThreadInput[] = [];

  constructor(
    private readonly finalResponse: string,
    private readonly targetRepo = "",
    private readonly shouldModifySource = false
  ) {}

  async startThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return this.runThread(input);
  }

  async runThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    this.inputs.push(input);
    if (this.shouldModifySource && this.targetRepo) {
      writeTarget(
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
    return this.runThread(input);
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
      thread_id: "thread_orchestrator_planner",
      role: input.role,
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

function writeTarget(root: string, path: string, value: string): void {
  const absolute = resolve(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, "utf8");
}

function writeDevWorkerBaseline(root: string, reportDir: string): void {
  writeTarget(
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
