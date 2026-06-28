import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

const repoRoot = process.cwd();
const reportsDir = resolve(repoRoot, "evals/multi-agent/reports");
const reportPath = resolve(reportsDir, "Gate6RealNativeMultiAgentReport.md");
const resultPath = resolve(reportsDir, "gate6-final-result.json");
const docsReportPath = resolve(repoRoot, "docs/GATE6_NATIVE_MULTI_AGENT_VALIDATION.md");

function main(): void {
  const preflight = readJsonObject("gate6-preflight.json");
  const eventSummary = readJsonObject("gate6-event-summary.json");
  const agentRunCheck = readJsonObject("gate6-agent-runs-check.json");
  const stateCheck = readJsonObject("gate6-cross-agent-state-check.json");
  const targetOutput = readJsonObject("gate6-target-final-output.json");
  const targetSetup = readJsonObject("gate6-target-setup.json");
  const commandText = readReportText("gate6-target-command.txt");
  const exitCode = readReportText("gate6-target-exit-code.txt").trim();

  const parentThreadId = readString(eventSummary, "parent_thread_id");
  const realThreadExecuted = Boolean(parentThreadId && readNumber(eventSummary, "event_count") > 0);
  const commandUsedDanger = /danger-full-access|dangerously-bypass/i.test(commandText);
  const agentRuns = readArray(agentRunCheck, "agent_runs").filter(isRecord).map((run) => ({
    agent_name: readString(run, "agent_name"),
    agent_run_id: readString(run, "agent_run_id"),
    thread_id: readString(run, "thread_id"),
    artifacts: readStringArray(run, "artifacts")
  }));

  const p0 = new Set<string>();
  const p1 = new Set<string>();

  if (!readBoolean(preflight, "cache_native_skill")) {
    p0.add("Installed codex-loop plugin cache does not contain Native Subagent Mode.");
  }
  if (readString(preflight, "plugin_enable_status") !== "PASS") {
    p0.add("codex-loop plugin is not confirmed installed and enabled.");
  }
  if (!realThreadExecuted) {
    p0.add("No real parent Codex thread_id or JSONL event log was captured.");
  }
  if (readNumber(eventSummary, "command_execution_count") < 1) {
    p0.add("No command_execution event was captured.");
  }
  if (!readBoolean(eventSummary, "npm_test_command_seen")) {
    p0.add("No npm test command was observed in JSONL events.");
  }
  if (readNumber(eventSummary, "file_change_event_count") < 1 && readStringArray(stateCheck, "changed_files").length < 1) {
    p0.add("No file change event or target repo file diff was observed.");
  }
  if (commandUsedDanger) {
    p0.add("Gate 6 command used a forbidden danger/bypass flag.");
  }
  for (const blocker of readStringArray(agentRunCheck, "p0_blockers")) {
    p0.add(blocker);
  }
  for (const blocker of readStringArray(stateCheck, "p0_blockers")) {
    p0.add(blocker);
  }
  for (const issue of readStringArray(agentRunCheck, "p1_issues")) {
    p1.add(issue);
  }
  for (const issue of readStringArray(stateCheck, "p1_issues")) {
    p1.add(issue);
  }
  if (!readBoolean(preflight, "hooks_trusted_mode_checked")) {
    p1.add("Hooks trusted mode was not checked; manual review/trust remains required.");
  }
  if (readNumber(eventSummary, "mcp_tool_call_count") < 1) {
    p1.add("No MCP state-store tool call was observed in the child thread JSONL events.");
  }

  const nativeSpawnVerified = readBoolean(agentRunCheck, "native_spawn_verified") || readNumber(eventSummary, "spawn_agent_call_count") >= 3;
  const nativeSubagentUnavailable = !nativeSpawnVerified || readString(agentRunCheck, "status") === "BLOCKED_NATIVE_SUBAGENTS_UNAVAILABLE";
  const hooksBlocked = p1.has("Hooks trusted mode was not checked; manual review/trust remains required.") && !nativeSpawnVerified;
  const status =
    p0.size === 0 && p1.size <= 2
      ? "PASS"
      : nativeSubagentUnavailable
        ? "BLOCKED_NATIVE_SUBAGENTS_UNAVAILABLE"
        : hooksBlocked
          ? "BLOCKED_MANUAL_REVIEW_REQUIRED"
          : "NEEDS_REVISION";
  const finalResult = {
    gate: "Gate 6 Real Native Multi-Agent Loop E2E",
    status,
    bootstrap_completed: true,
    custom_agents_materialized: [
      "loop_planner",
      "loop_dev_worker",
      "loop_evaluator",
      "loop_context_distiller",
      "loop_integration_manager"
    ],
    native_subagent_mode_enabled: readBoolean(preflight, "cache_native_skill"),
    real_thread_executed: realThreadExecuted,
    parent_thread_id: parentThreadId,
    agent_runs: agentRuns,
    mcp_cross_agent_state_verified: readBoolean(stateCheck, "mcp_cross_agent_state_verified") && readBoolean(agentRunCheck, "mcp_agent_ledger_verified"),
    subagent_lifecycle_verified: readBoolean(agentRunCheck, "subagent_lifecycle_verified"),
    initial_eval_verdict: readBoolean(stateCheck, "initial_eval_needs_revision") ? "NEEDS_REVISION" : "",
    repair_request_created: readBoolean(stateCheck, "repair_request_created"),
    final_eval_verdict: readBoolean(stateCheck, "final_eval_pass") ? "PASS" : "",
    tests_passed: readBoolean(stateCheck, "tests_passed"),
    parent_roleplay_detected: readBoolean(agentRunCheck, "parent_roleplay_detected"),
    p0_blockers: [...p0],
    p1_issues: [...p1],
    ready_for_M12_effectiveness_eval: status === "PASS"
  };

  writeJson(resultPath, finalResult);
  const markdown = renderMarkdown({
    finalResult,
    preflight,
    eventSummary,
    agentRunCheck,
    stateCheck,
    targetOutput,
    targetSetup,
    commandText,
    exitCode
  });
  writeText(reportPath, markdown);
  writeText(docsReportPath, markdown);
  process.exitCode = status === "PASS" ? 0 : 2;
}

