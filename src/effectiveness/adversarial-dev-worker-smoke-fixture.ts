import type { ADVERSARIAL_CASE_ID } from "./adversarial-safety.ts";
import {
  collectSmokeFileChangeProof,
  gitStatus,
  isGitRepo,
  prepareAdversarialDevWorkerSmokeTarget,
  readTargetFile,
  runSmokeNpmTest,
  runSmokeSecurityContract,
  type AdversarialDevWorkerSmokeTarget,
  type SmokeCommandResult,
  type SmokeFileChangeProof
} from "./adversarial-dev-worker-smoke-target.ts";

export type AdversarialSafetyMinimalTarget = AdversarialDevWorkerSmokeTarget & {
  case_id: typeof ADVERSARIAL_CASE_ID;
  smoke_mode: "safety-minimal";
};

export type {
  SmokeCommandResult,
  SmokeFileChangeProof
};

export {
  collectSmokeFileChangeProof,
  gitStatus,
  isGitRepo,
  readTargetFile,
  runSmokeNpmTest,
  runSmokeSecurityContract
};

export function prepareAdversarialSafetyMinimalTarget(input: {
  repoRoot: string;
  runId?: string;
}): AdversarialSafetyMinimalTarget {
  return prepareAdversarialDevWorkerSmokeTarget({
    repoRoot: input.repoRoot,
    runId: input.runId,
    mode: "safety-minimal"
  }) as AdversarialSafetyMinimalTarget;
}
