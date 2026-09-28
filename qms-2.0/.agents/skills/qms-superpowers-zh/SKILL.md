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
2. 开始实现计划：`using-git-worktrees`，检查隔离、依赖和基线测试。
3. 有两个以上相互独立的任务：`dispatching-parallel-agents`；有实现计划：`subagent-driven-development`。
4. 每个实现任务：子代理使用 `test-driven-development`，先红灯、最小实现、绿灯和邻近回归。
5. 每个任务完成：先 `requesting-code-review` 做规格审查，再做质量审查；反馈返修使用 `receiving-code-review`，修复后重新审查。
6. 宣称完成或进入合并前：`verification-before-completion`，最后按 `finishing-a-development-branch` 收尾。

没有完成前置技能和证据时，不得跳到后置技能，也不得把“计划已写”说成“开发已完成”。

## QMS 专属门禁

- 活动源码、测试和 Docker 构建上下文只能在 `qms-2.0/`；`archive/qms-1.0/` 只读。
- 子代理必须收到完整任务文本、领域背景、依赖、文件所有权和验证命令；不得要求子代理自行猜测计划上下文。
- 每个实现任务使用一个全新实现子代理。只在无共享写入和顺序依赖时并行；公共注册、权限目录、生成契约和阶段文档由主代理统一修改。
- 子代理报告 `DONE_WITH_CONCERNS`、`NEEDS_CONTEXT` 或 `BLOCKED` 时，先处理状态再推进；不得用另一个未经说明的重试掩盖阻塞。
- API DTO 变化必须运行 `contracts:generate`、`contracts:check`；生成文件不得手工编辑。
- 关键功能必须使用真实 PostgreSQL、Worker、对象存储、扫描服务和浏览器证据；不得用 SQLite、Mock 或 Skip 替代计划要求。
- 每次交付至少运行 `corepack pnpm check:governance`，并按计划运行受影响测试、构建和真实资源验收。
- 未经用户明确要求，不提交、推送、合并或删除工作成果。

## Issue、PR 与发布闭环

涉及需求、缺陷或维护优化时，先阅读[需求交付与功能维护流程](../../../docs/DELIVERY-MAINTENANCE-PROCESS.md)，把用户目标拆成一个 Issue，并固定范围、验收标准、验证命令和回滚路径。使用项目工具完成实现、PR 审查和 Actions 检查；同一目标保持一条分支、一个 PR，后续修复继续回写并推送到原 Issue/PR。

合并前必须完成本地验证和 PR 检查；合并后还要核对主分支 Foundation、部署日志中的源码 SHA 与镜像、服务健康状态、HTTP 以及目标功能的线上证据。不能把绿色 Action 或部署退出码单独当作线上发布成功。线上证据确认后才关闭 Issue，并把根因、有效修复、无效尝试和可复用规则沉淀到上述流程文档或对应专项文档。

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
