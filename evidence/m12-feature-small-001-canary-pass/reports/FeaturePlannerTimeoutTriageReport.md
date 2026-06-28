# Feature Planner Timeout Triage

Failure category: FEATURE_TREATMENT_PLANNER_NO_EVENT_TIMEOUT
Planner thread started: true
Planner thread id: 019eee5c-83b9-7be2-975a-32a734851275
Last event type: item.completed
Event count: 32
Elapsed ms: 101612
Uses planner-lite-v2: true
Uses task_graph_json string: false
Feature prompt length: 355
Feature prompt hash: 369a7ae0f92e9a007f647ea889fbbbf8428e639a989fec52b13542db85e38328
Repair-loop prompt hash: cf434cb80ebdc9db4f1dba1ee714fefc8be94c4d2a080995eb45ae3456c51c9a
Critical diffs: workingDirectory, target_repo_git_status, checkpointStatePath, artifactOutputPaths

## Evidence Paths
- events: /Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/reports/feature-small-001/sdk-stage-logs/generic-planner-events.jsonl
- stdout: /Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/reports/feature-small-001/sdk-stage-logs/generic-planner-stdout.log
- stderr: /Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/reports/feature-small-001/sdk-stage-logs/generic-planner-stderr.log
- raw output: /Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/reports/feature-small-001/sdk-stage-logs/generic-planner-stdout.log
- redacted output: /Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/reports/feature-small-001/sdk-stage-logs/generic-planner-stdout-redacted.log

## Recommended Fixes
- Keep feature-small-001 blocked until planner parity, lite-minimal, and exact smokes pass.
- Use planner-lite-v2 with direct tasks[] and no nested JSON strings.
- Classify no-event timeout as startup or turn timeout based on thread/event evidence.
- Do not rerun full M12 or another case before this planner slice is isolated.

This report is generated from existing evidence only. It does not start Codex, SDK threads, or another M12 case.
