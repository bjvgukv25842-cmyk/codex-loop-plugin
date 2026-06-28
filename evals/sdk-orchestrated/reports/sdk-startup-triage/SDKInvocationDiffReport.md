# Gate 6B.1E SDK Invocation Diff Report

Date: 2026-06-20

Status: SDK_INVOCATION_DIFF_DETECTED
Planner smoke mode compared: minimal
Real SDK run executed: false

## Traces

- sdk_parity: evals/sdk-orchestrated/reports/sdk-startup-triage/sdk-parity-invocation-trace-redacted.json (untrusted test/mock trace)
- gate6b_planner: evals/sdk-orchestrated/reports/sdk-startup-triage/gate6b-smoke-planner-invocation-trace-redacted.json (missing)
- planner_smoke: evals/sdk-orchestrated/reports/sdk-startup-triage/planner-smoke-minimal-invocation-trace-redacted.json (missing)

## Differences

- workingDirectory: {"gate6b_planner":"","planner_smoke":"","sdk_parity":"/Users/litmus/Downloads/codex-loop-plugin/tmp/sdk-orchestrated/gate6b-smoke-target"}
- target_repo_absolute_path: {"gate6b_planner":"","planner_smoke":"","sdk_parity":"/Users/litmus/Downloads/codex-loop-plugin/tmp/sdk-orchestrated/gate6b-smoke-target"}
- target_repo_git_status: {"gate6b_planner":"","planner_smoke":"","sdk_parity":""}
- CODEX_SQLITE_HOME: {"gate6b_planner":"","planner_smoke":"","sdk_parity":"present"}
- sqlite_home: {"gate6b_planner":"","planner_smoke":"","sdk_parity":"/Users/litmus/Downloads/codex-loop-plugin/.codex-eval/sqlite"}
- model_catalog_json: {"gate6b_planner":"","planner_smoke":"","sdk_parity":"/Users/litmus/Downloads/codex-loop-plugin/package.json"}
- model: {"gate6b_planner":"","planner_smoke":"","sdk_parity":"gpt-5.5"}
- sandboxMode: {"gate6b_planner":"","planner_smoke":"","sdk_parity":"read-only"}
- skipGitRepoCheck: {"gate6b_planner":null,"planner_smoke":null,"sdk_parity":false}
- usesOutputSchema: {"gate6b_planner":false,"planner_smoke":false,"sdk_parity":false}
- outputSchemaPath: {"gate6b_planner":"","planner_smoke":"","sdk_parity":""}
- outputSchemaHash: {"gate6b_planner":"","planner_smoke":"","sdk_parity":""}
- prompt_length: {"gate6b_planner":null,"planner_smoke":null,"sdk_parity":46}
- prompt_hash: {"gate6b_planner":"","planner_smoke":"","sdk_parity":"6a5e2e25594cb04d249b541a7cda908092a01cbbabb45820c2548ca5884c8769"}
- config_keys: {"gate6b_planner":[],"planner_smoke":[],"sdk_parity":["model","model_catalog_json","sqlite_home"]}
- env_keys: {"gate6b_planner":[],"planner_smoke":[],"sdk_parity":["BASE_URL","CODEX_CI","CODEX_INTERNAL_ORIGINATOR_OVERRIDE","CODEX_LOOP_DIRECT_CLI_PARITY_EVENTS_PATH","CODEX_LOOP_ENABLE_REAL_SDK_PARITY","CODEX_LOOP_GATE6B_SDK_PARITY_MOCK","CODEX_LOOP_MODEL_CATALOG_JSON","CODEX_LOOP_SDK_PARITY_RESULT_PATH","CODEX_SHELL","CODEX_SQLITE_HOME","CODEX_THREAD_ID","COLOR","COLORTERM","COMMAND_MODE","DEV","DISABLE_AUTO_UPDATE","EDITOR","FORCE_TTY","GH_PAGER","GIT_PAGER","HOME","INIT_CWD","LANG","LC_ALL","LC_CTYPE","LOGNAME","LOG_FORMAT","MODE","MallocNanoZone","NODE","NODE_ENV","NO_COLOR","OSLogRateLimit","PAGER","PATH","PROD","PWD","REDACTED_SENSITIVE_ENV_KEY","RUST_LOG","SHELL","SHLVL","SSR","TERM","TEST","TMPDIR","USER","VITEST","VITEST_MODE","VITEST_POOL_ID","VITEST_WORKER_ID","XPC_FLAGS","XPC_SERVICE_NAME","ZSH_TMUX_AUTOSTART","ZSH_TMUX_AUTOSTARTED","_","__CFBundleIdentifier","__CF_USER_TEXT_ENCODING","npm_command","npm_config_cache","npm_config_global_prefix","npm_config_globalconfig","npm_config_init_module","npm_config_local_prefix","npm_config_node_gyp","npm_config_noproxy","npm_config_npm_version","npm_config_prefix","npm_config_user_agent","npm_config_userconfig","npm_execpath","npm_lifecycle_event","npm_lifecycle_script","npm_node_execpath","npm_package_json","npm_package_name","npm_package_version"]}
- sdk_api_method: {"gate6b_planner":"","planner_smoke":"","sdk_parity":"runStreamed"}
- node_process_cwd: {"gate6b_planner":"","planner_smoke":"","sdk_parity":"/Users/litmus/Downloads/codex-loop-plugin"}
- error_capture_paths: {"gate6b_planner":{},"planner_smoke":{},"sdk_parity":{"result_path":"/var/folders/6l/hbp_wrfn59xcgt210xbxpxbr0000gn/T/sdk-parity-smoke-test-KirLTC/evals/sdk-orchestrated/reports/sdk-startup-triage/sdk-parity-smoke-result.json"}}

M12 blocked: true

