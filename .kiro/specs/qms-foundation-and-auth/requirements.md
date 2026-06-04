# Requirements Document

## 文档说明

本文档定义质量管理系统（QMS）的**基础架构与认证授权模块**的功能需求（对应 product.md 的 2.1-2.3 和 2.12 章节）。

### 文档覆盖范围

**本文档涵盖：**
- 系统基础与门户管理（2.1）
- 个人中心（2.2）
- 系统管理与全局配置（2.3）
- 版本与发布管理（2.12）
- 预留功能接口（2.10-2.11）

**业务模块需求（2.4-2.9）请参考：**
- **详细业务需求文档**：`.kiro/steering/product.md`
  - 2.4 质量数据面板
  - 2.5 供应商质量管理
  - 2.6 过程质量管理
  - 2.7 客户质量管理
  - 2.8 新品质量管理
  - 2.9 审核管理
- **实施任务清单**：`tasks.md` 任务组 9-16

本文档与 product.md 共同构成 QMS 系统的完整需求规格说明。

## Introduction

本文档定义质量管理系统（QMS）的基础架构与认证授权模块的功能需求。该模块是整个 QMS 系统的核心底座，负责用户身份认证、权限管理、系统配置、个人工作台、通知机制以及双轨发布架构。系统采用 Monorepo 结构，通过 Docker Compose 编排，支持 Preview（预览环境）与 Stable（正式环境）双轨并行运行，共享同一数据库底座。

本模块需支持内部员工与外部供应商的统一登录入口，实现细粒度的"功能-操作"权限控制体系，并提供千人千面的动态工作台。当前前台公共注册入口临时关闭，内部员工与供应商账号新增优先由管理员通过后台用户管理/后台创建路径维护；供应商账号统一基于供应商主数据创建。同时需预留仪器量具管理、质量成本管理等功能接口，为后续扩展奠定基础。

## 当前实施基线（2026-04）

| 范围 | 当前状态 | 说明 |
| --- | --- | --- |
| Requirement 1-3 | 已落地 | 账号创建与审核能力、统一登录、环境准入、平台管理员引导、角色标签权限矩阵已形成可联调闭环；前台公共注册入口临时关闭 |
| Requirement 4 | 预留 | 操作日志管理入口保留，但不作为第一里程碑阻塞项 |
| Requirement 5 | 部分落地 | 资料读取、头像、密码、签名已落地；账户信息自助修改仅限平台管理员 |
| Requirement 6-7 | 基础版已落地 | 工作台、快捷入口、底座域待办聚合已落地；增强指标与跨全部业务任务聚合继续扩展 |
| Requirement 8-11 | 预留/非阻塞 | 通知中心、公告管理、全局任务监控、通知规则配置保留兼容位，不作为第一里程碑主交付 |
| Requirement 12 | 已落地 | 审批注册、用户清单治理、角色标签分配、冻结/解冻、重置密码、权限矩阵治理已可用 |
| Requirement 13 | 部分落地 | 基础响应式已跟随前端布局实现；离线暂存等场景未落地 |
| Requirement 14-16 | 已落地 | 双环境、非破坏性迁移约束、功能特性开关已纳入正式交付 |
| Requirement 17-20 | 预留/按阶段推进 | 系统配置大面板、预留模块、DMZ 部署细节不作为当前验收阻塞 |

## 跨模块问题管理共享约束（2026-04 增补）

虽然问题管理的业务细节归属 2.5-2.9 各模块，但基础架构层已明确以下共享约束：

1. 系统需要支持跨模块统一问题主模型，以承接问题主单号、责任人、当前阶段、回复形式、待办、通知和数据范围控制。
2. 系统需要同时支持“问题简报（brief）”和“8D报告（eight_d）”两种回复形式，并允许在流转中按规则切换。
3. 系统需要对跨模块问题统一执行数据范围控制：内部人员默认可查看全量业务问题，外部供应商仅可查看本供应商被分派的问题。
4. 系统工作台、待办聚合和通知中心需要复用统一问题主单号 / 8D 报告号与统一流转事件，而不是由各模块各自维护不同口径。
5. 系统需要支持“来源台账”与“正式问题单”解耦，允许客户质量等模块先记录来源问题，再按需升级为问题简报或 8D 报告。
6. 系统需要支持客户质量客诉录入时的统一主数据口径：客户名称为必填且优先来自系统管理维护的客户主数据，终端客户名称允许选填。

