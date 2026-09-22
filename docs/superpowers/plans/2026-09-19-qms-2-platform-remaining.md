# QMS 2.0 阶段二剩余平台与 2A 治理执行计划

**目标：** 按可验证交付切片补齐阶段三依赖，最终分别记录平台验收和供应商联调；历史脚本 PASS 不代表业务完成。

**架构：** 领域拥有事实与专业校验，平台提供事务内编号、薄索引、固定版本流程、节点授权、审计及 Outbox。API 的 Swagger DTO 是 HTTP 契约唯一来源。采用现有 NestJS、Prisma 7、PostgreSQL 18、React 工程。

## 基线、隔离和责任

2026-09-20 主目录整合最终状态：以下工作树和资源为早期执行历史；当前唯一实现目录为 `D:/WorkSpace/QMS-2.0/qms-2.0`。P1/P2/P3/P4/P5及D–H均已完成本轮实现，P6全量聚合退出码0：PG404/API381/Web135/Worker3/安全输入1/browser17，0 skip；契约、构建、两Compose和归档隔离PASS。本轮六进程及四临时容器已清理，原主目录修改保留，未提交/推送/部署。供应商业务与跨企业联调由阶段三独立验收。最新证据以 `2026-09-19-qms-2-main-integration.md` 和 `qms-2.0/docs/FOUNDATION.md` 为准。

- 本线程基线 `54621e09a8c4b469070c00497e55e58ea237da72`，D 盘工作树 `D:/WorkSpace/QMS-2-platform-remaining`，分支 `codex/qms-2-platform-remaining`。主目录 5 个修改文件和 1 个未跟踪迁移计划保持原样。
- 交接文本确认阶段三共同基线为上述提交。本次恢复不读取、通知、等待或交互其他已有线程；接口及待集成项只写本地交接。用户随后明确允许当前任务内部子代理，采用限定文件/只读复核分工，不创建或操作其他用户线程。
- 本线程维护公共 schema/迁移、权限目录、模块注册、导航及验收入口。各分支逐批评审集成；生成契约在集成后重新生成，不手工合并。当前未获 commit/push/deploy 指令，不自动执行。
- 供应商模型、企业协作规则、业务表单、门户、整改内容由阶段三负责；公共索引不得承载这些字段。
- 验证资源预留 project `qms2-platform-remaining`、PG 55446、API 13046、Web/gateway 18096、MinIO 19046/19047；实际启用前核对占用。只使用临时库，禁止 55440。独立浏览器上下文；原始证据和秘密在仓库外。

## 实际剩余盘点

运行时原实现只递增 instance.version，未注册模块，无真实转换/节点授权/审计/Outbox；其唯一测试只断言空 mock 抛错。Worker handler 为 null，TaskService 有不属于 schema 的 retryCount 写入。附件 URL 未签名，没有实际上传完成校验、资源授权或扫描服务。页面和四步 phase-2 脚本只证明局部回归。A–C/矩阵按既有验收保留；D–H 尚未闭环。

## 交付批次与依赖

