import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { diffAdversarialDevWorkerTreatmentVsSmoke } from "../../scripts/effectiveness/diff-adversarial-dev-worker-treatment-vs-smoke.ts";
import {
  ADVERSARIAL_TREATMENT_DEV_WORKER_PHASE,
  adversarialDevWorkerPromptHash,
  buildAdversarialDevWorkerPrompt
} from "../../src/effectiveness/adversarial-dev-worker-stage.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("adversarial treatment vs exact smoke dev-worker path diff", () => {
  it("detects critical target mismatch", () => {
    const repoRoot = tempRoot("adversarial-treatment-path-diff-target-");
    writeEvidence(repoRoot, {
      treatment: {
        case_id: "adversarial-prompt-injection-001",
        variant: "treatment",
        mode: "treatment",
        status: "BLOCKED",
        dev_worker_prompt_length: buildAdversarialDevWorkerPrompt().length,
        dev_worker_prompt_hash: adversarialDevWorkerPromptHash(),
        validation_commands: ["npm test", "npm run security:contract"],
        dev_worker_phase: ADVERSARIAL_TREATMENT_DEV_WORKER_PHASE,
        finalizer_read_only: true
      },
      trace: {
        target_repo_is_git: false,
        start_thread_options: {
          workingDirectory: resolve(repoRoot, "evals/effectiveness/runs/adversarial-prompt-injection-001/wrong/target-repo"),
          sandboxMode: "workspace-write",
          model: "gpt-test"
        },
        run_options: { outputSchemaWasPassedToSdk: true },
        prompt: {
          length: buildAdversarialDevWorkerPrompt().length,
          hash: adversarialDevWorkerPromptHash()
        },
        sdk_api_method: "runStreamed"
      }
    });

    const diff = diffAdversarialDevWorkerTreatmentVsSmoke(repoRoot);

    expect(diff.status).toBe("NEEDS_REVISION");
    expect(diff.mismatch_categories).toContain("ADVERSARIAL_TREATMENT_DEV_WORKER_TARGET_MISMATCH");
    expect(diff.path_mismatch_detected).toBe(true);
  });

  it("passes after treatment uses the exact smoke three-phase path", () => {
    const repoRoot = tempRoot("adversarial-treatment-path-diff-pass-");
    writeEvidence(repoRoot, {
      treatment: {
        case_id: "adversarial-prompt-injection-001",
        variant: "treatment",
        mode: "treatment",
        status: "PASS",
        dev_worker_prompt_length: buildAdversarialDevWorkerPrompt().length,
        dev_worker_prompt_hash: adversarialDevWorkerPromptHash(),
        validation_commands: ["npm test", "npm run security:contract"],
        dev_worker_phase: ADVERSARIAL_TREATMENT_DEV_WORKER_PHASE,
        finalizer_read_only: true
      },
      trace: {
        target_repo_is_git: true,
        start_thread_options: {
          workingDirectory: resolve(repoRoot, "evals/effectiveness/runs/adversarial-prompt-injection-001/treatment/target-repo"),
          sandboxMode: "workspace-write",
          model: "gpt-test"
        },
        run_options: { outputSchemaWasPassedToSdk: true },
        prompt: {
          length: buildAdversarialDevWorkerPrompt().length,
          hash: adversarialDevWorkerPromptHash()
        },
        sdk_api_method: "run"
      }
    });

    const diff = diffAdversarialDevWorkerTreatmentVsSmoke(repoRoot);

    expect(diff.status).toBe("PASS");
    expect(diff.path_mismatch_detected).toBe(false);
    expect(diff.treatment_uses_three_phase_dev_worker).toBe(true);
  });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(resolve(tmpdir(), prefix));
  tempDirs.push(root);
  return root;
}

function writeEvidence(repoRoot: string, input: { treatment: Record<string, unknown>; trace: Record<string, unknown> }): void {
  const reportDir = resolve(repoRoot, "evals/effectiveness/reports/adversarial-prompt-injection-001");
  mkdirSync(resolve(reportDir, "sdk-stage-logs"), { recursive: true });
  writeFileSync(resolve(reportDir, "adversarial-dev-worker-smoke-exact-result.json"), `${JSON.stringify({
    status: "PASS",
    mode: "exact",
    target_repo_is_git: true,
    prompt_length: buildAdversarialDevWorkerPrompt().length,
    prompt_hash: adversarialDevWorkerPromptHash()
  }, null, 2)}\n`, "utf8");
  writeFileSync(resolve(reportDir, "treatment-result.json"), `${JSON.stringify(input.treatment, null, 2)}\n`, "utf8");
  writeFileSync(resolve(reportDir, "sdk-stage-logs/adversarial-dev-worker-invocation-trace-redacted.json"), `${JSON.stringify(input.trace, null, 2)}\n`, "utf8");
}
