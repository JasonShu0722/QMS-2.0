# QMS 用户分类与角色功能映射（草案）

## 1. 文档定位

本文档用于统一维护 QMS 的“相关方分类 -> 组织层级 -> 岗位角色 -> 模块职责 -> 权限边界 -> 开发落点”映射关系。

它的定位是：

- 作为开发、联调、测试、权限设计时的统一归口索引。
- 作为系统管理、菜单规划、权限矩阵拆分、工作台分角色展示的底稿。
- 作为后续将用户模型从“仅 internal / supplier 两类账号”升级为“账号身份 + 组织层级 + 岗位角色 + 数据范围”的过渡文档。

它**不是**新的需求源文档。正式源头仍然是：

- [`.kiro/steering/product.md`](../.kiro/steering/product.md)
- [`.kiro/specs/qms-foundation-and-auth/requirements.md`](../.kiro/specs/qms-foundation-and-auth/requirements.md)
- [`.kiro/specs/qms-foundation-and-auth/design.md`](../.kiro/specs/qms-foundation-and-auth/design.md)
- [`frontend/src/features/requirements-panel/catalog.ts`](../frontend/src/features/requirements-panel/catalog.ts)

如果角色体系、权限边界或组织层级发生升级，应优先同步源需求/设计文档，再回写本文档。

当前草案基线日期：`2026-04-11`

## 2. 与当前代码模型的关系

当前代码中的用户基础模型仍然偏粗：

- 账户类型只有 `internal` 和 `supplier` 两类。
- 通过 `is_platform_admin` 提供系统管理后台 bootstrap 入口。
- 内部用户只有 `department`、`position` 两个基础字段。
- 供应商用户通过 `supplier_id` 绑定供应商主体。
- 供应商主体当前已开始进入“供应商基础信息主数据”治理，后续供应商账号展示与登录可用性都应依赖该主数据状态。

现状见：

- [`backend/app/models/user.py`](../backend/app/models/user.py)
- [`frontend/src/types/user.ts`](../frontend/src/types/user.ts)

结合本项目实际情况，当前应这样解释代码与角色体系的关系：

| 维度 | 当前代码现状 | 本文档解释 |
| --- | --- | --- |
| 账户身份 | `internal` / `supplier` | 账户身份仍然保留两类 |
| 系统管理自举 | `is_platform_admin` | 当前应解释为 `sys.super_admin` 超级管理员标识 |
| 业务管理员 | 尚无独立字段 | 先作为规划角色 `sys.business_admin` 存在，后续通过角色模板或附加授权落地 |
| 业务岗位 | 仅 `department` + `position` 文本 | 本文档使用 `role_key` 作为岗位角色词汇表 |
| 数据范围 | 仅供应商侧有明确行级隔离 | 后续需补内部岗位的数据范围、审批范围和组织范围 |

**本轮明确约定：当前已经创建的管理员账号，对应的是 `sys.super_admin` 超级管理员角色。**

这意味着：

- 它不是普通“业务管理员”。
- 它是当前系统管理后台的最高 bootstrap 账号。
- 它代表全局配置、权限矩阵、功能开关、发布治理等最高技术控制权入口。

## 3. 使用规则

后续在开发过程中，任何新页面、新接口、新权限点、新功能开关、新审批节点，都应尽量同步回写到本文档或其后续结构化版本。

推荐遵循以下规则：

- 新增用户类别或岗位时，先补“角色字典”。
- 新增功能时，至少补“目标角色、前端入口、后端接口、权限点、数据范围、来源需求”。
- 路由、API、权限点、feature flag 发生调整时，同一 PR 内同步更新映射。
- “页面已存在”不等于“角色可用”，必须写明当前状态是“已闭环 / 部分落地 / 骨架存在 / 预留”。
- 同一人允许同时拥有“业务岗位 + 系统角色”，例如“体系工程师 + 业务管理员”。
- `sys.super_admin` 与业务岗位解耦，不应直接等同于“质量部长”或“体系工程师”。

## 4. 一级相关方分类

