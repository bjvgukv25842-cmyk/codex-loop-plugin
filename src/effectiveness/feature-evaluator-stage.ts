import { createHash } from "node:crypto";

import type { EvaluatorStageInput } from "../orchestrator/sdk-evaluator-stage-types.ts";
import { evaluatorLiteOutputSchema } from "../orchestrator/sdk-evaluator-stage.ts";
import type { RuntimeThreadResult } from "../runtime/runtime-types.ts";
import { getGenericFeatureCaseProfile } from "./generic-feature-case-profile.ts";

export const FEATURE_EVALUATOR_PROMPT_MAX_LENGTH = 700;
export const FEATURE_EVALUATOR_PARITY_PROMPT = "Respond with exactly: FEATURE_EVALUATOR_PARITY_OK";

export type FeatureEvaluatorParityFailureCategory =
  | "FEATURE_EVALUATOR_PARITY_TURN_NO_EVENT_TIMEOUT"
  | "FEATURE_EVALUATOR_PARITY_STARTUP_NO_EVENT_TIMEOUT"
  | "FEATURE_EVALUATOR_PARITY_TURN_FAILED"
  | "FEATURE_EVALUATOR_PARITY_THREAD_STARTUP_FAILURE"
  | "FEATURE_EVALUATOR_PARITY_RESPONSE_MISSING"
  | "SDK_EVALUATOR_RUNSTREAMED_EVENT_STREAM_ISSUE"
  | "SDK_EVALUATOR_METHOD_BOTH_FAILED";

export const featureEvaluatorMinimalOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "verdict", "summary"],
  properties: {
    status: { type: "string", enum: ["PASS", "BLOCKED"] },
    verdict: { type: "string", enum: ["PASS", "NEEDS_REVISION"] },
    summary: { type: "string" }
  }
} as const;

export function buildFeatureEvaluatorPrompt(input: Pick<EvaluatorStageInput, "prd_path" | "task_graph_path" | "dev_result_path" | "test_log_path"> & {
  diff_path?: string;
  case_id?: string;
}): string {
  const profile = getGenericFeatureCaseProfile(input.case_id ?? "feature-small-001") ?? getGenericFeatureCaseProfile("feature-small-001")!;
  return [
    "Role: evaluator. Read-only.",
    `Inputs: ${compactPath(input.prd_path)}; ${compactPath(input.task_graph_path)}; ${compactPath(input.dev_result_path)}; ${compactPath(input.test_log_path ?? "treatment-validation.log")}; ${compactPath(input.diff_path ?? "treatment-diff.patch")}.`,
    `Task: evaluate whether ${profile.case_id} is complete.`,
    `Acceptance: ${profile.evaluator_acceptance_summary}`,
    "Return evaluator-lite JSON only: status, verdict, summary, findings_json, validation_commands_checked.",
    "Use findings_json=\"[]\" for PASS. Include npm test in validation_commands_checked.",
    "Do not edit files. Do not run implementation. Do not load external skills."
  ].join("\n");
}

export function featureEvaluatorStageConfig(input: Pick<EvaluatorStageInput, "prd_path" | "task_graph_path" | "dev_result_path" | "test_log_path"> & {
  diff_path?: string;
  case_id?: string;
}) {
  const prompt = buildFeatureEvaluatorPrompt(input);
  return {
    prompt,
    prompt_length: prompt.length,
    prompt_hash: stableHash(prompt),
    output_schema: evaluatorLiteOutputSchema,
    uses_evaluator_lite_schema: true,
    uses_full_eval_report_schema: false,
    prompt_within_budget: prompt.length <= FEATURE_EVALUATOR_PROMPT_MAX_LENGTH
  };
}

export function featureEvaluatorPromptHash(input: Parameters<typeof buildFeatureEvaluatorPrompt>[0]): string {
  return stableHash(buildFeatureEvaluatorPrompt(input));
}

export function featureEvaluatorExactPathMatchesTreatment(): boolean {
  const config = featureEvaluatorStageConfig({
    prd_path: "docs/PRD.md",
    task_graph_path: "docs/TASK_GRAPH.json",
    dev_result_path: "artifacts/dev-result.json",
    test_log_path: "treatment-validation.log",
    diff_path: "treatment-diff.patch"
  });
  return config.uses_evaluator_lite_schema === true &&
    config.uses_full_eval_report_schema === false &&
    config.prompt_within_budget === true &&
    !JSON.stringify(config.output_schema).includes("eval_id") &&
    config.prompt.includes("feature-small-001") &&
    config.prompt.includes("reject whitespace-only names");
}

