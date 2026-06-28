import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

interface AgentRunEvidence {
  agent_name: string;
  agent_run_id: string;
  thread_id: string;
  status: string;
  artifacts: string[];
}

interface AgentRunCheck {
  status: "PASS" | "BLOCKED_NATIVE_SUBAGENTS_UNAVAILABLE";
  required_agent_runs_present: boolean;
  required_agents_missing: string[];
  agent_runs: AgentRunEvidence[];
  distinct_thread_ids: string[];
  subagent_lifecycle_verified: boolean;
  native_spawn_verified: boolean;
  planner_artifacts_verified: boolean;
  dev_worker_artifacts_verified: boolean;
  evaluator_artifacts_verified: boolean;
  mcp_agent_ledger_verified: boolean;
  repair_request_agent_evidence_verified: boolean;
  parent_roleplay_detected: boolean;
  p0_blockers: string[];
  p1_issues: string[];
}

const repoRoot = process.cwd();
const targetRepo = resolve(repoRoot, "tmp/multi-agent/gate6-target-validate-project-name");
const reportsDir = resolve(repoRoot, "evals/multi-agent/reports");
const outputPath = resolve(reportsDir, "gate6-agent-runs-check.json");

const requiredAgents = ["loop_planner", "loop_dev_worker", "loop_evaluator"];

function main(): void {
  const agentRuns = readJsonArray(resolve(targetRepo, "state/agent-runs.json"));
  const evidence = readJsonArray(resolve(targetRepo, "state/subagent-evidence.json"));
  const producers = readJsonArray(resolve(targetRepo, "state/artifact-producers.json"));
  const events = readJsonArray(resolve(targetRepo, "state/events.json"));
  const eventSummary = readJsonObject(resolve(reportsDir, "gate6-event-summary.json"));

  const normalizedRuns = mergeAgentRuns(agentRuns.map(toAgentRunEvidence), extractRunsFromJsonl());
  const presentAgentNames = new Set(normalizedRuns.map((run) => run.agent_name));
  const requiredAgentsMissing = requiredAgents.filter((agentName) => !presentAgentNames.has(agentName));
  const distinctThreadIds = [...new Set(normalizedRuns.map((run) => run.thread_id).filter(Boolean))].sort();

  const plannerArtifactsVerified = hasEvidence(evidence, "loop_planner", ["prd", "acceptance_criteria", "task_graph"]);
  const devWorkerArtifactsVerified = hasEvidence(evidence, "loop_dev_worker", ["dev_result"]);
  const evaluatorArtifactsVerified = evidence.filter((item) => readString(item, "agent_name") === "loop_evaluator" && readString(item, "artifact_type") === "eval_report").length >= 2;
  const repairRequestAgentEvidenceVerified = evidence.some((item) => readString(item, "artifact_type") === "repair_request" && Boolean(readString(item, "agent_run_id")));

  const stateLifecycleCount = events.filter((event) => /subagent(_|\.)?(start|stop)|agent_run\.(started|finished)/i.test(`${readString(event, "type")} ${readString(event, "message")}`)).length;
  const jsonlLifecycleCount = readNumber(eventSummary, "subagent_lifecycle_event_count");
  const nativeSpawnVerified = readNumber(eventSummary, "spawn_agent_call_count") >= 3 || readStringArray(eventSummary, "native_subagent_thread_ids").length >= 3;
  const subagentLifecycleVerified = stateLifecycleCount > 0 || jsonlLifecycleCount > 0 || nativeSpawnVerified || distinctThreadIds.length >= 2;
  const producerLedgerVerified =
    producers.length >= 4 &&
    producers.every((item) => readString(item, "created_by_agent_run_id") && readString(item, "created_by_agent_name") && readString(item, "created_by_thread_id") && readString(item, "parent_thread_id"));
  const mcpAgentLedgerVerified = agentRuns.length >= 3 && evidence.length >= 4 && producerLedgerVerified;

  const artifactFilesExist = [
    "docs/PRD.md",
    "docs/TASK_GRAPH.json",
    "artifacts/dev-result.json",
    "artifacts/eval-report-needs-revision.json",
    "artifacts/eval-report-pass.json"
  ].some((path) => existsSync(resolve(targetRepo, path)));
  const parentRoleplayDetected = artifactFilesExist && normalizedRuns.length === 0;

  const p0Blockers: string[] = [];
  if (requiredAgentsMissing.length > 0) {
    p0Blockers.push(`Missing required native agent runs: ${requiredAgentsMissing.join(", ")}`);
  }
  if (distinctThreadIds.length < 2 && !subagentLifecycleVerified) {
    p0Blockers.push("No evidence of distinct subagent threads or subagent lifecycle events.");
  }
  if (!nativeSpawnVerified) {
    const spawnCount = readNumber(eventSummary, "spawn_agent_call_count");
    p0Blockers.push(`Fewer than 3 required native spawn_agent events were captured; observed ${spawnCount}.`);
  }
  if (parentRoleplayDetected) {
    p0Blockers.push("Artifacts exist without Agent Evidence Ledger records; this is compatible with parent-thread roleplay, not native subagents.");
  }

  const p1Issues: string[] = [];
  if (!mcpAgentLedgerVerified) {
    p1Issues.push("MCP/state Agent Evidence Ledger or artifact producer ledger is incomplete or absent.");
  }
  if (!plannerArtifactsVerified) {
    p1Issues.push("Planner artifacts are not backed by loop_planner MCP/state evidence.");
  }
  if (!devWorkerArtifactsVerified) {
    p1Issues.push("DevResult is not backed by loop_dev_worker MCP/state evidence.");
  }
  if (!evaluatorArtifactsVerified) {
    p1Issues.push("EvalReports are not backed by loop_evaluator MCP/state evidence.");
  }
  if (!repairRequestAgentEvidenceVerified) {
    p1Issues.push("RepairRequest lacks agent_run evidence.");
  }

  const result: AgentRunCheck = {
    status: p0Blockers.length === 0 ? "PASS" : "BLOCKED_NATIVE_SUBAGENTS_UNAVAILABLE",
    required_agent_runs_present: requiredAgentsMissing.length === 0,
    required_agents_missing: requiredAgentsMissing,
    agent_runs: normalizedRuns,
    distinct_thread_ids: distinctThreadIds,
    subagent_lifecycle_verified: subagentLifecycleVerified,
    native_spawn_verified: nativeSpawnVerified,
    planner_artifacts_verified: plannerArtifactsVerified,
    dev_worker_artifacts_verified: devWorkerArtifactsVerified,
    evaluator_artifacts_verified: evaluatorArtifactsVerified,
    mcp_agent_ledger_verified: mcpAgentLedgerVerified,
    repair_request_agent_evidence_verified: repairRequestAgentEvidenceVerified,
    parent_roleplay_detected: parentRoleplayDetected,
    p0_blockers: p0Blockers,
    p1_issues: p1Issues
  };

  writeJson(outputPath, result);
  process.exitCode = result.status === "PASS" ? 0 : 2;
}