## Glossary

- **QMS_System**: 质量管理系统，本文档所描述的整体应用系统
- **User**: 系统用户，包含内部员工（Internal_User）和外部供应商（Supplier_User）
- **Internal_User**: 公司内部员工用户
- **Supplier_User**: 外部供应商用户
- **Permission_Matrix**: 权限矩阵，基于"功能模块-操作类型"的二维权限配置表
- **Role_Tag**: 角色标签，用于承载一组标准化权限，再由管理员批量分配给账户
- **Operation_Type**: 操作类型，包括录入、查阅、修改、删除、导出五种基本操作
- **Feature_Module**: 功能模块，系统的一级/二级/三级菜单功能点
- **Audit_Log**: 操作日志，记录用户关键操作的审计记录
- **Workbench**: 动态工作台，用户登录后的首页，展示个性化看板和待办任务
- **Todo_Task**: 待办任务，需要当前用户处理的业务单据或审批事项
- **Issue_Case**: 问题主单，跨模块统一承接问题生命周期、责任人、回复形式和编号规则的主模型
- **Response_Mode**: 回复形式，包含 `brief`（问题简报）和 `eight_d`（8D 报告）
- **Notification**: 站内信通知，系统推送给用户的消息
- **Announcement**: 公告，系统级或质量预警类的全员通知
- **Feature_Flag**: 功能特性开关，用于灰度发布和功能控制的配置项
- **Preview_Environment**: 预览环境，用于新功能验证的隔离环境
- **Stable_Environment**: 正式环境，面向全体用户的生产环境
- **Shared_Database**: 共享数据库，Preview 和 Stable 环境共用的 PostgreSQL 数据库
- **IMS_System**: 内部管理系统，提供物料入库、生产数据等基础数据的源系统
- **LDAP_Auth**: LDAP 认证，基于公司 AD/LDAP 的单点登录认证方式（预留功能）
- **Local_Auth**: 本地认证，基于账号密码的常规登录认证方式
- **JWT_Token**: JSON Web Token，用于用户会话管理的令牌
- **Password_Policy**: 密码策略，强制密码复杂度和定期修改的安全规则
- **Electronic_Signature**: 电子签名，用户上传的手写签名图片，用于审批流程
- **System_Config**: 系统配置，全局性的系统参数配置
- **Notification_Rule**: 通知规则，基于业务触发器的消息推送配置
- **SMTP_Server**: 邮件服务器，用于发送邮件通知的配置
- **Webhook**: Webhook 地址，用于企业微信/钉钉/飞书集成的回调地址
- **Responsive_Layout**: 响应式布局，适配桌面端和移动端的界面设计
- **PWA_Mode**: Progressive Web App 模式，无需原生 APP 的移动端访问方式
- **DMZ_Zone**: 非军事区，系统部署的网络区域，可同时访问外网和内网
- **Alembic_Migration**: Alembic 数据库迁移，遵循非破坏性原则的数据库版本管理
- **Reserved_Feature**: 预留功能接口，当前阶段不实现但需预留扩展槽位的功能

## Requirements

### Requirement 1: 用户创建与审核

**User Story:** 作为系统管理员，我希望能够通过后台创建或审核新用户，以确保只有合法用户能够访问系统。

#### Acceptance Criteria

