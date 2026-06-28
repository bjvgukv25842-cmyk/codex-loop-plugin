import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import type {
  AgentProfile,
  AgentType,
  ContextCapsule,
  EvalFinding,
  EvalReport,
  FileRef,
  LoopRun,
  TaskNode,
  TaskStatus,
  ValidationCommand
} from "../core/types.ts";
import { assertValid } from "../core/validate.ts";
import { JsonLoopStore } from "../state/json-store.ts";
import { readJsonFile, writeJsonFileAtomic } from "../state/json-file.ts";
import type { LoopEvent, LoopStore } from "../state/types.ts";
import type {
  EvalReportLikeInput,
  HookEventName,
  HookExecutionContext,
  HookResult,
  LoopSnapshot,
  PostToolUseInput,
  PreCompactInput,
  SessionStartInput,
  StopInput,
  SubagentStartInput,
  SubagentStopInput,
  ValidationCommandEvent
} from "./input-types.ts";

const ACTIVE_STATUSES = new Set([
  "IDLE",
  "GOAL_RECEIVED",
  "PRD_DRAFTING",
  "PRD_READY",
  "TASK_GRAPH_READY",
  "DEV_DISPATCHING",
  "DEV_RUNNING",
  "DEV_DONE",
  "EVAL_RUNNING",
  "REPAIR_REQUESTED",
  "VALIDATION_RUNNING",
  "READY_FOR_NEXT_MODULE",
  "READY_FOR_MERGE",
  "BLOCKED",
  "CONTEXT_RESTARTING"
]);

const VALIDATION_COMMAND_PATTERN = /\b(test|lint|typecheck|build|validate)\b/i;
const MAX_EXCERPT_LENGTH = 1000;

export async function readStdinJson<T>(): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {} as T;
  }

  return JSON.parse(raw) as T;
}

export async function runHookCli<TInput>(
  hook: HookEventName,
  handler: (input: TInput, context?: HookExecutionContext) => Promise<HookResult>
): Promise<void> {
  const input = await readStdinJson<TInput>();
  const result = await handleHookError(hook, () => handler(input));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === "error") {
    process.exitCode = 1;
  }
}

export async function handleHookError(hook: HookEventName, action: () => Promise<HookResult>): Promise<HookResult> {
  try {
    return await action();
  } catch (error) {
    return createHookResult(hook, "error", error instanceof Error ? error.message : "Unknown hook error", {
      warnings: [],
      data: {
        error_name: error instanceof Error ? error.name : "UnknownError"
      }
    });
  }
}

export async function handleSessionStart(input: SessionStartInput = {}, context: HookExecutionContext = {}): Promise<HookResult> {
  const hook = "SessionStart";
  const store = createHookStore(context);
  const loopRun = await findLoopRun(store, input.loop_run_id);

  if (!loopRun) {
    return createHookResult(hook, "skipped", "No active LoopRun found.", {
      warnings: ["Run loop init before expecting Codex Loop session context."]
    });
  }

  const snapshot = await buildLoopSnapshot(store, loopRun);

  return createHookResult(hook, "ok", sessionContextMessage(snapshot), {
    loop_run_id: loopRun.loop_run_id,
    data: {
      session_context: snapshot
    }
  });
}

export async function handlePostToolUse(input: PostToolUseInput = {}, context: HookExecutionContext = {}): Promise<HookResult> {
  const hook = "PostToolUse";
  const command = extractCommand(input);

  if (!command || !isValidationCommand(command)) {
    return createHookResult(hook, "skipped", "PostToolUse input did not contain a validation command.", {
      warnings: [],
      data: {
        command: command ?? null
      }
    });
  }

  const store = createHookStore(context);
  const loopRun = await findLoopRun(store);
  if (!loopRun) {
    return createHookResult(hook, "warning", "Validation command detected, but no active LoopRun was found.", {
      warnings: ["Validation event was not written because no LoopRun exists."],
      data: {
        validation: buildValidationEvent(input, command)
      }
    });
  }

  const validation = buildValidationEvent(input, command);
  const event = await appendSafeEvent(store, loopRun.loop_run_id, "hook.validation", validation.result === "failed" ? "Validation command failed." : "Validation command completed.", {
    hook,
    validation
  });

  return createHookResult(hook, validation.result === "failed" ? "warning" : "ok", "Validation command result recorded.", {
    loop_run_id: loopRun.loop_run_id,
    event_id: event.event_id,
    warnings: validation.result === "failed" ? ["Validation failed; repair the current module before continuing."] : [],
    data: {
      validation
    }
  });
}

