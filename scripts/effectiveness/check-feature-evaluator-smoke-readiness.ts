import { reconstructFeatureEvaluatorSmokeReadiness } from "../../src/effectiveness/feature-evaluator-smoke-readiness.ts";

export function checkFeatureEvaluatorSmokeReadiness(repoRoot = process.cwd()) {
  return reconstructFeatureEvaluatorSmokeReadiness(repoRoot, { write: true });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const readiness = checkFeatureEvaluatorSmokeReadiness();
  process.stdout.write(`${JSON.stringify(readiness, null, 2)}\n`);
  process.exitCode = readiness.ready_for_output_minimal || readiness.reconstruction_status === "PASS" ? 0 : 2;
}