function extractRunsFromJsonl(): AgentRunEvidence[] {
  const eventsPath = resolve(reportsDir, "gate6-target-events.jsonl");
  if (!existsSync(eventsPath)) {
    return [];
  }
  const runs: AgentRunEvidence[] = [];
  for (const line of readFileSync(eventsPath, "utf8").split(/\r?\n/).filter(Boolean)) {
    const parsed = parseJsonLine(line);
    const item = parsed ? readRecord(parsed, "item") : null;
    if (!item || readString(item, "type") !== "collab_tool_call" || readString(item, "tool") !== "spawn_agent" || readString(parsed as JsonRecord, "type") !== "item.completed") {
      continue;
    }
    const prompt = readString(item, "prompt");
    const receiverThreadIds = readStringArray(item, "receiver_thread_ids");
    const agentName = inferAgentName(prompt);
    if (!agentName) {
      continue;
    }
    runs.push({
      agent_name: agentName,
      agent_run_id: receiverThreadIds[0] ?? "",
      thread_id: receiverThreadIds[0] ?? "",
      status: "spawned",
      artifacts: inferArtifactsFromPrompt(prompt, agentName)
    });
  }
  return runs;
}

function mergeAgentRuns(primary: AgentRunEvidence[], fallback: AgentRunEvidence[]): AgentRunEvidence[] {
  const byAgent = new Map<string, AgentRunEvidence>();
  for (const run of [...fallback, ...primary]) {
    if (!run.agent_name) {
      continue;
    }
    const existing = byAgent.get(run.agent_name);
    byAgent.set(run.agent_name, {
      agent_name: run.agent_name,
      agent_run_id: run.agent_run_id || existing?.agent_run_id || "",
      thread_id: run.thread_id || existing?.thread_id || "",
      status: run.status || existing?.status || "",
      artifacts: run.artifacts.length > 0 ? run.artifacts : existing?.artifacts ?? []
    });
  }
  return [...byAgent.values()].sort((left, right) => left.agent_name.localeCompare(right.agent_name));
}

function inferAgentName(prompt: string): string {
  for (const agentName of ["loop_planner", "loop_dev_worker", "loop_evaluator", "loop_context_distiller", "loop_integration_manager"]) {
    if (prompt.includes(agentName)) {
      return agentName;
    }
  }
  return "";
}

function inferArtifactsFromPrompt(prompt: string, agentName: string): string[] {
  const artifacts = new Set<string>();
  for (const match of prompt.matchAll(/`([^`]+\.(?:md|json|js))`/gi)) {
    const path = match[1];
    if (/^(docs|artifacts|state|src|test)\//.test(path)) {
      artifacts.add(path);
    }
  }
  if (agentName === "loop_evaluator") {
    artifacts.add("inline EvalReport JSON");
  }
  return [...artifacts].sort();
}

function parseJsonLine(line: string): JsonRecord | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readRecord(input: JsonRecord, key: string): JsonRecord | null {
  const value = input[key];
  return isRecord(value) ? value : null;
}

function toAgentRunEvidence(run: JsonRecord): AgentRunEvidence {
  return {
    agent_name: readString(run, "agent_name"),
    agent_run_id: readString(run, "agent_run_id"),
    thread_id: readString(run, "thread_id"),
    status: readString(run, "status"),
    artifacts: readStringArray(run, "artifact_ids")
  };
}

function hasEvidence(evidence: JsonRecord[], agentName: string, artifactTypes: string[]): boolean {
  return artifactTypes.every((artifactType) =>
    evidence.some((item) => readString(item, "agent_name") === agentName && readString(item, "artifact_type") === artifactType && Boolean(readString(item, "agent_run_id")))
  );
}

function readJsonArray(path: string): JsonRecord[] {
  if (!existsSync(path)) {
    return [];
  }
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
}

function readJsonObject(path: string): JsonRecord {
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

function readNumber(input: JsonRecord, key: string): number {
  const value = input[key];
  return typeof value === "number" ? value : 0;
}

function readStringArray(input: JsonRecord, key: string): string[] {
  const value = input[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

main();
