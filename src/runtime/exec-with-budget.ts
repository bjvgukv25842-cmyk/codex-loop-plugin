import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { classifyReadonlyDatabase } from "./eval-sqlite-home.ts";
import { DEFAULT_GATE6_LITE_TIME_BUDGET, type TimeBudgetConfig } from "./time-budget.ts";

export type BudgetedExecStatus = "PASS" | "FAIL" | "TIMEOUT" | "NO_EVENT_TIMEOUT" | "BLOCKED";

export interface BudgetedExecOptions {
  command: string;
  args: string[];
  cwd: string;
  stdout_path: string;
  stderr_path: string;
  env?: NodeJS.ProcessEnv;
  budget?: Partial<TimeBudgetConfig>;
  now?: () => number;
}

export interface BudgetedExecResult {
  status: BudgetedExecStatus;
  duration_ms: number;
  exit_code: number | null;
  signal: NodeJS.Signals | null;
  stdout_path: string;
  stderr_path: string;
  event_count: number;
  last_event_type: string;
  failure_category?: "CODEX_LOCAL_STATE_DB_READONLY";
  stderr_excerpt?: string;
  error?: string;
}

export async function execWithBudget(options: BudgetedExecOptions): Promise<BudgetedExecResult> {
  const budget = {
    ...DEFAULT_GATE6_LITE_TIME_BUDGET,
    ...options.budget
  };
  const now = options.now ?? Date.now;
  const startMs = now();
  let eventCount = 0;
  let lastEventType = "";
  let stdoutRemainder = "";
  let settled = false;
  let timeoutKind: "TIMEOUT" | "NO_EVENT_TIMEOUT" | null = null;
  let lastEventAtMs = startMs;

  mkdirSync(dirname(options.stdout_path), { recursive: true });
  mkdirSync(dirname(options.stderr_path), { recursive: true });
  writeFileSync(options.stdout_path, "", "utf8");
  writeFileSync(options.stderr_path, "", "utf8");

  return await new Promise<BudgetedExecResult>((resolve) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const overallTimer = setTimeout(() => {
      timeoutKind = "TIMEOUT";
      child.kill("SIGTERM");
    }, budget.single_codex_exec_budget_ms);

    const noEventTimer = setInterval(() => {
      if (eventCount === 0 && now() - startMs >= budget.no_event_timeout_ms) {
        timeoutKind = "NO_EVENT_TIMEOUT";
        child.kill("SIGTERM");
        return;
      }
      if (eventCount > 0 && now() - lastEventAtMs >= budget.no_event_timeout_ms) {
        timeoutKind = "NO_EVENT_TIMEOUT";
        child.kill("SIGTERM");
      }
    }, Math.min(1_000, Math.max(100, budget.no_event_timeout_ms)));

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      writeFileSync(options.stdout_path, text, { encoding: "utf8", flag: "a" });
      const parsed = parseJsonlChunk(stdoutRemainder + text);
      stdoutRemainder = parsed.remainder;
      if (parsed.eventCount > 0) {
        eventCount += parsed.eventCount;
        lastEventType = parsed.lastEventType || lastEventType;
        lastEventAtMs = now();
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      writeFileSync(options.stderr_path, chunk.toString("utf8"), { encoding: "utf8", flag: "a" });
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(overallTimer);
      clearInterval(noEventTimer);
      resolve({
        status: "BLOCKED",
        duration_ms: Math.max(0, now() - startMs),
        exit_code: null,
        signal: null,
        stdout_path: options.stdout_path,
        stderr_path: options.stderr_path,
        event_count: eventCount,
        last_event_type: lastEventType,
        error: error.message
      });
    });

    child.on("close", (exitCode, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(overallTimer);
      clearInterval(noEventTimer);
      if (stdoutRemainder.trim()) {
        const parsed = parseJsonlChunk(`${stdoutRemainder}\n`);
        eventCount += parsed.eventCount;
        lastEventType = parsed.lastEventType || lastEventType;
      }
      resolve({
        status: timeoutKind ?? (exitCode === 0 ? "PASS" : "FAIL"),
        duration_ms: Math.max(0, now() - startMs),
        exit_code: exitCode,
        signal,
        stdout_path: options.stdout_path,
        stderr_path: options.stderr_path,
        event_count: eventCount,
        last_event_type: lastEventType,
        failure_category: classifyReadonlyDatabase(readFileText(options.stderr_path)) ?? undefined,
        stderr_excerpt: readFileText(options.stderr_path).slice(0, 2000)
      });
    });
  });
}

function readFileText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function parseJsonlChunk(text: string): { eventCount: number; lastEventType: string; remainder: string } {
  const endsWithNewline = /\r?\n$/.test(text);
  const lines = text.split(/\r?\n/);
  const completeLines = endsWithNewline ? lines.filter((line) => line.length > 0) : lines.slice(0, -1).filter((line) => line.length > 0);
  const remainder = endsWithNewline ? "" : (lines.at(-1) ?? "");
  let eventCount = 0;
  let lastEventType = "";
  for (const line of completeLines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        eventCount += 1;
        const type = (parsed as Record<string, unknown>).type;
        lastEventType = typeof type === "string" ? type : lastEventType;
      }
    } catch {
      // Non-JSON stdout lines are still captured in the log; they just are not JSONL events.
    }
  }
  return { eventCount, lastEventType, remainder };
}
