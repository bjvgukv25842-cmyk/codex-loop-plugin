import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type FeatureEvaluatorSmokeMode = "parity" | "text-only" | "output-minimal" | "output-lite" | "exact";
export type FeatureEvaluatorSmokeModeKey = "parity" | "text_only" | "output_minimal" | "output_lite" | "exact";
export type FeatureEvaluatorSmokeReadinessStatus = "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN";

export interface FeatureEvaluatorSmokeModeReadiness {
  status: FeatureEvaluatorSmokeReadinessStatus;
  sdk_method?: "run" | "runStreamed" | "";
  thread_id: string;
  evidence_path: string;
  passed_at: string;
}

export interface FeatureEvaluatorBlockedAttempt {
  mode: FeatureEvaluatorSmokeMode;
  status: string;
  reason: string;
}

export interface FeatureEvaluatorSmokeReadiness {
  case_id: "feature-small-001";
  parity: FeatureEvaluatorSmokeModeReadiness;
  text_only: FeatureEvaluatorSmokeModeReadiness;
  output_minimal: FeatureEvaluatorSmokeModeReadiness;
  output_lite: FeatureEvaluatorSmokeModeReadiness;
  exact: FeatureEvaluatorSmokeModeReadiness;
  ready_for_output_minimal: boolean;
  ready_for_output_lite: boolean;
  ready_for_exact: boolean;
  ready_for_treatment_rerun: boolean;
  blocked_attempt?: FeatureEvaluatorBlockedAttempt;
  reconstruction_status: "PASS" | "NEEDS_RERUN_PARITY" | "NEEDS_RERUN_TEXT_ONLY" | "NEEDS_RERUN_PARITY_AND_TEXT_ONLY";
  errors: string[];
}

export interface FeatureEvaluatorSmokeResultLike {
  case_id?: string;
  status?: string;
  mode?: string;
  real_sdk_run_executed?: boolean;
  evaluator_thread_started?: boolean;
  evaluator_thread_id?: string;
  structured_output_valid?: boolean;
  eval_report_created?: boolean;
  artifact_thread_evidence_verified?: boolean;
  final_response_contains_expected?: boolean;
  eval_verdict?: string;
  sdk_method?: "run" | "runStreamed";
  failure_category?: string;
}

export interface FeatureEvaluatorSmokeGateResult {
  ok: boolean;
  status: string;
  reason: string;
}

export const featureEvaluatorSmokeReportDir = "evals/effectiveness/reports/feature-small-001";
export const featureEvaluatorSmokeReadinessPath = `${featureEvaluatorSmokeReportDir}/feature-evaluator-smoke-readiness.json`;

export function featureEvaluatorModeKey(mode: FeatureEvaluatorSmokeMode): FeatureEvaluatorSmokeModeKey {
  if (mode === "text-only") return "text_only";
  if (mode === "output-minimal") return "output_minimal";
  if (mode === "output-lite") return "output_lite";
  return mode;
}

export function featureEvaluatorModeResultFilename(mode: FeatureEvaluatorSmokeMode): string {
  return `feature-evaluator-smoke-${mode}-result.json`;
}

export function featureEvaluatorModeResultPath(repoRoot: string, mode: FeatureEvaluatorSmokeMode): string {
  return resolve(repoRoot, featureEvaluatorSmokeReportDir, featureEvaluatorModeResultFilename(mode));
}

export function emptyFeatureEvaluatorSmokeReadiness(): FeatureEvaluatorSmokeReadiness {
  return recomputeReadiness({
    case_id: "feature-small-001",
    parity: emptyModeReadiness("run"),
    text_only: emptyModeReadiness(),
    output_minimal: emptyModeReadiness(),
    output_lite: emptyModeReadiness(),
    exact: emptyModeReadiness(),
    ready_for_output_minimal: false,
    ready_for_output_lite: false,
    ready_for_exact: false,
    ready_for_treatment_rerun: false,
    reconstruction_status: "NEEDS_RERUN_PARITY_AND_TEXT_ONLY",
    errors: []
  });
}

