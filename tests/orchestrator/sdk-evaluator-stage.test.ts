import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runEvaluatorStage } from "../../src/orchestrator/sdk-evaluator-stage.ts";
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

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("runEvaluatorStage", () => {
  it("writes EvalReport artifact with thread evidence", async () => {
    const targetRepo = mkdtempSync(join(tmpdir(), "evaluator-stage-"));
    tempDirs.push(targetRepo);
    writeTarget(targetRepo, "docs/PRD.md", "# PRD\n");
    writeTarget(targetRepo, "docs/TASK_GRAPH.json", "{}\n");
    writeTarget(targetRepo, "artifacts/dev-result.json", "{}\n");
    const adapter = new FakeRuntimeAdapter(
      JSON.stringify({
        status: "PASS",
        verdict: "PASS",
        findings_json: "[]",
        validation_commands_checked: ["npm test"],
        summary: "Looks good."
      })
    );

    const result = await runEvaluatorStage({
      loop_run_id: "loop_eval",
      task_id: "task_eval",
      target_repo: targetRepo,
      prd_path: "docs/PRD.md",
      task_graph_path: "docs/TASK_GRAPH.json",
      dev_result_path: "artifacts/dev-result.json",
      sqlite_home: "/tmp/sqlite",
      sandbox: "read-only",
      timeout_ms: 180_000,
      runtime_adapter: adapter,
      repo_root: targetRepo,
      report_dir: resolve(targetRepo, "reports")
    });

    expect(result.status).toBe("PASS");
    expect(result.evaluator_thread_id).toBe("thread_evaluator_mock");
    expect(result.eval_verdict).toBe("PASS");
    expect(JSON.parse(readFileSync(resolve(targetRepo, "artifacts/eval-report.json"), "utf8"))).toEqual(
      expect.objectContaining({
        verdict: "PASS",
        metadata: expect.objectContaining({
          created_by_runtime: "sdk-orchestrated",
          created_by_role: "evaluator",
          created_by_thread_id: "thread_evaluator_mock"
        })
      })
    );
  });

  it("uses read-only sandbox and lightweight output schema", async () => {
    const targetRepo = mkdtempSync(join(tmpdir(), "evaluator-stage-"));
    tempDirs.push(targetRepo);
    writeTarget(targetRepo, "docs/PRD.md", "# PRD\n");
    writeTarget(targetRepo, "docs/TASK_GRAPH.json", "{}\n");
    writeTarget(targetRepo, "artifacts/dev-result.json", "{}\n");
    const adapter = new FakeRuntimeAdapter(
      JSON.stringify({
        status: "PASS",
        verdict: "PASS",
        findings_json: "[]",
        validation_commands_checked: ["npm test"],
        summary: "Looks good."
      })
    );

    const result = await runEvaluatorStage({
      loop_run_id: "loop_eval",
      task_id: "task_eval",
      target_repo: targetRepo,
      prd_path: "docs/PRD.md",
      task_graph_path: "docs/TASK_GRAPH.json",
      dev_result_path: "artifacts/dev-result.json",
      sqlite_home: "/tmp/sqlite",
      sandbox: "read-only",
      timeout_ms: 180_000,
      runtime_adapter: adapter,
      repo_root: targetRepo,
      report_dir: resolve(targetRepo, "reports")
    });

    expect(result.runtime_input.sandbox).toBe("read-only");
    expect(result.runtime_input.output_schema).toEqual(
      expect.objectContaining({
        required: expect.arrayContaining(["findings_json"])
      })
    );
  });
});

class FakeRuntimeAdapter implements RuntimeAdapter {
  constructor(private readonly finalResponse: string) {}

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
    return { ...this.result({ role: "evaluator" } as RuntimeThreadInput), thread_id: input.thread_id };
  }

  async getFinalResponse(input: RuntimeFinalResponseInput): Promise<RuntimeThreadResult> {
    return { ...this.result({ role: "evaluator" } as RuntimeThreadInput), thread_id: input.thread_id };
  }

  private result(input: RuntimeThreadInput): RuntimeThreadResult {
    return {
      thread_id: "thread_evaluator_mock",
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

function writeTarget(root: string, path: string, value: string): void {
  const absolute = resolve(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, "utf8");
}