| 用户大类 | 说明 | 典型账号形态 |
| --- | --- | --- |
| 系统管理组 | 负责系统治理、权限、配置、发布、异常干预 | `internal`，其中超级管理员具备 `is_platform_admin=true` |
| 经营层 | 高层经营决策，只读看板和风险预警 | `internal` |
| 质量管理部 | 系统核心主使用者，覆盖来料、制程、客户、新品、审核等质量主链路 | `internal` |
| 采购部 | 围绕供应商绩效、索赔、变更等流程做商务协同 | `internal` |
| 研发中心与制造管理部 | 作为责任部门参与问题应答、整改、技术支持和新品协同 | `internal` |
| 其他协同部门 | 未来扩展的责任部门、审批部门、支持部门 | `internal` |
| 外部供应商 | 面向供应商侧协同、整改、资料提交、目标确认和变更提报 | `supplier` |

## 5. 组织与岗位层级草案

### 5.1 系统管理组

- 超级管理员（SuperAdmin）
- 系统管理员 / 业务管理员（Admin）

### 5.2 经营层

- 高管团队

### 5.3 质量管理部

- 质量管理部
  - 部长
  - 体系工程师
  - 制程质量室
    - 制程质量室经理
    - 制程质量工程师
    - 检验班长
      - 检验员（PQC）
  - 客户质量室
    - 客户质量室经理
    - 客户质量工程师
    - 失效分析工程师
    - 市场技术支持工程师（售后工程师）
  - 项目质量室
    - 项目质量室经理
    - 项目质量工程师
  - 供应商质量室
    - 供应商质量室经理
    - 供应商质量工程师
    - 来料检验班长
      - 来料检验员（IQC）
      - 三坐标测量员

### 5.4 采购部

- 部长
- 采购工程师

### 5.5 研发中心与制造管理部

- 部长 / 经理
- 研发工程师
- 制造工程师

### 5.6 其他协同部门

当前先按通用协同角色归类，后续按真实组织架构细化：

- 部门负责人 / 经理
- 责任工程师 / 专员
- 一线执行人员

### 5.7 外部供应商

当前结合项目实际，先用“外部供应商账号”作为统一业务角色表达，后续再拆成供应商管理员、质量经理、质量工程师等更细层级。

## 6. 角色分层原则

建议将角色分成四层：

| 层级 | 角色类型 | 说明 |
| --- | --- | --- |
| L0 | `sys.super_admin` | 系统最高技术控制权，突破全局数据隔离和配置限制 |
| L1 | `sys.business_admin` | 日常业务运维支撑，负责账号、模板、流程干预、公告通知等 |
| L2 | 部门负责人 / 经理 / 部长 | 以看板查阅、审批、督办、升级决策为主 |
| L3 | 工程师 / 班长 / 检验员 / 外部账号 | 以录入、跟进、处理、应答、提交资料为主 |

建议遵循：

- L0 不参与日常业务审批链设计，仅作为最高治理和兜底干预。
- L1 可以由业务部门人员兼任，例如“体系工程师 + 业务管理员”。
- L2/L3 角色是业务权限的主体，应通过角色模板和数据范围控制，而非一律提升为管理员。

## 7. 角色字典（本轮建议）

### 7.1 系统管理组

| role_key | 岗位 | 主要职责 | 主要模块 / 权限候选 | 当前系统映射 |
| --- | --- | --- | --- | --- |
| `sys.super_admin` | 超级管理员（SuperAdmin） | 全局最高读写权、操作日志全局查阅、权限矩阵、角色配置、数据字典、集成配置、版本发布、极端异常数据干预 | 系统管理、功能开关、系统配置、通知规则、审计日志、版本发布、集成配置 | `internal` + `is_platform_admin=true` |
| `sys.business_admin` | 系统管理员 / 业务管理员（Admin） | 账号日常维护、基础角色绑定、模板维护、流程异常干预、公告与通知管理 | 用户管理、任务监控、公告管理、通知规则、模板配置、流程干预 | 当前尚未独立建模，后续由角色模板或附加权限承接 |

### 7.2 经营层

| role_key | 岗位 | 主要职责 | 主要模块 / 权限候选 | 当前系统映射 |
| --- | --- | --- | --- | --- |
| `leadership.executive` | 高管团队 | 查看公司整体质量状况、核心指标推移、质量预警和超标报警，辅助经营决策 | 质量数据面板只读、关键审批只读/审批候选 | `internal` |