export async function handlePreCompact(input: PreCompactInput = {}, context: HookExecutionContext = {}): Promise<HookResult> {
  const hook = "PreCompact";
  const repoRoot = resolveRepoRoot(context);
  const store = createHookStore(context);
  const loopRun = await findLoopRun(store);

  if (!loopRun) {
    return createHookResult(hook, "skipped", "No active LoopRun found for context capsule generation.", {
      warnings: ["ContextCapsule draft was not written because no LoopRun exists."]
    });
  }

  const agent = await resolveAgent(store, input.agent_id, input.agent_type);
  if (!agent) {
    const event = await appendSafeEvent(store, loopRun.loop_run_id, "hook.context_capsule.warning", "PreCompact could not resolve an agent for ContextCapsule.", {
      hook,
      requested_agent_id: input.agent_id ?? null,
      requested_agent_type: input.agent_type ?? null
    });
    return createHookResult(hook, "warning", "Could not resolve an AgentProfile for ContextCapsule.", {
      loop_run_id: loopRun.loop_run_id,
      event_id: event.event_id,
      warnings: ["ContextCapsule requires agent_id and old_thread_id from an AgentProfile."]
    });
  }

  const task = input.task_id ? await store.getTask(input.task_id) : await findCurrentTask(store, loopRun);
  const progress = await readTextIfExists(join(repoRoot, "docs/LOOP_PROGRESS.md"));
  const events = await store.listEvents(loopRun.loop_run_id);
  const capsule = buildContextCapsule({
    loopRun,
    agent,
    task,
    progress,
    recentEvents: events.slice(-10),
    input,
    now: now(context)
  });
  const written = await store.writeContextCapsule(capsule);
  const artifactPath = join(repoRoot, "artifacts/context-capsules", `${written.capsule_id}.json`);
  await writeJsonFileAtomic(artifactPath, written);

  return createHookResult(hook, "ok", "ContextCapsule draft written before compaction.", {
    loop_run_id: loopRun.loop_run_id,
    event_id: (await latestEventId(store, loopRun.loop_run_id, "context_capsule.written")) ?? undefined,
    artifact_path: artifactPath,
    data: {
      capsule_id: written.capsule_id,
      agent_id: written.agent_id,
      next_instruction: written.next_instruction
    }
  });
}

export async function handleSubagentStop(input: SubagentStopInput = {}, context: HookExecutionContext = {}): Promise<HookResult> {
  const hook = "SubagentStop";
  const repoRoot = resolveRepoRoot(context);
  const store = createHookStore(context);
  const loopRun = await findLoopRun(store);
  const parsed = parseSubagentOutput(input);

  if (!loopRun) {
    return createHookResult(hook, "warning", "Subagent stopped, but no active LoopRun was found.", {
      warnings: ["Subagent output was not recorded because no LoopRun exists."],
      data: {
        parsed_output_kind: parsed.kind
      }
    });
  }

  if (parsed.kind === "eval_report_like") {
    const report = normalizeEvalReport(parsed.value, loopRun, input, now(context));
    if (!report) {
      const event = await appendSafeEvent(store, loopRun.loop_run_id, "hook.subagent.warning", "EvalReport-like subagent output lacked required routing fields.", {
        hook,
        agent_id: input.agent_id ?? null
      });
      return createHookResult(hook, "warning", "EvalReport-like output could not be saved.", {
        loop_run_id: loopRun.loop_run_id,
        event_id: event.event_id,
        warnings: ["EvalReport output must include task_id and module_id."]
      });
    }

    await store.writeEvalReport(report);
    const artifactPath = join(repoRoot, "artifacts/eval-reports", `${report.eval_id}.json`);
    await writeJsonFileAtomic(artifactPath, report);
    return createHookResult(hook, "ok", "EvalReport-like subagent output saved.", {
      loop_run_id: loopRun.loop_run_id,
      event_id: (await latestEventId(store, loopRun.loop_run_id, "eval_report.written")) ?? undefined,
      artifact_path: artifactPath,
      data: {
        eval_id: report.eval_id,
        verdict: report.verdict
      }
    });
  }

  if (parsed.kind === "json_missing_verdict") {
    const event = await appendSafeEvent(store, loopRun.loop_run_id, "hook.subagent.warning", "Subagent output looked structured but lacked verdict.", {
      hook,
      agent_id: input.agent_id ?? null
    });
    return createHookResult(hook, "warning", "Structured subagent output lacked verdict; no EvalReport was fabricated.", {
      loop_run_id: loopRun.loop_run_id,
      event_id: event.event_id,
      warnings: ["Missing verdict; evaluator output must include PASS or NEEDS_REVISION."]
    });
  }

  const event = await appendSafeEvent(store, loopRun.loop_run_id, "hook.subagent.output", "Subagent output captured as bounded event.", {
    hook,
    agent_id: input.agent_id ?? null,
    output_excerpt: excerpt(parsed.raw)
  });

  return createHookResult(hook, "ok", "Subagent output captured.", {
    loop_run_id: loopRun.loop_run_id,
    event_id: event.event_id,
    data: {
      output_excerpt: excerpt(parsed.raw)
    }
  });
}