| 批次 | 实施范围及接口依赖 | 行为验证与放行证据 |
| --- | --- | --- |
| P1 | 事务内 start/action、固定发布版本、授权、提交/审批/验证/拒绝/退回/关闭/重开、幂等回执、索引 CAS、审计/Outbox；领域在同一 tx 写业务记录 | 中性领域真实 PG：三重权限拒绝、跨租户/禁用/撤权、重复与变体键、并发胜者、外层/审计/Outbox 失败全回滚；HTTP 错误+Swagger 一致性 |
| P2 | 消费 P1 版本化事件，待办/站内通知、时限提醒、超时升级、5 次退避与人工重试；任务访问沿用实时节点授权 | 真实 Worker 多次消费/租约恢复/乱序事件/过期任务/失败队列，不重复待办或通知；授权重试与审计 |
| P3 | 附件初始化/完成、真实签名 PUT/GET、对象大小/哈希核验、资源授权适配器、隔离扫描、逻辑删除与保留、报告可用性 | PG + 临时 MinIO + 扫描接口，企业 A/B 允许/拒绝；伪造归属/未完成/隔离/删除拒绝；对象与 DB 故障补偿。扫描器部署依赖单列 |
| P4 | 流程设计器可操作属性、明确动作边和条件、问题工作空间、问题中心/待办/查询/保存视图、只读报告与追溯；P1/P2/P3 DTO | Web 组件及真实登录浏览器中性问题闭环，冲突恢复、权限拒绝、发布后只读与历史版本冻结 |
| P5 | 简报升级 8D、显式公共字段映射、编号/来源/证据保持，创建新固定版本实例 | 升级事务与回滚、并发/幂等、保留人工内容、旧任务取消、报告追溯和浏览器链 |
| G1 (D/F) | 组织树/部门/岗位、字典/受控参数、通知模板规则、审计查询及失败队列监控；不做供应商主数据 | 组织作用域允许/拒绝、禁止树环、参数版本冲突、敏感信息脱敏、PG + 浏览器 |
| G2 (E) | 管理员 MFA/恢复码、按角色强制策略、自助找回和高风险操作二次验证 | 真实挑战/撤销/限流/一次性消费/恢复码重放及拒绝审计；邮件渠道单列部署依赖 |
| G3 (G/H) | TLS/密钥轮换/存储版本保护、备份恢复演练、导出授权/保留、国际化和无障碍 | 临时恢复目标校验 DB+对象一致；下载过期/越权拒绝；键盘/读屏与语言切换。实际基础设施证据不可用说明文档替代 |
| P6 | 完整验收入口强制配置/PG/浏览器/迁移/seed/Compose；平台链与供应商联调独立记账 | missing config 必须 FAIL；冻结安装、全测试、contracts、构建、archive、Compose、真实浏览器均有实际结果，最后销毁临时资源 |

## P1 首批文件和执行步骤

- `apps/api/src/modules/workflow/workflow-runtime.service.ts`：替换空壳，导出强类型事务 API；不开放绕过领域事实校验的通用动作 HTTP 入口。
- `apps/api/src/modules/workflow/workflow-runtime-policy.ts`：确定性节点动作、白名单条件与状态投影。
- `apps/api/prisma/schema.prisma` 与新增迁移：独立流程请求回执及动作历史，不复用账号管理幂等表。
- `apps/api/src/modules/workflow/workflow.module.ts`：注册服务并导出给领域模块。
- `apps/api/src/common/contracts/platform-error.ts`：稳定错误码；通过 Swagger 重新生成 contracts。
- `apps/api/test/workflow/workflow-runtime-schema.integration-spec.ts`：中性领域事务、权限与并发行为；不注册生产中性路由。
- `docs/PLATFORM-HANDOFF.md`：公共 API 调用方式、授权边界、事件 v1、错误和附件阻塞项。

- [x] 读取设计/交接、隔离工作树、冻结依赖安装。
- [x] API/Web、构建/契约/隔离在 P1 聚合 PASS；首次 Web 失败保留 FOUNDATION 历史记录，不另声称干净基线已独立重验。
- [x] 先写 PG 行为失败用例，历史交接记录 12 项 RED；恢复后重新验证现有半成品。
- [x] 实现 P1，生成迁移与 Prisma client，针对性验证通过（runtime 25 项真实 PG；新隔离检查已红绿验证）。
- [x] 全量 API/Web、真实 PG、contracts、构建、Compose 和真实账号浏览器在 P1 聚合 PASS；补修后的分层复验见 FOUNDATION，尚不代表业务浏览器与供应商联调。
- [x] P1 规格/质量子代理复核及交接证据更新；发现项已修复并复核关闭。
- [x] P2a 实现与真实 PG 验证，独立规格/质量复核 PASS；八步聚合 PASS（PG 125、API 280、Web 69、browser 11）。

P1 领域调用形状：`prisma.$transaction(async tx => { await domain.validateAndWrite(tx); return runtime.submitAction(input, tx); })`。领域记录写入必须由领域幂等协议保护，或放入 runtime 的事务 mutation 回调，使成功回放不重复执行；不得先提交业务再调用平台。具体签名以实现及交接同步，不把本示例当生成 DTO。

跨企业协作不能从客户端组织 ID 扩大范围；供应商记录的拥有组织与参与企业模型待后续显式集成。P1 先实现已有组织授权模型，拒绝未知跨企业调用，不把已有复合 FK 拆掉来绕过隔离。