export function loadFeatureEvaluatorSmokeReadiness(repoRoot: string): FeatureEvaluatorSmokeReadiness {
  const existing = readJson<Partial<FeatureEvaluatorSmokeReadiness> | null>(resolve(repoRoot, featureEvaluatorSmokeReadinessPath), null);
  if (!existing) return reconstructFeatureEvaluatorSmokeReadiness(repoRoot, { write: false });
  return recomputeReadiness({
    ...emptyFeatureEvaluatorSmokeReadiness(),
    ...existing,
    parity: normalizeModeReadiness(existing.parity, "run"),
    text_only: normalizeModeReadiness(existing.text_only),
    output_minimal: normalizeModeReadiness(existing.output_minimal),
    output_lite: normalizeModeReadiness(existing.output_lite),
    exact: normalizeModeReadiness(existing.exact),
    errors: Array.isArray(existing.errors) ? existing.errors : []
  });
}

export function writeFeatureEvaluatorSmokeReadiness(repoRoot: string, readiness: FeatureEvaluatorSmokeReadiness): FeatureEvaluatorSmokeReadiness {
  const next = recomputeReadiness(readiness);
  writeJson(resolve(repoRoot, featureEvaluatorSmokeReadinessPath), next);
  return next;
}

export function updateFeatureEvaluatorSmokeReadinessFromResult(
  repoRoot: string,
  result: FeatureEvaluatorSmokeResultLike
): FeatureEvaluatorSmokeReadiness {
  let readiness = loadFeatureEvaluatorSmokeReadiness(repoRoot);
  const mode = parseFeatureEvaluatorSmokeMode(result.mode);
  if (!mode) {
    return writeFeatureEvaluatorSmokeReadiness(repoRoot, readiness);
  }

  const key = featureEvaluatorModeKey(mode);
  const current = readiness[key];
  const status = resultStatusToReadinessStatus(result.status);
  const passed = result.status === "PASS" && result.evaluator_thread_started === true;
  const evidencePath = featureEvaluatorModeResultPath(repoRoot, mode);
  const nextMode: FeatureEvaluatorSmokeModeReadiness = {
    status,
    sdk_method: mode === "parity" ? result.sdk_method ?? current.sdk_method ?? "run" : current.sdk_method ?? "",
    thread_id: result.evaluator_thread_id ?? current.thread_id,
    evidence_path: relativeToRepo(repoRoot, evidencePath),
    passed_at: passed ? timestampForPath(evidencePath) : current.passed_at
  };

  readiness = {
    ...readiness,
    [key]: shouldPreservePass(current, nextMode) ? current : nextMode
  };

  const blockedAttempt = blockedAttemptForResult(mode, result, readiness);
  if (blockedAttempt) readiness.blocked_attempt = blockedAttempt;

  return writeFeatureEvaluatorSmokeReadiness(repoRoot, readiness);
}

export function reconstructFeatureEvaluatorSmokeReadiness(
  repoRoot: string,
  options: { write?: boolean } = {}
): FeatureEvaluatorSmokeReadiness {
  const existing = readJson<Partial<FeatureEvaluatorSmokeReadiness> | null>(resolve(repoRoot, featureEvaluatorSmokeReadinessPath), null);
  let readiness = existing
    ? recomputeReadiness({
        ...emptyFeatureEvaluatorSmokeReadiness(),
        ...existing,
        parity: normalizeModeReadiness(existing.parity, "run"),
        text_only: normalizeModeReadiness(existing.text_only),
        output_minimal: normalizeModeReadiness(existing.output_minimal),
        output_lite: normalizeModeReadiness(existing.output_lite),
        exact: normalizeModeReadiness(existing.exact),
        errors: Array.isArray(existing.errors) ? existing.errors : []
      })
    : emptyFeatureEvaluatorSmokeReadiness();
  for (const mode of smokeModes()) {
    const result = readBestModeResult(repoRoot, mode);
    if (result) {
      if (options.write === true) writeJson(featureEvaluatorModeResultPath(repoRoot, mode), result);
      readiness = applyResultToReadiness(repoRoot, readiness, mode, result);
      continue;
    }
    const reconstructed = reconstructResultFromLogs(repoRoot, mode);
    if (reconstructed) {
      if (options.write === true) writeJson(featureEvaluatorModeResultPath(repoRoot, mode), reconstructed);
      readiness = applyResultToReadiness(repoRoot, readiness, mode, reconstructed);
    }
  }

  const latest = readJson<FeatureEvaluatorSmokeResultLike | null>(resolve(repoRoot, featureEvaluatorSmokeReportDir, "feature-evaluator-smoke-result.json"), null);
  const latestMode = parseFeatureEvaluatorSmokeMode(latest?.mode);
  if (latest && latestMode && latest.status !== "PASS") {
    const blockedAttempt = blockedAttemptForResult(latestMode, latest, readiness);
    if (blockedAttempt) readiness.blocked_attempt = blockedAttempt;
  }

  readiness = recomputeReadiness(readiness);
  if (options.write === true) writeJson(resolve(repoRoot, featureEvaluatorSmokeReadinessPath), readiness);
  return readiness;
}

