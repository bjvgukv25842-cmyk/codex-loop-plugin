# Usage

## Start The Loop

Use the main skill:

```text
$codex-loop

Continue implementing this repository one module at a time.
```

For module-specific work, use `docs/MODULE_PROMPT_TEMPLATE.md`.

## Execute M0-M10

Each module should:

1. Read `AGENTS.md`, `.agent/PLANS.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/LOOP_PROGRESS.md`, and `docs/DECISIONS.md`.
2. State the module goal, inputs, outputs, files to modify, validation commands, and risks.
3. Make scoped changes only.
4. Run validation.
5. Update implementation plan, progress, and decisions.
6. Stop before entering the next module.

## CLI Commands

```bash
npm run loop -- loop init --goal "Implement feature" --module-id M7
npm run loop -- loop status --loop-run-id loop_123
npm run loop -- loop plan --loop-run-id loop_123
npm run loop -- loop run --loop-run-id loop_123
npm run loop -- loop eval --eval-id eval_123
npm run loop -- loop repair --repair-id repair_123
npm run loop -- loop capsule --loop-run-id loop_123 --agent-id agent_dev_worker --restart-reason "Context is long" --next-instruction "Continue current module"
npm run loop -- loop report --loop-run-id loop_123 --path artifacts/FinalDeliveryReport.md
```

`loop run` advances one state-machine step. It does not call a real Codex SDK runtime.

## View State

Default runtime state files:

- `state/loop-runs.json`
- `state/agents.json`
- `state/tasks.json`
- `state/artifacts.json`
- `state/eval-reports.json`
- `state/repair-requests.json`
- `state/context-capsules.json`
- `state/events.json`

Set `CODEX_LOOP_STATE_DIR` to redirect state for tests or isolated runs.

## Generate A Capsule

Use CLI:

```bash
npm run loop -- loop capsule --loop-run-id loop_123 --agent-id agent_dev_worker --restart-reason "Thread is long" --next-instruction "Continue the repair request"
```

Or use `$context-distiller` to produce schema-compatible ContextCapsule JSON from source-of-truth files.

## Handle NEEDS_REVISION

1. Evaluator returns EvalReport with `verdict: "NEEDS_REVISION"`.
2. `EvaluationGate` creates a RepairRequest.
3. Dev Worker repairs only the listed findings.
4. Validation reruns.
5. Evaluator returns PASS or another NEEDS_REVISION.

Do not broaden repair scope unless the user approves it.