### 7.3 质量管理部

| role_key | 岗位 | 主要职责 | 主要模块 / 权限候选 | 当前系统映射 |
| --- | --- | --- | --- | --- |
| `quality.minister` | 质量管理部部长 | 全局质量监控与管理；对重大质量问题、审核结果、索赔与供应商绩效具备最终审批或查阅权 | 质量数据面板、客户质量、供应商质量、审核管理、索赔管理 | `internal` |
| `quality.system.engineer` | 体系工程师 | 内部过程审核、分层审核的计划制定、结果录入、问题闭环；经验教训沉淀与知识库维护 | 审核管理、经验教训库、公告与通知配置候选 | `internal` |
| `quality.process.manager` | 制程质量室经理 | 监控制程质量状况，审批制程重大质量问题及跟进节点 | 制程质量、质量数据面板、流程督办 | `internal` |
| `quality.process.engineer` | 制程质量工程师 | 主导制程质量问题跟进、统计分析、超标报警闭环，使用 AI 做趋势与回复诊断；对被分派的跨模块问题可执行应答 | 制程质量、质量数据面板、AI诊断 | `internal` |
| `quality.process.pqc.lead` | 检验班长 | 审核检验员录入数据和问题，统筹现场检验，查阅负责工段质量数据 | 制程质量、待办、移动端/PDA | `internal` |
| `quality.process.pqc.inspector` | 检验员（PQC） | 过程质量数据与问题录入，不具备已归档数据修改权 | 制程质量、扫码/PDA | `internal` |
| `quality.customer.manager` | 客户质量室经理 | 查阅客户质量数据和趋势预警，把关客户审核结果及客户索赔审批；可从客诉台账发起正式问题单 / 8D，并维护问题范围与关闭节点 | 客户质量、客户审核、客户索赔、质量数据面板 | `internal` |
| `quality.customer.engineer` | 客户质量工程师 | 主导客诉跟进、数据统计、客诉台账录入、实物解析分派、客户审核问题闭环、发起客户索赔；可从客诉清单发起问题单 / 8D，利用 AI 诊断辅助回复；对被分派的跨模块问题可执行应答 | 客户质量、客户审核、客户索赔、AI诊断 | `internal` |
| `quality.customer.failure_analyst` | 失效分析工程师 | 配合客户质量工程师进行实物解析和专项技术分析，录入一次原因分析、失效件信息和检测数据 | 客户质量、经验教训 | `internal` |
| `quality.customer.field_support` | 市场技术支持工程师（售后工程师） | 负责客户端现场问题登录、退件/实物信息采集和初步数据录入 | 客户质量、移动端/PDA 候选 | `internal` |
| `quality.project.manager` | 项目质量室经理 | 统筹新品质量，查看试产与初期流动数据，审批新品阶段重大质量问题 | 新品质量、质量数据面板 | `internal` |
| `quality.project.engineer` | 项目质量工程师 | 负责新品试产和初期流动生产数据汇总与录入，执行经验教训点检，跟进新品超标问题；对被分派的跨模块问题可执行应答 | 新品质量、经验教训、试产管理 | `internal` |
| `quality.supplier.manager` | 供应商质量室经理 | 查阅分供方绩效和来料趋势，审批供应商准入/年度审核、供应商索赔和供应商变更；对跨模块分派至本室的问题具备督办、驳回、关闭和重开候选权限 | 供应商质量、供应商审核、供应商索赔、供应商变更、质量数据面板 | `internal` |
| `quality.supplier.engineer` | 供应商质量工程师 | 负责供应商绩效维护与分析、执行审核、问题清单闭环、发起和跟进供应商索赔、处理供应商变更；对被分派的跨模块问题可执行应答 | 供应商质量、SCAR/8D、审核、索赔、变更 | `internal` |
| `quality.supplier.iqc.lead` | 来料检验班长 | 审核 IQC 录入的来料数据和问题，统筹来料检验现场；对被分派的跨模块问题可执行应答和转办 | 来料质量、供应商质量、待办 | `internal` |
| `quality.supplier.iqc.inspector` | 来料检验员（IQC） | 来料质量数据及问题登录、录入，联动 IMS 确认物料到料信息 | 来料质量、检验规范、扫码/PDA | `internal` |
| `quality.supplier.cmm_operator` | 三坐标测量员 | 负责精密尺寸检验等特定质量数据录入 | 来料质量、检验规范 | `internal` |

