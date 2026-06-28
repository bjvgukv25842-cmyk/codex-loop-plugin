import { emitResult, resultPath, runGate6B2FinalEvaluator } from "./gate6b2-utils.ts";

runGate6B2FinalEvaluator()
  .then((result) => emitResult(resultPath("gate6b2-final-evaluator-result.json"), result))
  .catch((error: unknown) =>
    emitResult(resultPath("gate6b2-final-evaluator-result.json"), {
      status: "FAILED",
      current_stage: "FAILED",
      real_sdk_run_executed: false,
      failure_category: "UNHANDLED_ERROR",
      errors: [error instanceof Error ? error.message : String(error)]
    })
  );
