# QMS 2.0 文档导航

本目录是 QMS 2.0 的中文工程文档入口。文档状态和权威关系由 `../governance/documentation-index.json` 维护，新增或废弃文档必须同步更新索引。

## 开发与治理

| 文档 | 用途 |
| --- | --- |
| [开发治理](DEVELOPMENT-GOVERNANCE.md) | 计划顶部当前摘要、工程完成条件、证据矩阵、质量门禁和独立审查 |
| [需求交付与功能维护流程](DELIVERY-MAINTENANCE-PROCESS.md) | 参与者、授权、主动版本分配、Issue / PR、发布验收与关闭回填的权威流程 |
| [工作流与治理整合设计](../../docs/superpowers/specs/2026-10-12-qms-workflow-integration-design.md) | 本轮已批准的职责整合、OpenClaw 只读分析、当前摘要与主动版本规则 |
| [工作流与治理整合计划](../../docs/superpowers/plans/2026-10-12-qms-workflow-integration.md) | V0.0.6 文档调整、规则推演、独立复核与实际验证状态 |
| [导航修复交付记录](../../docs/superpowers/plans/2026-10-09-qms-navigation-repair.md) | REQ-0006～0010 历史闭环及顶部当前摘要；V0.0.5 已推送事实与部署版本分开 |
| [业务术语](DOMAIN-GLOSSARY.md) | 跨领域术语、权限与交付状态的区别 |
| [架构决策](ARCHITECTURE-DECISIONS.md) | 既有决策、原始来源、代价和重审条件 |
| [变更影响分析](CHANGE-IMPACT.md) | 新功能、缺陷、依赖升级的分析与复用模板 |
| [变更验证推荐](VALIDATION-IMPACT.md) | 根据 Git 改动推荐检查与文档复核，未知路径保守处理 |
| [维护与发布手册](OPERATIONS-RUNBOOK.md) | 故障诊断、发布、恢复及防复发记录 |
| [OpenClaw 运维协作接入](OPENCLAW-OPS-HANDOFF.md) | 源码 / 文档只读分析、需求五字段初稿、字段责任、监控与机器人权限边界 |
| [维护事项台账](MAINTENANCE-REGISTER.md) | 已知弃用和容量限制的触发、复核及关闭证据 |
| [运行观测与演练准备](OPERABILITY-READINESS.md) | 一次性数据库的 Outbox/扫描快照与备份恢复演练边界 |
| [文档复核机制](DOCUMENTATION-MAINTENANCE.md) | 索引、来源变化、复核到期与废弃规则 |
| [工程工具与 Skill](ENGINEERING-TOOLS.md) | 命令环境、共享 Git 状态、浏览器接续、任务交接和验收证据 |
| [飞书需求开发启动 Skill](../.agents/skills/qms-start-development/SKILL.md) | 查看遗留工作或接单；评审后按有效授权主动推进对应检查点 |
| [功能交付 Skill](../.agents/skills/qms-feature-delivery/SKILL.md) | 根据当前事实主动推进交付，输出阶段产物、证据与下一动作 |
| [QMS 工程方法 Skill](../.agents/skills/qms-superpowers-zh/SKILL.md) | 工程方法路由；阶段细则引用交付流程 |
| [能力状态总账](CAPABILITY-STATUS.md) | 当前能力、验收状态、限制和试点/生产边界 |
| [Foundation](FOUNDATION.md) | 基础、平台和治理验收事实及历史记录 |
| [平台交接](PLATFORM-HANDOFF.md) | 平台接口、事务、权限和集成约束 |
| [供应商平台交接](SUPPLIER-PLATFORM-HANDOFF.md) | 供应商领域与平台的交接边界 |

## 领域和平台

| 文档 | 用途 |
| --- | --- |
| [账号管理](ACCOUNT-ADMINISTRATION.md) | 账号、组织、角色和治理范围 |
| [附件](ATTACHMENTS.md) | 附件生命周期、扫描和对象版本 |
| [数据保护](DATA-PROTECTION.md) | TLS、密钥、对象保护、备份和恢复 |
| [邮件恢复](EMAIL-RECOVERY.md) | 邮箱确认、找回和投递 Worker |
| [前端设计](FRONTEND-DESIGN.md) | 生产 Web 参考、迁移和验收 |
| [导航、登录工具栏与需求反馈设计](../../docs/superpowers/specs/2026-10-09-qms-navigation-and-feedback-design.md) | REQ-0006～0010 的设计与交付映射；已发布并经负责人手动最终验收、关闭回填 |
| [OpenAPI](OPENAPI.md) | API 契约生成与同步 |
| [阶段二](PHASE-2.md) | 平台实施和验收记录 |
| [阶段三](PHASE-3.md) | 供应商质量实施和未完成边界 |
| [阶段四](PHASE-4.md) | 制程、客户、新品和审核业务域策划入口 |
| [阶段五](PHASE-5.md) | 覆盖补齐、质量数据与增强能力策划入口 |

阶段五领域设计与实施计划：F4 [设计](../../docs/superpowers/specs/2026-09-26-qms-2.0-f4-audit-excel-import-design.md) / [计划](../../docs/superpowers/plans/2026-09-26-qms-2.0-f4-audit-excel-import.md)；C6 [设计](../../docs/superpowers/specs/2026-09-26-qms-2.0-c6-supplier-pcn-design.md) / [计划](../../docs/superpowers/plans/2026-09-26-qms-2.0-c6-supplier-pcn.md)。
| [问题工作空间](PROBLEM-WORKSPACE.md) | 问题读取、处理、历史和报告 |
| [安全](SECURITY.md) | 安全边界与已实现保护 |
| [流程设计器](WORKFLOW-DESIGNER.md) | 流程定义、版本和设计器行为 |

## 使用规则

开始任务先读本页、`DEVELOPMENT-GOVERNANCE.md` 和相关领域交接文档；完成任务后同步能力状态、验收记录和机器索引。
