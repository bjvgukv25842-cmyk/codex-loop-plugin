import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { prepareM12DocsUpdateFixture } from "../../src/effectiveness/effectiveness-fixtures.ts";
import { loadM12Dataset } from "../../scripts/effectiveness/dataset.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("docs-update-001 fixture", () => {
  it("is materialized with the expected docs files", () => {
    const fixture = resolve(process.cwd(), "evals/effectiveness/fixtures/docs-update-001");

    expect(existsSync(resolve(fixture, "package.json"))).toBe(true);
    expect(existsSync(resolve(fixture, "README.md"))).toBe(true);
    expect(existsSync(resolve(fixture, "docs/API.md"))).toBe(true);
    expect(existsSync(resolve(fixture, "src/duration.js"))).toBe(true);
    expect(existsSync(resolve(fixture, "test/duration.test.js"))).toBe(true);
    expect(existsSync(resolve(fixture, "scripts/check-docs-contract.js"))).toBe(true);
  });

  it("starts with passing npm test and failing docs contract", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "docs-update-fixture-"));
    tempDirs.push(tempDir);
    cpSync(resolve(process.cwd(), "evals/effectiveness/fixtures/docs-update-001"), tempDir, { recursive: true });

    expect(() => execFileSync("npm", ["test"], { cwd: tempDir, stdio: "pipe" })).not.toThrow();
    expect(() => execFileSync("npm", ["run", "docs:contract"], { cwd: tempDir, stdio: "pipe" })).toThrow();
  });

  it("prepareM12DocsUpdateFixture resets the target repo and records docs-gap evidence", () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "docs-update-prepare-"));
    tempDirs.push(repoRoot);
    cpSync(
      resolve(process.cwd(), "evals/effectiveness/fixtures/docs-update-001"),
      resolve(repoRoot, "evals/effectiveness/fixtures/docs-update-001"),
      { recursive: true }
    );
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "docs-update-001")!;

    const paths = prepareM12DocsUpdateFixture({ testCase, variant: "treatment", repoRoot });

    expect(existsSync(resolve(paths.target_repo, "docs/API.md"))).toBe(true);
    expect(existsSync(resolve(paths.target_repo, ".git"))).toBe(true);
    expect(JSON.parse(readFileSync(resolve(paths.reports_dir, "sdk-stage-logs/dev-worker-baseline.json"), "utf8"))).toMatchObject({
      fixture_status: "DOCS_GAP_AS_EXPECTED",
      initial_tests_failed: false,
      initial_docs_contract_failed: true,
      seeded_gap_fixture_created: false
    });
  });
});
