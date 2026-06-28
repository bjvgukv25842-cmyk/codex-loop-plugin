# Feature Evaluator Timeout Triage

Case: feature-small-001
Failure category: FEATURE_TREATMENT_EVALUATOR_TURN_NO_EVENT_TIMEOUT
Planner completed: true
Dev worker completed: true
Evaluator thread started: true
Evaluator thread id: 019eefa6-0eac-79f2-900b-ffd106885119
Evaluator completed: false
Event count: 28
Last event type: item.completed
Prompt length: 865
Prompt hash: b3a3b92b8ffd6abd90f0e3e7aaa305b0254808170ac18b68548dc1a540cdc5c5
Uses evaluator-lite schema: true
Uses full EvalReport schema: false
Target repo: /Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/runs/feature-small-001/treatment/target-repo
Target repo is git: true

## Critical Diffs
- evaluator_thread_started_but_no_eval_report
- planner_and_dev_worker_completed_before_evaluator_timeout
- historical_evaluator_prompt_exceeded_m12_2g_budget

## Recommended Fixes
- Keep feature-small-001 treatment blocked until an evaluator-only slice completes without timeout.
- Run evaluator parity, text-only, output-minimal, output-lite, and exact smokes in order.
- Use the shortened feature evaluator prompt with evaluator-lite outputSchema; do not use the full EvalReport schema as outputSchema.
- Use checkpoint evaluator retry only after planner and dev worker PASS evidence is present.
