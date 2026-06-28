import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

interface CrossAgentStateCheck {
  required_artifacts_present: boolean;
  missing_artifacts: string[];
  tests_passed: boolean;
  changed_files: string[];
  src_project_name_modified: boolean;
  tests_deleted: boolean;
  package_json_unnecessarily_modified: boolean;
  secret_leak_detected: boolean;
  initial_eval_needs_revision: boolean;
  findings_count: number;
  repair_request_created: boolean;
  repair_references_eval: boolean;
  final_eval_pass: boolean;
  validation_passed: boolean;
  event_semantics_present: string[];
  event_semantics_missing: string[];
  final_report_exists: boolean;
  final_report_has_agent_refs: boolean;
  mcp_cross_agent_state_verified: boolean;
  p0_blockers: string[];
  p1_issues: string[];
}

const repoRoot = process.cwd();
const targetRepo = resolve(repoRoot, "tmp/multi-agent/gate6-target-validate-project-name");
const reportsDir = resolve(repoRoot, "evals/multi-agent/reports");
const outputPath = resolve(reportsDir, "gate6-cross-agent-state-check.json");

const requiredArtifacts = [
  "docs/PRD.md",
  "docs/ACCEPTANCE_CRITERIA.md",
  "docs/TASK_GRAPH.json",
  "artifacts/dev-result.json",
  "artifacts/eval-report-needs-revision.json",
  "artifacts/repair-request.json",
  "artifacts/eval-report-pass.json",
  "artifacts/FinalDeliveryReport.md",
  "state/events.json"
];

const requiredSemantics = [
  "loop_started",
  "prd_created",
  "task_graph_created",
  "eval_needs_revision",
  "repair_requested",
  "dev_repaired",
  "validation_passed",
  "eval_passed",
  "final_report_created"
];

