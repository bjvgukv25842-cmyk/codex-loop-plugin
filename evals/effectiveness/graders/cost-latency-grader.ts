import type { GraderResult, M12RunResult } from "../../../scripts/effectiveness/types.ts";

export function gradeCostLatency(result: M12RunResult): GraderResult {
  const evidence = [
    `duration_ms=${result.duration_ms}`,
    `thread_count=${result.thread_count}`,
    `command_count=${result.command_count}`
  ];
  return {
    grader: "cost-latency",
    status: "PASS",
    score: 1,
    p0: false,
    severe: false,
    summary: "Cost and latency counters recorded.",
    evidence
  };
}