1. WHEN 内部员工账号需要接入系统 THEN THE QMS_System SHALL 通过管理员用户管理或后台创建路径记录用户名、姓名、电话、邮箱、部门、职位信息
2. WHEN 前台登录页面加载 THEN THE QMS_System SHALL 不展示公共注册入口
3. WHEN 用户直接访问前台 `/register` 路由 THEN THE QMS_System SHALL 重定向到登录页
4. WHEN 管理员审核通过注册申请 THEN THE QMS_System SHALL 将用户状态更新为"已激活"并允许用户登录
5. WHEN 管理员驳回注册申请 THEN THE QMS_System SHALL 将用户状态更新为"已驳回"并记录驳回原因
6. WHEN 供应商账号需要接入系统 THEN THE QMS_System SHALL 要求管理员在用户管理界面统一创建，而不是开放公共供应商注册入口
7. WHEN 管理员创建供应商账号 THEN THE QMS_System SHALL 仅允许其绑定现存的供应商主数据记录

### Requirement 2: 统一登录与身份认证

**User Story:** 作为用户，我希望通过统一入口登录系统，根据我的身份类型选择合适的认证方式，以便安全地访问系统。

#### Acceptance Criteria

1. WHEN 用户访问系统登录页面 THEN THE QMS_System SHALL 展示统一的登录入口界面
2. WHEN 内部员工选择员工登录 THEN THE QMS_System SHALL 提供账号密码登录选项
3. WHEN 供应商选择供应商登录 THEN THE QMS_System SHALL 提供账号密码加图形验证码的登录选项
4. WHEN 用户输入错误密码连续 5 次 THEN THE QMS_System SHALL 锁定账号 30 分钟
5. WHEN 用户首次登录或密码超过 90 天 THEN THE QMS_System SHALL 强制用户修改密码
6. WHEN 用户设置新密码 THEN THE QMS_System SHALL 验证密码包含大写、小写、数字、特殊字符中至少三种且长度大于 8 位
7. WHEN 用户从 stable 或 preview 运行入口登录 THEN THE QMS_System SHALL 使用后端当前运行环境与 `allowed_environments` 作为唯一登录准入规则
8. WHEN 用户登录成功 THEN THE QMS_System SHALL 生成 JWT_Token 并返回稳定会话对象，至少包含 `user_info`、`environment`、`allowed_environments` 与 `password_expired`
9. WHERE LDAP_Auth 功能启用 WHEN 内部员工选择 SSO 登录 THEN THE QMS_System SHALL 调用 LDAP 接口进行身份验证（预留功能）

### Requirement 3: 细粒度权限控制

**User Story:** 作为系统管理员，我希望能够按角色标签统一配置细粒度权限，并将角色标签分配给用户，以降低逐人维护权限的成本并保持权限口径一致。

#### Acceptance Criteria

1. WHEN 平台管理员访问权限配置界面 THEN THE QMS_System SHALL 允许其进入系统管理后台，而不依赖业务权限矩阵自举
2. WHEN 管理员访问权限配置界面 THEN THE QMS_System SHALL 展示网格化的权限矩阵配置界面
3. WHEN 前端读取权限矩阵 THEN THE QMS_System SHALL 返回统一的 `modules + rows` 契约
4. WHEN 管理员访问权限管理界面 THEN THE QMS_System SHALL 展示可维护的角色标签列表及其适用用户类型、启停状态和已分配账户数量
5. WHEN 管理员为角色标签配置功能模块权限 THEN THE QMS_System SHALL 支持配置一级、二级、三级菜单的访问权限
6. WHEN 管理员为角色标签配置操作权限 THEN THE QMS_System SHALL 支持独立配置录入、查阅、修改、删除、导出五种操作权限
7. WHEN 管理员将角色标签分配给账户 THEN THE QMS_System SHALL 使该账户立即继承角色标签对应的权限集合
8. WHEN 系统保留用户级直连授权能力 THEN THE QMS_System SHALL 将其视为兼容性补充通道，而不是权限治理的主入口
9. WHEN 供应商用户查阅数据 THEN THE QMS_System SHALL 仅返回关联到该供应商名称的数据记录
10. WHEN 管理员保存权限配置 THEN THE QMS_System SHALL 立即生效无需重启后端服务
11. WHEN 用户访问功能模块 THEN THE QMS_System SHALL 根据权限配置动态渲染可用的操作按钮
12. WHEN 用户尝试执行无权限的操作 THEN THE QMS_System SHALL 拒绝请求并返回权限不足提示
13. WHEN 内部人员访问跨模块问题列表 THEN THE QMS_System SHALL 默认允许其查看全量业务问题，而不是仅限本人创建或本人处理的问题
14. WHEN 外部供应商访问问题数据 THEN THE QMS_System SHALL 仅返回绑定到其 `supplier_id` 且分派给本供应商的问题记录
15. WHEN 用户被分派跨模块问题应答任务 THEN THE QMS_System SHALL 将“模块浏览权限”和“被分派后可应答权限”作为可组合但不完全等价的权限能力处理