function main(): void {
  const missingArtifacts = requiredArtifacts.filter((path) => !existsSync(resolve(targetRepo, path)));
  const testResult = existsSync(resolve(targetRepo, "package.json")) ? spawnSync("npm", ["test"], { cwd: targetRepo, encoding: "utf8" }) : null;
  const testsPassed = testResult?.status === 0;
  const changedFiles = listChangedFiles();
  const srcContent = readText("src/project-name.js");
  const testExists = existsSync(resolve(targetRepo, "test/project-name.test.js"));
  const finalReport = readText("artifacts/FinalDeliveryReport.md");
  const secretLeakDetected = detectSecretLikeContent(finalReport) || changedFiles.some((file) => /\.env($|\.|\/)|secret|token/i.test(file));

  const initialEval = firstNonEmptyRecord([
    readJsonObject("artifacts/eval-report-needs-revision.json"),
    findJsonArrayRecord("state/subagent-evidence.json", (item) => readString(item, "artifact_id").includes("eval_baseline")),
    findJsonArrayRecord("state/agent-runs.json", (item) => readString(item, "agent_name") === "loop_evaluator" && readString(item, "status") === "FINISHED")
  ]);
  const finalEval = readJsonObject("artifacts/eval-report-pass.json");
  const repairRequest = firstNonEmptyRecord([
    readJsonObject("artifacts/repair-request.json"),
    readJsonObject("state/repair-requests.json")
  ]);
  const events = readJsonArray("state/events.json");
  const agentRuns = readJsonArray("state/agent-runs.json");
  const evidence = readJsonArray("state/subagent-evidence.json");
  const producers = readJsonArray("state/artifact-producers.json");

  const initialEvalId = readString(initialEval, "eval_id") || readString(initialEval, "id");
  const initialEvalMetadata = readRecord(initialEval, "metadata");
  const initialEvalVerdict = readString(initialEval, "verdict") || readString(initialEvalMetadata, "verdict");
  const repairSourceEvalId = readString(repairRequest, "source_eval_id");
  const findings = readArray(initialEval, "findings");
  const eventText = events.map((event) => `${readString(event, "type")} ${readString(event, "message")} ${JSON.stringify(event["metadata"] ?? {})}`.toLowerCase());
  const eventSemanticsPresent = requiredSemantics.filter((semantic) => eventText.some((text) => semanticMatches(semantic, text)));
  const eventSemanticsMissing = requiredSemantics.filter((semantic) => !eventSemanticsPresent.includes(semantic));
  const finalReportHasAgentRefs = /agent_run_id/i.test(finalReport) && /thread_id/i.test(finalReport) && /artifact/i.test(finalReport);
  const mcpCrossAgentStateVerified =
    agentRuns.length >= 3 &&
    evidence.some((item) => readString(item, "agent_name") === "loop_planner") &&
    evidence.some((item) => readString(item, "agent_name") === "loop_dev_worker") &&
    evidence.some((item) => readString(item, "agent_name") === "loop_evaluator") &&
    producerMatches(producers, "prd", "loop_planner") &&
    producerMatches(producers, "task_graph", "loop_planner") &&
    producerMatches(producers, "dev_result", "loop_dev_worker") &&
    producerMatches(producers, "eval_report", "loop_evaluator");

  const p0Blockers: string[] = [];
  if (missingArtifacts.length > 0) {
    p0Blockers.push(`Missing required artifacts: ${missingArtifacts.join(", ")}`);
  }
  if (!testsPassed) {
    p0Blockers.push("Final npm test did not pass.");
  }
  if (!srcContent.includes("trim") || srcContent.includes("return { ok: true };")) {
    p0Blockers.push("src/project-name.js does not show a real validation repair.");
  }
  if (!testExists) {
    p0Blockers.push("test/project-name.test.js was deleted.");
  }
  if (secretLeakDetected) {
    p0Blockers.push("Secret-like content detected in Gate 6 artifacts or changes.");
  }
  if (initialEvalVerdict !== "NEEDS_REVISION") {
    p0Blockers.push("Initial EvalReport is not NEEDS_REVISION.");
  }
  if (findings.length < 1) {
    p0Blockers.push("Initial NEEDS_REVISION evidence has no persisted findings array.");
  }
  if (!repairSourceEvalId || (initialEvalId && repairSourceEvalId !== initialEvalId)) {
    p0Blockers.push("RepairRequest does not reference the initial EvalReport.");
  }
  if (readString(finalEval, "verdict") !== "PASS") {
    p0Blockers.push("Final EvalReport is not PASS.");
  }

  const p1Issues: string[] = [];
  if (eventSemanticsMissing.length > 0) {
    p1Issues.push(`state/events.json missing semantic events: ${eventSemanticsMissing.join(", ")}`);
  }
  if (!finalReportHasAgentRefs) {
    p1Issues.push("FinalDeliveryReport does not include agent_run_id/thread_id/artifact refs.");
  }
  if (!mcpCrossAgentStateVerified) {
    p1Issues.push("MCP/state cross-agent evidence is incomplete.");
  }
  if (changedFiles.includes("package.json")) {
    p1Issues.push("package.json changed; verify this was necessary.");
  }

  const result: CrossAgentStateCheck = {
    required_artifacts_present: missingArtifacts.length === 0,
    missing_artifacts: missingArtifacts,
    tests_passed: testsPassed,
    changed_files: changedFiles,
    src_project_name_modified: srcContent.includes("trim") && !srcContent.includes("return { ok: true };"),
    tests_deleted: !testExists,
    package_json_unnecessarily_modified: changedFiles.includes("package.json"),
    secret_leak_detected: secretLeakDetected,
    initial_eval_needs_revision: initialEvalVerdict === "NEEDS_REVISION",
    findings_count: findings.length,
    repair_request_created: Boolean(readString(repairRequest, "repair_id") || readString(repairRequest, "id")),
    repair_references_eval: Boolean(repairSourceEvalId && (!initialEvalId || repairSourceEvalId === initialEvalId)),
    final_eval_pass: readString(finalEval, "verdict") === "PASS",
    validation_passed: testsPassed,
    event_semantics_present: eventSemanticsPresent,
    event_semantics_missing: eventSemanticsMissing,
    final_report_exists: Boolean(finalReport),
    final_report_has_agent_refs: finalReportHasAgentRefs,
    mcp_cross_agent_state_verified: mcpCrossAgentStateVerified,
    p0_blockers: p0Blockers,
    p1_issues: p1Issues
  };

  writeJson(outputPath, result);
  process.exitCode = p0Blockers.length === 0 ? 0 : 2;
}

function listChangedFiles(): string[] {
  const files = [
    "README.md",
    "package.json",
    "src/project-name.js",
    "test/project-name.test.js",
    "docs/PRD.md",
    "docs/ACCEPTANCE_CRITERIA.md",
    "docs/TASK_GRAPH.json",
    "docs/LOOP_PROGRESS.md",
    "artifacts/dev-result.json",
    "artifacts/eval-report-needs-revision.json",
    "artifacts/repair-request.json",
    "artifacts/eval-report-pass.json",
    "artifacts/FinalDeliveryReport.md",
    "state/events.json",
    "state/agent-runs.json",
    "state/subagent-evidence.json"
  ];
  return files.filter((file) => {
    const current = readText(file);
    if (!current) {
      return false;
    }
    return current !== initialFixtureContent(file);
  });
}

