import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  createSdkCheckpointState,
  DEFAULT_SDK_CHECKPOINT_STATE_PATH,
  writeSdkCheckpointState
} from "../../src/orchestrator/sdk-checkpoint-state.ts";

const repoRoot = process.cwd();
const targetRepo = process.env.CODEX_LOOP_GATE6B_SMOKE_TARGET_REPO
  ? resolve(process.env.CODEX_LOOP_GATE6B_SMOKE_TARGET_REPO)
  : resolve(repoRoot, "tmp/sdk-orchestrated/gate6b-smoke-target");
const statePath = process.env.CODEX_LOOP_GATE6B_CHECKPOINT_STATE_PATH
  ? resolve(process.env.CODEX_LOOP_GATE6B_CHECKPOINT_STATE_PATH)
  : resolve(repoRoot, DEFAULT_SDK_CHECKPOINT_STATE_PATH);

function main(): void {
  writeTargetFile("package.json", {
    name: "gate6b-smoke-target",
    version: "0.0.0",
    type: "module",
    scripts: {
      test: "node --test",
      validate: "node --test"
    }
  });
  writeTargetText("README.md", "# Gate 6B Checkpoint Smoke Target\n\nIsolated SDK checkpoint validation target.\n");
  writeTargetText("src/project-name.js", "export function validateProjectName(name) {\n  return { ok: true };\n}\n");
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

  const state = createSdkCheckpointState("tmp/sdk-orchestrated/gate6b-smoke-target");
  writeSdkCheckpointState(state, statePath);
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "PASS",
        checkpoint_state_created: true,
        current_stage: state.current_stage,
        target_repo: state.target_repo,
        state_path: relativeStatePath(),
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

function relativeStatePath(): string {
  return statePath.startsWith(repoRoot) ? statePath.slice(repoRoot.length + 1) : statePath;
}

main();