export async function handleSubagentStart(input: SubagentStartInput = {}, context: HookExecutionContext = {}): Promise<HookResult> {
  const hook = "SubagentStart";
  const store = createHookStore(context);
  const loopRun = await findLoopRun(store);

  if (!loopRun) {
    return createHookResult(hook, "warning", "Subagent started, but no active LoopRun was found.", {
      warnings: ["SubagentStart was not recorded because no LoopRun exists."],
      data: {
        agent_name: input.agent_name ?? null,
        thread_id: input.thread_id ?? null
      }
    });
  }

  const event = await appendSafeEvent(store, loopRun.loop_run_id, "hook.subagent.start", "Subagent lifecycle start captured.", {
    hook,
    agent_id: input.agent_id ?? null,
    agent_name: input.agent_name ?? null,
    agent_type: input.agent_type ?? null,
    agent_run_id: input.agent_run_id ?? null,
    parent_thread_id: input.parent_thread_id ?? null,
    thread_id: input.thread_id ?? null,
    task_id: input.task_id ?? null,
    module_id: input.module_id ?? null
  });

  return createHookResult(hook, "ok", "Subagent start captured.", {
    loop_run_id: loopRun.loop_run_id,
    event_id: event.event_id,
    data: {
      agent_run_id: input.agent_run_id ?? null,
      agent_name: input.agent_name ?? null,
      thread_id: input.thread_id ?? null
    }
  });
}

export async function handleStop(input: StopInput = {}, context: HookExecutionContext = {}): Promise<HookResult> {
  const hook = "Stop";
  const repoRoot = resolveRepoRoot(context);
  const store = createHookStore(context);
  const loopRun = await findLoopRun(store, input.loop_run_id);

  if (!loopRun) {
    return createHookResult(hook, "skipped", "No active LoopRun found.", {
      warnings: []
    });
  }

  const progress = await readTextIfExists(join(repoRoot, "docs/LOOP_PROGRESS.md"));
  const progressCheck = checkProgressUpdated(progress, input.current_module_id ?? loopRun.current_module_id);
  const warnings: string[] = [];
  if (!progressCheck.updated) {
    warnings.push(progressCheck.message);
  }
  if (!["DONE", "FAILED"].includes(loopRun.status)) {
    warnings.push(nextStepHint(loopRun));
  }

  const event = await appendSafeEvent(store, loopRun.loop_run_id, warnings.length > 0 ? "hook.stop.warning" : "hook.stop.ok", warnings.length > 0 ? "Stop hook found pending loop follow-up." : "Stop hook completed without warnings.", {
    hook,
    current_module_id: loopRun.current_module_id,
    progress_updated: progressCheck.updated,
    loop_status: loopRun.status
  });

  return createHookResult(hook, warnings.length > 0 ? "warning" : "ok", warnings.length > 0 ? "Loop has pending follow-up." : "Loop stop check passed.", {
    loop_run_id: loopRun.loop_run_id,
    event_id: event.event_id,
    warnings,
    data: {
      current_module_id: loopRun.current_module_id,
      loop_status: loopRun.status,
      progress_updated: progressCheck.updated
    }
  });
}