### Requirement 4: 操作日志审计

**User Story:** 作为系统管理员，我希望能够查阅所有用户的关键操作日志，以便进行安全审计和问题追溯。

#### Acceptance Criteria

1. WHEN 用户执行提交操作 THEN THE QMS_System SHALL 记录操作人、操作时间、操作类型、操作对象到 Audit_Log
2. WHEN 用户执行删除操作 THEN THE QMS_System SHALL 记录操作人、操作时间、操作类型、被删除对象标识到 Audit_Log
3. WHEN 用户执行修改操作 THEN THE QMS_System SHALL 记录操作人、操作时间、操作类型、修改前后的数据快照到 Audit_Log
4. WHEN 管理员访问操作日志界面 THEN THE QMS_System SHALL 展示所有操作日志记录
5. WHEN 管理员筛选操作日志 THEN THE QMS_System SHALL 支持按用户、时间范围、操作类型进行筛选
6. WHEN 管理员导出操作日志 THEN THE QMS_System SHALL 生成 Excel 文件包含所有筛选结果

### Requirement 5: 个人中心与基本信息管理

**User Story:** 作为用户，我希望能够查看和管理我的个人信息，包括修改密码和上传电子签名，以便个性化使用系统。

#### Acceptance Criteria

1. WHEN 用户访问工作台中的系统设置 THEN THE QMS_System SHALL 展示头像、姓名、部门/供应商名称、职位等个人信息
2. WHEN 平台管理员修改自己的账户信息 THEN THE QMS_System SHALL 允许其更新姓名、邮箱、电话、部门、职位等资料
3. WHEN 非平台管理员尝试自助修改账户信息 THEN THE QMS_System SHALL 拒绝该操作并要求通过管理员用户管理界面处理
4. WHEN 用户上传头像 THEN THE QMS_System SHALL 支持头像上传与裁剪，并存储标准头像路径
5. WHEN 用户修改密码 THEN THE QMS_System SHALL 验证旧密码正确性并应用 Password_Policy 规则
6. WHEN 用户上传电子签名图片 THEN THE QMS_System SHALL 自动实现图片背景透明化处理
7. WHEN 用户保存电子签名 THEN THE QMS_System SHALL 存储签名图片路径并关联到用户账号
8. WHEN 系统需要用户签名 THEN THE QMS_System SHALL 调用用户的 Electronic_Signature 生成电子签章

### Requirement 6: 动态工作台

**User Story:** 作为用户，我希望登录后看到个性化的工作台，根据我的角色展示相关的指标监控和待办任务，以便快速了解工作状态。

#### Acceptance Criteria

1. WHEN 用户登录系统 THEN THE QMS_System SHALL 将动态工作台设置为默认首页
2. WHEN 用户访问工作台 THEN THE QMS_System SHALL 展示个人信息卡、环境标识和统一的系统设置入口
3. WHEN 用户访问工作台 THEN THE QMS_System SHALL 支持在其可见功能范围内自定义快捷入口
4. WHEN 内部员工访问工作台 THEN THE QMS_System SHALL 聚合展示底座域待办任务，在页头展示待办总数/超期事项/临期事项统计窗，并在功能开关启用时展示指标增强块
5. WHEN 供应商访问工作台 THEN THE QMS_System SHALL 优先展示需要其行动的任务卡片；绩效状态块仅在真实数据源可用时显示
6. WHEN 公告或通知能力未启用 THEN THE QMS_System SHALL 允许隐藏对应区块或展示明确空态
7. WHEN 用户点击待办任务 THEN THE QMS_System SHALL 跳转到对应模块的具体单据详情页
8. WHEN 用户点击工作台待办统计窗 THEN THE QMS_System SHALL 打开个人待办事项清单弹窗，并展示真实待办列表
9. WHEN 业务问题待办适配器启用 THEN THE QMS_System SHALL 在工作台中统一展示跨模块问题卡片，并显示问题主单号或 8D 报告号

