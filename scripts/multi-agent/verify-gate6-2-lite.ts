import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { parseGate6EventLines } from "./parse-subagent-events.ts";

type FailureCategory =
  | "TIMEOUT"
  | "NO_EVENT_TIMEOUT"
  | "CODEX_LOCAL_STATE_DB_READONLY"
  | "NO_JSONL_EVENT"
  | "REPAIR_DEV_WORKER_NOT_SPAWNED"
  | "REPAIR_DEV_WORKER_NO_AGENT_RUN"
  | "REPAIR_DEV_WORKER_NO_FILE_CHANGE"
  | "REPAIR_DEV_WORKER_NO_TEST"
  | "FINAL_EVALUATOR_NOT_SPAWNED"
  | "FINAL_EVAL_REPORT_MISSING"
  | "FINAL_EVAL_NOT_PASS"
  | "TESTS_FAILED"
  | "MCP_CROSS_AGENT_STATE_MISSING"
  | "PARENT_ROLEPLAY_DETECTED"
  | "UNKNOWN";

const repoRoot = process.cwd();
const targetRepo = resolve(repoRoot, "tmp/multi-agent/gate6-2-lite-repair-target");
const reportsDir = resolve(repoRoot, "evals/multi-agent/reports");
const eventsPath = resolve(reportsDir, "gate6-2-lite-events.jsonl");
const commandPath = resolve(reportsDir, "gate6-2-lite-command.txt");
const budgetResultPath = resolve(reportsDir, "gate6-2-lite-budget-result.json");
const resultPath = resolve(reportsDir, "gate6-2-lite-result.json");