export function isValidationCommand(command: string): boolean {
  return VALIDATION_COMMAND_PATTERN.test(command);
}

export function extractCommand(input: PostToolUseInput): string | null {
  return firstString(input.command, input.tool_input?.command);
}

export function checkProgressUpdated(progress: string, moduleId: string): { updated: boolean; message: string } {
  const hasCurrentModule = new RegExp(`\\b${escapeRegExp(moduleId)}\\b`).test(progress);
  const hasM8Completion = moduleId === "M8" ? /M8[\s\S]{0,120}(complete|Complete|完成|PASS)/.test(progress) : true;

  if (hasCurrentModule && hasM8Completion) {
    return {
      updated: true,
      message: `docs/LOOP_PROGRESS.md mentions ${moduleId}.`
    };
  }

  return {
    updated: false,
    message: `Update docs/LOOP_PROGRESS.md for current module ${moduleId} before ending the loop turn.`
  };
}

export function createHookResult(
  hook: HookEventName,
  status: HookResult["status"],
  message: string,
  options: Partial<Pick<HookResult, "event_id" | "loop_run_id" | "artifact_path" | "warnings" | "data">> = {}
): HookResult {
  return {
    ok: status !== "error",
    hook,
    status,
    message,
    ...(options.event_id ? { event_id: options.event_id } : {}),
    ...(options.loop_run_id ? { loop_run_id: options.loop_run_id } : {}),
    ...(options.artifact_path ? { artifact_path: options.artifact_path } : {}),
    warnings: options.warnings ?? [],
    data: options.data ?? {}
  };
}

export function createHookStore(context: HookExecutionContext = {}): LoopStore {
  return new JsonLoopStore({ stateDir: context.stateDir });
}

export function resolveRepoRoot(context: HookExecutionContext = {}): string {
  const candidate = context.repoRoot ?? context.pluginRoot ?? process.env.CODEX_LOOP_REPO_ROOT ?? process.env.CODEX_PLUGIN_ROOT ?? process.cwd();
  return isAbsolute(candidate) ? candidate : resolve(candidate);
}

export function resolvePluginRoot(context: HookExecutionContext = {}): string {
  const candidate = context.pluginRoot ?? process.env.CODEX_PLUGIN_ROOT ?? process.cwd();
  return isAbsolute(candidate) ? candidate : resolve(candidate);
}

export async function appendSafeEvent(
  store: LoopStore,
  loopRunId: string,
  type: string,
  message: string,
  metadata: Record<string, unknown> = {}
): Promise<LoopEvent> {
  return store.appendEvent({
    event_id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    loop_run_id: loopRunId,
    type,
    message,
    metadata
  });
}

async function findLoopRun(store: LoopStore, requestedLoopRunId?: string): Promise<LoopRun | null> {
  if (requestedLoopRunId) {
    return store.getLoopRun(requestedLoopRunId);
  }

  const loopRuns = await store.listLoopRuns();
  const activeRuns = loopRuns.filter((loopRun) => ACTIVE_STATUSES.has(loopRun.status));
  return activeRuns.at(-1) ?? loopRuns.at(-1) ?? null;
}

async function buildLoopSnapshot(store: LoopStore, loopRun: LoopRun): Promise<LoopSnapshot> {
  const tasks = await store.listTasksByLoopRun(loopRun.loop_run_id);
  const events = await store.listEvents(loopRun.loop_run_id);
  return {
    loop_run_id: loopRun.loop_run_id,
    status: loopRun.status,
    current_module_id: loopRun.current_module_id,
    task_status_counts: countTaskStatuses(tasks),
    recent_events: events.slice(-5).map((event) => ({
      event_id: event.event_id,
      type: event.type,
      message: event.message,
      created_at: event.created_at
    }))
  };
}

function countTaskStatuses(tasks: TaskNode[]): Record<TaskStatus, number> {
  return tasks.reduce<Record<TaskStatus, number>>((counts, task) => {
    counts[task.status] = (counts[task.status] ?? 0) + 1;
    return counts;
  }, {} as Record<TaskStatus, number>);
}

function sessionContextMessage(snapshot: LoopSnapshot): string {
  return `Codex Loop active: ${snapshot.loop_run_id}, status ${snapshot.status}, current module ${snapshot.current_module_id}.`;
}

