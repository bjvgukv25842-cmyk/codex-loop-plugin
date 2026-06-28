import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { prepareM12FeatureFixture } from "../../src/effectiveness/effectiveness-fixtures.ts";
import { loadM12Dataset } from "../../scripts/effectiveness/dataset.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("feature-small-001 fixture", () => {
  it("is materialized with the expected project-name files", () => {
    const fixture = resolve(process.cwd(), "evals/effectiveness/fixtures/feature-small-001");

    expect(existsSync(resolve(fixture, "package.json"))).toBe(true);
    expect(existsSync(resolve(fixture, "src/project-name.js"))).toBe(true);
    expect(existsSync(resolve(fixture, "test/project-name.test.js"))).toBe(true);
  });

  it("starts with a failing npm test baseline", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "feature-small-fixture-"));
    tempDirs.push(tempDir);
    cpSync(resolve(process.cwd(), "evals/effectiveness/fixtures/feature-small-001"), tempDir, { recursive: true });

    expect(() => execFileSync("npm", ["test"], { cwd: tempDir, stdio: "pipe" })).toThrow();
  });

  it("prepareM12FeatureFixture resets the target repo and records broken baseline evidence", () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "feature-small-prepare-"));
    tempDirs.push(repoRoot);
    cpSync(
      resolve(process.cwd(), "evals/effectiveness/fixtures/feature-small-001"),
      resolve(repoRoot, "evals/effectiveness/fixtures/feature-small-001"),
      { recursive: true }
    );
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "feature-small-001")!;

    const paths = prepareM12FeatureFixture({ testCase, variant: "treatment", repoRoot });

    expect(existsSync(resolve(paths.target_repo, "src/project-name.js"))).toBe(true);
    expect(existsSync(resolve(paths.target_repo, ".git"))).toBe(true);
    expect(JSON.parse(readFileSync(resolve(paths.reports_dir, "sdk-stage-logs/dev-worker-baseline.json"), "utf8"))).toMatchObject({
      fixture_status: "BROKEN_AS_EXPECTED",
      initial_tests_failed: true,
      seeded_gap_fixture_created: false
    });
  });
});