function main(): void {
  const budgetResult = readJsonObject(budgetResultPath);
  const eventSummary = parseEvents();
  const agentRuns = readJsonArray(join(targetRepo, "state/agent-runs.json")).filter(isRecord);
  const artifactProducers = readJsonArray(join(targetRepo, "state/artifact-producers.json")).filter(isRecord);
  const sourceText = readText(join(targetRepo, "src/project-name.js"));
  const commandText = readText(commandPath);
  const evalPass = readJsonObject(join(targetRepo, "artifacts/eval-report-pass.json"));
  const devWorkerRuns = agentRuns.filter((run) => readString(run, "agent_name") === "loop_dev_worker");
  const evaluatorRuns = agentRuns.filter((run) => readString(run, "agent_name") === "loop_evaluator");
  const devRepairResultExists = existsSync(join(targetRepo, "artifacts/dev-repair-result.json"));
  const evalPassExists = existsSync(join(targetRepo, "artifacts/eval-report-pass.json"));
  const sourceRepaired = /trim\s*\(/.test(sourceText) && /80/.test(sourceText) && !/return\s*\{\s*ok:\s*true\s*\}/.test(sourceText);
  const tests = existsSync(join(targetRepo, "package.json"))
    ? spawnSync("npm", ["test"], { cwd: targetRepo, encoding: "utf8" })
    : { status: 1, stdout: "", stderr: "target package.json missing" };
  const testsPassed = tests.status === 0;
  const npmTestSeen = eventSummary.npm_test_command_seen || /npm\s+test/.test(readText(join(targetRepo, "artifacts/dev-repair-result.json")));
  const producerAgents = new Set(artifactProducers.map((producer) => readString(producer, "created_by_agent_name")).filter(Boolean));
  const mcpCrossAgentStateVerified = devWorkerRuns.length > 0 && evaluatorRuns.length > 0 && producerAgents.has("loop_dev_worker") && producerAgents.has("loop_evaluator");
  const parentRoleplayDetected = sourceRepaired && devWorkerRuns.length === 0;
  const commandUsedDanger = /danger-full-access|dangerously-bypass/i.test(commandText);
  const secretLeakDetected = scanForSecrets([
    sourceText,
    readText(join(targetRepo, "artifacts/dev-repair-result.json")),
    readText(join(targetRepo, "artifacts/eval-report-pass.json"))
  ]);

  const failureCategory = classifyFailure({
    budgetStatus: readString(budgetResult, "status"),
    budgetFailureCategory: readString(budgetResult, "failure_category"),
    stderrExcerpt: readString(budgetResult, "stderr_excerpt"),
    eventCount: eventSummary.event_count,
    devWorkerRuns: devWorkerRuns.length,
    evaluatorRuns: evaluatorRuns.length,
    sourceRepaired,
    npmTestSeen,
    evalPassExists,
    finalVerdict: readString(evalPass, "verdict"),
    testsPassed,
    mcpCrossAgentStateVerified,
    parentRoleplayDetected
  });
  const p0 = new Set<string>();
  const p1 = new Set<string>();
  if (failureCategory !== null) {
    p0.add(failureCategory);
  }
  if (commandUsedDanger) {
    p0.add("danger-full-access used");
  }
  if (secretLeakDetected) {
    p0.add("secret leak detected");
  }
  if (!devRepairResultExists) {
    p1.add("artifacts/dev-repair-result.json missing");
  }

  const budgetStatus = readString(budgetResult, "status");
  const status = p0.size === 0 ? "PASS" : budgetStatus === "TIMEOUT" || budgetStatus === "NO_EVENT_TIMEOUT" ? budgetStatus : "FAIL";
  const result = {
    gate: "Gate 6.2-Lite Repair Continuation",
    status,
    failure_category: failureCategory,
    real_codex_exec_runs: existsSync(budgetResultPath) ? 1 : 0,
    real_thread_executed: eventSummary.event_count > 0,
    agent_runs: agentRuns.map((run) => ({
      agent_name: readString(run, "agent_name"),
      agent_run_id: readString(run, "agent_run_id"),
      thread_id: readString(run, "thread_id"),
      status: readString(run, "status")
    })),
    mcp_cross_agent_state_verified: mcpCrossAgentStateVerified,
    subagent_lifecycle_verified: eventSummary.subagent_lifecycle_event_count > 0 || devWorkerRuns.length + evaluatorRuns.length > 0,
    dev_worker_file_change_verified: sourceRepaired,
    npm_test_seen: npmTestSeen,
    tests_passed: testsPassed,
    final_eval_verdict: readString(evalPass, "verdict"),
    eval_report_pass_exists: evalPassExists,
    parent_roleplay_detected: parentRoleplayDetected,
    secret_leak_detected: secretLeakDetected,
    danger_full_access_used: commandUsedDanger,
    event_summary: eventSummary,
    runtime_budget: budgetResult,
    ready_for_m12: false,
    recommended_next_gate: status === "PASS" ? "Gate 6.3 Checkpointed Resume Native Loop" : "Gate 6B SDK-Orchestrated Mode",
    p0_blockers: [...p0],
    p1_issues: [...p1]
  };
  writeJson(resultPath, result);
  process.exitCode = status === "PASS" ? 0 : 2;
}

function classifyFailure(input: {
  budgetStatus: string;
  budgetFailureCategory: string;
  stderrExcerpt: string;
  eventCount: number;
  devWorkerRuns: number;
  evaluatorRuns: number;
  sourceRepaired: boolean;
  npmTestSeen: boolean;
  evalPassExists: boolean;
  finalVerdict: string;
  testsPassed: boolean;
  mcpCrossAgentStateVerified: boolean;
  parentRoleplayDetected: boolean;
}): FailureCategory | null {
  if (input.budgetStatus === "TIMEOUT") return "TIMEOUT";
  if (input.budgetStatus === "NO_EVENT_TIMEOUT") return "NO_EVENT_TIMEOUT";
  if (input.budgetFailureCategory === "CODEX_LOCAL_STATE_DB_READONLY" || /attempt to write a readonly database/i.test(input.stderrExcerpt)) {
    return "CODEX_LOCAL_STATE_DB_READONLY";
  }
  if (input.eventCount === 0) return "NO_JSONL_EVENT";
  if (input.parentRoleplayDetected) return "PARENT_ROLEPLAY_DETECTED";
  if (input.devWorkerRuns === 0) return "REPAIR_DEV_WORKER_NOT_SPAWNED";
  if (!input.sourceRepaired) return "REPAIR_DEV_WORKER_NO_FILE_CHANGE";
  if (!input.npmTestSeen) return "REPAIR_DEV_WORKER_NO_TEST";
  if (!input.testsPassed) return "TESTS_FAILED";
  if (input.evaluatorRuns === 0) return "FINAL_EVALUATOR_NOT_SPAWNED";
  if (!input.evalPassExists) return "FINAL_EVAL_REPORT_MISSING";
  if (input.finalVerdict !== "PASS") return "FINAL_EVAL_NOT_PASS";
  if (!input.mcpCrossAgentStateVerified) return "MCP_CROSS_AGENT_STATE_MISSING";
  return null;
}

function parseEvents(): ReturnType<typeof parseGate6EventLines> {
  if (!existsSync(eventsPath)) {
    return parseGate6EventLines([]);
  }
  const lines = readFileSync(eventsPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  return parseGate6EventLines(lines);
}

function scanForSecrets(values: string[]): boolean {
  return values.some((value) => /(?:api[_-]?key|secret|token|\.env|sk-[A-Za-z0-9_-]{20,})/i.test(value));
}

function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return isRecord(parsed) ? parsed : {};
}

function readJsonArray(path: string): unknown[] {
  if (!existsSync(path)) {
    return [];
  }
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(parsed) ? parsed : [];
}

function readText(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function readString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

main();