### Requirement 7: 待办任务聚合

**User Story:** 作为用户，我希望在一个地方看到所有需要我处理的任务，并能够快速识别紧急和逾期任务，以便合理安排工作优先级。

#### Acceptance Criteria

1. WHEN 系统加载待办任务 THEN THE QMS_System SHALL 通过适配器注册式任务聚合器收集任务，并自动跳过不可用的数据源
2. WHEN 第一里程碑加载工作台 THEN THE QMS_System SHALL 至少聚合注册审批、权限初始化等真实底座域任务，不得混入演示性质的伪待办
3. WHEN 系统展示待办任务 THEN THE QMS_System SHALL 显示任务类型、单据编号、紧急程度、剩余处理时间，并支持在个人待办事项弹窗中统一查看
4. WHEN 任务剩余时间小于 0 THEN THE QMS_System SHALL 标记为红色已超期状态
5. WHEN 任务剩余时间小于等于 72 小时 THEN THE QMS_System SHALL 标记为黄色即将超期状态
6. WHEN 任务剩余时间大于 72 小时 THEN THE QMS_System SHALL 标记为绿色正常状态
7. WHEN 用户点击待办任务 THEN THE QMS_System SHALL 直接跳转到对应单据详情页进行处理
8. WHEN 工作台展示待办统计 THEN THE QMS_System SHALL 同步给出待办总数、超期事项数与临期事项数
9. WHEN 跨模块问题适配器启用 THEN THE QMS_System SHALL 聚合供应商质量、制程质量、客户质量、新品质量、审核管理的问题待办
10. WHEN 问题回复形式在流转中切换 THEN THE QMS_System SHALL 同步刷新待办卡片上的当前动作、目标页面和单据编号展示
11. WHEN 待办任务来自统一问题中心 THEN THE QMS_System SHALL 优先展示统一问题主单号；若为 8D 环节则同时支持展示 8D 报告号

### Requirement 8: 站内信通知

**User Story:** 作为用户，我希望能够接收系统推送的通知消息，并能够管理已读未读状态，以便及时了解重要信息。

#### Acceptance Criteria

1. WHEN 系统触发流程异常 THEN THE QMS_System SHALL 向相关用户发送站内信通知
2. WHEN 系统生成定期报告 THEN THE QMS_System SHALL 向相关用户发送系统提醒通知
3. WHEN 系统检测到预警条件 THEN THE QMS_System SHALL 向相关用户发送预警通知
4. WHEN 用户访问通知中心 THEN THE QMS_System SHALL 展示所有通知消息并标识已读未读状态
5. WHEN 用户标记通知为已读 THEN THE QMS_System SHALL 更新通知状态并移除未读标识
6. WHEN 用户有未读消息 THEN THE QMS_System SHALL 在右上角铃铛图标显示红点数字
7. WHEN 问题被分派、驳回、重开、升级、关闭或回复形式切换 THEN THE QMS_System SHALL 向相关责任人、审核人和关注人发送流程通知
8. WHEN 供应商侧问题通知发送给外部账号 THEN THE QMS_System SHALL 仅通知绑定同一 `supplier_id` 的供应商用户

### Requirement 9: 公告管理

**User Story:** 作为系统管理员，我希望能够发布系统公告和质量预警，并强制重要公告的阅读确认，以确保信息有效传达。

#### Acceptance Criteria

