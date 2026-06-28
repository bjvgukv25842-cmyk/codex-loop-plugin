import type { ArtifactRuntimeEvidence } from "./sdk-loop-state-machine.ts";

export function createSdkArtifactEvidence(input: ArtifactRuntimeEvidence): ArtifactRuntimeEvidence {
  const missing = [
    input.artifact_path ? "" : "artifact_path",
    input.created_by_runtime === "sdk-orchestrated" ? "" : "created_by_runtime",
    input.created_by_role ? "" : "created_by_role",
    input.created_by_thread_id ? "" : "created_by_thread_id",
    input.created_by_thread_run_id ? "" : "created_by_thread_run_id"
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Missing SDK artifact evidence fields: ${missing.join(", ")}`);
  }
  return input;
}
