import type { RuntimeRole } from "../runtime/runtime-types.ts";

export interface SdkPromptInput {
  loop_run_id: string;
  task_id: string;
  goal: string;
  artifact_paths?: string[];
}

export function buildSdkLoopPrompt(role: RuntimeRole, input: SdkPromptInput): string {
  const artifacts = (input.artifact_paths ?? []).map((path) => `- ${path}`).join("\n") || "- none";
  return [
    `$codex-loop SDK-Orchestrated Mode`,
    ``,
    `Role: ${role}`,
    `LoopRun: ${input.loop_run_id}`,
    `Task: ${input.task_id}`,
    `Goal: ${input.goal}`,
    ``,
    `Required existing artifacts:`,
    artifacts,
    ``,
    `Write artifacts with created_by_runtime=sdk-orchestrated, created_by_role=${role}, created_by_thread_id, and created_by_thread_run_id.`,
    `Do not claim PASS without schema-valid artifacts and validation evidence.`
  ].join("\n");
}