1. WHEN 管理员发布公告 THEN THE QMS_System SHALL 记录公告标题、内容、类型、重要程度、发布时间
2. WHEN 公告标记为重要 THEN THE QMS_System SHALL 在用户登录后弹窗提醒点击查阅
3. WHEN 用户查阅重要公告 THEN THE QMS_System SHALL 记录阅读时间和阅读人 ID
4. WHEN 用户未读重要公告 THEN THE QMS_System SHALL 在公告栏置顶并高亮显示
5. WHEN 用户访问公告栏 THEN THE QMS_System SHALL 按发布时间倒序展示所有公告

### Requirement 10: 全局任务统计与监控

**User Story:** 作为系统管理员，我希望能够监控团队整体的工作负载和流程瓶颈，并能够批量转派任务，以便优化资源分配。

#### Acceptance Criteria

1. WHEN 管理员访问任务统计界面 THEN THE QMS_System SHALL 展示按部门或人员统计的待办任务数量分布图
2. WHEN 管理员查看逾期分析 THEN THE QMS_System SHALL 列出所有已逾期单据清单并支持按逾期时长排序
3. WHEN 管理员选择批量转派 THEN THE QMS_System SHALL 支持将指定用户名下的所有待办任务转移给另一用户
4. WHEN 管理员执行批量转派 THEN THE QMS_System SHALL 更新所有相关单据的当前处理人字段并发送通知

### Requirement 11: 消息通知机制配置

**User Story:** 作为系统管理员，我希望能够配置业务触发规则和通知渠道，实现自动化的消息推送和升级策略，以提高流程效率。

#### Acceptance Criteria

1. WHEN 管理员配置触发规则 THEN THE QMS_System SHALL 支持选择业务对象、触发条件、执行动作
2. WHEN 管理员配置升级策略 THEN THE QMS_System SHALL 支持定义超时时长和升级抄送对象
3. WHEN 业务单据满足触发条件 THEN THE QMS_System SHALL 自动执行配置的通知动作
4. WHEN 单据在当前节点停留超过设定时长 THEN THE QMS_System SHALL 自动触发升级通知
5. WHEN 管理员配置邮件通道 THEN THE QMS_System SHALL 记录 SMTP_Server 参数并验证连接有效性
6. WHEN 管理员配置企业通讯工具 THEN THE QMS_System SHALL 记录 Webhook 地址并验证可达性

### Requirement 12: 用户信息与权限管理

**User Story:** 作为系统管理员，我希望能够分别处理用户审批和用户清单治理，并在清单中维护账户资料、角色标签和账号状态，以维护系统安全并降低日常管理成本。

#### Acceptance Criteria

1. WHEN 管理员查看待审核用户 THEN THE QMS_System SHALL 展示所有状态为"待审核"的注册申请
2. WHEN 管理员审批注册申请 THEN THE QMS_System SHALL 支持通过或驳回操作并记录审批意见
3. WHEN 管理员访问用户管理界面 THEN THE QMS_System SHALL 将"用户审批"与"用户清单管理"作为两个明确的子版块区分展示
4. WHEN 管理员查看用户清单 THEN THE QMS_System SHALL 展示非待审核账户的姓名、用户名、部门、岗位、用户类型、角色标签和账号状态
5. WHEN 管理员筛选用户清单 THEN THE QMS_System SHALL 支持按姓名或用户名关键字、部门、岗位、用户类型、账号状态和角色标签进行搜索与筛选
6. WHEN 管理员调整普通用户账户资料 THEN THE QMS_System SHALL 在用户清单管理中统一完成治理，而不是依赖普通用户自助修改
7. WHEN 管理员为账户分配角色标签 THEN THE QMS_System SHALL 支持绑定一个或多个角色标签并立即生效
8. WHEN 管理员重置用户密码 THEN THE QMS_System SHALL 生成临时密码并强制用户下次登录修改
9. WHEN 管理员冻结用户账号 THEN THE QMS_System SHALL 将用户状态设置为"已冻结"并阻止其登录
10. WHEN 管理员解冻用户账号 THEN THE QMS_System SHALL 将用户状态恢复为"已激活"并允许其登录
11. WHEN 管理员删除普通账户 THEN THE QMS_System SHALL 阻止删除超级管理员 bootstrap 账户和已关联关键业务数据的账户
12. WHEN 管理员配置角色标签权限 THEN THE QMS_System SHALL 展示 Permission_Matrix 配置界面并支持实时保存
13. WHEN 管理员访问供应商基础信息界面 THEN THE QMS_System SHALL 展示供应商代码、供应商名称、状态、联系人及关联账号数量
14. WHEN 管理员维护供应商基础信息 THEN THE QMS_System SHALL 支持单条创建、批量导入、编辑与启停用
15. WHEN 管理员创建供应商账号 THEN THE QMS_System SHALL 仅允许绑定已存在且处于启用状态的供应商主数据
16. WHEN 供应商主数据被停用 THEN THE QMS_System SHALL 阻止继续创建绑定该主体的新供应商账号，并使已绑定账号失去登录资格

