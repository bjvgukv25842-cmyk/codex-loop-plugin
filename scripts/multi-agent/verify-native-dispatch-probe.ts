import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type ProbeFailureCategory =
  | ""
  | "CUSTOM_AGENTS_NOT_DISCOVERED"
  | "PROJECT_CODEX_CONFIG_NOT_TRUSTED"
  | "CODEX_EXEC_SUBAGENT_UNAVAILABLE"
  | "PROMPT_DID_NOT_FORCE_SPAWN"
  | "MCP_NOT_INHERITED_BY_SUBAGENTS"
  | "HOOKS_UNTRUSTED_BUT_NOT_BLOCKING"
  | "UNKNOWN";

interface ProbeResult {
  status: "PASS" | "FAIL" | "BLOCKED";
  failure_category: ProbeFailureCategory;
  real_thread_executed: boolean;
  parent_thread_id: string;
  agent_runs_count: number;
  agent_names: string[];
  artifacts_present: string[];
  artifacts_missing: string[];
  mcp_agent_run_evidence: boolean;
  subagent_lifecycle_verified: boolean;
  parent_wrote_probe_artifacts: boolean;
  custom_agents_discovered: boolean;
  project_codex_config_present: boolean;
  project_codex_config_trusted: boolean;
  blockers: string[];
  warnings: string[];
}

const repoRoot = process.cwd();
const targetRepo = resolve(repoRoot, "tmp/multi-agent/native-dispatch-probe");
const reportsDir = resolve(repoRoot, "evals/multi-agent/reports");
const resultPath = resolve(reportsDir, "native-dispatch-probe-result.json");
const reportPath = resolve(reportsDir, "native-dispatch-probe-report.md");

const requiredArtifacts = [
  "artifacts/probe/planner.json",
  "artifacts/probe/evaluator.json"
];

function main(): void {
  const eventSummary = readJsonObject(resolve(reportsDir, "native-dispatch-probe-event-summary.json"));
  const agentRuns = readJsonArray(resolve(targetRepo, "state/agent-runs.json"));
  const evidence = readJsonArray(resolve(targetRepo, "state/subagent-evidence.json"));
  const events = readJsonArray(resolve(targetRepo, "state/events.json"));
  const exitCode = readText(resolve(reportsDir, "native-dispatch-probe-exit-code.txt")).trim();
  const stderr = readText(resolve(reportsDir, "native-dispatch-probe-stderr.log"));

  const artifactsPresent = requiredArtifacts.filter((path) => existsSync(resolve(targetRepo, path)));
  const artifactsMissing = requiredArtifacts.filter((path) => !artifactsPresent.includes(path));
  const projectCodexConfigPresent =
    existsSync(resolve(targetRepo, ".codex/config.toml")) &&
    existsSync(resolve(targetRepo, ".codex/agents/loop-planner.toml")) &&
    existsSync(resolve(targetRepo, ".codex/agents/loop-evaluator.toml"));
  const agentNames = unique([
    ...agentRuns.map((run) => readString(run, "agent_name")),
    ...readStringArray(eventSummary, "spawned_agent_names")
  ]).filter(Boolean);
  const realThreadExecuted = Boolean(readString(eventSummary, "parent_thread_id") && readNumber(eventSummary, "event_count") > 0);
  const subagentLifecycleVerified = readNumber(eventSummary, "spawn_agent_call_count") >= 2 && readStringArray(eventSummary, "native_subagent_thread_ids").length >= 2;
  const mcpAgentRunEvidence =
    agentRuns.filter((run) => ["loop_planner", "loop_evaluator"].includes(readString(run, "agent_name"))).length >= 2 &&
    evidence.filter((item) => ["loop_planner", "loop_evaluator"].includes(readString(item, "agent_name"))).length >= 2 &&
    events.some((event) => readString(event, "type") === "agent_run.started") &&
    events.some((event) => readString(event, "type") === "agent_run.finished");
  const parentWroteProbeArtifacts = artifactsPresent.length > 0 && agentRuns.length === 0;

  const blockers: string[] = [];
  if (!realThreadExecuted) {
    blockers.push("No real parent Codex thread_id or event log was captured.");
  }
  if (!projectCodexConfigPresent) {
    blockers.push("Target repo does not contain .codex/config.toml and required loop agent TOML files.");
  }
  for (const agentName of ["loop_planner", "loop_evaluator"]) {
    if (!agentNames.includes(agentName)) {
      blockers.push(`Missing spawned custom agent evidence: ${agentName}.`);
    }
  }
  if (artifactsMissing.length > 0) {
    blockers.push(`Missing probe artifacts: ${artifactsMissing.join(", ")}.`);
  }
  if (!mcpAgentRunEvidence) {
    blockers.push("MCP AgentRun start/finish evidence is incomplete.");
  }
  if (!subagentLifecycleVerified) {
    blockers.push("JSONL did not capture two native spawn_agent lifecycle events.");
  }
  if (parentWroteProbeArtifacts) {
    blockers.push("Probe artifacts exist without AgentRun evidence; parent roleplay is possible.");
  }

  const warnings: string[] = [];
  if (exitCode.includes("timeout")) {
    warnings.push(`Probe command timed out: ${exitCode}.`);
  }
  if (stderr.includes("hook") || stderr.includes("trust")) {
    warnings.push("Hook trust warning observed; hooks are not required for this probe PASS.");
  }

  const failureCategory = classifyFailure({
    blockers,
    eventSummary,
    agentNames,
    mcpAgentRunEvidence,
    stderr,
    exitCode,
    artifactsPresent
  });
  const status: ProbeResult["status"] = blockers.length === 0 ? "PASS" : failureCategory === "CODEX_EXEC_SUBAGENT_UNAVAILABLE" ? "BLOCKED" : "FAIL";
  const result: ProbeResult = {
    status,
    failure_category: blockers.length === 0 ? "" : failureCategory,
    real_thread_executed: realThreadExecuted,
    parent_thread_id: readString(eventSummary, "parent_thread_id"),
    agent_runs_count: agentRuns.length,
    agent_names: agentNames,
    artifacts_present: artifactsPresent,
    artifacts_missing: artifactsMissing,
    mcp_agent_run_evidence: mcpAgentRunEvidence,
    subagent_lifecycle_verified: subagentLifecycleVerified,
    parent_wrote_probe_artifacts: parentWroteProbeArtifacts,
    custom_agents_discovered: agentNames.includes("loop_planner") && agentNames.includes("loop_evaluator"),
    project_codex_config_present: projectCodexConfigPresent,
    project_codex_config_trusted: projectCodexConfigPresent && agentNames.includes("loop_planner") && agentNames.includes("loop_evaluator"),
    blockers,
    warnings
  };

  writeJson(resultPath, result);
  writeText(reportPath, renderReport(result, eventSummary, exitCode));
  process.exitCode = result.status === "PASS" ? 0 : 2;
}

