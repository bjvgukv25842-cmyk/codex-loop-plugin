# M12.3B.3 Gate Policy Triage

Case: bugfix-small-001

Status: gate policy bug detected

## Evidence

- Case category: bugfix
- Treatment status: PASS
- Initial evaluator verdict: PASS
- Final evaluator verdict: PASS
- RepairRequest created: false
- Planner thread id present: true
- Dev Worker thread id present: true
- Evaluator thread id present: true
- FinalReport present: true
- Validation passed: true
- Secret leak detected: false
- Danger full access used: false

## Policy Finding

bugfix-small-001 completed through the generic direct PASS path:

Planner -> Dev Worker -> Evaluator PASS -> FinalReport

Because the evaluator did not return NEEDS_REVISION, the treatment did not need a RepairRequest or Repair Dev Worker. The previous release gate treated the missing repair_dev_worker_thread_id as incomplete thread evidence, which is too strict for generic feature and bugfix cases that pass on the first evaluation.

## Recommended Fix

Allow non-repair PASS path for generic bugfix cases. Keep repair-loop cases strict, and require RepairRequest plus Repair Dev Worker only when the case is a repair-loop case or any evaluator verdict is NEEDS_REVISION.