### 7.4 采购部

| role_key | 岗位 | 主要职责 | 主要模块 / 权限候选 | 当前系统映射 |
| --- | --- | --- | --- | --- |
| `procurement.minister` | 采购部长 | 查阅分供方绩效和趋势预警，协同查阅供应商审核结果，参与重大供应商索赔和物料质量问题处理 | 供应商质量、供应商审核、供应商索赔、质量数据面板只读 | `internal` |
| `procurement.engineer` | 采购工程师 | 跟进负责供应商的质量问题应答，在供应商索赔和供应商变更流程中做商务或交期协同确认 | 供应商质量、供应商索赔、供应商变更 | `internal` |

### 7.5 研发中心与制造管理部

| role_key | 岗位 | 主要职责 | 主要模块 / 权限候选 | 当前系统映射 |
| --- | --- | --- | --- | --- |
| `rd.manager` | 研发中心部长 / 经理 | 查阅本部门相关质量状况，督导研发责任问题闭环和审核整改 | 质量数据面板只读、客户质量、新品质量、审核整改 | `internal` |
| `rd.engineer` | 研发工程师 | 对被分派的质量问题和审核问题进行技术应答，参与经验教训点检和新品超标问题闭环 | 客户质量、制程问题、新品质量、审核整改 | `internal` |
| `manufacturing.manager` | 制造管理部部长 / 经理 | 查阅本部门质量状况，督导制造责任问题闭环和整改 | 质量数据面板只读、制程质量、审核整改 | `internal` |
| `manufacturing.engineer` | 制造工程师 | 对被分派的质量问题和审核问题进行应答，参与新品试产和异常闭环 | 制程质量、新品质量、审核整改 | `internal` |

### 7.6 其他协同部门

| role_key | 岗位 | 主要职责 | 主要模块 / 权限候选 | 当前系统映射 |
| --- | --- | --- | --- | --- |
| `cross_function.manager` | 其他责任部门负责人 / 经理 | 督导本部门处理被指派问题、审核整改和节点审批 | 客诉、制程问题、审核整改、新品问题 | `internal` |
| `cross_function.engineer` | 其他责任板块工程师 | 处理被指派问题、录入整改对策、回复审核问题 | 客诉、制程问题、审核整改、新品问题 | `internal` |

### 7.7 外部供应商

| role_key | 岗位 | 主要职责 | 主要模块 / 权限候选 | 当前系统映射 |
| --- | --- | --- | --- | --- |
| `supplier.external` | 外部供应商账号 | 仅可查阅并操作本公司的任务：质量问题和审核问题应答、分供方绩效确认、供应商索赔处理、供应商变更提报；仅可查看本供应商被分派的问题 | 供应商门户、SCAR/8D、绩效、索赔、供应商变更 | `supplier` |

## 8. 功能域与主责任角色映射

### 8.1 系统底座与系统管理

| 功能域 | 主负责角色 | 协同 / 查阅角色 | 来源需求 |
| --- | --- | --- | --- |
| 用户注册审核与账号生命周期 | `sys.super_admin`、`sys.business_admin` | 候选：质量部长只读 | Requirement 1、12 |
| 统一登录与环境准入 | `sys.super_admin` | 全体用户使用 | Requirement 2 |
| 权限矩阵与角色模板 | `sys.super_admin` | `sys.business_admin` 候选 | Requirement 3、12 |
| 操作日志与审计追踪 | `sys.super_admin` | `sys.business_admin` 只读候选 | Requirement 4 |
| 个人中心与电子签名 | 全体用户 | `sys.business_admin` 负责普通用户资料治理 | Requirement 5 |
| 动态工作台 / 待办聚合 | 全体用户 | 按角色展示不同卡片 | Requirement 6、7 |
| 站内信 / 公告 | `sys.business_admin` | `quality.system.engineer` 候选协同 | Requirement 8、9 |
| 全局任务统计与监控 | `sys.business_admin` | `quality.minister`、各室经理候选只读 | Requirement 10 |
| 消息通知机制配置 | `sys.super_admin`、`sys.business_admin` | `quality.system.engineer` 候选 | Requirement 11 |
| 功能特性开关 | `sys.super_admin` | 无 | Requirement 16 |
| 系统全局配置 | `sys.super_admin` | `sys.business_admin` 部分只读 / 限定维护候选 | Requirement 17 |
| 版本与发布治理 | `sys.super_admin` | 无 | Requirement 14、16、2.12 |