## 本次恢复范围与验证

接续 P1 半成品：先跑现有真实 PG 用例，再补受控退回/驳回/重开动作边的发布与复制、验证/关闭职责分离、退回后的验证失效、事务 mutation 与幂等/并发回归。职责分离作为关闭节点显式 `requireIndependentVerification` 策略，领域需要此约束时必须绑定启用该策略的发布版本；不把供应商专业字段写进公共索引。

验证使用 55446 临时 PostgreSQL；将 runtime 集成测试加入正式 test:integration 入口，并运行全量单测、PG、contracts、构建、归档隔离、Compose。P1 不提供绕过领域规则的通用 HTTP 动作入口；生产业务浏览器链、跨企业适配、Worker 和附件验收仍按后续批次记录。

## P2 子切片与子代理边界

P1 规格复核通过后进入质量复核；P2a 由单个实现子代理负责下面文件集合，主代理负责计划、交接、质量修复协调与最终聚合。不同时派多个实现者修改共享 schema。

### P2a：任务与站内通知投影

- 补齐 Prisma WorkflowTask 中数据库已有的 workflowVersionId；新增 entryInstanceVersion/enteredAt，将 instance+node 唯一改为 instance+entryVersion。Notification 增加可回填的唯一 deduplicationKey；实例增加独立 taskProjectionVersion 游标，不改变业务 version。
- 只消费显式支持的 WORKFLOW_STARTED / WORKFLOW_ACTION_COMPLETED 类型，保留其余 Outbox 事件给其他 handler。claim 返回事件 key、聚合引用及创建时间。
- 领取保持 SKIP LOCKED 短事务。处理事务锁 Outbox、核对租约，再锁实例；任务、通知、投影游标和 PROCESSED 原子提交。业务异常回滚后按原租约 CAS 退避，旧租约不得写业务副作用。
- 连续版本按序投影；低于/等于游标作为重复，高于下一版本延后且不消耗失败次数。退回/重开新轮次保留旧任务历史；关闭结束旧任务、不建新任务。过时事件只补历史，不给已离开节点发待处理通知。
- 显式处理人、角色及额外权限使用 AND；通知只投递给仍 ACTIVE 且拥有 workflow:act 和节点授权的本拥有组织候选人，不扩大供应商跨组织权限。角色节点一轮共享一个任务，不按收件人数复制。
- dueAt 从事件 createdAt + 固定节点 slaMinutes 计算，避免消费延迟延长时限；提醒/升级定时事件属于 P2b。入口保持现有单批 worker 语义，持续调度是明确后续依赖，不宣传持续运行已交付。
- 真实 PG 验证生命周期、回退重入、重复/乱序、两 Worker 竞争、租约恢复/旧租约、处理与确认失败全回滚、未知事件保留、真实 Prisma 创建和复合 FK。单独临时数据库 qms_platform_worker，仍使用 55446 可销毁容器，绝不触碰 55440。

### 后续 P2b/P2c

P2b 为确定性延迟 Outbox 提醒/超时/升级事件和持续 Worker 调度；SLA 严重度配置独立冻结，不能硬编码供应商固定小时。P2c 提取共享节点授权策略，接入实时任务/通知查询、受控领取及有组织权限和审计的失败重试；不开放绕过领域 runtime 的通用 complete。旧 TaskService 无 actor 的方法在此之前不是可用公共业务接口。

### P2b：已确认语义与实施边界

用户在本任务明确确认：`offsetMinutes` 表示距截止时间提前多少分钟；超时升级只通知配置的升级负责人，保留当前任务及流程节点，不自动转派。

