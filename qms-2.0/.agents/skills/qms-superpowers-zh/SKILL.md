---
name: qms-superpowers-zh
description: Use when implementing, reviewing, debugging, or planning QMS 2.0 changes that can modify behavior, contracts, data, permissions, workflows, or acceptance evidence.
---

# QMS Superpowers 工作流

这是 QMS 2.0 的项目级流程入口。它把 `superpowers-zh` 的通用方法接到 QMS 的目录、真实资源和验收规则上，避免只写计划而漏掉执行门禁。

## 触发边界

以下任务必须使用本技能：

- 新功能、缺陷修复、API/数据库/权限/流程/前端行为变更
- 阶段计划执行、子代理分派、跨层重构或真实验收
- 影响交接、治理、契约或能力状态的文档变更

纯问答、只读调查和不改变内容的查看可以不启动完整流程。

## 强制路由

按任务需要加载以下 `superpowers-zh` 子技能：

1. 设计或行为变化：`brainstorming`，然后 `writing-plans`。
2. 开始实现计划：`using-git-worktrees`，检查隔离、依赖和基线测试；活动位置仍以仓库要求为准，先核对当前 Git 状态。
3. 有两个以上相互独立的任务：`dispatching-parallel-agents`；有实现计划：`subagent-driven-development`。
4. 每个实现任务：子代理使用 `test-driven-development`，先红灯、最小实现、绿灯和邻近回归。
5. 每个任务完成：先 `requesting-code-review` 做规格审查，再做质量审查；反馈返修使用 `receiving-code-review`，修复后重新审查。
6. 宣称完成或进入合并前：`verification-before-completion`，最后按 `finishing-a-development-branch` 收尾。

没有完成前置技能和证据时，不得跳到后置技能，也不得把“计划已写”说成“开发已完成”。纯文档维护按交付流程简化，Skill 指令修改使用 `writing-skills` 与对应编写 / 验证规则，不为文本改动启动不相关业务资源或创造 Issue / PR。

## QMS 专属门禁

- 活动源码、测试和 Docker 构建上下文只能在 `qms-2.0/`；`archive/qms-1.0/` 只读。
- 子代理必须收到完整任务文本、领域背景、依赖、文件所有权和验证命令；不得要求子代理自行猜测计划上下文。
- 每个实现任务使用一个全新实现子代理。只在无共享写入和顺序依赖时并行；公共注册、权限目录、生成契约和阶段文档由主代理统一修改。共享 checkout 的 Git 索引、分支操作和验证期间写入按[工程工具](../../../docs/ENGINEERING-TOOLS.md)串行协调。
- 子代理报告 `DONE_WITH_CONCERNS`、`NEEDS_CONTEXT` 或 `BLOCKED` 时，先处理状态再推进；不得用另一个未经说明的重试掩盖阻塞。
- API DTO 变化必须运行 `contracts:generate`、`contracts:check`；生成文件不得手工编辑。
- 关键功能必须使用真实 PostgreSQL、Worker、对象存储、扫描服务和浏览器证据；不得用 SQLite、Mock 或 Skip 替代计划要求。
- 每次交付至少运行 `corepack pnpm check:governance`，并按计划运行受影响测试、构建和真实资源验收。
- 核对用户单次与持续授权，已覆盖的动作主动接续、不重复询问；具体限制优先，不把常规提交 / PR 授权扩大为合并、发布或删除。

## Issue、PR 与发布闭环

涉及需求、缺陷或维护优化时，先阅读[需求交付与功能维护流程](../../../docs/DELIVERY-MAINTENANCE-PROCESS.md)，固定分组、授权来源、当前检查点和下一主动动作；不按记录数量或共享文件机械建单。常规修复按负责人持续授权先复用 / 创建 Issue，验证与两阶段审查通过后提交 / 推送并创建 / 更新 PR。纯文档免 Issue / PR，明确只策划 / 只本地限制优先。

建 Issue 与最终提交 PR 是独立检查点：实现前完成建单，验证审查后主动提交 PR，不能仅列为后续建议。合并前同目标修复接续原 PR，合并后代码修复另建关联修复 PR；PR 用普通关联，不提前自动关闭 Issue。多单元 base / head / 检查范围与依赖接续按交付流程核对。

飞书阶段状态本身仍只授权本地开发；符合持续授权条件的明确接单按常规分支推进。确实只本地时保存草案再实现，但用户要求先建外部 Issue 的顺序不能被草案例外覆盖。缺少合并发布授权不妨碍已授权的 Issue 和 PR；其他外部动作按具体授权接续。

合并 / 目标分支推送前核对发布效果与授权，纯文档也可能触发 CD。发布后逐版本核对真实部署，再在最终版本逐需求及联合回归；代理、CI、负责人手动确认分别按[治理格式](../../../docs/DEVELOPMENT-GOVERNANCE.md)记录实际覆盖，不能批量勾选未知项或伪造自动日志。关闭回填及只读字段接续按交付流程执行。

交付前完成计划中的规则沉淀及治理 / 适用行为验证。通用规则维护在交付流程，技能保留路由，具体数量和操作安排留在专项设计 / 计划。沉淀无新增内容时记录理由，不为单次案例扩大项目要求。

## 交接记录

每个任务完成时记录：实现子代理、文件范围、基线/当前 Git 状态、红灯和绿灯命令、规格审查结论、质量审查结论、主代理独立验证结果和未完成限制。阶段验收写入 `qms-2.0/docs/PHASE-*.md`。

## 常见遗漏

| 说法 | 正确处理 |
| --- | --- |
| “只是改一个字段” | 先判断 DTO、迁移、权限、契约和回滚影响。 |
| “代理说完成了” | 检查实际 diff、完整输出、退出码和真实资源证据。 |
| “几个领域可以一起做” | 先画文件所有权和依赖；共享文件不得并行写。 |
| “测试最后补” | 删除实现，按 TDD 重新开始。 |
| “外部接口以后再说” | 现在只记录端口、字段、认证、样本和未启用状态，不伪造集成 PASS。 |