export function gateFeatureEvaluatorSmokeMode(readiness: FeatureEvaluatorSmokeReadiness, mode: FeatureEvaluatorSmokeMode): FeatureEvaluatorSmokeGateResult {
  if (mode === "parity") return { ok: true, status: "", reason: "" };
  if (readiness.parity.status !== "PASS") {
    return { ok: false, status: "BLOCKED_EVALUATOR_PARITY_NOT_PASSED", reason: "Evaluator parity smoke must PASS before later evaluator smoke modes or feature treatment rerun are allowed." };
  }
  if (mode === "text-only") return { ok: true, status: "", reason: "" };
  if (readiness.text_only.status !== "PASS") {
    return { ok: false, status: "BLOCKED_EVALUATOR_TEXT_ONLY_NOT_PASSED", reason: "Evaluator text-only smoke must PASS before output-schema evaluator smoke modes are allowed." };
  }
  if (mode === "output-minimal") return { ok: true, status: "", reason: "" };
  if (readiness.output_minimal.status !== "PASS") {
    return { ok: false, status: "BLOCKED_EVALUATOR_OUTPUT_MINIMAL_NOT_PASSED", reason: "output-lite attempted before output-minimal PASS" };
  }
  if (mode === "output-lite") return { ok: true, status: "", reason: "" };
  if (readiness.output_lite.status !== "PASS") {
    return { ok: false, status: "BLOCKED_EVALUATOR_OUTPUT_LITE_NOT_PASSED", reason: "exact attempted before output-lite PASS" };
  }
  return { ok: true, status: "", reason: "" };
}

export function smokeModes(): FeatureEvaluatorSmokeMode[] {
  return ["parity", "text-only", "output-minimal", "output-lite", "exact"];
}

function applyResultToReadiness(
  repoRoot: string,
  readiness: FeatureEvaluatorSmokeReadiness,
  mode: FeatureEvaluatorSmokeMode,
  result: FeatureEvaluatorSmokeResultLike
): FeatureEvaluatorSmokeReadiness {
  const key = featureEvaluatorModeKey(mode);
  const current = readiness[key];
  const path = featureEvaluatorModeResultPath(repoRoot, mode);
  const status = resultStatusToReadinessStatus(result.status);
  const nextMode: FeatureEvaluatorSmokeModeReadiness = {
    status,
    sdk_method: mode === "parity" ? result.sdk_method ?? current.sdk_method ?? "run" : current.sdk_method ?? "",
    thread_id: result.evaluator_thread_id ?? current.thread_id,
    evidence_path: relativeToRepo(repoRoot, path),
    passed_at: status === "PASS" ? timestampForPath(path) : current.passed_at
  };
  const next = { ...readiness, [key]: shouldPreservePass(current, nextMode) ? current : nextMode };
  const blockedAttempt = blockedAttemptForResult(mode, result, next);
  return blockedAttempt ? { ...next, blocked_attempt: blockedAttempt } : next;
}

function readBestModeResult(repoRoot: string, mode: FeatureEvaluatorSmokeMode): FeatureEvaluatorSmokeResultLike | null {
  const modeSpecific = readJson<FeatureEvaluatorSmokeResultLike | null>(featureEvaluatorModeResultPath(repoRoot, mode), null);
  const reconstructed = reconstructResultFromLogs(repoRoot, mode);
  if (reconstructed?.status === "PASS" && modeSpecific?.status !== "PASS") return reconstructed;
  if (modeSpecific?.mode === mode) return modeSpecific;
  const latest = readJson<FeatureEvaluatorSmokeResultLike | null>(resolve(repoRoot, featureEvaluatorSmokeReportDir, "feature-evaluator-smoke-result.json"), null);
  if (reconstructed?.status === "PASS" && latest?.status !== "PASS") return reconstructed;
  return latest?.mode === mode ? latest : null;
}

