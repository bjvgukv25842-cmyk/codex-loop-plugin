import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = resolve(process.cwd(), "scripts/sdk-orchestrated/analyze-planner-schema.ts");
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("planner schema analysis", () => {
  it("identifies full planner schema high-risk keywords and lower lite complexity", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "planner-schema-analysis-test-"));
    tempDirs.push(tempDir);
    const output = execFileSync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR: tempDir
      },
      stdio: "pipe"
    }).toString("utf8");
    const parsed = JSON.parse(output) as { schemas: Array<Record<string, unknown>> };
    const planner = parsed.schemas.find((schema) => schema.name === "schema-output-planner");
    const lite = parsed.schemas.find((schema) => schema.name === "schema-output-lite");

    expect(planner?.high_risk_keywords_present).toEqual(expect.arrayContaining(["$ref"]));
    expect(Number(planner?.complexity_score)).toBeGreaterThan(Number(lite?.complexity_score));
    expect(readFileSync(resolve(tempDir, "PlannerSchemaAnalysisReport.md"), "utf8")).toContain("Planner Schema Analysis");
  });
});
