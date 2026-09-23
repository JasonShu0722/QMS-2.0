# QMS 运行观测与隔离演练实施计划

**目标：** 落地 P2-06 的试点准备基础，并用真实隔离资源取得演练证据。

**设计：** [运行观测与隔离演练设计](../specs/2026-09-23-qms-operability-readiness-design.md)。

**文件职责：** `apps/api/scripts/operations-snapshot.mjs` 只读聚合 Outbox/扫描状态；`test/operations-snapshot.test.mjs` 检查目标拒绝与输出；`apps/api/test/operations/operations-snapshot.acceptance.mjs` 在真实 PostgreSQL 验证计数。`docs/OPERABILITY-READINESS.md` 说明指标语义、手工取证和演练边界。`apps/api/package.json` 提供命令，机器文档索引与导航保持同步。

- [x] 先写拒绝 55440/远程/非一次性目标和聚合结果的失败测试。
- [x] 实现只读事务查询和 JSON 输出，不输出 URL、载荷、错误正文、文件名。
- [x] 用一次性 PostgreSQL 实测数据变化，并复跑现有备份/恢复验收；核对容器归属后清理资源。
- [x] 更新中文运维、导航、来源摘要和计划事实；运行治理、专项测试与受影响构建检查。

## 实际结果

2026-09-23 在带 `qms.task=p2-ops-20260923-r3` 标签的一次性 PostgreSQL 18、MinIO 上执行：`operations-snapshot.acceptance.mjs` 1/1 PASS；已有 `data-protection.acceptance.mjs` 8/8 PASS；API 构建、迁移、空队列 CLI 快照均通过。原始日志、快照与加密备份位于 Git 外 `D:/WorkSpace/QMS-2.0-local/p2-ops-validation-20260923-r3/reports/`，本轮两个容器与监听端口已清理。前两次失败分别是新夹具 SQL 参数类型冲突，以及旧验收默认错误容器不存在；失败记录在 `p2-ops-validation-20260923/` 与 `p2-ops-validation-20260923-r2/`，没有删改原断言或把失败计作通过。

最终治理、契约、Lint、构建与默认测试结果见 Git 外 `D:/WorkSpace/QMS-2.0-local/p2-continuation-20260923/`。本轮只交付一次性数据库采样和隔离演练；生产指标采集、关键操作失败观测、阈值、告警渠道和试点故障注入仍未验收，开放事项为 `MAINT-003`。
