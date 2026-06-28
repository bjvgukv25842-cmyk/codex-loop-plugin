import type { NativeAgentRunEvidence, NativeDispatchEvidence } from "./native-dispatch-contract.ts";
import { requirePlannerFollowupDispatch } from "./dispatch-guards.ts";

export interface Gate6WorkOrderInput {
  loop_run_id: string;
  parent_thread_id: string;
  task_id: string;
  module_id: string;
}

export interface NextDispatchWorkOrder {
  agent_name: "loop_dev_worker" | "loop_evaluator";
  phase: "implementation" | "baseline" | "repair" | "final";
  blockers: string[];
  prompt: string;
}

export function buildGate6RepairRequestTemplate(input: Gate6WorkOrderInput): string {
  return JSON.stringify(
    {
      repair_id: "repair_validate_project_name_m1_over80",
      loop_run_id: input.loop_run_id,
      task_id: input.task_id,
      module_id: input.module_id,
      source_eval_id: "eval_validate_project_name_m1_baseline_needs_revision",
      assigned_agent_id: "loop_dev_worker",
      findings: [
        {
          finding_id: "finding_over_80_character_names_still_pass",
          severity: "high",
          category: "correctness",
          description: "validateProjectName still accepts project names longer than 80 characters.",
          evidence: [
            {
              type: "artifact",
              ref: "artifacts/eval-report-needs-revision.json",
              summary: "Baseline evaluator reported the over-80-character validation gap."
            }
          ],
          required_fix: "Reject project names longer than 80 characters while preserving empty, whitespace-only, and valid-name behavior."
        }
      ],
      repair_instructions: [
        "Update only src/project-name.js so validateProjectName(name).ok is false when the normalized project name is longer than 80 characters."
      ],
      allowed_scope: ["src/project-name.js", "artifacts/dev-result.json"],
      disallowed_scope: ["package.json", "test/project-name.test.js", ".env", "node_modules"],
      validation_commands: [
        {
          command: "npm test",
          cwd: ".",
          reason: "Verify all validateProjectName acceptance criteria after repair."
        }
      ],
      status: "REPAIR_REQUESTED",
      created_at: "2026-06-19T00:00:00.000Z",
      updated_at: "2026-06-19T00:00:00.000Z"
    },
    null,
    2
  );
}

export function nextGate6WorkOrder(evidence: NativeDispatchEvidence, input: Gate6WorkOrderInput): NextDispatchWorkOrder | null {
  const plannerFollowupBlocker = requirePlannerFollowupDispatch(evidence);
  if (plannerFollowupBlocker) {
    return {
      agent_name: "loop_dev_worker",
      phase: "implementation",
      blockers: [],
      prompt: buildGate6DevWorkerInitialWorkOrder(input)
    };
  }

  if (hasRun(evidence.agent_runs, "loop_dev_worker", "implementation") && evidence.has_dev_result && !hasRun(evidence.agent_runs, "loop_evaluator", "baseline")) {
    return {
      agent_name: "loop_evaluator",
      phase: "baseline",
      blockers: [],
      prompt: buildGate6BaselineEvaluatorWorkOrder(input)
    };
  }

  if (evidence.has_repair_request && !hasRun(evidence.agent_runs, "loop_dev_worker", "repair")) {
    return {
      agent_name: "loop_dev_worker",
      phase: "repair",
      blockers: [],
      prompt: buildGate6RepairWorkOrder(input)
    };
  }

  if (hasRun(evidence.agent_runs, "loop_dev_worker", "repair") && evidence.has_repair_dev_result && !hasRun(evidence.agent_runs, "loop_evaluator", "final")) {
    return {
      agent_name: "loop_evaluator",
      phase: "final",
      blockers: [],
      prompt: buildGate6FinalEvaluatorWorkOrder(input)
    };
  }

  return null;
}

