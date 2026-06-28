import type { EvalVerdict, LoopStatus } from "../core/types.ts";
import type { LoopStore } from "../state/types.ts";
import { advanceLoopStatus } from "./state-machine.ts";
import { RepairDispatcher } from "./repair-dispatcher.ts";

export interface EvaluationGateResult {
  eval_id: string;
  verdict: EvalVerdict;
  next_status: LoopStatus;
  repair_request_id: string | null;
}

export class EvaluationGate {
  constructor(
    private readonly store: LoopStore,
    private readonly repairDispatcher = new RepairDispatcher(store)
  ) {}

  async processEvalReport(evalId: string): Promise<EvaluationGateResult> {
    const evalReport = await this.store.getEvalReport(evalId);
    if (!evalReport) {
      throw new Error(`EvalReport not found: ${evalId}`);
    }

    const loopRun = await this.store.getLoopRun(evalReport.loop_run_id);
    if (!loopRun) {
      throw new Error(`LoopRun not found: ${evalReport.loop_run_id}`);
    }

    const nextStatus = advanceLoopStatus("EVAL_RUNNING", {
      evalVerdict: evalReport.verdict
    });

    let repairRequestId: string | null = null;
    if (evalReport.verdict === "NEEDS_REVISION") {
      const repairResult = await this.repairDispatcher.createRepairRequestFromEval(evalReport);
      repairRequestId = repairResult.repair_request.repair_id;
      await this.store.updateTaskStatus(evalReport.task_id, {
        status: "REPAIR_REQUESTED"
      });
    }

    await this.store.updateLoopRun(loopRun.loop_run_id, {
      status: nextStatus,
      updated_at: new Date().toISOString()
    });

    return {
      eval_id: evalReport.eval_id,
      verdict: evalReport.verdict,
      next_status: nextStatus,
      repair_request_id: repairRequestId
    };
  }
}
