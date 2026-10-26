# QMS 2.0 文档导航

本目录是 QMS 2.0 的中文工程文档入口。文档状态和权威关系由 `../governance/documentation-index.json` 维护，新增或废弃文档必须同步更新索引。

## 开发与治理

| 文档 | 用途 |
| --- | --- |
| [本轮整体开发与分批上线路径](../../docs/superpowers/plans/2026-10-24-qms-problem-management-delivery-roadmap.md) | 五条批准需求的主PR / 部署节点与开源提醒；N1 / N2已部署，N3按Issue #70本地推进，正式人工验收与业务开通独立 |
| [N2配置与流程基础细化](../../docs/superpowers/plans/2026-10-24-qms-n2-configuration-and-workflow-foundations.md) | N2-A组件 / 导入 / 批量维护及组织职责、N2-B受控关闭审核基础已部署a32615c；历史失败、修复、发布与人工边界分记 |
| [N3过程人工台账与完整内部8D](../../docs/superpowers/plans/2026-10-25-qms-n3-process-eight-d.md) | REQ-0026 / 0027的N3完整人工链；独立样例、TDD / 双审、真实验证，准备PR时停O3提醒开源，不提前推送或发布 |
| [N1 到期维护事项事实复核](N1-MAINTENANCE-REVIEW-2026-10-24.md) | 正式开工时复核弃用、备份容量及运维观测，三项仍开放；真实定向结果、失败与未知边界，不靠改日期或假关闭解除门禁 |
| [各板块问题管理研讨草稿](../../docs/superpowers/specs/2026-10-23-qms-domain-problem-management-discussion-draft.md) | 供 2026-10-24 讨论：旧版 / 当前源码差距、IMS、FAE、8D、SQE 关联发单、问题中心、指标与上线准备；未批准实施 |
| [本轮五条聚合需求提交记录](../../docs/superpowers/specs/2026-10-24-qms-five-requirement-submission.md) | 已提交飞书 REQ-0025～0029；5 个综合目标覆盖 74 内部细项，真实 record_id、字段回读及状态留痕，旧需求不删不重开 |
| [本轮完整需求清单](../../docs/superpowers/specs/2026-10-24-qms-problem-management-requirements-list.md) | 74 条仅作内部验收追溯；业务已确认、工程细化 / 接入资料 / 上线准备与后置分开，不再逐项建单或将整包技术细节返询负责人 |
| [基础管理前置交付计划](../../docs/superpowers/plans/2026-10-24-qms-basic-management-prerequisite.md) | N1 V0.0.28 / PR #65已部署b4e5115，机器发布核验与同根因返修证据；正式页面人工验收仍待完成，N2单独接续 |
| [REQ-0030 修复计划](../../docs/superpowers/plans/2026-10-26-req0030-admin-process-fix.md) | P0 / Issue #72，管理员内部组织全量权限、受控删除及审计检索、制程问题跟进与登记/出货入口；本地开发中 |
| [组织与岗位独立样例入口](../apps/web/organization-preview.html) | 本地开发服务打开 `/organization-preview.html`；负责人已认可页面交互，内存模拟不接真实 API 或默认生产入口，不代表真实角色或全设备验收 |
| [基础交互体系与场景覆盖设计](../../docs/superpowers/specs/2026-10-21-qms-interaction-system-design.md) | 已确认的控件选型、动作层级、20 组领域、完整状态与验收；样例确认先于正式迁移 |
| [可视化样例先行计划](../../docs/superpowers/plans/2026-10-21-qms-interaction-preview.md) | Issue #58、8 组独立交互样例、预览入口、TDD／构建排除／视觉确认及实际进度 |
| [第一批共享交互迁移计划](../../docs/superpowers/plans/2026-10-21-qms-interaction-foundation.md) | Issue #60、共享按钮／外观／语言／弹窗、本地验证及统一推送前的负责人仓库处理门禁 |
| [全部现有页面交互展开计划](../../docs/superpowers/plans/2026-10-21-qms-all-pages-interaction.md) | 102个正式TSX／真实路由及子面板盘点，分批红绿回归、审查、规范与样例回收；全部覆盖后才通知统一推送 |
| [岗位即角色设计](../../docs/superpowers/specs/2026-10-22-qms-position-as-role-design.md) | REQ-0024 岗位直接维护权限、创建即任职、历史授权与流程引用兼容；设计阶段，不代表已实现 |
| [岗位即角色实施计划](../../docs/superpowers/plans/2026-10-22-qms-position-as-role.md) | Issue #62，A～D交付单元、独立评审、真实资源验收与迁移授权边界 |
| [个人资料、岗位授权与角色清单规格](../../docs/superpowers/specs/2026-10-19-qms-profile-position-role-design.md) | REQ-0022／0023 自动生效、资料与签名边界、角色摘要及来源；已本地实现，最终联合验收及上线待完成 |
| [个人资料、岗位授权与角色清单计划](../../docs/superpowers/plans/2026-10-19-qms-profile-position-role.md) | 角色清单／完整岗位授权／资料账号中心三单元、调用方清单、TDD／联合验收与交付接续 |
| [个人账号与全页密度返修规格](../../docs/superpowers/specs/2026-10-19-qms-account-overview-density-design.md) | 人工验收后确认的账号整合、单一会话表及全页留白减半 |
| [个人账号与全页密度返修计划](../../docs/superpowers/plans/2026-10-19-qms-account-overview-density.md) | V0.0.21 本地实现、验证、审查、云端边界及新一轮人工检查 |
| [紧凑界面与账号、主数据、审计设计](../../docs/superpowers/specs/2026-10-18-qms-compact-account-master-audit-design.md) | REQ-0017～0021 的已批准目标、独立评审及最小实现边界 |
| [紧凑界面与账号、主数据、审计计划](../../docs/superpowers/plans/2026-10-18-qms-compact-account-master-audit.md) | 四个单元、Issue/PR、TDD、验证审查及授权接续 |
| [开发治理](DEVELOPMENT-GOVERNANCE.md) | 计划顶部当前摘要、工程完成条件、证据矩阵、质量门禁和独立审查 |
| [需求交付与功能维护流程](DELIVERY-MAINTENANCE-PROCESS.md) | 参与者、授权、主动版本分配、Issue / PR、发布验收与关闭回填的权威流程 |
| [工作流与治理整合设计](../../docs/superpowers/specs/2026-10-12-qms-workflow-integration-design.md) | 本轮已批准的职责整合、OpenClaw 只读分析、当前摘要与主动版本规则 |
| [工作流与治理整合计划](../../docs/superpowers/plans/2026-10-12-qms-workflow-integration.md) | V0.0.6 文档调整、规则推演、独立复核与实际验证状态 |
| [导航修复交付记录](../../docs/superpowers/plans/2026-10-09-qms-navigation-repair.md) | REQ-0006～0010 历史闭环及顶部当前摘要；V0.0.5 已推送事实与部署版本分开 |
| [P0/P1 开发策划与确认记录](../../docs/superpowers/plans/2026-10-17-qms-p0-p1-development-planning.md) | REQ-0013～0016 的已确认决定、源码差距、候选交付单元和未决范围；策划中，非已冻结实现计划 |
| [P0/P1 实施总计划](../../docs/superpowers/plans/2026-10-17-qms-p0-p1-implementation.md) | A～G 分组、F1/F2/F3、8 个功能单元、依赖、Issue/PR 映射、验收与关闭回填 |
| [A/B/E 外壳实施计划](../../docs/superpowers/plans/2026-10-17-qms-p0-p1-web.md) | 紧凑顶栏、个人菜单与真实扫描头像的文件、TDD、回归和独立交付 |
| [C/D 身份账号实施计划](../../docs/superpowers/plans/2026-10-17-qms-p0-p1-identity.md) | 首次改密、临时密码、批量幂等、长期会话和自主 MFA 的实施步骤 |
| [F1/F2/F3/G 基础数据实施计划](../../docs/superpowers/plans/2026-10-17-qms-p0-p1-master-data.md) | 供应商档案解耦与多账号、客户复用、两字段物料、逐行导入及外部只预留 |
| [P0/P1 身份与账号设计](../../docs/superpowers/specs/2026-10-17-qms-p0-p1-identity-account-design.md) | REQ-0013～0014 的登录、MFA、批量账号与临时密码设计规格 |
| [P0/P1 基础数据设计](../../docs/superpowers/specs/2026-10-17-qms-p0-p1-master-data-design.md) | REQ-0015 的供应商用户账号、供应商/客户/物料导入和外部接收预留规格 |
| [P0/P1 顶栏与个人入口设计](../../docs/superpowers/specs/2026-10-17-qms-p0-p1-shell-design.md) | REQ-0013/0016 的共享顶栏、工作标签、头像菜单和退出确认规格 |
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
