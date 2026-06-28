import type { RuntimeAdapter } from "../runtime/runtime-adapter.ts";
import { sandboxForRole } from "../runtime/sdk-runtime-adapter.ts";
import type { RuntimeRole, RuntimeThreadInput, RuntimeThreadResult } from "../runtime/runtime-types.ts";
import { advanceSdkLoopState, type SdkLoopEvidence, type SdkLoopState } from "./sdk-loop-state-machine.ts";
import { buildSdkLoopPrompt } from "./sdk-loop-prompts.ts";
import { runDevWorkerStage } from "./sdk-dev-worker-stage.ts";
import type { DevWorkerStageResult } from "./sdk-dev-worker-stage-types.ts";
import { runPlannerLiteStage } from "./sdk-planner-lite-stage.ts";
import type { PlannerLiteStageResult } from "./sdk-planner-stage-types.ts";

export interface SdkOrchestratorOptions {
  adapter: RuntimeAdapter;
  working_directory: string;
  loop_run_id: string;
  task_id: string;
  goal: string;
}

export class SdkOrchestrator {
  private state: SdkLoopState = "INIT_LOOP";
  private evidence: SdkLoopEvidence = {};

  constructor(private readonly options: SdkOrchestratorOptions) {}

  currentState(): SdkLoopState {
    return this.state;
  }

  currentEvidence(): SdkLoopEvidence {
    return { ...this.evidence };
  }

  advance(evidencePatch: SdkLoopEvidence = {}): SdkLoopState {
    this.evidence = {
      ...this.evidence,
      ...evidencePatch
    };
    this.state = advanceSdkLoopState(this.state, this.evidence);
    return this.state;
  }

  async runRole(role: RuntimeRole, artifactPaths: string[] = []): Promise<RuntimeThreadResult> {
    const input: RuntimeThreadInput = {
      role,
      loop_run_id: this.options.loop_run_id,
      task_id: this.options.task_id,
      prompt: buildSdkLoopPrompt(role, {
        loop_run_id: this.options.loop_run_id,
        task_id: this.options.task_id,
        goal: this.options.goal,
        artifact_paths: artifactPaths
      }),
      sandbox: sandboxForRole(role),
      working_directory: this.options.working_directory,
      timeout_ms: 180_000,
      output_schema_path: "",
      env: {}
    };
    return this.options.adapter.runThread(input);
  }

  async runPlannerLiteStage(input: {
    model?: string;
    model_catalog_json?: string;
    sqlite_home: string;
    report_dir?: string;
    invocation_trace_path?: string;
    invocation_trace_label?: string;
  }): Promise<PlannerLiteStageResult> {
    return runPlannerLiteStage({
      loop_run_id: this.options.loop_run_id,
      task_id: this.options.task_id,
      target_repo: this.options.working_directory,
      model: input.model,
      model_catalog_json: input.model_catalog_json,
      sqlite_home: input.sqlite_home,
      sandbox: "read-only",
      timeout_ms: 180_000,
      runtime_adapter: this.options.adapter,
      report_dir: input.report_dir,
      invocation_trace_path: input.invocation_trace_path,
      invocation_trace_label: input.invocation_trace_label
    });
  }

  async runDevWorkerStage(input: {
    prd_path: string;
    task_graph_path: string;
    model?: string;
    model_catalog_json?: string;
    sqlite_home: string;
    report_dir?: string;
    invocation_trace_path?: string;
    invocation_trace_label?: string;
  }): Promise<DevWorkerStageResult> {
    return runDevWorkerStage({
      loop_run_id: this.options.loop_run_id,
      task_id: this.options.task_id,
      target_repo: this.options.working_directory,
      prd_path: input.prd_path,
      task_graph_path: input.task_graph_path,
      model: input.model,
      model_catalog_json: input.model_catalog_json,
      sqlite_home: input.sqlite_home,
      sandbox: "workspace-write",
      timeout_ms: 180_000,
      runtime_adapter: this.options.adapter,
      report_dir: input.report_dir,
      invocation_trace_path: input.invocation_trace_path,
      invocation_trace_label: input.invocation_trace_label
    });
  }
}
