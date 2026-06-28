# Agents

Custom agents live in `.codex/agents/`.

| Name | Responsibility | Sandbox | Inputs | Outputs | Forbidden |
| --- | --- | --- | --- | --- | --- |
| `planner` | Create PRD, acceptance criteria, TaskGraph, modular plans | read-only | User goal, source-of-truth docs | PRD, acceptance criteria, TaskGraph | Production code edits |
| `dev_worker` | Implement one module/task/repair request | workspace-write | TaskNode, RepairRequest, PRD, TaskGraph | DevResult, changed files, validation evidence | Scope expansion, next module |
| `evaluator` | Read-only evidence evaluation | read-only | PRD, TaskGraph, diff, tests, artifacts | EvalReport PASS/NEEDS_REVISION | File mutation, repair work |
| `context_distiller` | Create ContextCapsule for restart | read-only | State docs, events, findings | ContextCapsule JSON | Inventing facts, changing requirements |
| `integration_manager` | Integrate evaluator-approved modules | workspace-write | PASS evidence, artifacts, validation logs | FinalDeliveryReport | Bypassing evaluator findings |
| `test_reviewer` | Review test coverage and validation | read-only | Tests, validation commands | Test review JSON | File mutation |
| `architecture_reviewer` | Review boundaries and maintainability | read-only | Source and plans | Architecture review JSON | File mutation |

Agent concurrency is configured in `.codex/config.toml`:

```toml
[agents]
max_threads = 6
max_depth = 1
```
