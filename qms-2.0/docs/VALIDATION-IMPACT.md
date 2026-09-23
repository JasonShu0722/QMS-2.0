# 变更验证推荐

本页是[变更影响分析](CHANGE-IMPACT.md)的辅助入口。规则清单是 `../governance/validation-impact.json`，执行器是 `../scripts/recommend-validation.mjs`；两者由 `check:governance` 校验。命令从 `qms-2.0/` 执行，并先加载 Git 外的 `Enter-Qms.ps1` 以使用仓库要求的 Node 与 pnpm。

```powershell
corepack pnpm validation:recommend
corepack pnpm validation:recommend --base origin/main
corepack pnpm validation:recommend --format json
```

默认比较当前工作区与 `HEAD`，包含未提交和非忽略的未跟踪文件。`--base` 还纳入基线到 `HEAD` 的提交改动，适合功能分支审查；基线必须是当前仓库已有的 Git ref。结果列出源码指纹、命中规则、推荐命令、权威文档和未知路径。JSON 输出可交给后续工具读取，但结果本身不会执行命令或写入证据报告。

相同路径可命中多个规则，命令合并去重。文档复核还会根据机器索引中的来源摘要反向发现受影响的权威文档。开放维护台账中的来源文件发生改动时，结果会同时列出对应的 `MAINT-*`、负责人、复核截止日和下一步；这只是联动提示，不能自动关闭事项。公共权限、迁移、流程、附件/Worker、部署与依赖变更扩大推荐范围；未知路径、空改动或被安全策略排除的文件触发保守清单和人工判定。删除文件也纳入路径判断。

JSON 中的 `needsManualReview` 只标识路径归类存在未知或缺少改动信息；即使值为 `false`，工程师仍须复核业务影响与实际验收范围。

推荐只帮助确定应查什么，不证明检查已运行，也不能降低[开发治理](DEVELOPMENT-GOVERNANCE.md)及根 `AGENTS.md` 的功能级、阶段级和发布级门禁。特别是阶段命令需要一次性 PostgreSQL、对象存储、Worker 和浏览器前置条件；缺少时应按原脚本失败并记录 `NOT_RUN`，不能以局部测试 PASS 代替。新增路径或变更分类时先更新规则和反例测试，再运行 `corepack pnpm check:governance`。