### 8.2 业务模块

| 模块 | 主使用角色 | 关键协同角色 | 典型操作 |
| --- | --- | --- | --- |
| 质量数据面板 | `leadership.executive`、`quality.minister`、各室经理、质量工程师 | 采购部长、研发/制造经理 | 看板查阅、趋势分析、异常关注 |
| 供应商质量管理 | `quality.supplier.manager`、`quality.supplier.engineer`、`quality.supplier.iqc.lead`、`quality.supplier.iqc.inspector` | `procurement.minister`、`procurement.engineer`、`supplier.external` | SCAR/8D、绩效、目标、审核、索赔、变更 |
| 制程质量管理 | `quality.process.manager`、`quality.process.engineer`、`quality.process.pqc.lead`、`quality.process.pqc.inspector` | `manufacturing.manager`、`manufacturing.engineer` | 过程数据录入、异常跟进、趋势分析 |
| 客户质量管理 | `quality.customer.manager`、`quality.customer.engineer`、`quality.customer.failure_analyst`、`quality.customer.field_support` | `cross_function.manager`、`cross_function.engineer` | 客诉台账、实物处理 / 解析、问题发单 / 8D、索赔、问题归档 |
| 新品质量管理 | `quality.project.manager`、`quality.project.engineer` | `rd.manager`、`rd.engineer`、`manufacturing.engineer` | 试产数据、经验教训点检、阶段评审 |
| 审核管理 | `quality.system.engineer`、各室经理 | 被审核部门负责人、责任工程师、`supplier.external` | 审核计划、执行、NC整改、验证关闭 |

### 8.3 跨模块问题管理共通口径

| 角色 / 人群 | 查看范围 | 典型动作 | 说明 |
| --- | --- | --- | --- |
| 内部员工 | 默认可查看全量业务问题 | 具体操作仍按模块权限、阶段权限和责任归属控制 | “可查看”不等于“可处理” |
| 被分派的内部责任工程师 | 默认可查看全量业务问题 | 应答、提交对策、补证据、重提 | 需支持跨模块共用的被分派应答能力 |
| 内部经理 / 室经理 | 默认可查看全量业务问题 | 督办、驳回、关闭、重开、升级候选 | 以本部门或本室问题为主，但不限制其查询全局 |
| 外部供应商账号 | 仅本供应商被分派的问题 | 查看、提交问题简报、提交 8D、补证据、重提 | 不可查看其他供应商和内部备注 |

补充共通约束：

- 问题回复形式统一分为 `brief`（问题简报）和 `eight_d`（8D 报告）。
- 问题主单号采用 `ZXQ-<分类子类>-<YYMM>-<SEQ3>`，8D 报告号采用 `ZX8D-<分类子类>-<YYMM>-<SEQ3>`。
- 供应商 SCAR/8D 关闭审批按严重度分级：低严重度由 `quality.supplier.engineer` 审批关闭；中、高严重度由 `quality.supplier.engineer` -> `quality.supplier.manager` 审批关闭；重大问题由 `quality.supplier.engineer` -> `quality.supplier.manager` -> `quality.minister` 审批关闭。
- 当前已确认分类编码：
  - `CQ0`：0km
  - `CQ1`：售后
  - `PQ0`：PCBA段
  - `PQ1`：组装测试段
  - `IQ0`：结构料
  - `IQ1`：电子料
  - `DQ0`：厂内试产/调试问题
  - `DQ1`：客诉问题
  - `AQ0`：体系审核 NC
  - `AQ1`：过程审核 NC
  - `AQ2`：产品审核 NC
  - `AQ3`：客户审核问题

## 9. 系统管理专项映射

### 9.1 管理角色边界