function buildValidationEvent(input: PostToolUseInput, command: string): ValidationCommandEvent {
  const exitCode = extractExitCode(input);
  return {
    command,
    exit_code: exitCode,
    result: exitCode === 0 ? "passed" : exitCode === null ? "not_run" : "failed",
    output_excerpt: excerpt(firstString(input.tool_result?.stderr, input.tool_result?.stdout, input.tool_result?.output) ?? "")
  };
}

function extractExitCode(input: PostToolUseInput): number | null {
  const candidates = [input.exit_code, input.tool_result?.exit_code];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  const status = firstString(input.status, input.tool_result?.status);
  if (status === "success" || status === "passed") {
    return 0;
  }
  if (status === "failed" || status === "error") {
    return 1;
  }

  return null;
}

function buildContextCapsule(input: {
  loopRun: LoopRun;
  agent: AgentProfile;
  task: TaskNode | null;
  progress: string;
  recentEvents: LoopEvent[];
  input: PreCompactInput;
  now: string;
}): ContextCapsule {
  const completedModules = extractCompletedModules(input.progress);
  const failedValidationEvents = input.recentEvents.filter((event) => event.type === "hook.validation" && readMetadataResult(event) === "failed");
  const capsule: ContextCapsule = {
    capsule_id: `capsule_${input.agent.agent_id}_${Date.now()}`,
    loop_run_id: input.loopRun.loop_run_id,
    agent_id: input.agent.agent_id,
    agent_type: input.agent.agent_type,
    old_thread_id: input.agent.current_thread_id,
    new_thread_id: null,
    restart_reason: input.input.restart_reason ?? "PreCompact hook requested a context capsule draft.",
    current_module: input.loopRun.current_module_id,
    current_task: input.task?.task_id ?? "task_unassigned",
    completed_modules: completedModules,
    completed_work: extractCompletedWork(input.progress),
    open_issues: failedValidationEvents.map((event) => event.message),
    evaluator_findings: [],
    repair_requests: [],
    decisions: extractDecisionIds(input.progress),
    validation_status: {
      commands_run: input.recentEvents.flatMap((event) => readValidationCommand(event)),
      passed: input.recentEvents.filter((event) => readMetadataResult(event) === "passed").map((event) => event.message),
      failed: failedValidationEvents.map((event) => event.message),
      not_run_reason: ""
    },
    files_changed_recently: input.task?.likely_files ?? [],
    source_of_truth_files: input.loopRun.source_of_truth_files,
    next_instruction: input.input.next_instruction ?? `Continue ${input.loopRun.current_module_id} from docs/LOOP_PROGRESS.md and latest events.`,
    do_not_repeat: ["Do not rely on chat history as the only source of truth.", "Do not enter the next module unless explicitly requested."],
    risks: failedValidationEvents.length > 0 ? ["Recent validation failure exists in event log."] : [],
    created_at: input.now,
    updated_at: input.now
  };
  assertValid("context-capsule", capsule);
  return capsule;
}

async function resolveAgent(store: LoopStore, agentId?: string, agentType?: AgentType): Promise<AgentProfile | null> {
  if (agentId) {
    return store.getAgent(agentId);
  }

  const agents = await store.listAgents();
  if (agentType) {
    return agents.find((agent) => agent.agent_type === agentType) ?? null;
  }

  return agents.find((agent) => agent.agent_type === "context_distiller") ?? agents.at(0) ?? null;
}

async function findCurrentTask(store: LoopStore, loopRun: LoopRun): Promise<TaskNode | null> {
  const tasks = await store.listTasksByLoopRun(loopRun.loop_run_id);
  return tasks.find((task) => task.module_id === loopRun.current_module_id && task.status !== "PASS") ?? tasks.at(-1) ?? null;
}

function parseSubagentOutput(input: SubagentStopInput):
  | { kind: "eval_report_like"; value: EvalReportLikeInput; raw: string }
  | { kind: "json_missing_verdict"; value: Record<string, unknown>; raw: string }
  | { kind: "text"; raw: string } {
  const rawValue = input.subagent_output ?? input.result ?? input.output ?? "";
  const raw = typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue);
  const parsed = typeof rawValue === "object" && rawValue !== null ? rawValue : parseJsonFromText(raw);

  if (isRecord(parsed)) {
    const verdict = parsed.verdict ?? parsed.status;
    if (verdict === "PASS" || verdict === "NEEDS_REVISION") {
      return {
        kind: "eval_report_like",
        value: parsed as EvalReportLikeInput,
        raw
      };
    }

    return {
      kind: "json_missing_verdict",
      value: parsed,
      raw
    };
  }

  return {
    kind: "text",
    raw
  };
}

