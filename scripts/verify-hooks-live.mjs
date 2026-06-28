import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const evidenceDir = join(repoRoot, "evidence/gate5-2-hooks-trusted-mode");
const summaryPath = join(evidenceDir, "hook-trust-summary.json");
const hooksConfigPath = join(repoRoot, "hooks/hooks.json");

const requiredHooks = ["PostToolUse", "PreCompact", "SubagentStop", "Stop"];
const dangerousPattern = /\b(rm\s+-rf|git\s+push|git\s+commit|curl\s+.*https?:|wget\s+|danger-full-access)\b/i;
const secretPattern = /(secret|token|\.env|api[_-]?key|BEGIN (RSA|OPENSSH|PRIVATE)|sk-[A-Za-z0-9])/i;

function json(path, fallback = null) {
  if (!existsSync(path)) {
    return fallback;
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function text(path, fallback = "") {
  if (!existsSync(path)) {
    return fallback;
  }
  return readFileSync(path, "utf8");
}

function output(result) {
  mkdirSync(join(repoRoot, "evals/real-thread/reports"), { recursive: true });
  writeFileSync(join(repoRoot, "evals/real-thread/reports/gate5-2-hooks-live-check.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.hooks_trusted_mode_status === "PASS" ? 0 : 1;
}

const hooksConfig = json(hooksConfigPath, {});
const configuredEvents = Object.keys(hooksConfig.hooks ?? {});
const missingConfiguredHooks = requiredHooks.filter((hook) => !configuredEvents.includes(hook));

if (!existsSync(summaryPath)) {
  output({
    hooks_trusted_mode_status: "BLOCKED_MANUAL_REVIEW_REQUIRED",
    reason: "Trusted hook runtime evidence is missing. Review/trust hooks in Codex, run a hook-triggering session, then write evidence/gate5-2-hooks-trusted-mode/hook-trust-summary.json.",
    manual_steps: [
      "Open Codex hooks review / trust UI.",
      "Review hooks/hooks.json and the referenced hook scripts.",
      "Trust the current hook definition hash.",
      "Run a real Codex session that triggers PostToolUse, PreCompact, SubagentStop, and Stop.",
      "Record hook runtime evidence under evidence/gate5-2-hooks-trusted-mode/.",
      "Run npm run real:verify-hooks."
    ],
    configured_hooks: configuredEvents,
    missing_configured_hooks: missingConfiguredHooks
  });
} else {
  const summary = json(summaryPath, {});
  const filesToScan = Array.isArray(summary.files_scanned_for_safety)
    ? summary.files_scanned_for_safety.map((file) => join(repoRoot, file))
    : [summaryPath];
  const safetyText = filesToScan.map((file) => text(file)).join("\n");
  const checks = {
    hook_definition_trusted: summary.hook_definition_trusted === true,
    post_tool_use_captured_npm_test: summary.post_tool_use_captured_npm_test === true,
    pre_compact_generated_context_capsule: summary.pre_compact_generated_context_capsule === true,
    subagent_stop_saved_output: summary.subagent_stop_saved_output === true,
    stop_checked_loop_progress: summary.stop_checked_loop_progress === true,
    no_dangerous_commands: summary.no_dangerous_commands === true && !dangerousPattern.test(safetyText),
    no_secret_leak: summary.no_secret_leak === true && !secretPattern.test(safetyText),
    no_infinite_continue: summary.no_infinite_continue === true,
    hooks_config_contains_required_events: missingConfiguredHooks.length === 0
  };
  const missingChecks = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  output({
    hooks_trusted_mode_status: missingChecks.length === 0 ? "PASS" : "NEEDS_REVISION",
    evidence_dir: "evidence/gate5-2-hooks-trusted-mode",
    summary_path: "evidence/gate5-2-hooks-trusted-mode/hook-trust-summary.json",
    checks,
    missing_checks: missingChecks,
    configured_hooks: configuredEvents,
    missing_configured_hooks: missingConfiguredHooks
  });
}