| 事项 | `sys.super_admin` | `sys.business_admin` |
| --- | --- | --- |
| 跨部门 / 跨供应商全局读写 | 是 | 否，默认按职责受限 |
| 权限矩阵与角色模板 | 是 | 候选，仅限被授权范围 |
| 审计日志全局查阅且不可删除 | 是 | 只读候选，不可删除 |
| 数据字典、集成底层映射、审批流引擎 | 是 | 否或仅部分维护 |
| 版本发布、Preview / Stable 切流 | 是 | 否 |
| 极端异常数据修正 / 物理删除 | 是，且需额外审批 | 否 |
| 普通账号启停用、重置密码 | 是 | 是 |
| 公告发布与通知规则 | 是 | 是 |
| 流程强制转交 / 挂起 / 终止 | 是 | 是 |
| SIP / 模板 / 缺陷代码库等主数据维护 | 是 | 是 |

### 9.2 当前实现与规划的对应关系

| mapping_id | 功能 | 目标角色 | 当前前端入口 | 当前后端入口 | 当前状态 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `foundation.super_admin_bootstrap` | 超级管理员 bootstrap | `sys.super_admin` | 系统管理入口、工作台快捷入口 | `is_platform_admin` 相关鉴权 | 已落地 | 当前已创建管理员账号即此角色 |
| `foundation.user_approval` | 用户审批与用户清单治理 | `sys.super_admin`、后续 `sys.business_admin` | `/admin/users` | `/v1/admin/users/pending`、`/v1/admin/users`、`POST /v1/admin/users`、`POST /v1/admin/users/bulk`、`approve`、`reject`、`freeze`、`unfreeze`、`reset-password`、`PATCH /users/{id}`、`PUT /users/{id}/roles`、`DELETE /users/{id}` | 已验证 | 公共注册仅保留内部员工；供应商账号统一由管理员在此创建，且必须绑定已存在且启用中的供应商主数据 |
| `foundation.supplier_master` | 供应商基础信息主数据 | `sys.super_admin`、后续 `sys.business_admin` | `/admin/suppliers` | `/v1/admin/suppliers`、`/bulk`、`/{id}`、`/{id}/status` | 已验证 | 维护供应商代码、供应商名称、状态及联系信息；停用后阻止新绑定，并影响已绑定供应商账号登录可用性 |
| `foundation.permission_matrix` | 角色标签权限矩阵 | `sys.super_admin` | `/admin/permissions` | `/v1/admin/permissions/matrix`、`/roles`、`/roles/{id}/permissions`、`grant`、`revoke` | 已验证 | 权限主模型已切换为角色标签矩阵，用户直连授权仅保留兼容通道 |
| `foundation.task_monitor` | 全局任务统计与监控 | `sys.business_admin`、`sys.super_admin` | `/admin/tasks` | `/v1/admin/tasks/statistics`、`reassign` | 骨架存在 | 前端期待任务列表接口，后端未完全对齐；业务统计默认未启用 |
| `foundation.operation_logs` | 操作日志与审计 | `sys.super_admin` | `/admin/operation-logs` | 当前实际为 `/v1/operation-logs` | 骨架存在 | 前后端路径、字段和导出能力尚未完全对齐，且管理员权限校验待补 |
| `foundation.feature_flags` | 功能开关与灰度发布 | `sys.super_admin` | `/admin/feature-flags` | `/v1/admin/feature-flags` | 基本落地 | 前后端契约相对最完整 |
| `foundation.notification_rules` | 通知规则 | `sys.super_admin`、`sys.business_admin` | 暂无 | `/v1/admin/notification-rules` | 后端先行 | 前端页面、菜单、权限点未接入 |
| `foundation.system_config` | 系统全局配置 | `sys.super_admin` | 暂无 | `/v1/admin/system-config` | 后端先行 | 前端页面、菜单、权限点未接入 |
| `foundation.release_governance` | 版本与发布治理 | `sys.super_admin` | 暂无专门页面 | 当前依赖环境切换、部署与功能开关 | 部分落地 | 双环境、功能开关已存在，但缺独立发布控制台 |
| `foundation.integration_config` | 集成接口与底层映射配置 | `sys.super_admin` | 暂无 | 暂无统一入口 | 预留 | 包括 IMS、OA、SAP 等底层映射配置 |
| `foundation.master_data_admin` | 主数据与模板维护 | `sys.business_admin`、`sys.super_admin` | 业务页面分散入口 | 分散在各业务模块 | 部分落地 | 供应商基础信息已先独立落地；SIP 模板、缺陷代码库、检验项目基础库需后续继续统一归口 |

