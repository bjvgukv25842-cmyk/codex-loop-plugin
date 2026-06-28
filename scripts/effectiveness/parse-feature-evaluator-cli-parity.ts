import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { FEATURE_EVALUATOR_PARITY_PROMPT } from "../../src/effectiveness/feature-evaluator-stage.ts";
import { writeJson, writeMarkdown } from "./io.ts";

export interface EvaluatorCliParityResult {
  module: "M12.2H.1 Feature Evaluator CLI Parity Parse";
  status: "PASS" | "FAIL" | "NO_INPUT";
  executed: false;
  events_path: string;
  stderr_path: string;
  thread_started: boolean;
  turn_started: boolean;
  turn_completed: boolean;
  agent_message_contains_expected: boolean;
  stderr_nonempty: boolean;
  likely_failure: "" | "SDK_EVALUATOR_ADAPTER_OR_EVENT_STREAM_ISSUE" | "CODEX_CLI_TARGET_REPO_SANDBOX_MODEL_OR_RUNTIME_ISSUE" | "CLI_PARITY_NOT_EXECUTED";
  prompt: typeof FEATURE_EVALUATOR_PARITY_PROMPT;
  errors: string[];
}

const repoRoot = process.cwd();
const reportDir = "evals/effectiveness/reports/feature-small-001";
const eventsPath = resolve(repoRoot, reportDir, "evaluator-cli-parity-events.jsonl");
const stderrPath = resolve(repoRoot, reportDir, "evaluator-cli-parity-stderr.log");

export function parseFeatureEvaluatorCliParity(root = repoRoot): EvaluatorCliParityResult {
  const absoluteEventsPath = resolve(root, reportDir, "evaluator-cli-parity-events.jsonl");
  const absoluteStderrPath = resolve(root, reportDir, "evaluator-cli-parity-stderr.log");
  const events = readEvents(absoluteEventsPath);
  const stderr = readText(absoluteStderrPath);
  const threadStarted = events.some((event) => eventType(event) === "thread.started");
  const turnStarted = events.some((event) => eventType(event) === "turn.started");
  const turnCompleted = events.some((event) => eventType(event) === "turn.completed");
  const containsExpected = events.some((event) => eventType(event) === "item.completed" && stableText(event).includes("FEATURE_EVALUATOR_PARITY_OK"));
  const hasInput = existsSync(absoluteEventsPath) || existsSync(absoluteStderrPath);
  const pass = threadStarted && turnStarted && containsExpected && turnCompleted;
  const result: EvaluatorCliParityResult = {
    module: "M12.2H.1 Feature Evaluator CLI Parity Parse",
    status: !hasInput ? "NO_INPUT" : pass ? "PASS" : "FAIL",
    executed: false,
    events_path: absoluteEventsPath,
    stderr_path: absoluteStderrPath,
    thread_started: threadStarted,
    turn_started: turnStarted,
    turn_completed: turnCompleted,
    agent_message_contains_expected: containsExpected,
    stderr_nonempty: stderr.trim().length > 0,
    likely_failure: !hasInput
      ? "CLI_PARITY_NOT_EXECUTED"
      : pass
        ? "SDK_EVALUATOR_ADAPTER_OR_EVENT_STREAM_ISSUE"
        : "CODEX_CLI_TARGET_REPO_SANDBOX_MODEL_OR_RUNTIME_ISSUE",
    prompt: FEATURE_EVALUATOR_PARITY_PROMPT,
    errors: pass || !hasInput ? [] : [stderr.trim() || "CLI parity did not produce the expected completed agent message."]
  };
  writeJson(resolve(root, reportDir, "evaluator-cli-parity-result.json"), result);
  writeMarkdown(resolve(root, reportDir, "EvaluatorCliParityReport.md"), renderReport(result));
  return result;
}

function readEvents(path: string): unknown[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return { type: "unparseable", raw: line };
      }
    });
}

function readText(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

function renderReport(result: EvaluatorCliParityResult): string {
  return [
    "# Evaluator CLI Parity Report",
    "",
    `Status: ${result.status}`,
    `Thread started: ${result.thread_started}`,
    `Turn started: ${result.turn_started}`,
    `Turn completed: ${result.turn_completed}`,
    `Agent message contains expected token: ${result.agent_message_contains_expected}`,
    `Stderr nonempty: ${result.stderr_nonempty}`,
    `Likely failure: ${result.likely_failure || "none"}`,
    "",
    "## Paths",
    `Events: ${result.events_path}`,
    `Stderr: ${result.stderr_path}`,
    "",
    "This parser reads CLI parity output only. It does not execute Codex CLI.",
    ""
  ].join("\n");
}

function eventType(event: unknown): string {
  return isRecord(event) && typeof event.type === "string" ? event.type : "";
}

function stableText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = parseFeatureEvaluatorCliParity();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "FAIL" ? 2 : 0;
}
