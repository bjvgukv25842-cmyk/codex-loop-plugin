# SDK Evaluator Method Triage

Case: feature-small-001
CLI parity status: PASS
Previous SDK parity status: FAIL
Likely failure: SDK_EVALUATOR_ADAPTER_OR_EVENT_STREAM_ISSUE
Previous SDK method: run
Recommended parity method: run
runStreamed no-event timeout risk: false
Invocation alignment checked: true
CLI/SDK invocation diff status: PASS
Historical role invocation diff status: NEEDS_REVISION

## Invocation
Target repo: /Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/runs/feature-small-001/treatment/target-repo
Model: gpt-5.5
Model catalog JSON: /Users/litmus/Downloads/codex-loop-plugin/evals/sdk-orchestrated/model-catalog-bundled.json
SQLite home: /Users/litmus/Downloads/codex-loop-plugin/.codex-eval/sqlite
Prompt: Respond with exactly: FEATURE_EVALUATOR_PARITY_OK

## Next Action
Rerun evaluator SDK parity once with CODEX_LOOP_EVALUATOR_PARITY_SDK_METHOD=run. Do not run text-only or treatment unless parity passes.

This report is generated from existing evidence only. It does not start SDK threads or Codex CLI.
