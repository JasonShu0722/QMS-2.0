# MAINT-003 运维告警判定与隔离演练实施计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:executing-plans` 或 `superpowers:subagent-driven-development` 逐任务实现此计划。步骤使用复选框跟踪进度。

**目标：** 为 QMS 运行观测增加可测试的告警判定层，并在一次性 PostgreSQL 中验证故障触发与恢复。

**架构：** 复用现有 `operations-snapshot.mjs` 的只读采样结果，新增纯函数告警判定器和 stdin CLI，不引入生产监控依赖。一次性验收夹具只写入带唯一前缀的 Outbox/扫描记录，测试结束清理；生产指标出口和通知渠道继续作为 `MAINT-003` 后续工作。

**技术栈：** Node.js 22.22、内置 `node:test`、PostgreSQL、现有 `pg` 客户端。

---

### 任务 1：冻结告警策略与纯函数反例

**文件：**
- 创建：`qms-2.0/governance/operability-alerts.json`
- 创建：`qms-2.0/scripts/operations-alerts.mjs`
- 创建：`qms-2.0/test/operations-alerts.test.mjs`
- 修改：`qms-2.0/package.json`

- [x] 先写阈值越界、最高级别合并、`null` 年龄、非法输入和敏感字段不输出的失败测试。
- [x] 实现版本化策略、`evaluateObservation` 和 stdin CLI；退出码固定为 CLEAR=0、WARN=1、CRITICAL=2、UNKNOWN=3。
- [x] 将 `operations:alerts` 接入 API workspace 脚本。
- [x] 运行 `node --test test/operations-alerts.test.mjs`，确认全部通过（6/6）。

### 任务 2：真实隔离故障注入与恢复

**文件：**
- 创建：`qms-2.0/apps/api/test/operations/operations-alerts.acceptance.mjs`
- 修改：`qms-2.0/apps/api/package.json`

- [x] 在 `QMS_ACCEPTANCE_DISPOSABLE_DATABASE=true` 且 `qms_observe_` loopback 数据库中连接真实 PostgreSQL；使用临时 `qms-maint003-pg` 容器完成并已删除。
- [x] 验收脚本采样空基线并断言 CLEAR。
- [x] 验收脚本写入本批唯一前缀的失败 Outbox 和扫描错误记录，采样并断言 CRITICAL。
- [x] 验收脚本删除本批记录，重新采样并断言 CLEAR。
- [x] 验收脚本覆盖缺少前置条件的启动失败、预览端口和非一次性数据库拒绝路径。
- [x] 运行 `node --test test/operations/operations-alerts.acceptance.mjs`，2/2 通过；临时数据库容器已清理，日志未写入 Git。

### 任务 3：文档、台账和索引同步

**文件：**
- 修改：`qms-2.0/docs/OPERABILITY-READINESS.md`
- 修改：`qms-2.0/docs/MAINTENANCE-REGISTER.md`
- 修改：`qms-2.0/docs/README.md`
- 修改：`qms-2.0/governance/maintenance-items.json`
- 修改：`qms-2.0/governance/documentation-index.json`
- 修改：`docs/superpowers/plans/2026-09-23-qms-maint-003-operability-alerts.md`

- [x] 记录策略、命令、演练前置条件、清理要求及生产未覆盖边界。
- [x] 更新 `MAINT-003` 事实和下一步，保持 `open`，不得伪造生产关闭证据。
- [x] 更新受影响来源摘要；`OPERABILITY-READINESS.md` 已有导航入口，未重复新增导航项。
- [x] 运行 `corepack pnpm check:governance` 和 `corepack pnpm test:governance`。

### 任务 4：整体验证和交接

- [x] API lint、API build、OpenAPI contracts:check 和 `git diff --check` 均通过。
- [x] `corepack pnpm test` 通过：API 35 套件/435 测试，Web 27 文件/150 测试；仅保留既有 Ant Design 和 Node engine warning。
- [x] 已完成最终源码指纹、真实 PostgreSQL 触发/恢复结果和限制核对；Git 外交接报告待提交前由仓库脚本生成。
- [x] 已通过单元测试、真实 PostgreSQL 验收和代码检查覆盖范围漂移、生产误连接、敏感输出、清理和恢复路径。
