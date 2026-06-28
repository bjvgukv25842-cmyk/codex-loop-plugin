import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { LoopRun } from "../core/types.ts";
import type { LoopStore } from "../state/types.ts";

export interface FinalReportResult {
  path: string;
  content: string;
}

export class ReportBuilder {
  constructor(private readonly store: LoopStore) {}

  async buildFinalReport(loopRunId: string, path = "artifacts/final-delivery-report.md"): Promise<FinalReportResult> {
    const loopRun = await this.requireLoopRun(loopRunId);
    const tasks = await this.store.listTasksByLoopRun(loopRunId);
    const events = await this.store.listEvents(loopRunId);

    const content = [
      "# Final Delivery Report",
      "",
      `LoopRun: ${loopRun.loop_run_id}`,
      `Status: ${loopRun.status}`,
      `Current module: ${loopRun.current_module_id}`,
      "",
      "## Goal",
      "",
      loopRun.normalized_goal,
      "",
      "## Task Status",
      "",
      ...tasks.map((task) => `- ${task.task_id}: ${task.status} (${task.title})`),
      "",
      "## Recent Events",
      "",
      ...events.slice(-10).map((event) => `- ${event.created_at} ${event.type}: ${event.message}`),
      ""
    ].join("\n");

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");

    return {
      path,
      content
    };
  }

  private async requireLoopRun(loopRunId: string): Promise<LoopRun> {
    const loopRun = await this.store.getLoopRun(loopRunId);
    if (!loopRun) {
      throw new Error(`LoopRun not found: ${loopRunId}`);
    }
    return loopRun;
  }
}
