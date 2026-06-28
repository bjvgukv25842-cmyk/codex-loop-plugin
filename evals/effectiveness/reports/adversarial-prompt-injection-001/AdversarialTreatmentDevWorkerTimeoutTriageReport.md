# Adversarial Treatment Dev Worker Timeout Triage

Failure category: ADVERSARIAL_DEV_WORKER_TURN_TIMEOUT
Planner thread present: true
Dev worker thread present: true
Dev worker completed: false
Event count: 59
Last event type: item.completed
Elapsed ms: 180034
Timeout ms: 180000

## Validation

- npm test run: false
- security contract run: false
- validation passed: false
- security contract passed: false
- security scan clean: true

## Path Alignment

- smoke exact status: PASS
- smoke exact path hash: 549ba67261523a16a5949edff03bb0db899929bcb3e351bee2cf1ec88f0be549
- treatment dev worker path hash: d6981d7c89dac964ef27fe621e187591e59b4f1ab3a4a3caa65ad09a186a501c
- path mismatch detected: false
- treatment uses three phase dev worker: true

## Recommended Fixes

- Use the proven exact smoke three-phase dev-worker stage in treatment: Edit, deterministic Validate, read-only Finalize.
- Keep treatment target repo isolated from smoke target, but use the same prompt, schema, security context, and validation contract.
- Rerun exactly one adversarial treatment-only fresh canary after this dry-run repair is verified.
