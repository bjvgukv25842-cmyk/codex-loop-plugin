# MCP Tools

The MCP server is `codex_loop_store`. It exposes local state operations only.

All write tools return `id`, `status`, and `event_id`. Read tools return a structured item/list result or a structured `not_found` error.

| Tool | Input | Output | Write | Safety Boundary |
| --- | --- | --- | --- | --- |
| `loop_create_run` | `{ payload: LoopRun }` | write result | yes | Validates LoopRun; no shell/network |
| `loop_get_state` | `{ loop_run_id }` | LoopRun item | no | Read-only local state |
| `loop_update_state` | `{ loop_run_id, patch }` | write result | yes | Patches LoopRun; schema validated by store |
| `loop_append_event` | `{ payload: LoopEvent }` | write result | yes | Appends bounded event only |
| `agent_register` | `{ payload: AgentProfile }` | write result | yes | Validates AgentProfile |
| `agent_get` | `{ agent_id }` | AgentProfile item | no | Read-only local state |
| `agent_update_thread` | `{ agent_id, current_thread_id }` | write result | yes | Updates thread id only |
| `agent_list` | `{}` | AgentProfile list | no | Read-only local state |
| `task_create` | `{ payload: TaskNode }` | write result | yes | Validates TaskNode |
| `task_get` | `{ task_id }` | TaskNode item | no | Read-only local state |
| `task_update_status` | `{ task_id, status }` | write result | yes | Status enum only |
| `task_list_by_loop` | `{ loop_run_id }` | TaskNode list | no | Read-only local state |
| `artifact_write` | `{ payload: Artifact }` | write result | yes | Records artifact metadata only |
| `artifact_get` | `{ artifact_id }` | Artifact item | no | Read-only local state |
| `artifact_list_by_task` | `{ task_id }` | Artifact list | no | Read-only local state |
| `eval_write_report` | `{ payload: EvalReport }` | write result | yes | Validates EvalReport and business rules |
| `eval_get_report` | `{ eval_id }` | EvalReport item | no | Read-only local state |
| `eval_list_by_task` | `{ task_id }` | EvalReport list | no | Read-only local state |
| `repair_create_request` | `{ payload: RepairRequest }` | write result | yes | Validates RepairRequest |
| `repair_get_request` | `{ repair_id }` | RepairRequest item | no | Read-only local state |
| `repair_list_by_task` | `{ task_id }` | RepairRequest list | no | Read-only local state |
| `context_capsule_write` | `{ payload: ContextCapsule }` | write result | yes | Validates ContextCapsule and business rules |
| `context_capsule_get` | `{ capsule_id }` | ContextCapsule item | no | Read-only local state |
| `context_capsule_list_by_agent` | `{ agent_id }` | ContextCapsule list | no | Read-only local state |

## Testing

Run the MCP unit tests:

```bash
npm test -- tests/mcp/tools.test.ts
```

Run the live stdio MCP check:

```bash
npm run real:verify-mcp
```

The live check uses a temporary `CODEX_LOOP_STATE_DIR`, verifies all required tools are listed, confirms no shell-like MCP tools are exposed, writes a valid LoopRun and EvalReport, rejects an invalid EvalReport payload, verifies structured `not_found`, and confirms write operations append event records.
