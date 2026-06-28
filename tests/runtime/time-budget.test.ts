import { describe, expect, it } from "vitest";

import {
  DEFAULT_GATE6_LITE_TIME_BUDGET,
  checkBudget,
  createTimeBudget,
  recordCodexExecRun,
  recordRetry
} from "../../src/runtime/time-budget.ts";

describe("Gate 6.2-Lite time budget", () => {
  it("uses conservative defaults for real Codex exec runs", () => {
    expect(DEFAULT_GATE6_LITE_TIME_BUDGET).toEqual({
      overall_budget_ms: 1_800_000,
      single_codex_exec_budget_ms: 180_000,
      no_event_timeout_ms: 60_000,
      max_codex_exec_runs: 1,
      max_retries: 0,
      allow_full_gate6_run: false
    });
  });

  it("blocks full Gate 6 runs by default", () => {
    const budget = createTimeBudget({}, 1_000);
    const check = checkBudget(budget, { nowMs: 1_100, fullGate6Run: true });

    expect(check.ok).toBe(false);
    expect(check.reason).toBe("FULL_GATE6_RUN_DISABLED");
  });

  it("allows only one codex exec run and no retries", () => {
    let budget = createTimeBudget({}, 1_000);
    budget = recordCodexExecRun(budget);

    expect(checkBudget(budget, { nowMs: 1_100 }).reason).toBe("MAX_CODEX_EXEC_RUNS_EXCEEDED");
    expect(checkBudget(recordRetry(createTimeBudget({}, 1_000)), { nowMs: 1_100, retry: true }).reason).toBe("MAX_RETRIES_EXCEEDED");
  });
});