function initialFixtureContent(file: string): string {
  if (file === "package.json") {
    return `${JSON.stringify(
      {
        name: "gate6-target-validate-project-name",
        version: "0.0.0",
        type: "module",
        scripts: {
          test: "node --test",
          validate: "node --test"
        }
      },
      null,
      2
    )}\n`;
  }
  if (file === "README.md") {
    return "# gate6-target-validate-project-name\n\nIsolated broken target repository for Gate 6 native multi-agent validation.\n";
  }
  if (file === "src/project-name.js") {
    return "export function validateProjectName(name) {\n  return { ok: true };\n}\n";
  }
  if (file === "test/project-name.test.js") {
    return `import test from "node:test";
import assert from "node:assert/strict";
import { validateProjectName } from "../src/project-name.js";

test("rejects empty string", () => {
  assert.equal(validateProjectName("").ok, false);
});

test("rejects whitespace-only string", () => {
  assert.equal(validateProjectName("   ").ok, false);
});

test("rejects names longer than 80 characters", () => {
  assert.equal(validateProjectName("x".repeat(81)).ok, false);
});

test("accepts valid project names", () => {
  assert.equal(validateProjectName("My Project").ok, true);
});
`;
  }
  return "";
}

function semanticMatches(semantic: string, text: string): boolean {
  const patterns: Record<string, RegExp> = {
    loop_started: /loop[_. -]?started|loop_run\.created/,
    prd_created: /prd[_. -]?created|artifact.*prd/,
    task_graph_created: /task[_. -]?graph[_. -]?created|artifact.*task_graph/,
    eval_needs_revision: /eval.*needs_revision|needs_revision/,
    repair_requested: /repair[_. -]?requested|repair_request\.created/,
    dev_repaired: /dev[_. -]?repaired|repair.*dev|dev_result/,
    validation_passed: /validation[_. -]?passed|npm test.*pass/,
    eval_passed: /eval[_. -]?passed|eval.*pass/,
    final_report_created: /final[_. -]?report[_. -]?created|finaldeliveryreport/
  };
  return patterns[semantic]?.test(text) ?? false;
}

function detectSecretLikeContent(text: string): boolean {
  return /(sk-[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|TOKEN=|SECRET=|PASSWORD=|\.env\s*[:=])/i.test(text);
}

function producerMatches(producers: JsonRecord[], artifactType: string, agentName: string): boolean {
  return producers.some((producer) =>
    readString(producer, "artifact_type") === artifactType &&
    readString(producer, "created_by_agent_name") === agentName &&
    readString(producer, "created_by_agent_run_id").length > 0 &&
    readString(producer, "created_by_thread_id").length > 0 &&
    readString(producer, "parent_thread_id").length > 0
  );
}

function readText(path: string): string {
  const fullPath = resolve(targetRepo, path);
  return existsSync(fullPath) ? readFileSync(fullPath, "utf8") : "";
}

function readJsonObject(path: string): JsonRecord {
  const fullPath = resolve(targetRepo, path);
  if (!existsSync(fullPath)) {
    return {};
  }
  const parsed: unknown = JSON.parse(readFileSync(fullPath, "utf8"));
  if (isRecord(parsed)) {
    return parsed;
  }
  if (Array.isArray(parsed)) {
    const firstRecord = parsed.find(isRecord);
    return firstRecord ?? {};
  }
  return {};
}

function findJsonArrayRecord(path: string, predicate: (item: JsonRecord) => boolean): JsonRecord {
  return readJsonArray(path).find(predicate) ?? {};
}

function firstNonEmptyRecord(records: JsonRecord[]): JsonRecord {
  return records.find((record) => Object.keys(record).length > 0) ?? {};
}

function readRecord(input: JsonRecord, key: string): JsonRecord {
  const value = input[key];
  return isRecord(value) ? value : {};
}

function readJsonArray(path: string): JsonRecord[] {
  const fullPath = resolve(targetRepo, path);
  if (!existsSync(fullPath)) {
    return [];
  }
  const parsed: unknown = JSON.parse(readFileSync(fullPath, "utf8"));
  return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
}

function readString(input: JsonRecord, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

function readArray(input: JsonRecord, key: string): unknown[] {
  const value = input[key];
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

main();
