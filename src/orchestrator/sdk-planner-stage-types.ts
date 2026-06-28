import type { RuntimeAdapter } from "../runtime/runtime-adapter.ts";
import type { RuntimeThreadInput, RuntimeThreadResult } from "../runtime/runtime-types.ts";
import type { PlannerArtifactValidationOptions, PlannerArtifactValidationResult } from "./validate-planner-artifacts.ts";

export type PlannerLiteStageStatus = "PASS" | "NEEDS_REVISION" | "BLOCKED" | "FAILED" | "TIMEOUT";

export interface PlannerLiteRuntimeAdapter extends RuntimeAdapter {
  runThreadStreamed?(input: RuntimeThreadInput): Promise<RuntimeThreadResult>;
}

export interface PlannerLiteStageInput {
  loop_run_id: string;
  task_id?: string;
  target_repo: string;
  model?: string;
  model_catalog_json?: string;
  sqlite_home: string;
  sandbox: "read-only";
  timeout_ms: number;
  runtime_adapter: PlannerLiteRuntimeAdapter;
  repo_root?: string;
  report_dir?: string;
  invocation_trace_label?: string;
  invocation_trace_path?: string;
  events_path?: string;
  stdout_path?: string;
  stderr_path?: string;
  result_path?: string;
  no_event_timeout_ms?: number;
  output_contract_version?: "v1" | "v2";
  output_schema?: Record<string, unknown>;
  output_schema_kind?: string;
  artifact_validator?: (finalResponse: string, options: PlannerArtifactValidationOptions & { target_repo?: string }) => PlannerArtifactValidationResult;
  prompt_override?: string;
  root_goal?: string;
  default_validation_commands?: string[];
  default_likely_files?: string[];
}

export interface PlannerLiteStageResult {
  status: PlannerLiteStageStatus;
  failure_category: string;
  planner_thread_started: boolean;
  planner_thread_id: string;
  structured_output_valid: boolean;
  prd_artifact_created: boolean;
  task_graph_artifact_created: boolean;
  task_graph_schema_valid: boolean;
  artifact_thread_evidence_verified: boolean;
  prd_path: string;
  task_graph_path: string;
  planner_result_path: string;
  final_response_contains_expected: boolean;
  event_count: number;
  no_event_timeout: boolean;
  last_event_type: string;
  elapsed_ms: number;
  runtime_input: RuntimeThreadInput;
  output_contract_version: "v1" | "v2";
  raw_output_path: string;
  redacted_output_path: string;
  events_path: string;
  errors: string[];
}

export interface PlannerLiteInvocationSnapshot {
  workingDirectory: string;
  model: string;
  model_catalog_json: string;
  sqlite_home: string;
  sandboxMode: "read-only" | "workspace-write";
  skipGitRepoCheck: boolean;
  outputSchemaHash: string;
  promptHash: string;
  promptLength: number;
  sdkMethod: "runStreamed";
  runOptions: string[];
  envKeys: string[];
  configKeys: string[];
  targetRepoGitStatus: string;
}

export interface PlannerLiteInvocationDiff {
  status: "PASS" | "NEEDS_REVISION";
  critical_diff_count: number;
  differences: Array<{
    field: keyof PlannerLiteInvocationSnapshot;
    planner_lite_smoke: unknown;
    gate6b_smoke_planner: unknown;
  }>;
}