### Requirement 13: 移动端响应式适配

**User Story:** 作为移动端用户，我希望能够在手机或平板上流畅访问系统，界面自动适配屏幕尺寸，以便在现场作业时使用系统。

#### Acceptance Criteria

1. WHEN 用户通过移动设备访问系统 THEN THE QMS_System SHALL 自动应用响应式布局
2. WHEN 移动端加载页面 THEN THE QMS_System SHALL 自动折叠左侧菜单栏并放大操作按钮和输入框
3. WHEN 用户在移动端访问扫码页面 THEN THE QMS_System SHALL 全屏显示扫描框并隐藏顶部导航和底部版权信息
4. WHEN 移动端用户在无网络环境下操作 THEN THE QMS_System SHALL 支持将数据暂存本地
5. WHEN 移动端网络恢复 THEN THE QMS_System SHALL 自动同步提交暂存的本地数据

### Requirement 14: 双轨发布架构

**User Story:** 作为系统管理员，我希望能够在预览环境验证新功能，确认无误后再发布到正式环境，同时两个环境共享数据库，以实现平滑的版本升级。

#### Acceptance Criteria

1. WHEN 系统部署 THEN THE QMS_System SHALL 同时运行 Preview_Environment 和 Stable_Environment 两个容器实例
2. WHEN 用户访问预览域名 THEN THE QMS_System SHALL 路由请求到 Preview_Environment 容器
3. WHEN 用户访问正式域名 THEN THE QMS_System SHALL 路由请求到 Stable_Environment 容器
4. WHEN 任一环境写入数据 THEN THE QMS_System SHALL 将数据存储到 Shared_Database
5. WHEN 任一环境读取数据 THEN THE QMS_System SHALL 从 Shared_Database 查询数据
6. WHEN 用户同时具备 stable 与 preview 访问权限 THEN THE QMS_System SHALL 在前端展示环境标识与切换入口

### Requirement 15: 数据库兼容性管理

**User Story:** 作为开发人员，我希望预览环境的数据库变更不会破坏正式环境的运行，以确保系统稳定性。

#### Acceptance Criteria

1. WHEN 预览环境新增数据表 THEN THE QMS_System SHALL 允许该操作且不影响正式环境
2. WHEN 预览环境新增字段 THEN THE QMS_System SHALL 要求字段设置为 Nullable 或带有 Default Value
3. WHEN 预览环境尝试删除字段 THEN THE QMS_System SHALL 阻止该操作直到正式环境代码同步更新
4. WHEN 预览环境尝试重命名字段 THEN THE QMS_System SHALL 阻止该操作直到正式环境代码同步更新
5. WHEN 预览环境执行 Alembic_Migration THEN THE QMS_System SHALL 验证迁移脚本符合非破坏性原则
6. WHEN 正式环境读取新增字段 THEN THE QMS_System SHALL 对空值进行判空处理避免报错

### Requirement 16: 功能特性开关

**User Story:** 作为系统管理员，我希望能够通过功能开关控制新功能的发布范围，实现灰度测试和白名单机制，以降低发布风险。

