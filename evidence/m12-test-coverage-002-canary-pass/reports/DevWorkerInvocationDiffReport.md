# Test-Coverage Dev Worker Invocation Diff

Status: PASS
Compared: test-coverage-001 -> test-coverage-002
Critical diffs: none

## Fields
- model: same=true; tc001="gpt-5.5"; tc002="gpt-5.5"
- model_catalog_json: same=true; tc001="/Users/litmus/Downloads/codex-loop-plugin/evals/sdk-orchestrated/model-catalog-bundled.json"; tc002="/Users/litmus/Downloads/codex-loop-plugin/evals/sdk-orchestrated/model-catalog-bundled.json"
- sqlite_home: same=true; tc001="/Users/litmus/Downloads/codex-loop-plugin/.codex-eval/sqlite"; tc002="/Users/litmus/Downloads/codex-loop-plugin/.codex-eval/sqlite"
- workingDirectory: same=false; tc001="/Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/runs/test-coverage-001/treatment/target-repo"; tc002="/Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/runs/test-coverage-002/treatment/target-repo"
- target_repo_git_status: same=false; tc001="M test/invoice.test.js\n?? artifacts/\n?? docs/\n?? evals/"; tc002="M test/cache.test.js\n?? artifacts/\n?? docs/\n?? evals/"
- target_repo_is_git: same=true; tc001=true; tc002=true
- sandboxMode: same=true; tc001="workspace-write"; tc002="workspace-write"
- prompt_length: same=false; tc001=590; tc002=585
- prompt_hash: same=false; tc001="278f35b8f4687402a74ebab4bf7e903e775ee2e8593de1ad29c0396d1025e9be"; tc002="06229a3d736e16e9cda1bba72d82500769285a164cfdc477bddbf95e2322e173"
- prompt_section_count: same=true; tc001=5; tc002=5
- validation_commands: same=true; tc001=["npm test","npm run coverage:contract"]; tc002=["npm test","npm run coverage:contract"]
- likely_files: same=false; tc001=["test/invoice.test.js","src/invoice.js","scripts/check-test-coverage-contract.js"]; tc002=["test/cache.test.js","src/cache.js","src/cache-storage.js","scripts/check-test-coverage-contract.js"]
- sdk_method: same=true; tc001="run"; tc002="run"
- usesRunStreamed: same=true; tc001=false; tc002=false
- usesRun: same=true; tc001=true; tc002=true
- timeout_ms: same=true; tc001=180000; tc002=180000
- no_event_timeout_ms: same=true; tc001=30000; tc002=30000
- checkpoint_state_path: same=false; tc001="evals/effectiveness/reports/test-coverage-001/treatment-generic-test-coverage-state.json"; tc002="evals/effectiveness/reports/test-coverage-002/treatment-generic-test-coverage-state.json"
- artifact_output_paths: same=true; tc001=["artifacts/dev-result.json","artifacts/eval-report.json","artifacts/FinalDeliveryReport.md"]; tc002=["artifacts/dev-result.json","artifacts/eval-report.json","artifacts/FinalDeliveryReport.md"]
- source_modification_allowed: same=false; tc001="src/invoice.js only if tests expose a real bug"; tc002="src/cache.js or src/cache-storage.js only if tests expose a real bug"

## Recommended Fixes
- Keep TC002 dev-worker exact prompt no larger than the TC001 proven prompt envelope.
- Run parity/minimal/exact dev-worker smokes before a treatment rerun.
- Do not change source files unless tests expose a real implementation bug.
