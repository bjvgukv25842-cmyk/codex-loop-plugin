# Skills

Skills live under `skills/*/SKILL.md`.

| Skill | Description | Trigger | Inputs | Outputs | Typical Prompt |
| --- | --- | --- | --- | --- | --- |
| `codex-loop` | Full modular loop coordination | `$codex-loop` | Goal, docs, state, artifacts | Module report JSON | `$codex-loop continue current module` |
| `prd-planner` | PRD and acceptance criteria generation | `$prd-planner` | User goal, implementation docs | PRDOutput JSON | `$prd-planner create PRD for this goal` |
| `task-decomposer` | TaskGraph generation | `$task-decomposer` | PRD and acceptance criteria | TaskGraph JSON | `$task-decomposer split this PRD into tasks` |
| `dev-worker` | Scoped implementation or repair | `$dev-worker` | TaskNode or RepairRequest | DevResult JSON | `$dev-worker implement TASK-001 only` |
| `evaluator` | Read-only evaluation | `$evaluator` | PRD, TaskGraph, diff, tests | EvalReport JSON | `$evaluator check this module against acceptance criteria` |
| `context-distiller` | Context capsule generation | `$context-distiller` | Progress, decisions, state, findings | ContextCapsule JSON | `$context-distiller create a restart capsule` |
| `integration-manager` | Final integration checks | `$integration-manager` | PASS evals, artifacts, validation | FinalDeliveryReport | `$integration-manager produce final delivery report` |

Skills define behavior. State must still be written to files/state store.