function classifyFailure(input: {
  blockers: string[];
  eventSummary: Record<string, unknown>;
  agentNames: string[];
  mcpAgentRunEvidence: boolean;
  stderr: string;
  exitCode: string;
  artifactsPresent: string[];
}): ProbeFailureCategory {
  if (input.blockers.length === 0) {
    return "";
  }
  const stderr = input.stderr.toLowerCase();
  if (/unknown agent|agent.*not found|custom agent/i.test(input.stderr)) {
    return "CUSTOM_AGENTS_NOT_DISCOVERED";
  }
  if (/trust|not trusted|approval/i.test(input.stderr)) {
    return "PROJECT_CODEX_CONFIG_NOT_TRUSTED";
  }
  if (readNumber(input.eventSummary, "spawn_agent_call_count") === 0 && (input.exitCode.includes("timeout") || readNumber(input.eventSummary, "event_count") > 0)) {
    return "PROMPT_DID_NOT_FORCE_SPAWN";
  }
  if (readNumber(input.eventSummary, "spawn_agent_call_count") < 2 && !stderr.includes("unknown agent")) {
    return "CODEX_EXEC_SUBAGENT_UNAVAILABLE";
  }
  if (input.agentNames.includes("loop_planner") && input.agentNames.includes("loop_evaluator") && !input.mcpAgentRunEvidence) {
    return "MCP_NOT_INHERITED_BY_SUBAGENTS";
  }
  if (stderr.includes("hook") && stderr.includes("trust")) {
    return "HOOKS_UNTRUSTED_BUT_NOT_BLOCKING";
  }
  return "UNKNOWN";
}

function renderReport(result: ProbeResult, eventSummary: Record<string, unknown>, exitCode: string): string {
  return `# Native Dispatch Probe Report

Status: ${result.status}

Failure category: ${result.failure_category || "none"}

## Summary

- Real thread executed: ${result.real_thread_executed}
- Parent thread ID: ${result.parent_thread_id}
- Command exit: ${exitCode || "unknown"}
- Spawn agent calls: ${readNumber(eventSummary, "spawn_agent_call_count")}
- Native subagent thread ids: ${readStringArray(eventSummary, "native_subagent_thread_ids").join(", ") || "none"}
- Agent runs count: ${result.agent_runs_count}
- Agent names: ${result.agent_names.join(", ") || "none"}
- MCP AgentRun evidence: ${result.mcp_agent_run_evidence}
- Subagent lifecycle verified: ${result.subagent_lifecycle_verified}
- Parent wrote probe artifacts: ${result.parent_wrote_probe_artifacts}
- Custom agents discovered: ${result.custom_agents_discovered}
- Project .codex config present: ${result.project_codex_config_present}
- Project .codex config trusted/in effect: ${result.project_codex_config_trusted}

## Artifacts

- Present: ${result.artifacts_present.join(", ") || "none"}
- Missing: ${result.artifacts_missing.join(", ") || "none"}

## Blockers

${result.blockers.length > 0 ? result.blockers.map((item) => `- ${item}`).join("\n") : "- none"}

## Warnings

${result.warnings.length > 0 ? result.warnings.map((item) => `- ${item}`).join("\n") : "- none"}
`;
}

function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return isRecord(parsed) ? parsed : {};
}

function readJsonArray(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) {
    return [];
  }
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
}

function readText(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function readString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

function readNumber(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  return typeof value === "number" ? value : 0;
}

function readStringArray(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function unique(items: string[]): string[] {
  return [...new Set(items)].sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