function normalizeEvalReport(
  value: EvalReportLikeInput,
  loopRun: LoopRun,
  input: SubagentStopInput,
  timestamp: string
): EvalReport | null {
  if (!value.task_id || !value.module_id) {
    return null;
  }

  const findings = Array.isArray(value.findings) ? (value.findings as EvalFinding[]) : [];
  const report: EvalReport = {
    eval_id: value.eval_id ?? `eval_${value.task_id}_${Date.now()}`,
    loop_run_id: value.loop_run_id ?? loopRun.loop_run_id,
    task_id: value.task_id,
    module_id: value.module_id,
    evaluator_agent_id: value.evaluator_agent_id ?? input.agent_id ?? "agent_evaluator",
    verdict: value.verdict ?? value.status ?? "NEEDS_REVISION",
    confidence: typeof value.confidence === "number" ? value.confidence : 0.5,
    findings,
    required_fixes: Array.isArray(value.required_fixes) ? value.required_fixes : [],
    validation_commands_checked: Array.isArray(value.validation_commands_checked) ? value.validation_commands_checked : [],
    created_at: value.created_at ?? timestamp,
    updated_at: value.updated_at ?? timestamp,
    metadata: {
      ...(isRecord(value.metadata) ? value.metadata : {}),
      captured_by_hook: "SubagentStop"
    }
  };

  assertValid("eval-report", report);
  return report;
}

function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function latestEventId(store: LoopStore, loopRunId: string, eventType: string): Promise<string | null> {
  const events = await store.listEvents(loopRunId);
  return events.filter((event) => event.type === eventType).at(-1)?.event_id ?? null;
}

async function readTextIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function extractCompletedModules(progress: string): string[] {
  const modules = new Set<string>();
  const completedSection = progress.match(/## Completed Modules([\s\S]*?)(?:\n## |$)/)?.[1] ?? progress;
  for (const match of completedSection.matchAll(/\bM\d+\b/g)) {
    modules.add(match[0]);
  }
  return [...modules];
}

function extractCompletedWork(progress: string): string[] {
  const currentStatus = progress.match(/## Current Status([\s\S]*?)(?:\n## |$)/)?.[1]?.trim();
  if (!currentStatus) {
    return [];
  }
  return currentStatus
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .slice(0, 10)
    .map((line) => line.replace(/^-+\s*/, ""));
}

function extractDecisionIds(progress: string): string[] {
  return [...new Set([...progress.matchAll(/\bDEC-\d{4}\b/g)].map((match) => match[0]))];
}

function readValidationCommand(event: LoopEvent): ValidationCommand[] {
  const validation = isRecord(event.metadata.validation) ? event.metadata.validation : null;
  const command = validation && typeof validation.command === "string" ? validation.command : null;
  return command ? [{ command }] : [];
}

function readMetadataResult(event: LoopEvent): string | null {
  const validation = isRecord(event.metadata.validation) ? event.metadata.validation : null;
  const result = validation && typeof validation.result === "string" ? validation.result : null;
  return result;
}

function nextStepHint(loopRun: LoopRun): string {
  return `Loop ${loopRun.loop_run_id} is ${loopRun.status}; continue ${loopRun.current_module_id} or update docs/LOOP_PROGRESS.md with validation evidence.`;
}

function excerpt(text: string): string {
  if (text.length <= MAX_EXCERPT_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_EXCERPT_LENGTH)}...`;
}

function now(context: HookExecutionContext): string {
  return context.now?.() ?? new Date().toISOString();
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function writeJsonArtifact(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function readStateArray<T>(path: string): Promise<T[]> {
  return readJsonFile<T[]>(path, []);
}

export function artifactHash(path: string): string {
  return createHash("sha256").update(path).digest("hex");
}

export function fileRef(path: string): FileRef {
  return {
    path,
    purpose: basename(path)
  };
}