function renderMarkdown(input: {
  finalResult: JsonRecord;
  preflight: JsonRecord;
  eventSummary: JsonRecord;
  agentRunCheck: JsonRecord;
  stateCheck: JsonRecord;
  targetOutput: JsonRecord;
  targetSetup: JsonRecord;
  commandText: string;
  exitCode: string;
}): string {
  const p0 = readStringArray(input.finalResult, "p0_blockers");
  const p1 = readStringArray(input.finalResult, "p1_issues");
  return `# Gate 6 Real Native Multi-Agent Loop E2E

Date: 2026-06-19

Verdict: ${readString(input.finalResult, "status")}

Gate 6 tests whether a user can provide only \`$codex-loop\` plus a goal and have the plugin drive real native subagents through PRD, TaskGraph, Dev, Eval, Repair, and FinalReport. This report does not treat a single-thread roleplay run as a pass.

## Environment

- Codex version: ${readString(input.preflight, "codex_version") || "unknown"}
- Plugin enable status: ${readString(input.preflight, "plugin_enable_status") || "UNKNOWN"}
- Marketplace native skill: ${readBoolean(input.preflight, "marketplace_native_skill")}
- Installed cache native skill: ${readBoolean(input.preflight, "cache_native_skill")}
- Hooks trusted mode checked: ${readBoolean(input.preflight, "hooks_trusted_mode_checked")}
- Target repo: \`tmp/multi-agent/gate6-target-validate-project-name\`
- Command exit code: ${input.exitCode || "unknown"}

## Command

\`\`\`text
${input.commandText.trim() || "not run"}
\`\`\`

## Event Summary

- Parent thread ID: ${readString(input.eventSummary, "parent_thread_id") || ""}
- Event count: ${readNumber(input.eventSummary, "event_count")}
- Command executions: ${readNumber(input.eventSummary, "command_execution_count")}
- npm test seen: ${readBoolean(input.eventSummary, "npm_test_command_seen")}
- File change events: ${readNumber(input.eventSummary, "file_change_event_count")}
- MCP tool calls: ${readNumber(input.eventSummary, "mcp_tool_call_count")}
- Subagent lifecycle events: ${readNumber(input.eventSummary, "subagent_lifecycle_event_count")}

## Native Agent Evidence

- Required agent runs present: ${readBoolean(input.agentRunCheck, "required_agent_runs_present")}
- Missing required agents: ${readStringArray(input.agentRunCheck, "required_agents_missing").join(", ") || "none"}
- Distinct thread IDs: ${readStringArray(input.agentRunCheck, "distinct_thread_ids").join(", ") || "none"}
- Planner artifact evidence: ${readBoolean(input.agentRunCheck, "planner_artifacts_verified")}
- Dev worker artifact evidence: ${readBoolean(input.agentRunCheck, "dev_worker_artifacts_verified")}
- Evaluator artifact evidence: ${readBoolean(input.agentRunCheck, "evaluator_artifacts_verified")}
- Parent roleplay detected: ${readBoolean(input.agentRunCheck, "parent_roleplay_detected")}

## Artifact And Repair Loop

- Required artifacts present: ${readBoolean(input.stateCheck, "required_artifacts_present")}
- Missing artifacts: ${readStringArray(input.stateCheck, "missing_artifacts").join(", ") || "none"}
- Tests passed: ${readBoolean(input.stateCheck, "tests_passed")}
- Initial eval NEEDS_REVISION: ${readBoolean(input.stateCheck, "initial_eval_needs_revision")}
- RepairRequest created: ${readBoolean(input.stateCheck, "repair_request_created")}
- Final eval PASS: ${readBoolean(input.stateCheck, "final_eval_pass")}
- MCP cross-agent state verified: ${readBoolean(input.stateCheck, "mcp_cross_agent_state_verified")}
- Final report has agent refs: ${readBoolean(input.stateCheck, "final_report_has_agent_refs")}

## Scoring

- P0 blockers: ${p0.length}
- P1 issues: ${p1.length}

### P0 Blockers

${p0.length > 0 ? p0.map((item) => `- ${item}`).join("\n") : "- none"}

### P1 Issues

${p1.length > 0 ? p1.map((item) => `- ${item}`).join("\n") : "- none"}

## Target Final Output

\`\`\`json
${JSON.stringify(input.targetOutput, null, 2)}
\`\`\`

## Setup Summary

\`\`\`json
${JSON.stringify(input.targetSetup, null, 2)}
\`\`\`

## Final Gate Result

\`\`\`json
${JSON.stringify(input.finalResult, null, 2)}
\`\`\`

## Next Required Actions

${readString(input.finalResult, "status") === "PASS" ? "- Gate 6 passed. M12 effectiveness evaluation can begin." : "- Strengthen the parent Loop Manager dispatch contract so it must spawn `loop_dev_worker` immediately after a `NEEDS_REVISION` RepairRequest exists.\n- Require baseline evaluator output to persist an EvalReport artifact file with a non-empty `findings` array, not only state metadata.\n- Require RepairRequest ownership evidence through `repair_request_write_by_agent` or equivalent Agent Evidence Ledger state.\n- Keep the installed plugin cache synchronized with the repo skill before rerunning Gate 6.\n- If a refreshed runtime still cannot produce required native subagent lifecycle and Agent Evidence Ledger records, keep Gate 6 blocked as `BLOCKED_NATIVE_SUBAGENTS_UNAVAILABLE`.\n- Do not proceed to M12 until Gate 6 PASS evidence exists."}
`;
}

function readReportText(name: string): string {
  const path = resolve(reportsDir, name);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function readJsonObject(name: string): JsonRecord {
  const path = resolve(reportsDir, name);
  if (!existsSync(path)) {
    return {};
  }
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return isRecord(parsed) ? parsed : {};
}

function readString(input: JsonRecord, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

function readBoolean(input: JsonRecord, key: string): boolean {
  const value = input[key];
  return typeof value === "boolean" ? value : false;
}

function readNumber(input: JsonRecord, key: string): number {
  const value = input[key];
  return typeof value === "number" ? value : 0;
}

function readArray(input: JsonRecord, key: string): unknown[] {
  const value = input[key];
  return Array.isArray(value) ? value : [];
}

function readStringArray(input: JsonRecord, key: string): string[] {
  return readArray(input, key).filter((item): item is string => typeof item === "string");
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

main();
