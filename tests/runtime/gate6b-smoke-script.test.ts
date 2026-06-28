import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = resolve(process.cwd(), "scripts/sdk-orchestrated/run-gate6b-smoke.ts");
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("Gate 6B smoke script", () => {
  it("defaults to checkpointed smoke instead of the legacy continuous run", () => {
    const output = runScript({
      CODEX_LOOP_ENABLE_REAL_SDK_RUN: undefined,
      CODEX_LOOP_GATE6B_SMOKE_MOCK: undefined
    });

    expect(output.status).toBe("BLOCKED_USE_CHECKPOINTED_SMOKE");
    expect(output.real_sdk_run_executed).toBe(false);
  });

  it("blocks the dry-run at planner smoke when parity passed but planner slices did not", () => {
    const output = runScript({
      CODEX_LOOP_ENABLE_LEGACY_GATE6B_SMOKE: "1",
      CODEX_LOOP_ENABLE_REAL_SDK_RUN: undefined,
      CODEX_LOOP_GATE6B_SMOKE_MOCK: undefined,
      CODEX_LOOP_CODEX_MODEL: "gpt-test",
      CODEX_LOOP_MODEL_CATALOG_JSON: "package.json"
    }, { writeParityPass: true });

    expect(output.status).toBe("BLOCKED_PLANNER_LITE_SMOKE_NOT_PASSED");
    expect(output.real_sdk_run_executed).toBe(false);
  });

  it("blocks the dry-run when planner passed but dev worker smoke slices did not", () => {
    const output = runScript({
      CODEX_LOOP_ENABLE_LEGACY_GATE6B_SMOKE: "1",
      CODEX_LOOP_ENABLE_REAL_SDK_RUN: undefined,
      CODEX_LOOP_GATE6B_SMOKE_MOCK: undefined,
      CODEX_LOOP_CODEX_MODEL: "gpt-test",
      CODEX_LOOP_MODEL_CATALOG_JSON: "package.json"
    }, { writeParityPass: true, writePlannerPass: true });

    expect(output.status).toBe("BLOCKED_DEV_WORKER_SMOKE_NOT_PASSED");
    expect(output.failure_category).toBe("BLOCKED_DEV_WORKER_SMOKE_NOT_PASSED");
    expect(output.real_sdk_run_executed).toBe(false);
    expect(output.dev_worker_thread_started).toBe(false);
    expect(output.evaluator_thread_started).toBe(false);
  });

  it("can PASS through the mock SDK path without starting a real SDK run", () => {
    const output = runScript({
      CODEX_LOOP_ENABLE_LEGACY_GATE6B_SMOKE: "1",
      CODEX_LOOP_ENABLE_REAL_SDK_RUN: "1",
      CODEX_LOOP_GATE6B_SMOKE_MOCK: "pass"
    }, { writeParityPass: true, writePlannerPass: true, writeDevWorkerPass: true });

    expect(output.status).toBe("PASS");
    expect(output.real_sdk_run_executed).toBe(false);
    expect(output.planner_thread_started).toBe(true);
    expect(output.dev_worker_thread_started).toBe(true);
    expect(output.evaluator_thread_started).toBe(true);
    expect(output.tests_passed).toBe(true);
    expect(output.eval_verdict).toBe("PASS");
  });

  it("does not require schema-output-planner PASS when planner-lite passed", () => {
    const output = runScript(
      {
        CODEX_LOOP_ENABLE_LEGACY_GATE6B_SMOKE: "1",
        CODEX_LOOP_ENABLE_REAL_SDK_RUN: "1",
        CODEX_LOOP_GATE6B_SMOKE_MOCK: "pass"
      },
      {
        writeParityPass: true,
        writePlannerPass: true,
        writeDevWorkerPass: true,
        writePlannerSchemaFailure: true
      }
    );

    expect(output.status).toBe("PASS");
    expect(output.real_sdk_run_executed).toBe(false);
  });

  it("fails the mock SDK path when thread_id is missing", () => {
    const output = runScript({
      CODEX_LOOP_ENABLE_LEGACY_GATE6B_SMOKE: "1",
      CODEX_LOOP_ENABLE_REAL_SDK_RUN: "1",
      CODEX_LOOP_GATE6B_SMOKE_MOCK: "missing-thread"
    }, { writeParityPass: true, writePlannerPass: true, writeDevWorkerPass: true });

    expect(output.status).toBe("THREAD_ID_MISSING");
    expect(output.failure_category).toBe("THREAD_ID_MISSING");
  });

  it("does not PASS when evaluator verdict is NEEDS_REVISION", () => {
    const output = runScript({
      CODEX_LOOP_ENABLE_LEGACY_GATE6B_SMOKE: "1",
      CODEX_LOOP_ENABLE_REAL_SDK_RUN: "1",
      CODEX_LOOP_GATE6B_SMOKE_MOCK: "needs-revision"
    }, { writeParityPass: true, writePlannerPass: true, writeDevWorkerPass: true });

    expect(output.status).toBe("FAIL");
    expect(output.failure_category).toBe("EVAL_VERDICT_NOT_PASS");
  });
});

