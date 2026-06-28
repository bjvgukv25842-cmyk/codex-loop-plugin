# Gate 6B.1D SDK-vs-CLI Parity Smoke Report

Date: 2026-06-20

Run status: PASS
Verify status: PASS
Real SDK run attempted: true
Direct CLI parity status: PASS
SDK thread started: true
SDK thread id: 019ee441-7b5e-77a0-a1c2-0432f6511108
Failure category: 
Model: gpt-5.5
Model catalog: /Users/litmus/Downloads/codex-loop-plugin/evals/sdk-orchestrated/model-catalog-bundled.json
Target repo: tmp/sdk-orchestrated/gate6b-smoke-target
M12 blocked: true

This smoke starts at most one read-only SDK thread and exists to prove SDK invocation parity before the three-thread Gate 6B.1 smoke.

Default dry-run behavior returns `BLOCKED_SDK_PARITY_NOT_ENABLED` unless `CODEX_LOOP_ENABLE_REAL_SDK_PARITY=1` is explicitly set in a controlled host terminal.

Only after SDK parity PASS should `CODEX_LOOP_ENABLE_REAL_SDK_RUN=1 npm run gate6b:smoke:run` be attempted.

