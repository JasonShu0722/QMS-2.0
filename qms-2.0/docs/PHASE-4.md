# 阶段四业务域策划入口

## 问题管理重建接续（2026-10-25）

本轮按[整体路径](../../docs/superpowers/plans/2026-10-24-qms-problem-management-delivery-roadmap.md)及[N2细化计划](../../docs/superpowers/plans/2026-10-24-qms-n2-configuration-and-workflow-foundations.md)继续：N2-A配置已部署V0.0.29 / 70fdbab，N2-B关闭审核基础在本地整合验证，尚未PR或部署。生产关闭领域适配器为空，新模板不能发布 / 开单；过程台账与完整报告、客户 / 新品 / 供应商链及IMS / AI仍按N3以后交付。下方2026-09-24记录是旧阶段源码与验收历史，不能替代本轮新业务规则的实现或上线证明。

## 当前状态

阶段三已在提交 `68b526c` 完成开发收尾并标记 PASS。阶段四代码已在提交 `a8216b5` 合并到 `main`，四个业务域的 API、Web 入口、迁移、定向数据库集成和构建门禁已完成。浏览器联合验收、附件扫描失败恢复和外部系统真实接入仍属于环境或后续阶段边界，不能以本地代码合并代替生产上线验收。

## 当前交接（2026-09-24）

- Wave0 来源关系和发单事务契约：PASS；来源快照、组织授权、`FOR UPDATE`、幂等、审计回滚和真实 PostgreSQL 证据已记录在对应集成测试中。
- 制程不良品台账：进行中范围已通过。已交付人工录入、类型字典、字段校验、列表/详情/归档、CAS、幂等、组织隔离、文件资源端口和 MES/IMS 外部标识预留；真实 PostgreSQL 迁移与 10 个定向测试通过。
- 客户质量已实现客户主数据、客诉台账、实物处置/解析历史、简报与 8D 工作流绑定、来源快照和动态关联；审核已实现模板项匹配、期限政策/工作日历版本记录、整改分派/回复/验证职责分离。新品已实现制程不良遴选、来源快照、问题升级、遗留问题、带病量产审批和发布 Workflow 绑定。审计 NC 与新品问题均写入统一 `problem_index`。四条领域链在一次性 PostgreSQL 上通过 9 个套件、54 个测试；编译 Worker 生命周期通过 3 个测试；Compose 配置通过。
- Web 已交付客户质量台账，以及审核管理和新品质量按 ID 查询的入口，并覆盖加载、错误、权限拒绝、空数据状态；契约、治理、API/Web lint、测试和构建均通过。浏览器安全前置测试通过 3 个用例；完整浏览器验收需在部署环境提供一次性 gateway、对象存储、邮件和夹具数据库后运行。
- 尚未交付：四条业务链真实浏览器联动、附件扫描与失败恢复。客户 8D 已支持从严重度政策快照读取 `approvalLevel`，并要求绑定同级别 `APPROVAL` 节点；新品 BRIEF→8D 已接入平台 Workflow 升级服务：保留领域修订、问题索引和流程实例身份，升级在 ReadCommitted 事务内原子切换并支持幂等回放。审核 NC 已增加版本化工作日历、服务端到期计算、Workflow 绑定和通用提醒事件；制程 Web 台账与 BRIEF 发单入口已交付。阶段四计划中的外部系统真实接入仍保持未完成状态。
- 外部 MES/IMS/ERP/SAP 仍只有字段、适配器端口和待核实状态，没有真实连接或集成 PASS；按阶段边界保留为后续接入项。

## 验收记录（2026-09-24）

