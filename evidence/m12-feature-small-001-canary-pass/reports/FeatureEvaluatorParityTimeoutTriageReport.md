# Feature Evaluator Parity Timeout Triage

Case: feature-small-001
Stage: evaluator-parity
Failure category: FEATURE_EVALUATOR_PARITY_TURN_NO_EVENT_TIMEOUT
Evaluator thread started: true
Evaluator thread id: 019ef3bd-93be-7e02-bf96-ffb7636fc90c
Turn started: true
Turn completed: false
Turn failed: false
Event count: 3
Last event type: agent_message
Elapsed ms: 0
Working directory: /Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/runs/feature-small-001/treatment/target-repo
Target repo is git: true
Sandbox mode: read-only
Model: gpt-5.5
Uses output schema: false
SDK method: run

## Paths
Events: /Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/reports/feature-small-001/sdk-stage-logs/feature-evaluator-smoke-parity-events.jsonl
Stdout: /Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/reports/feature-small-001/sdk-stage-logs/feature-evaluator-smoke-parity-stdout.log
Stderr: /Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/reports/feature-small-001/sdk-stage-logs/feature-evaluator-smoke-parity-stderr.log

## Recommended Fixes
- Keep feature evaluator text-only, output-minimal, output-lite, exact, and treatment rerun blocked until parity is proven.
- Run evaluator CLI parity once to isolate whether Codex CLI can return FEATURE_EVALUATOR_PARITY_OK with the same target repo and prompt.
- If CLI parity passes while SDK parity times out, investigate SDK evaluator adapter event streaming or switch the controlled parity method to run() for diagnosis.

This report is generated from existing evaluator parity evidence only. It does not start SDK threads or Codex CLI.