## 10. 开发映射台账字段规范

后续如需把本文档进一步结构化，建议每条能力至少维护以下字段：

| 字段 | 含义 |
| --- | --- |
| `mapping_id` | 映射唯一标识 |
| `domain` | 所属模块域，如 foundation / supplier / process |
| `capability` | 功能名称 |
| `target_roles` | 面向角色列表 |
| `route` | 前端页面入口 |
| `api` | 后端接口 |
| `permission_module` | 权限矩阵模块路径 |
| `operations` | 录入 / 查阅 / 修改 / 删除 / 导出 |
| `feature_flag` | 对应功能开关 |
| `data_scope` | 数据范围规则 |
| `approval_scope` | 审批范围 |
| `source_requirement` | 来源需求或章节 |
| `implementation_status` | 未开始 / 骨架存在 / 部分落地 / 已闭环 / 已验证 |
| `test_reference` | 测试或验证命令 |
| `notes` | 风险、限制、待确认项 |

推荐模板：

```md
| mapping_id | capability | target_roles | route | api | permission_module | operations | feature_flag | data_scope | source_requirement | implementation_status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| foundation.user_approval | 内部员工注册审核与账号治理 | sys.super_admin, sys.business_admin | /admin/users | GET/POST /v1/admin/users/* | system.users | read/update | - | 全量账号 | Requirement 1,12 | 已验证 | 公共注册仅面向内部员工，供应商账号由管理员创建 |
```

## 11. 当前权限模型落点

为了让“岗位层级”和“权限矩阵”真正映射起来，当前建议已经落地为“岗位默认模板 + 用户差异化覆盖”的四层表达：

1. `account_type`
   内部 / 供应商。
2. `system_role`
   超级管理员 / 业务管理员。
3. `role_key`
   岗位和业务角色，例如 `quality.process.engineer`、`procurement.engineer`。
4. `permission_override`
   针对个别用户的额外授权或限制；当前仍保留兼容通道，但不作为日常治理主入口。

当前已落地的关键实现：

- `role_tags`：承载角色标签定义、适用用户类型和启停状态。
- `role_permissions`：承载角色标签对模块操作的授权集合。
- `user_role_assignments`：承载账户与角色标签的多对多绑定关系。
- `permissions`：保留用户直连授权，用于特殊覆盖和历史兼容。

建议后续继续补充的结构化字段：

- `org_unit_path`
- `role_key`
- `system_role`
- `manager_user_id`
- `data_scope_type`
- `data_scope_value`
- `approval_scope_type`
- `is_delegated_admin`

## 12. 后续落地建议

建议按以下顺序推进：

1. 先冻结本文档中的一级相关方分类、岗位字典和 `role_key` 命名。
2. 再整理系统管理板块的权限模块命名，至少把 `users / permissions / tasks / logs / feature_flags / notification_rules / system_config / release / integrations / master-data` 拆清。
3. 然后把 `sys.super_admin` 与 `sys.business_admin` 的边界正式固化到权限设计中。
4. 再为质量、采购、研发制造、经营层、供应商建立第一批角色模板。
5. 在用户模型中补组织和角色字段时，再决定是否新增组织架构表、岗位字典表、角色模板表和数据范围规则表。
6. 等文档稳定后，可将第 10 节台账转为 `ts/json/yaml` 结构化配置，供前后端和测试复用。

## 13. 待确认事项

以下内容仍需在后续讨论中确认：

- `sys.business_admin` 是否独立于业务岗位，还是默认由质量管理部系统统筹专员兼任。
- 质量部长、各室经理是否需要获得“受限系统管理只读权限”。
- 采购、研发、制造是否需要拆分更细的审批范围和数据范围。
- 供应商侧后续是否要从 `supplier.external` 继续拆成管理员、质量经理、质量工程师等子角色。
- 是否需要单独的“角色模板管理”后台，而不是完全依赖用户粒度授权。