export function buildGate6DevWorkerInitialWorkOrder(input: Gate6WorkOrderInput): string {
  const threadId = "thread-loop-dev-worker-gate6-implementation";
  return [
    "You are loop_dev_worker. Execute only the Gate 6 initial implementation work order.",
    identityLines(input, "loop_dev_worker", "dev_worker", "implementation"),
    `Use thread_id ${threadId} if the runtime does not expose your actual thread id.`,
    "Allowed files: src/project-name.js and artifacts/dev-result.json.",
    "Do not modify package.json, test/project-name.test.js, docs, or state files directly.",
    "Implement a real first-pass code diff, but intentionally leave the whitespace-only rejection unfixed so the baseline evaluator can produce NEEDS_REVISION for Gate 6 repair-loop proof.",
    "Expected first pass: empty string fails, length > 80 fails, valid names pass, whitespace-only still fails validation.",
    "Run npm test and record the honest failed validation result.",
    "Write artifacts/dev-result.json with changed_files, validation_commands, validation_result, remaining_risks, agent_run_id, and thread_id.",
    mcpStartInstruction(input, "loop_dev_worker", "dev_worker", "implementation", threadId),
    mcpArtifactInstruction("loop_dev_worker", threadId, "dev_result", "artifacts/dev-result.json", "artifact_dev_result_initial"),
    "Call MCP agent_run_finish with payload { agent_run_id: <id from agent_run_start>, status: \"NEEDS_REVISION\", artifact_ids: [\"artifact_dev_result_initial\"] }.",
    "Return compact JSON only with status, agent_name, agent_run_id, thread_id, changed_files, artifact, validation_commands, validation_result, next_required_phase: \"spawn_loop_evaluator_baseline\", and blockers.",
    "Return compact JSON only. Do not load unrelated skills or repository-wide docs."
  ].join("\n");
}

export function buildGate6BaselineEvaluatorWorkOrder(input: Gate6WorkOrderInput): string {
  const threadId = "thread-loop-evaluator-gate6-baseline";
  return [
    "You are loop_evaluator. Execute only the Gate 6 baseline evaluation work order.",
    identityLines(input, "loop_evaluator", "evaluator", "baseline"),
    `Use thread_id ${threadId} if the runtime does not expose your actual thread id.`,
    "Read docs/PRD.md, docs/ACCEPTANCE_CRITERIA.md, docs/TASK_GRAPH.json, src/project-name.js, test/project-name.test.js, and artifacts/dev-result.json.",
    "Do not modify source or tests.",
    "Evaluate the first-pass implementation. Because whitespace-only names remain accepted, verdict must be NEEDS_REVISION with at least one finding and required_fix.",
    "Write artifacts/eval-report-needs-revision.json.",
    mcpStartInstruction(input, "loop_evaluator", "evaluator", "baseline", threadId),
    "Call MCP eval_report_write_by_agent with payload { agent_run_id: <id from agent_run_start>, agent_name: \"loop_evaluator\", thread_id: \"" + threadId + "\", eval_report: <full EvalReport object> }.",
    mcpArtifactInstruction("loop_evaluator", threadId, "eval_report", "artifacts/eval-report-needs-revision.json", "eval_gate6_needs_revision"),
    "Call MCP agent_run_finish with payload { agent_run_id: <id from agent_run_start>, status: \"NEEDS_REVISION\", artifact_ids: [\"eval_gate6_needs_revision\"] }.",
    "Return compact JSON only with status, agent_name, agent_run_id, thread_id, eval_report, verdict: \"NEEDS_REVISION\", findings_count, next_required_phase: \"create_repair_request\", and blockers.",
    "Return compact JSON only. Do not load unrelated skills or repository-wide docs."
  ].join("\n");
}

export function buildGate6RepairWorkOrder(input: Gate6WorkOrderInput): string {
  const threadId = "thread-loop-dev-worker-gate6-repair";
  return [
    "You are loop_dev_worker. Execute only the Gate 6 repair work order.",
    identityLines(input, "loop_dev_worker", "dev_worker", "repair"),
    `Use thread_id ${threadId} if the runtime does not expose your actual thread id.`,
    "Read artifacts/repair-request.json and fix only the required whitespace-only validation gap.",
    "Allowed files: src/project-name.js and artifacts/dev-result.json.",
    "Do not modify package.json or tests.",
    "Run npm test and require it to pass.",
    "Update artifacts/dev-result.json with repair summary, changed_files, validation_commands, validation_result, remaining_risks, agent_run_id, and thread_id.",
    mcpStartInstruction(input, "loop_dev_worker", "dev_worker", "repair", threadId),
    mcpArtifactInstruction("loop_dev_worker", threadId, "dev_result", "artifacts/dev-result.json", "artifact_dev_result_repair"),
    "Call MCP agent_run_finish with payload { agent_run_id: <id from agent_run_start>, status: \"PASS\", artifact_ids: [\"artifact_dev_result_repair\"] }.",
    "Return compact JSON only with status, agent_name, agent_run_id, thread_id, changed_files, artifact, validation_commands, validation_result, next_required_phase: \"spawn_loop_evaluator_final\", and blockers.",
    "Return compact JSON only. Do not load unrelated skills or repository-wide docs."
  ].join("\n");
}

