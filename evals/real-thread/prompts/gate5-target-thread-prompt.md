$codex-loop

你现在运行在一个隔离测试仓库中。请执行 codex-loop-plugin 的真实 E2E 自测目标任务。

任务：
修复 validateProjectName(name)，使测试通过。

要求：
1. 你必须按照 PRD → TaskGraph → Eval NEEDS_REVISION → RepairRequest → Dev Repair → Eval PASS → FinalReport 的 loop 执行。
2. 你必须先评估当前坏实现，不要一上来直接改代码。
3. 因为当前实现故意有 bug，所以第一次 Evaluator 必须输出 NEEDS_REVISION。
4. 然后根据 NEEDS_REVISION 生成 RepairRequest。
5. 然后 Dev Worker 只修复 RepairRequest 中的问题。
6. 修复后运行 npm test。
7. 测试通过后，Evaluator 输出 PASS。
8. 最后生成 FinalDeliveryReport。

必须创建：

- docs/PRD.md
- docs/ACCEPTANCE_CRITERIA.md
- docs/TASK_GRAPH.json
- artifacts/dev-result.json
- artifacts/eval-report-needs-revision.json
- artifacts/repair-request.json
- artifacts/eval-report-pass.json
- artifacts/FinalDeliveryReport.md
- state/events.json

实现要求：
- 空字符串失败。
- 纯空格失败。
- 超过 80 字符失败。
- 合法名称通过。
- validateProjectName 返回对象，至少包含 ok: boolean。
- 可以包含 reason 字段。
- 不要引入第三方依赖。
- 不要修改 package.json，除非测试命令无法运行。
- 不要访问网络。
- 不要读取 .env。
- 不要删除测试。

EvalReport NEEDS_REVISION 要求：
{
  "verdict": "NEEDS_REVISION",
  "findings": [
    {
      "severity": "high",
      "category": "correctness",
      "description": "Current validateProjectName implementation accepts invalid names.",
      "evidence": [],
      "required_fix": ""
    }
  ]
}

EvalReport PASS 要求：
{
  "verdict": "PASS",
  "findings": [],
  "validation_commands_checked": ["npm test"]
}

FinalDeliveryReport 必须包含：
- summary
- changed files
- validation commands
- validation result
- evaluator verdicts
- repair summary
- remaining risks

完成后，最终输出 JSON：

{
  "status": "PASS | NEEDS_REVISION | BLOCKED",
  "prd_created": true,
  "task_graph_created": true,
  "initial_eval_verdict": "NEEDS_REVISION",
  "repair_request_created": true,
  "final_eval_verdict": "PASS",
  "tests_passed": true,
  "changed_files": [],
  "artifacts": [],
  "validation_commands": [],
  "remaining_risks": []
}