function runScript(
  overrides: Record<string, string | undefined>,
  options: { writeParityPass?: boolean; writePlannerPass?: boolean; writeDevWorkerPass?: boolean; writePlannerSchemaFailure?: boolean } = {}
): Record<string, unknown> {
  const env = { ...process.env };
  const tempDir = mkdtempSync(resolve(tmpdir(), "gate6b-smoke-test-"));
  tempDirs.push(tempDir);
  const resultPath = resolve(tempDir, "result.json");
  const parityResultPath = resolve(tempDir, "sdk-parity-result.json");
  const triageDir = resolve(tempDir, "sdk-startup-triage");
  const targetRepo = resolve(tempDir, "target-repo");
  env.CODEX_LOOP_GATE6B_SMOKE_RESULT_PATH = resultPath;
  env.CODEX_LOOP_SDK_PARITY_RESULT_PATH = parityResultPath;
  env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR = triageDir;
  env.CODEX_LOOP_GATE6B_SMOKE_TARGET_REPO = targetRepo;
  if (options.writeParityPass) {
    writeFileSync(
      parityResultPath,
      `${JSON.stringify(
        {
          status: "PASS",
          sdk_thread_started: true,
          sdk_thread_id: "thread_sdk_parity_mock",
          final_response_contains_expected: true
        },
        null,
        2
      )}\n`,
      "utf8"
    );
  }
  if (options.writePlannerPass) {
    mkdirSync(triageDir, { recursive: true });
    for (const mode of ["parity-as-planner", "minimal", "schema-text-only", "schema-output-minimal", "schema-output-lite"]) {
      writeFileSync(
        resolve(triageDir, `planner-smoke-${mode}-result.json`),
        `${JSON.stringify(
          {
            status: "PASS",
            planner_thread_started: true,
            planner_thread_id: `thread_planner_${mode}`
          },
          null,
          2
        )}\n`,
        "utf8"
      );
    }
    if (options.writePlannerSchemaFailure) {
      writeFileSync(
        resolve(triageDir, "planner-smoke-schema-output-planner-result.json"),
        `${JSON.stringify(
          {
            status: "PLANNER_SCHEMA_TOO_COMPLEX_FOR_OUTPUT_SCHEMA",
            planner_thread_started: false,
            planner_thread_id: "",
            failure_category: "PLANNER_SCHEMA_TOO_COMPLEX_FOR_OUTPUT_SCHEMA"
          },
          null,
          2
        )}\n`,
        "utf8"
      );
    }
  }
  if (options.writeDevWorkerPass) {
    mkdirSync(triageDir, { recursive: true });
    const baseDevWorkerPass = {
      status: "PASS",
      dev_worker_thread_started: true,
      dev_worker_thread_id: "thread_dev_worker_mock",
      file_change_verified: true,
      tests_passed: true,
      initial_tests_failed: true,
      structured_output_valid: true,
      final_response_contains_expected: true,
      dev_worker_stage_shared: true,
      dev_worker_stage_impl: "runDevWorkerStage"
    };
    for (const mode of ["parity", "minimal-fix", "output-lite"]) {
      writeFileSync(
        resolve(triageDir, `dev-worker-smoke-${mode}-result.json`),
        `${JSON.stringify(
          {
            ...baseDevWorkerPass,
            mode
          },
          null,
          2
        )}\n`,
        "utf8"
      );
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  writeSmokeTarget(targetRepo);
  if (options.writeDevWorkerPass) {
    writeDevWorkerBaseline(targetRepo, triageDir);
  }
  try {
    execFileSync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env,
      stdio: "pipe"
    });
  } catch {
    // Some negative smoke cases intentionally exit non-zero after writing the result artifact.
  }
  return JSON.parse(readFileSync(resultPath, "utf8")) as Record<string, unknown>;
}

function writeSmokeTarget(targetRepo: string): void {
  writeTarget(targetRepo, "package.json", JSON.stringify({ type: "module", scripts: { test: "node --test" } }, null, 2));
  writeTarget(targetRepo, "src/project-name.js", "export function validateProjectName(name) {\n  return { ok: true };\n}\n");
  writeTarget(
    targetRepo,
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
}

function writeTarget(root: string, path: string, value: string): void {
  const absolute = resolve(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, "utf8");
}

function writeDevWorkerBaseline(targetRepo: string, triageDir: string): void {
  writeTarget(
    triageDir,
    "dev-worker-baseline.json",
    `${JSON.stringify(
      {
        target_repo: targetRepo,
        src_project_name_hash_before: hashFile(resolve(targetRepo, "src/project-name.js")),
        package_json_hash_before: hashFile(resolve(targetRepo, "package.json")),
        test_project_name_hash_before: hashFile(resolve(targetRepo, "test/project-name.test.js")),
        initial_tests_run: true,
        initial_tests_expected_to_fail: true,
        initial_tests_failed: true,
        fixture_status: "BROKEN_AS_EXPECTED"
      },
      null,
      2
    )}\n`
  );
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
