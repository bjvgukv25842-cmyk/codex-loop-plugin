export interface TimeBudgetConfig {
  overall_budget_ms: number;
  single_codex_exec_budget_ms: number;
  no_event_timeout_ms: number;
  max_codex_exec_runs: number;
  max_retries: number;
  allow_full_gate6_run: boolean;
}

export interface TimeBudgetState {
  config: TimeBudgetConfig;
  started_at_ms: number;
  codex_exec_runs: number;
  retries: number;
}

export interface BudgetCheck {
  ok: boolean;
  reason?: "OVERALL_BUDGET_EXCEEDED" | "MAX_CODEX_EXEC_RUNS_EXCEEDED" | "MAX_RETRIES_EXCEEDED" | "FULL_GATE6_RUN_DISABLED";
  remaining_overall_ms: number;
}

export const DEFAULT_GATE6_LITE_TIME_BUDGET: TimeBudgetConfig = {
  overall_budget_ms: 1_800_000,
  single_codex_exec_budget_ms: 180_000,
  no_event_timeout_ms: 60_000,
  max_codex_exec_runs: 1,
  max_retries: 0,
  allow_full_gate6_run: false
};

export function createTimeBudget(config: Partial<TimeBudgetConfig> = {}, nowMs = Date.now()): TimeBudgetState {
  const merged = normalizeTimeBudgetConfig({
    ...DEFAULT_GATE6_LITE_TIME_BUDGET,
    ...config
  });
  return {
    config: merged,
    started_at_ms: nowMs,
    codex_exec_runs: 0,
    retries: 0
  };
}

export function normalizeTimeBudgetConfig(config: TimeBudgetConfig): TimeBudgetConfig {
  const entries: Array<[keyof Omit<TimeBudgetConfig, "allow_full_gate6_run">, number]> = [
    ["overall_budget_ms", config.overall_budget_ms],
    ["single_codex_exec_budget_ms", config.single_codex_exec_budget_ms],
    ["no_event_timeout_ms", config.no_event_timeout_ms],
    ["max_codex_exec_runs", config.max_codex_exec_runs],
    ["max_retries", config.max_retries]
  ];

  for (const [key, value] of entries) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid time budget value for ${key}: ${value}`);
    }
  }
  if (config.single_codex_exec_budget_ms > config.overall_budget_ms) {
    throw new Error("single_codex_exec_budget_ms cannot exceed overall_budget_ms");
  }
  if (config.no_event_timeout_ms > config.single_codex_exec_budget_ms) {
    throw new Error("no_event_timeout_ms cannot exceed single_codex_exec_budget_ms");
  }
  return config;
}

export function checkBudget(
  state: TimeBudgetState,
  options: { nowMs?: number; fullGate6Run?: boolean; retry?: boolean } = {}
): BudgetCheck {
  const nowMs = options.nowMs ?? Date.now();
  const elapsed = Math.max(0, nowMs - state.started_at_ms);
  const remainingOverall = Math.max(0, state.config.overall_budget_ms - elapsed);

  if (options.fullGate6Run === true && !state.config.allow_full_gate6_run) {
    return {
      ok: false,
      reason: "FULL_GATE6_RUN_DISABLED",
      remaining_overall_ms: remainingOverall
    };
  }
  if (elapsed > state.config.overall_budget_ms) {
    return {
      ok: false,
      reason: "OVERALL_BUDGET_EXCEEDED",
      remaining_overall_ms: 0
    };
  }
  if (state.codex_exec_runs >= state.config.max_codex_exec_runs) {
    return {
      ok: false,
      reason: "MAX_CODEX_EXEC_RUNS_EXCEEDED",
      remaining_overall_ms: remainingOverall
    };
  }
  if (options.retry === true && state.retries >= state.config.max_retries) {
    return {
      ok: false,
      reason: "MAX_RETRIES_EXCEEDED",
      remaining_overall_ms: remainingOverall
    };
  }
  return {
    ok: true,
    remaining_overall_ms: remainingOverall
  };
}

export function recordCodexExecRun(state: TimeBudgetState): TimeBudgetState {
  return {
    ...state,
    codex_exec_runs: state.codex_exec_runs + 1
  };
}

export function recordRetry(state: TimeBudgetState): TimeBudgetState {
  return {
    ...state,
    retries: state.retries + 1
  };
}

