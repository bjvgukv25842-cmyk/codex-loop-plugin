# Feature Evaluator Smoke Report

Smoke status: PASS
Verify status: PASS
Mode: exact
Real SDK run executed: true
Evaluator thread started: true
Evaluator thread id: 019ef3bd-93be-7e02-bf96-ffb7636fc90c
Structured output valid: true
Eval report created: true
Eval verdict: PASS
Output schema kind: evaluator-lite
Uses evaluator-lite schema: true
Uses full EvalReport schema: false
Evaluator prompt length: 694
Failure category: 
Evaluator parity category: FEATURE_EVALUATOR_PARITY_TURN_NO_EVENT_TIMEOUT
Evaluator parity event count: 3
Evaluator parity last event type: agent_message
Evaluator parity SDK method: run
Recommended parity SDK method: run
Evaluator CLI/SDK parity invocation status: PASS
Old parity timeout triage superseded: superseded_by_sdk_method_run_parity_pass
Historical evaluator/planner/dev invocation diff status: NEEDS_REVISION
Historical evaluator/planner/dev critical diffs: sqlite_home, sandboxMode, skipGitRepoCheck, promptLength, promptHash, sdkMethod, runStreamedUsage, outputSchemaUsage, outputSchemaHash, eventsPath
Current evaluator timeout category: FEATURE_TREATMENT_EVALUATOR_TURN_NO_EVENT_TIMEOUT
Historical evaluator event count: 28
Historical evaluator last event type: item.completed

## SDK Diagnosis
package.json declares SDK: true
package-lock includes SDK: true
npm/resolve sees SDK: true
dynamic import ok: true
Codex export available: true
SDK version: 0.141.0
SDK failure category: 
SDK method likely failure: SDK_EVALUATOR_ADAPTER_OR_EVENT_STREAM_ISSUE

## Readiness State
parity: PASS
text-only: PASS
output-minimal: PASS
output-lite: PASS
exact: PASS
ready_for_output_minimal: true
ready_for_output_lite: true
ready_for_exact: true
ready_for_treatment_rerun: true
readiness reconstruction status: PASS
blocked_attempt.mode: output-lite
blocked_attempt.status: BLOCKED_EVALUATOR_OUTPUT_MINIMAL_NOT_PASSED
blocked_attempt.reason: output-lite attempted before output-minimal PASS

## Required Smoke Order
- parity
- text-only
- output-minimal
- output-lite
- exact

Only after all five real evaluator-only smokes pass may one approved feature-small-001 treatment fresh rerun be considered.
M12 production ready: false

