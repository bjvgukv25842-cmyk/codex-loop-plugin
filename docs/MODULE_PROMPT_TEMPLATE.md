# Module Run Prompt Template

Use this template when asking Codex to implement one module. Do not repeat the full project background.

```text
$codex-loop

继续实现 codex-loop-plugin。

当前模块：M{number} - {module_name}

请严格遵守：

- AGENTS.md
- .agent/PLANS.md
- docs/IMPLEMENTATION_PLAN.md
- docs/LOOP_PROGRESS.md
- docs/DECISIONS.md
- skills/codex-loop/SKILL.md

本轮只做当前模块，不要进入下一模块。

本模块目标：
{写清楚目标}

本模块必须产出：
{列出文件或功能}

本模块验收标准：
{列出验收标准}

建议验证命令：
{列出命令；如果不存在，请先检查项目脚本并选择最合适的验证方式}

执行流程：
1. 先阅读相关文档和现有代码。
2. 输出本模块实现计划。
3. 修改文件。
4. 运行验证。
5. 修复当前模块内的问题。
6. 更新 docs/IMPLEMENTATION_PLAN.md。
7. 更新 docs/LOOP_PROGRESS.md。
8. 如产生架构选择，更新 docs/DECISIONS.md。
9. 输出模块完成报告。

不要：
- 不要一次性实现其他模块。
- 不要跳过验证。
- 不要删除未理解的代码。
- 不要把未完成内容说成完成。
```