export function classifyFeatureEvaluatorParityFailure(input: {
  thread_id?: string;
  failure_category?: string;
  status?: RuntimeThreadResult["status"];
  final_response?: string;
  events?: unknown[];
  last_event_type?: string;
  no_event_timeout?: boolean;
  event_count?: number;
  sdk_method?: "run" | "runStreamed";
  direct_cli_parity_status?: "PASS" | "FAIL" | "UNKNOWN";
}): FeatureEvaluatorParityFailureCategory {
  const events = input.events ?? [];
  const hasThreadId = Boolean(input.thread_id);
  const hasThreadStarted = hasThreadId || events.some((event) => eventType(event) === "thread.started");
  const hasTurnStarted = events.some((event) => eventType(event) === "turn.started");
  const hasTurnCompleted = events.some((event) => eventType(event) === "turn.completed");
  const hasTurnFailed = events.some((event) => eventType(event) === "turn.failed" || eventType(event) === "error");
  const hasUnparseableEvent = events.some((event) => eventType(event) === "unparseable");
  if (input.failure_category === "SDK_EVALUATOR_METHOD_BOTH_FAILED") {
    return "SDK_EVALUATOR_METHOD_BOTH_FAILED";
  }
  if (
    input.failure_category === "SDK_EVALUATOR_RUNSTREAMED_EVENT_STREAM_ISSUE" ||
    input.failure_category === "SDK_RUNSTREAMED_EVENT_STREAM_ISSUE" ||
    (input.sdk_method === "runStreamed" &&
      input.direct_cli_parity_status === "PASS" &&
      (hasUnparseableEvent || input.failure_category === "SDK_THREAD_FAILED" || input.status === "FAILED"))
  ) {
    return "SDK_EVALUATOR_RUNSTREAMED_EVENT_STREAM_ISSUE";
  }
  if (hasTurnFailed || input.status === "FAILED") {
    return "FEATURE_EVALUATOR_PARITY_TURN_FAILED";
  }
  if (hasThreadStarted && (hasTurnStarted || input.last_event_type === "turn.started") && !hasTurnCompleted) {
    return "FEATURE_EVALUATOR_PARITY_TURN_NO_EVENT_TIMEOUT";
  }
  if (!hasThreadStarted || !hasThreadId) {
    return "FEATURE_EVALUATOR_PARITY_STARTUP_NO_EVENT_TIMEOUT";
  }
  if (input.failure_category === "SDK_NO_EVENT_TIMEOUT" || input.no_event_timeout === true || input.status === "TIMEOUT") {
    return "FEATURE_EVALUATOR_PARITY_TURN_NO_EVENT_TIMEOUT";
  }
  if (!input.final_response?.includes("FEATURE_EVALUATOR_PARITY_OK")) {
    return "FEATURE_EVALUATOR_PARITY_RESPONSE_MISSING";
  }
  return "FEATURE_EVALUATOR_PARITY_THREAD_STARTUP_FAILURE";
}

export function parseFeatureEvaluatorEvents(events: unknown[]): {
  event_count: number;
  last_event_type: string;
  thread_id: string;
  turn_started: boolean;
  turn_completed: boolean;
  turn_failed: boolean;
} {
  let lastEventType = "";
  let threadId = "";
  let turnStarted = false;
  let turnCompleted = false;
  let turnFailed = false;
  for (const event of events) {
    const type = eventType(event);
    if (type) lastEventType = type;
    if (type === "turn.started") turnStarted = true;
    if (type === "turn.completed") turnCompleted = true;
    if (type === "turn.failed" || type === "error") turnFailed = true;
    const maybeThreadId = threadIdFromEvent(event);
    if (maybeThreadId) threadId = maybeThreadId;
  }
  return {
    event_count: events.length,
    last_event_type: lastEventType,
    thread_id: threadId,
    turn_started: turnStarted,
    turn_completed: turnCompleted,
    turn_failed: turnFailed
  };
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function eventType(event: unknown): string {
  return isRecord(event) && typeof event.type === "string" ? event.type : "";
}

function threadIdFromEvent(event: unknown): string {
  return isRecord(event) && event.type === "thread.started" && typeof event.thread_id === "string" ? event.thread_id : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const markers = [
    "evals/effectiveness/reports/feature-small-001/",
    "evals/effectiveness/runs/feature-small-001/treatment/target-repo/"
  ];
  for (const marker of markers) {
    const index = normalized.indexOf(marker);
    if (index >= 0) return normalized.slice(index);
  }
  if (normalized.length <= 90) return normalized;
  const parts = normalized.split("/");
  return parts.slice(-3).join("/");
}
