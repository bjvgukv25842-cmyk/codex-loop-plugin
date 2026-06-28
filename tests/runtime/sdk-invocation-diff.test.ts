import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = resolve(process.cwd(), "scripts/sdk-orchestrated/diff-sdk-invocations.ts");
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("SDK invocation diff", () => {
  it("detects workingDirectory, model catalog, output schema, and prompt differences", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "sdk-invocation-diff-test-"));
    tempDirs.push(tempDir);
    const triageDir = resolve(tempDir, "sdk-startup-triage");
    mkdirSync(triageDir, { recursive: true });
    writeTrace(resolve(triageDir, "sdk-invocation-trace-redacted.json"), trace({ target: "/tmp/a", catalog: "/tmp/catalog-a.json", schemaHash: "", prompt: "short" }));
    writeTrace(resolve(triageDir, "gate6b-smoke-planner-invocation-trace-redacted.json"), trace({ target: "/tmp/b", catalog: "/tmp/catalog-b.json", schemaHash: "schema-b", prompt: "longer planner prompt" }));
    writeTrace(resolve(triageDir, "planner-smoke-minimal-invocation-trace-redacted.json"), trace({ target: "/tmp/a", catalog: "/tmp/catalog-a.json", schemaHash: "", prompt: "short" }));

    execFileSync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR: triageDir
      },
      stdio: "pipe"
    });

    const result = JSON.parse(readFileSync(resolve(triageDir, "sdk-invocation-diff.json"), "utf8")) as {
      status: string;
      differences: Array<{ field: string }>;
    };
    const fields = result.differences.map((difference) => difference.field);
    expect(result.status).toBe("SDK_INVOCATION_DIFF_DETECTED");
    expect(fields).toContain("workingDirectory");
    expect(fields).toContain("model_catalog_json");
    expect(fields).toContain("usesOutputSchema");
    expect(fields).toContain("outputSchemaHash");
    expect(fields).toContain("prompt_length");
    expect(fields).toContain("prompt_hash");
  });
});

function trace(input: { target: string; catalog: string; schemaHash: string; prompt: string }): Record<string, unknown> {
  return {
    trace_label: "test",
    node_process_cwd: process.cwd(),
    target_repo: input.target,
    constructor_options: {
      env_keys: ["CODEX_SQLITE_HOME"],
      config_keys: ["model", "model_catalog_json", "sqlite_home"],
      config_values_redacted: {
        sqlite_home: "/tmp/sqlite",
        model_catalog_json: input.catalog,
        model: "gpt-test"
      }
    },
    start_thread_options: {
      workingDirectory: input.target,
      skipGitRepoCheck: false,
      sandboxMode: "read-only",
      model: "gpt-test"
    },
    run_options: {
      usesOutputSchema: Boolean(input.schemaHash),
      outputSchemaPath: input.schemaHash ? "/tmp/schema.json" : "",
      outputSchemaHash: input.schemaHash,
      usesRunStreamed: true
    },
    prompt: {
      length: input.prompt.length,
      hash: createHash("sha256").update(input.prompt).digest("hex")
    },
    sdk_api_method: "runStreamed",
    error_capture_paths: {}
  };
}

function writeTrace(path: string, value: Record<string, unknown>): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
