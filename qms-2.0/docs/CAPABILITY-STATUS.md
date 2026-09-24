# QMS 2.0 能力状态总账

本表是当前能力状态的导航，不替代各模块规格、阶段验收日志或生产发布批准。状态只在有对应证据时更新。

状态含义：

- `已验收`：当前实现有完整对应验收证据。
- `进行中`：已有实现或定向验证，但范围仍未闭环。
- `未开始`：尚未进入实现或没有可采信证据。
- `受限可用`：仅限明确的开发、测试或内部场景，不代表试点或生产放行。

| 能力域 | 当前状态 | 证据入口 | 主要限制 |
| --- | --- | --- | --- |
| 身份、会话和账号治理 | 已验收 | `FOUNDATION.md`、`ACCOUNT-ADMINISTRATION.md` | 生产密钥、SMTP 和 MFA 运维配置在仓库外 |
| 组织、角色和权限矩阵 | 已验收 | `FOUNDATION.md`、`PLATFORM-HANDOFF.md` | 新领域仍需单独证明权限覆盖 |
| 问题索引与问题工作空间 | 已验收 | `PHASE-2.md`、`PROBLEM-WORKSPACE.md` | 领域模块负责创建和维护专业事实 |
| 流程设计、版本和运行时 | 已验收 | `WORKFLOW-DESIGNER.md`、`PLATFORM-HANDOFF.md` | 不提供通用 BPMN 或任意脚本执行 |
| 待办、通知和 Worker | 已验收 | `PHASE-2.md`、`FOUNDATION.md` | 业务领域通知受众仍需领域联调 |
| 附件生命周期与扫描 | 已验收 | `ATTACHMENTS.md`、`FOUNDATION.md` | 生产对象存储、病毒库和保留策略需部署配置 |
| 审计、导出和追溯 | 已验收 | `FOUNDATION.md`、`DATA-PROTECTION.md` | 正式留存和导出授权需按环境配置 |
| 数据保护、TLS、密钥轮换 | 已验收 | `DATA-PROTECTION.md`、`FOUNDATION.md` | 生产灾备演练和云权限不包含在本地验收内 |
| 供应商质量领域开发 | 已验收 / 受限可用 | `PHASE-3.md`（2026-09-24 阶段三开发收尾门禁）、`SUPPLIER-PLATFORM-HANDOFF.md` | 阶段三开发与真实资源/浏览器主链已 PASS；真实供应商试点和生产发布仍需另行审批 |
| 供应商正式试点 | 未开始 | `PHASE-3.md` | 必须完成阶段三主链和试点门槛 |
| 制程不良品台账 | 进行中 | `PHASE-4.md`、`apps/api/src/modules/process-quality/`、真实 PostgreSQL 定向测试 | 正式问题发单、Worker/浏览器闭环和 MES/IMS 接入尚未完成 |
| 客户质量 | 进行中 | `PHASE-4.md`、`apps/api/src/modules/customer-quality/`、真实 PostgreSQL 定向测试 | 客诉发单、简报/8D、实物状态闭环、响应 DTO 与浏览器验收未完成 |
| 审核管理 | 进行中 | `PHASE-4.md`、`apps/api/src/modules/audit-management/`、真实 PostgreSQL 定向测试 | 模板检查项校验、NC 责任分离与期限政策、问题索引及浏览器验收未完成 |
| 新品质量 | 未开始 | `PHASE-4.md`、阶段四规格与计划 | 仅完成策划与跨域来源契约，尚无领域实现 |
| 生产发布 | 未开始 | `FOUNDATION.md`、`DATA-PROTECTION.md` | 尚未完成正式部署批准和生产灾备演练 |

更新本表时必须写明日期、对应源码范围、命令和实际结果。历史 PASS 不得覆盖当前较新代码的失败或未覆盖范围。