| 项目 | 环境和命令 | 结果 |
| --- | --- | --- |
| 迁移与种子 | 一次性 `postgres:18`，本机 `55446`，独立 `qms_phase4_upgrade`；在 `apps/api` 执行 `prisma migrate deploy`、`prisma db seed` | PASS：49 个迁移及种子，新品修订表迁移成功 |
| 新品 BRIEF→8D 升级 | 同一一次性 PostgreSQL，`QMS_DISPOSABLE_TEST_DB=true`；新品基础集成及迁移后的服务类型检查 | PASS：新品基础 6/6，平台升级适配器已注册并通过编译 |
| 客户 8D 分级审批门槛 | 独立 PostgreSQL 客诉来源与问题发单集成 | PASS：9 用例，含政策快照级别与 Workflow `APPROVAL` 节点匹配拒绝 |
| 四域数据库集成 | 同一一次性 PostgreSQL，`QMS_DISPOSABLE_TEST_DB=true`；Jest `--testPathPatterns='(process-quality\|customer-quality\|new-product-quality\|audit-management).*integration-spec.ts'` | PASS：9 套件、54 用例 |
| 编译 Worker 生命周期 | `corepack pnpm --dir qms-2.0 --filter @qms/api test:worker-process` | PASS：3 用例 |
| Web 行为和构建 | `corepack pnpm --dir qms-2.0 --filter @qms/web test`、`build` | PASS：32 文件、170 用例；构建通过 |
| 契约与治理 | `contracts:check`、`check:governance`、`check:archive-isolation` | PASS |
| Compose 配置 | 一次性环境变量下 `docker compose -f deployment/docker-compose.foundation.yml config --quiet` | PASS |
| 浏览器联合验收 | 需要一次性 API/Web gateway、MinIO、ClamAV、Mailpit 与隔离夹具库 | 未运行；不得视为 PASS |
| 审核期限与 NC 流程 | 独立 PostgreSQL `55444`，审核集成及期限单测 | PASS：审核集成 10/10、期限单测 3/3 |
| 全量 API 集成 | 直接运行 `test:integration` 时缺少 `QMS_OBJECT_STORAGE_ENDPOINT`，且并发容器复用导致连接中断 | FAIL；领域定向套件已独立重跑通过，全量套件仍待隔离资源复验 |

当前终端使用 Node.js `v24.19.0`，与仓库要求的 Node.js 22 不符。完整阶段验收需切换受支持运行时，并按阶段一、二的脚本要求提供一次性资源；任何保留预览数据库 `55440` 均禁止用于验收。

## 业务主线

阶段四借鉴 QMS 1.0 的业务组织方式：先建立领域来源台账，再从台账筛选、分流并发起正式问题，最后复用 QMS 2.0 平台完成流程、任务、附件、审计、验证和关闭。

```text
来源台账 → 选择与分流 → 正式问题/问题简报/8D → 验证与关闭 → 追溯与经验沉淀
```

四条主线：

1. 制程质量：不良品台账 → 制程问题发单。MES/IMS 先留适配器和接口契约，待字段、认证和样本核实后再接入。
2. 客户质量：客诉台账 → 实物处理/解析分流 → 问题简报或 8D。
3. 新品质量：从制程不良台账遴选新品相关记录 → 新品项目/试产问题 → 简报或 8D；保留经验教训、阶段评审和带病量产审批。
4. 审核管理：审核计划/执行 → NG/NC 台账 → 整改验证关闭，并可进入统一问题中心。

## 权威来源

- [阶段四设计规格](../../docs/superpowers/specs/2026-09-24-qms-2.0-phase-4-domain-quality-design.md)
- [阶段四实施计划](../../docs/superpowers/plans/2026-09-24-qms-2.0-phase-4-domain-quality.md)
- QMS 1.0 只读参考：`E:/WorkSpace/QMS/archive/qms-1.0/`

## 参考范围

重点参考 QMS 1.0 的 `.kiro/steering/product.md` 第 2.6～2.9 节、`doc/requirements-panel/QMS_FUNCTION_REQUIREMENTS.md`，以及制程、客户、新品和审核实现记录。参考内容只用于提取业务语义和用户路径，不复制 1.0 代码、旧编号、表结构、双环境或数据迁移。

## 阶段边界

- 各领域拥有来源台账和专业事实，公共问题索引只保存聚合字段与稳定引用。
- 发单、流程、任务、通知、附件、审计和关闭复用平台公开服务与同事务边界。
- 未核实的 MES、IMS、ERP/SAP 接口不以 Mock、假数据或“跳过”替代真实验收。
- 供应商绩效、供应商审核、PPAP、质量成本、仪器计量和 AI 自动决策不混入本阶段主链。
