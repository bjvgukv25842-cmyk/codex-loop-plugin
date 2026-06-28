import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type TestCoverageDevWorkerSmokeMode = "parity" | "minimal" | "exact";

export interface TestCoverageDevWorkerSmokeModeState {
  status: string;
  result_path: string;
}

export interface TestCoverageDevWorkerSmokeReadiness {
  case_id: "test-coverage-002";
  parity: TestCoverageDevWorkerSmokeModeState;
  minimal: TestCoverageDevWorkerSmokeModeState;
  exact: TestCoverageDevWorkerSmokeModeState;
  ready_for_parity: boolean;
  ready_for_minimal: boolean;
  ready_for_exact: boolean;
  ready_for_treatment_rerun: boolean;
  reconstruction_status: "PASS" | "PARTIAL" | "NOT_RUN";
}

export function testCoverageDevWorkerModeResultPath(repoRoot: string, mode: TestCoverageDevWorkerSmokeMode): string {
  return resolve(repoRoot, `evals/effectiveness/reports/test-coverage-002/dev-worker-smoke-${mode}-result.json`);
}

export function testCoverageDevWorkerSmokeReadinessPath(repoRoot: string): string {
  return resolve(repoRoot, "evals/effectiveness/reports/test-coverage-002/dev-worker-smoke-readiness.json");
}

export function reconstructTestCoverageDevWorkerSmokeReadiness(repoRoot = process.cwd(), options: { write?: boolean } = {}): TestCoverageDevWorkerSmokeReadiness {
  const parity = modeState(repoRoot, "parity");
  const minimal = modeState(repoRoot, "minimal");
  const exact = modeState(repoRoot, "exact");
  const readiness: TestCoverageDevWorkerSmokeReadiness = {
    case_id: "test-coverage-002",
    parity,
    minimal,
    exact,
    ready_for_parity: true,
    ready_for_minimal: parity.status === "PASS",
    ready_for_exact: parity.status === "PASS" && minimal.status === "PASS",
    ready_for_treatment_rerun: parity.status === "PASS" && minimal.status === "PASS" && exact.status === "PASS",
    reconstruction_status: exact.status === "PASS" ? "PASS" : parity.status === "NOT_RUN" ? "NOT_RUN" : "PARTIAL"
  };
  if (options.write) writeJson(testCoverageDevWorkerSmokeReadinessPath(repoRoot), readiness);
  return readiness;
}

export function gateTestCoverageDevWorkerSmokeMode(readiness: TestCoverageDevWorkerSmokeReadiness, mode: TestCoverageDevWorkerSmokeMode): { ok: boolean; status: string; reason: string } {
  if (mode === "parity") return { ok: true, status: "PASS", reason: "" };
  if (mode === "minimal" && !readiness.ready_for_minimal) {
    return { ok: false, status: "BLOCKED_TEST_COVERAGE_002_DEV_PARITY_NOT_PASSED", reason: "Run and pass parity before minimal." };
  }
  if (mode === "exact" && !readiness.ready_for_exact) {
    return { ok: false, status: "BLOCKED_TEST_COVERAGE_002_DEV_MINIMAL_NOT_PASSED", reason: "Run and pass minimal before exact." };
  }
  return { ok: true, status: "PASS", reason: "" };
}

export function updateTestCoverageDevWorkerSmokeReadinessFromResult(repoRoot: string, result: { mode: TestCoverageDevWorkerSmokeMode; status: string }): TestCoverageDevWorkerSmokeReadiness {
  const path = testCoverageDevWorkerModeResultPath(repoRoot, result.mode);
  writeJson(path, result);
  return reconstructTestCoverageDevWorkerSmokeReadiness(repoRoot, { write: true });
}

function modeState(repoRoot: string, mode: TestCoverageDevWorkerSmokeMode): TestCoverageDevWorkerSmokeModeState {
  const path = testCoverageDevWorkerModeResultPath(repoRoot, mode);
  const result = readJson<{ status?: unknown } | null>(path, null);
  return {
    status: typeof result?.status === "string" ? result.status : "NOT_RUN",
    result_path: path
  };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}
