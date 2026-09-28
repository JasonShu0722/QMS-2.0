# QMS 2.0 文档导航

本目录是 QMS 2.0 的中文工程文档入口。文档状态和权威关系由 `../governance/documentation-index.json` 维护，新增或废弃文档必须同步更新索引。

## 开发与治理

| 文档 | 用途 |
| --- | --- |
| [开发治理](DEVELOPMENT-GOVERNANCE.md) | 任务模板、证据矩阵、分层门禁、独立审查和模块边界 |
| [需求交付与功能维护流程](DELIVERY-MAINTENANCE-PROCESS.md) | Issue、实现、PR、Actions、部署、线上确认和复盘闭环 |
| [业务术语](DOMAIN-GLOSSARY.md) | 跨领域术语、权限与交付状态的区别 |
| [架构决策](ARCHITECTURE-DECISIONS.md) | 既有决策、原始来源、代价和重审条件 |
| [变更影响分析](CHANGE-IMPACT.md) | 新功能、缺陷、依赖升级的分析与复用模板 |
| [变更验证推荐](VALIDATION-IMPACT.md) | 根据 Git 改动推荐检查与文档复核，未知路径保守处理 |
| [维护与发布手册](OPERATIONS-RUNBOOK.md) | 故障诊断、发布、恢复及防复发记录 |
| [维护事项台账](MAINTENANCE-REGISTER.md) | 已知弃用和容量限制的触发、复核及关闭证据 |
| [运行观测与演练准备](OPERABILITY-READINESS.md) | 一次性数据库的 Outbox/扫描快照与备份恢复演练边界 |
| [文档复核机制](DOCUMENTATION-MAINTENANCE.md) | 索引、来源变化、复核到期与废弃规则 |
| [工程工具与 Skill](ENGINEERING-TOOLS.md) | 任务交接、源码快照、验收证据与三个专用 Skill |
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
