# Codex Loop State Machine

Use this reference when executing `$codex-loop` or when another skill needs the whole loop order.

## States

1. `GOAL_RECEIVED`
2. `PRD_DRAFTING`
3. `PRD_READY`
4. `TASK_GRAPH_READY`
5. `DEV_RUNNING`
6. `DEV_DONE`
7. `EVAL_RUNNING`
8. `REPAIR_REQUESTED`
9. `VALIDATION_RUNNING`
10. `READY_FOR_NEXT_MODULE`
11. `READY_FOR_MERGE`
12. `DONE`
13. `BLOCKED`
14. `CONTEXT_RESTARTING`

## Transitions

- Goal received -> PRD drafting: normalize the user goal.
- PRD drafting -> PRD ready: docs/PRD.md and docs/ACCEPTANCE_CRITERIA.md exist.
- PRD ready -> task graph ready: docs/TASK_GRAPH.json validates against the M1 task graph contract.
- Task graph ready -> dev running: pick one ready task and assign owner_agent_type.
- Dev running -> dev done: implementation result and validation evidence exist.
- Dev done -> eval running: evaluator receives PRD, task graph, diff, artifacts, and validation logs.
- Eval running -> ready for next module: EvalReport verdict is PASS and validation evidence supports it.
- Eval running -> repair requested: EvalReport verdict is NEEDS_REVISION and required_fixes are present.
- Repair requested -> dev running: Dev Worker repairs only listed findings.
- Any active state -> context restarting: context is long, noisy, compacted, or unreliable.
- Context restarting -> previous active state: ContextCapsule preserves restart state and next_instruction.
- Ready for next module -> done: all required modules pass and final report exists.

## Failure Rules

- Do not advance when validation fails.
- Do not advance when evaluator returns NEEDS_REVISION.
- Do not repair outside required_fixes.
- Do not bypass evaluator PASS for integration.
- Do not invent state from chat memory.