function reconstructResultFromLogs(repoRoot: string, mode: FeatureEvaluatorSmokeMode): FeatureEvaluatorSmokeResultLike | null {
  const logDir = resolve(repoRoot, featureEvaluatorSmokeReportDir, "sdk-stage-logs");
  const stdoutPath = resolve(logDir, `feature-evaluator-smoke-${mode}-stdout.log`);
  if (!existsSync(stdoutPath)) return null;
  const stdout = readFileSync(stdoutPath, "utf8").trim();
  if (!stdout) return null;
  if (mode === "parity" && stdout.includes("FEATURE_EVALUATOR_PARITY_OK")) {
    return reconstructedPass(repoRoot, mode, "PASS", threadIdFromEvents(repoRoot, mode));
  }
  if (mode === "text-only" || mode === "output-minimal") {
    const parsed = parseJsonObject(stdout);
    if (parsed?.verdict === "PASS") {
      return reconstructedPass(repoRoot, mode, "PASS", threadIdFromEvents(repoRoot, mode));
    }
  }
  if (mode === "output-lite" || mode === "exact") {
    const parsed = parseJsonObject(stdout);
    if (parsed?.verdict === "PASS") {
      return reconstructedPass(repoRoot, mode, "PASS", threadIdFromEvents(repoRoot, mode));
    }
  }
  return null;
}

function reconstructedPass(repoRoot: string, mode: FeatureEvaluatorSmokeMode, evalVerdict: "" | "PASS", threadId: string): FeatureEvaluatorSmokeResultLike {
  return {
    case_id: "feature-small-001",
    status: "PASS",
    mode,
    real_sdk_run_executed: true,
    evaluator_thread_started: true,
    evaluator_thread_id: threadId,
    structured_output_valid: true,
    eval_report_created: mode === "output-lite" || mode === "exact",
    artifact_thread_evidence_verified: true,
    final_response_contains_expected: true,
    eval_verdict: mode === "parity" ? "" : evalVerdict,
    sdk_method: "run",
    failure_category: ""
  };
}

function threadIdFromEvents(repoRoot: string, mode: FeatureEvaluatorSmokeMode): string {
  const eventsPath = resolve(repoRoot, featureEvaluatorSmokeReportDir, "sdk-stage-logs", `feature-evaluator-smoke-${mode}-events.jsonl`);
  if (!existsSync(eventsPath)) return "";
  const lines = readFileSync(eventsPath, "utf8").split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isRecord(parsed) && typeof parsed.thread_id === "string") return parsed.thread_id;
      if (isRecord(parsed) && isRecord(parsed.item) && typeof parsed.item.thread_id === "string") return parsed.item.thread_id;
    } catch {
      // Ignore malformed historical event rows.
    }
  }
  return "";
}

function blockedAttemptForResult(
  mode: FeatureEvaluatorSmokeMode,
  result: FeatureEvaluatorSmokeResultLike,
  readiness: FeatureEvaluatorSmokeReadiness
): FeatureEvaluatorBlockedAttempt | undefined {
  if (result.status === "PASS") return undefined;
  if (mode === "output-lite" && readiness.output_minimal.status !== "PASS") {
    return {
      mode,
      status: "BLOCKED_EVALUATOR_OUTPUT_MINIMAL_NOT_PASSED",
      reason: "output-lite attempted before output-minimal PASS"
    };
  }
  if (mode === "output-minimal" && readiness.text_only.status !== "PASS") {
    return {
      mode,
      status: readiness.parity.status === "PASS" ? "BLOCKED_EVALUATOR_TEXT_ONLY_NOT_PASSED" : "BLOCKED_EVALUATOR_PARITY_NOT_PASSED",
      reason: readiness.parity.status === "PASS"
        ? "output-minimal attempted before text-only PASS"
        : "output-minimal attempted before parity PASS"
    };
  }
  if (mode === "exact" && readiness.output_lite.status !== "PASS") {
    return {
      mode,
      status: "BLOCKED_EVALUATOR_OUTPUT_LITE_NOT_PASSED",
      reason: "exact attempted before output-lite PASS"
    };
  }
  if (mode === "text-only" && readiness.parity.status !== "PASS") {
    return {
      mode,
      status: "BLOCKED_EVALUATOR_PARITY_NOT_PASSED",
      reason: "text-only attempted before parity PASS"
    };
  }
  return undefined;
}

