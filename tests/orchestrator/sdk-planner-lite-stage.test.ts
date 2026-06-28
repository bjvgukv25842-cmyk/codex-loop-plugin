import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildPlannerLiteStagePrompt,
  createPlannerLiteRuntimeInput,
  runPlannerLiteStage
} from "../../src/orchestrator/sdk-planner-lite-stage.ts";
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
import { diffSnapshots } from "../../scripts/sdk-orchestrated/diff-planner-lite-vs-gate6b.ts";
import { validPlannerLiteOutput } from "./parse-planner-lite-output.test.ts";
import { plannerLiteInvocationSnapshot } from "../../src/orchestrator/sdk-planner-lite-stage.ts";
import { validPlannerLiteV2Output } from "./planner-lite-v2-output.test.ts";

describe("runPlannerLiteStage", () => {
  it("starts planner via runtime adapter and writes planner artifacts with thread evidence", async () => {
    const targetRepo = mkdtempSync(join(tmpdir(), "planner-lite-stage-"));
    const adapter = new FakeRuntimeAdapter(JSON.stringify(validPlannerLiteOutput()));

    const result = await runPlannerLiteStage({
      loop_run_id: "loop_test",
      target_repo: targetRepo,
      model: "gpt-test",
      model_catalog_json: "/tmp/model-catalog.json",
      sqlite_home: "/tmp/sqlite",
      sandbox: "read-only",
      timeout_ms: 180_000,
      runtime_adapter: adapter,
      repo_root: targetRepo,
      report_dir: resolve(targetRepo, "reports")
    });

    expect(result.status).toBe("PASS");
    expect(result.planner_thread_id).toBe("thread_planner_lite");
    expect(result.prd_artifact_created).toBe(true);
    expect(result.task_graph_artifact_created).toBe(true);
    expect(result.task_graph_schema_valid).toBe(true);
    expect(readFileSync(resolve(targetRepo, "docs/PRD.md"), "utf8")).toContain("created_by_thread_id: thread_planner_lite");
    expect(JSON.parse(readFileSync(resolve(targetRepo, "docs/TASK_GRAPH.json"), "utf8"))).toEqual(
      expect.objectContaining({
        loop_run_id: "loop_test",
        prd_artifact_id: "artifact_prd_gate6b_planner",
        root_goal: "Validate project names"
      })
    );
    expect(JSON.parse(readFileSync(resolve(targetRepo, "artifacts/planner-result.json"), "utf8"))).toEqual(
      expect.objectContaining({
        created_by_runtime: "sdk-orchestrated",
        created_by_role: "planner",
        created_by_thread_id: "thread_planner_lite"
      })
    );
    expect(adapter.inputs[0]?.prompt).toBe(buildPlannerLiteStagePrompt());
    expect(adapter.inputs[0]?.output_schema).toBeTruthy();
  });

  it("uses planner-lite-v2 prompt and schema when requested", async () => {
    const targetRepo = mkdtempSync(join(tmpdir(), "planner-lite-v2-stage-"));
    const adapter = new FakeRuntimeAdapter(JSON.stringify(validPlannerLiteV2Output()));

    const result = await runPlannerLiteStage({
      loop_run_id: "loop_test",
      target_repo: targetRepo,
      model: "gpt-test",
      model_catalog_json: "/tmp/model-catalog.json",
      sqlite_home: "/tmp/sqlite",
      sandbox: "read-only",
      timeout_ms: 180_000,
      runtime_adapter: adapter,
      repo_root: targetRepo,
      report_dir: resolve(targetRepo, "reports"),
      output_contract_version: "v2"
    });

    expect(result.status).toBe("PASS");
    expect(result.output_contract_version).toBe("v2");
    expect(adapter.inputs[0]?.prompt).toBe(buildPlannerLiteStagePrompt("v2"));
    expect(JSON.stringify(adapter.inputs[0]?.output_schema)).toContain("\"tasks\"");
    expect(JSON.stringify(adapter.inputs[0]?.output_schema)).not.toContain("task_graph_json");
  });

  it("allows callers to override the planner prompt while keeping planner-lite-v2 schema", async () => {
    const targetRepo = mkdtempSync(join(tmpdir(), "planner-lite-v2-override-"));
    const adapter = new FakeRuntimeAdapter(JSON.stringify(validPlannerLiteV2Output()));
    const prompt = [
      "Goal: Add project name validation.",
      "Return planner-lite-v2 JSON with direct tasks[]."
    ].join("\n");

    const result = await runPlannerLiteStage({
      loop_run_id: "loop_test",
      target_repo: targetRepo,
      model: "gpt-test",
      model_catalog_json: "/tmp/model-catalog.json",
      sqlite_home: "/tmp/sqlite",
      sandbox: "read-only",
      timeout_ms: 180_000,
      runtime_adapter: adapter,
      repo_root: targetRepo,
      report_dir: resolve(targetRepo, "reports"),
      output_contract_version: "v2",
      prompt_override: prompt,
      root_goal: "Add project name validation.",
      default_likely_files: ["src/project-name.js", "test/project-name.test.js"]
    });

    expect(result.status).toBe("PASS");
    expect(adapter.inputs[0]?.prompt).toBe(prompt);
    expect(JSON.stringify(adapter.inputs[0]?.output_schema)).not.toContain("task_graph_json");
    expect(JSON.parse(readFileSync(resolve(targetRepo, "docs/TASK_GRAPH.json"), "utf8")).root_goal).toBe("Add project name validation.");
  });

  it("persists partial planner evidence when postprocess fails after thread start", async () => {
    const targetRepo = mkdtempSync(join(tmpdir(), "planner-lite-v2-fail-"));
    const reportDir = resolve(targetRepo, "reports");
    const adapter = new FakeRuntimeAdapter(JSON.stringify(validPlannerLiteV2Output({ tasks: [] })));

    const result = await runPlannerLiteStage({
      loop_run_id: "loop_test",
      target_repo: targetRepo,
      model: "gpt-test",
      model_catalog_json: "/tmp/model-catalog.json",
      sqlite_home: "/tmp/sqlite",
      sandbox: "read-only",
      timeout_ms: 180_000,
      runtime_adapter: adapter,
      repo_root: targetRepo,
      report_dir: reportDir,
      stdout_path: resolve(reportDir, "planner-stdout.log"),
      events_path: resolve(reportDir, "planner-events.jsonl"),
      output_contract_version: "v2"
    });

    expect(result.status).toBe("NEEDS_REVISION");
    expect(result.failure_category).toBe("PLANNER_V2_TASKS_EMPTY");
    expect(result.planner_thread_id).toBe("thread_planner_lite");
    expect(result.raw_output_path).toBe(resolve(reportDir, "planner-stdout.log"));
    expect(result.redacted_output_path).toBe(resolve(reportDir, "planner-stdout-redacted.log"));
    expect(result.events_path).toBe(resolve(reportDir, "planner-events.jsonl"));
    expect(readFileSync(result.redacted_output_path, "utf8")).toContain("\"tasks\":[]");
  });

  it("detects prompt and outputSchema invocation differences", () => {
    const baseInput = createPlannerLiteRuntimeInput({
      loop_run_id: "loop_a",
      target_repo: process.cwd(),
      model: "gpt-test",
      model_catalog_json: "/tmp/model-catalog.json",
      sqlite_home: "/tmp/sqlite",
      sandbox: "read-only",
      timeout_ms: 180_000,
      runtime_adapter: new FakeRuntimeAdapter("{}"),
      repo_root: process.cwd()
    });
    const changedInput = {
      ...baseInput,
      prompt: `${baseInput.prompt}\nextra`,
      output_schema: { type: "object", properties: { status: { type: "string" } } }
    };

    const diff = diffSnapshots(plannerLiteInvocationSnapshot(baseInput), plannerLiteInvocationSnapshot(changedInput));

    expect(diff.status).toBe("NEEDS_REVISION");
    expect(diff.differences.map((entry) => entry.field)).toEqual(expect.arrayContaining(["promptHash", "promptLength", "outputSchemaHash"]));
  });
});

class FakeRuntimeAdapter implements RuntimeAdapter {
  readonly inputs: RuntimeThreadInput[] = [];

  constructor(private readonly finalResponse: string) {}

  async startThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return this.runThread(input);
  }

  async runThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    this.inputs.push(input);
    return this.result(input);
  }

  async runThreadStreamed(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    this.inputs.push(input);
    const eventsPath = input.error_capture_paths?.events_path ?? join(tmpdir(), "planner-lite-events.jsonl");
    mkdirSync(dirname(eventsPath), { recursive: true });
    writeFileSync(eventsPath, "{\"type\":\"thread.started\",\"thread_id\":\"thread_planner_lite\"}\n", "utf8");
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
      thread_id: "thread_planner_lite",
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