export function buildGate6RepairRequestInstruction(input: Gate6WorkOrderInput): string {
  return [
    "When baseline evaluator returns NEEDS_REVISION, parent must create artifacts/repair-request.json and call MCP repair_create_request with exactly the M1 RepairRequest schema shape below.",
    "Do not use source_eval_report_path, finding_ids, required_fixes, created_by, or metadata as top-level fields because repair-request.schema.json rejects additional properties.",
    buildGate6RepairRequestTemplate(input),
    "After repair_create_request returns ok true, the next parent action must be native spawn_agent for loop_dev_worker phase repair."
  ].join("\n");
}

export function buildGate6FinalEvaluatorWorkOrder(input: Gate6WorkOrderInput): string {
  const threadId = "thread-loop-evaluator-gate6-final";
  return [
    "You are loop_evaluator. Execute only the Gate 6 final evaluation work order.",
    identityLines(input, "loop_evaluator", "evaluator", "final"),
    `Use thread_id ${threadId} if the runtime does not expose your actual thread id.`,
    "Read PRD, acceptance criteria, TaskGraph, dev result, repair request, final source, tests, and npm test evidence.",
    "Do not modify files.",
    "If npm test passes and all acceptance criteria are met, write artifacts/eval-report-pass.json with verdict PASS and empty findings.",
    mcpStartInstruction(input, "loop_evaluator", "evaluator", "final", threadId),
    "Call MCP eval_report_write_by_agent with payload { agent_run_id: <id from agent_run_start>, agent_name: \"loop_evaluator\", thread_id: \"" + threadId + "\", eval_report: <full PASS EvalReport object> }.",
    mcpArtifactInstruction("loop_evaluator", threadId, "eval_report", "artifacts/eval-report-pass.json", "eval_gate6_pass"),
    "Call MCP agent_run_finish with payload { agent_run_id: <id from agent_run_start>, status: \"PASS\", artifact_ids: [\"eval_gate6_pass\"] }.",
    "Return compact JSON only with status, agent_name, agent_run_id, thread_id, eval_report, verdict: \"PASS\", next_required_phase: \"run_final_validation\", and blockers.",
    "Return compact JSON only. Do not load unrelated skills or repository-wide docs."
  ].join("\n");
}

function identityLines(input: Gate6WorkOrderInput, agentName: string, agentType: string, phase: string): string {
  return [
    `loop_run_id: ${input.loop_run_id}`,
    `parent_thread_id: ${input.parent_thread_id}`,
    `task_id: ${input.task_id}`,
    `module_id: ${input.module_id}`,
    `agent_name: ${agentName}`,
    `agent_type: ${agentType}`,
    `phase: ${phase}`
  ].join("\n");
}

function hasRun(agentRuns: NativeAgentRunEvidence[], agentName: string, phase: string): boolean {
  return agentRuns.some((run) => run.agent_name === agentName && run.phase === phase);
}

function mcpStartInstruction(input: Gate6WorkOrderInput, agentName: string, agentType: string, phase: string, threadId: string): string {
  return `Call MCP agent_run_start before work with payload { loop_run_id: "${input.loop_run_id}", agent_name: "${agentName}", agent_type: "${agentType}", parent_thread_id: "${input.parent_thread_id}", thread_id: "${threadId}", task_id: "${input.task_id}", module_id: "${input.module_id}", phase: "${phase}" }.`;
}

function mcpArtifactInstruction(agentName: string, threadId: string, artifactType: string, artifactPath: string, artifactId: string): string {
  return `Call MCP artifact_write_by_agent with payload { agent_run_id: <id from agent_run_start>, agent_name: "${agentName}", thread_id: "${threadId}", artifact_type: "${artifactType}", artifact_path: "${artifactPath}", artifact_id: "${artifactId}" }.`;
}