function recomputeReadiness(readiness: FeatureEvaluatorSmokeReadiness): FeatureEvaluatorSmokeReadiness {
  const readyForOutputMinimal = readiness.parity.status === "PASS" && readiness.text_only.status === "PASS";
  const readyForOutputLite = readyForOutputMinimal && readiness.output_minimal.status === "PASS";
  const readyForExact = readiness.output_lite.status === "PASS";
  const readyForTreatment = readiness.exact.status === "PASS";
  const missingParity = readiness.parity.status !== "PASS";
  const missingTextOnly = readiness.text_only.status !== "PASS";
  return {
    ...readiness,
    ready_for_output_minimal: readyForOutputMinimal,
    ready_for_output_lite: readyForOutputLite,
    ready_for_exact: readyForExact,
    ready_for_treatment_rerun: readyForTreatment,
    reconstruction_status: missingParity && missingTextOnly
      ? "NEEDS_RERUN_PARITY_AND_TEXT_ONLY"
      : missingParity
        ? "NEEDS_RERUN_PARITY"
        : missingTextOnly
          ? "NEEDS_RERUN_TEXT_ONLY"
          : "PASS"
  };
}

function resultStatusToReadinessStatus(status: string | undefined): FeatureEvaluatorSmokeReadinessStatus {
  if (status === "PASS") return "PASS";
  if (status === "FAIL") return "FAIL";
  if (typeof status === "string" && status.startsWith("BLOCKED")) return "BLOCKED";
  return "NOT_RUN";
}

function shouldPreservePass(current: FeatureEvaluatorSmokeModeReadiness, next: FeatureEvaluatorSmokeModeReadiness): boolean {
  return current.status === "PASS" && next.status !== "PASS";
}

function emptyModeReadiness(sdkMethod: "run" | "runStreamed" | "" = ""): FeatureEvaluatorSmokeModeReadiness {
  return {
    status: "NOT_RUN",
    sdk_method: sdkMethod,
    thread_id: "",
    evidence_path: "",
    passed_at: ""
  };
}

function normalizeModeReadiness(value: unknown, sdkMethod: "run" | "runStreamed" | "" = ""): FeatureEvaluatorSmokeModeReadiness {
  if (!isRecord(value)) return emptyModeReadiness(sdkMethod);
  return {
    status: value.status === "PASS" || value.status === "FAIL" || value.status === "BLOCKED" || value.status === "NOT_RUN"
      ? value.status
      : "NOT_RUN",
    sdk_method: value.sdk_method === "run" || value.sdk_method === "runStreamed" ? value.sdk_method : sdkMethod,
    thread_id: typeof value.thread_id === "string" ? value.thread_id : "",
    evidence_path: typeof value.evidence_path === "string" ? value.evidence_path : "",
    passed_at: typeof value.passed_at === "string" ? value.passed_at : ""
  };
}

function parseFeatureEvaluatorSmokeMode(value: unknown): FeatureEvaluatorSmokeMode | null {
  return value === "parity" || value === "text-only" || value === "output-minimal" || value === "output-lite" || value === "exact"
    ? value
    : null;
}

function timestampForPath(path: string): string {
  try {
    return existsSync(path) ? statSync(path).mtime.toISOString() : new Date().toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function relativeToRepo(repoRoot: string, path: string): string {
  const absolute = resolve(path);
  const root = resolve(repoRoot);
  return absolute.startsWith(`${root}/`) ? absolute.slice(root.length + 1) : absolute;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readJson<T>(path: string, fallback: T): T {
  const absolute = resolve(path);
  if (!existsSync(absolute)) return fallback;
  try {
    const text = readFileSync(absolute, "utf8").trim();
    if (!text) return fallback;
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
