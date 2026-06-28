import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = process.cwd();
const targetRepo = process.env.CODEX_LOOP_GATE6B_SMOKE_TARGET_REPO
  ? resolve(process.env.CODEX_LOOP_GATE6B_SMOKE_TARGET_REPO)
  : resolve(repoRoot, "tmp/sdk-orchestrated/gate6b-smoke-target");
const casePath = resolve(repoRoot, "evals/sdk-orchestrated/smoke/gate6b-smoke-case.json");

function main(): void {
  writeJson(casePath, {
    case_id: "gate6b-smoke-validate-project-name",
    gate: "Gate 6B.1 SDK-Orchestrated Smoke Harness",
    target_repo: "tmp/sdk-orchestrated/gate6b-smoke-target",
    loop_run_id: "loop_gate6b_smoke",
    task_id: "task_validate_project_name",
    max_sdk_threads: 3,
    max_retries: 0,
    thread_timeout_ms: 180000,
    roles: [
      {
        role: "planner",
        sandbox: "read-only",
        writes_files_directly: false,
        expected_artifacts: ["docs/PRD.md", "docs/TASK_GRAPH.json"]
      },
      {
        role: "dev_worker",
        sandbox: "workspace-write",
        expected_file_changes: ["src/project-name.js"],
        validation_commands: ["npm test"],
        expected_artifacts: ["artifacts/dev-result.json"]
      },
      {
        role: "evaluator",
        sandbox: "read-only",
        expected_artifacts: ["artifacts/eval-report.json"]
      }
    ],
    acceptance_criteria: [
      "validateProjectName(\"\").ok is false",
      "validateProjectName(\"   \").ok is false",
      "validateProjectName(\"x\" repeated 81 times).ok is false",
      "validateProjectName(\"My Project\").ok is true"
    ],
    non_goals: [
      "No repair loop in Gate 6B.1",
      "No final evaluator thread in Gate 6B.1",
      "No context distiller thread in Gate 6B.1",
      "No M12 effectiveness evaluation"
    ]
  });

  writeTargetFile("package.json", {
    name: "gate6b-smoke-target",
    version: "0.0.0",
    type: "module",
    scripts: {
      test: "node --test",
      validate: "node --test"
    }
  });
  writeTargetText(
    "README.md",
    [
      "# Gate 6B Smoke Target",
      "",
      "Isolated target repository for SDK-Orchestrated smoke validation.",
      "The initial implementation is intentionally broken."
    ].join("\n")
  );
  writeTargetText(
    "src/project-name.js",
    [
      "export function validateProjectName(name) {",
      "  return { ok: true };",
      "}",
      ""
    ].join("\n")
  );
  writeTargetText(
    "test/project-name.test.js",
    [
      "import test from \"node:test\";",
      "import assert from \"node:assert/strict\";",
      "import { validateProjectName } from \"../src/project-name.js\";",
      "",
      "test(\"rejects empty string\", () => {",
      "  assert.equal(validateProjectName(\"\").ok, false);",
      "});",
      "",
      "test(\"rejects whitespace-only string\", () => {",
      "  assert.equal(validateProjectName(\"   \").ok, false);",
      "});",
      "",
      "test(\"rejects names longer than 80 characters\", () => {",
      "  assert.equal(validateProjectName(\"x\".repeat(81)).ok, false);",
      "});",
      "",
      "test(\"accepts valid project names\", () => {",
      "  assert.equal(validateProjectName(\"My Project\").ok, true);",
      "});",
      ""
    ].join("\n")
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "PASS",
        target_repo: "tmp/sdk-orchestrated/gate6b-smoke-target",
        case_file: "evals/sdk-orchestrated/smoke/gate6b-smoke-case.json",
        real_sdk_run_executed: false
      },
      null,
      2
    )}\n`
  );
}

function writeTargetFile(path: string, value: unknown): void {
  writeTargetText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeTargetText(path: string, value: string): void {
  const absolutePath = resolve(targetRepo, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, value, "utf8");
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

main();