- 复用 Outbox.availableAt，不新增调度表或队列框架。创建任务事务内按 `dueAt - offsetMinutes` 排提醒、按 dueAt 排 OVERDUE，配置 escalation 时同一 dueAt 排升级通知；无 SLA 不排时限事件。提醒需 SLA、唯一非负安全整数 offset 且不超过 SLA；升级也需 SLA。
- 补充确定规则：offset=0 允许到期提醒；OVERDUE 事件只改任务状态、不额外给处理人重复通知。迟到消费仍只给当前有效轮次补发配置的各条提醒，每一条独立确定性去重；历史轮次全部静默结束，不把延迟当新时限。
- 提醒收件人沿用节点处理权限；升级收件人使用 escalation 的 AND 约束、ACTIVE、同拥有组织及现有 `problem-index:read` 权限，不要求原节点处理资格，也不授予任何流程操作权。读取通知时的实时资源授权属于 P2c。
- 定时载荷绑定 task、org、instance、fixed version、node、entry version；键和计划时间必须从持久化任务/固定节点配置校验，禁止从载荷指定接收人或任意时刻。处理事务锁顺序仍为事件→实例→任务。必须核对实际实例 RUNNING/currentNode/version，不依赖滞后的 task 状态判断有效性。
- 定时处理不推进流程 version 或 taskProjectionVersion；有效未完成任务到期标为 OVERDUE 并增加 task.version。提醒/升级通知、状态更新和事件确认原子提交，重用 P2a 租约/重试。已关闭/取消/重开旧轮次、索引已不再引用实例的事件静默确认。
- Worker 入口默认持续轮询，保留显式 `--once`；配置校验、可中断等待、收到终止信号停止领取并等待当前批次完成。Compose 继续 API/Worker 同镜像，增加恢复策略。基础设施异常退出非零，不静默无限吞错。
- 验证：真实 PG 提前/到期/迟到、延迟排程回滚、重复/竞争、回退重入与runtime已前进但投影未追上、角色升级但无操作权、撤权/禁用/跨组织拒绝、确认故障回滚；单测停止循环及非法配置；实际独立 Worker 进程消费启动后产生的事件。Windows 进程强制终止与 POSIX 优雅信号证据分别说明。
- 本批不做严重度 SLA 决策表、多级升级、重复周期提醒、邮件通道或任务操作 HTTP。需后续配置设计与 P2c 授权入口后才能给页面完整闭环。

- [x] P2b 先 RED、后实现确定性时限事件与持续 Worker；独立进程 3 项、API 301 项通过，时限最新 35 项真实 PG 通过。
- [x] P2b 独立规格/质量审查 PASS；最终八步聚合 PASS（PG 160、API 301、Web 69、browser 11），独立进程再验 3/3 PASS；临时 API/网关/PG 已清理。

### P2c 只读盘点与待实施决策

独立子代理已盘点，尚未实施：旧 TaskService/NotificationService 无业务调用者，Web 未接通的 completeTask 帮助函数不能成为通用完成入口。建议先做 P2c1 实时授权任务/通知查询和失败队列查询/重试，再做 P2c2 领取。

- 拟注册 `task:read`、`notification:read`、`outbox:read`、`outbox:retry`；领取批次再注册 `task:claim`，不自动授予已有角色。
- 通知需新增明确 kind；普通通知按当前用户权限与引用节点 assignment 复核，升级通知按 `problem-index:read` 和 escalation 复核。不得长期从正文或 dedup key 决定访问权限；无法可信归类的旧记录保留 LEGACY 且不开放。
- 历史通知是否继续显示需在实施前明确：建议保留本人历史，但用引用固定节点配置和实时权限鉴权，不要求节点仍是当前节点；活动待办则必须当前实例/节点/进入版本全部一致。
- 任务列表在授权范围内分页、统计，不能先取整组织一页再内存过滤。公共策略需保留 P1 内部跨组织角色与 P2a 同拥有组织通知之间的已有差别，并显式传入事务，锁后重新读取权限。
- Outbox 无 organizationId，查询/重试必须由受支持事件的真实实例/任务归属解析；损坏或未知归属不暴露给组织管理员。DTO 不返回 payload 或原始 lastError，仅稳定 reasonCode。FAILED→PENDING 与审计同一 ReadCommitted 事务，锁后重验撤权，并发第二人 409。
- 现有 AdminMutationService 固定 Serializable，不适用于要求锁后可见撤权的这些操作；不能直接套用它。
- 领取尚需决定是责任跟踪还是独占处理。若独占，P1 runtime 也需检查当前轮次领取人并统一锁序；只更新 Task.assigneeUserId 不能保证独占。还需撤权/禁用后的释放或重新分配策略。该决定未完成前不开放 claim、更不声称领取已交付。