#### Acceptance Criteria

1. WHEN 管理员访问功能控制台 THEN THE QMS_System SHALL 展示所有可配置的 Feature_Flag 列表
2. WHEN 管理员启用功能开关 THEN THE QMS_System SHALL 立即对指定范围的用户生效
3. WHEN 管理员禁用功能开关 THEN THE QMS_System SHALL 立即对所有用户隐藏该功能
4. WHEN 管理员配置白名单 THEN THE QMS_System SHALL 支持按用户 ID 或供应商代码指定可见范围
5. WHEN 用户访问功能模块 THEN THE QMS_System SHALL 先按 `environment` 过滤，再按 `global / whitelist` 规则判断功能可见性
6. WHEN 白名单用户访问新功能 THEN THE QMS_System SHALL 展示新版界面
7. WHEN 非白名单用户访问 THEN THE QMS_System SHALL 展示旧版界面或保持旧能力不显示新入口

### Requirement 17: 系统全局配置

**User Story:** 作为系统管理员，我希望能够集中管理系统的全局配置参数，包括业务规则、超时时长、文件大小限制等，以便灵活调整系统行为。

#### Acceptance Criteria

1. WHEN 管理员访问系统配置界面 THEN THE QMS_System SHALL 展示所有可配置的 System_Config 参数
2. WHEN 管理员修改配置参数 THEN THE QMS_System SHALL 验证参数格式和取值范围的合法性
3. WHEN 管理员保存配置 THEN THE QMS_System SHALL 立即生效无需重启服务
4. WHEN 系统执行业务逻辑 THEN THE QMS_System SHALL 从 System_Config 读取最新配置值
5. WHEN 配置参数缺失 THEN THE QMS_System SHALL 使用预设的默认值并记录警告日志

### Requirement 18: 预留功能接口 - 仪器与量具管理

**User Story:** 作为系统架构师，我希望为仪器与量具管理功能预留数据库表结构和 API 接口，以便后续快速扩展该功能。

#### Acceptance Criteria

1. WHEN 系统初始化数据库 THEN THE QMS_System SHALL 创建仪器量具相关的预留表结构
2. WHEN 预留表包含字段 THEN THE QMS_System SHALL 将所有字段设置为 Nullable
3. WHEN 后端 API 设计 THEN THE QMS_System SHALL 预留仪器量具管理的 RESTful 接口路由
4. WHEN 前端菜单设计 THEN THE QMS_System SHALL 预留仪器量具管理的菜单入口但默认隐藏

### Requirement 19: 预留功能接口 - 质量成本管理

**User Story:** 作为系统架构师，我希望为质量成本管理功能预留数据库表结构和 API 接口，以便后续快速扩展该功能。

#### Acceptance Criteria

1. WHEN 系统初始化数据库 THEN THE QMS_System SHALL 创建质量成本相关的预留表结构
2. WHEN 预留表包含字段 THEN THE QMS_System SHALL 将所有字段设置为 Nullable
3. WHEN 后端 API 设计 THEN THE QMS_System SHALL 预留质量成本管理的 RESTful 接口路由
4. WHEN 前端菜单设计 THEN THE QMS_System SHALL 预留质量成本管理的菜单入口但默认隐藏

### Requirement 20: DMZ 网络部署

**User Story:** 作为系统运维人员，我希望系统能够部署在 DMZ 区，同时访问外网（响应前端）和内网（请求 IMS），以满足安全和业务需求。

#### Acceptance Criteria

1. WHEN 系统部署到 DMZ_Zone THEN THE QMS_System SHALL 配置双网卡分别连接外网和内网
2. WHEN 前端用户访问系统 THEN THE QMS_System SHALL 通过外网网卡响应 HTTP 请求
3. WHEN 后端需要同步 IMS 数据 THEN THE QMS_System SHALL 通过内网网卡访问 IMS_System
4. WHEN 网络配置完成 THEN THE QMS_System SHALL 验证外网和内网连接均正常
