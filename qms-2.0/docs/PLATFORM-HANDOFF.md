# 平台与供应商质量接口交接

## N2-B 关闭审核接缝（2026-10-25，本地未发布）

当前增量含独立轮次 / 职责 / 回执及通知两份追加迁移，迁移总数108→110；旧单节点任务唯一约束及旧发布版本不改。领域必须显式注册`WorkflowClosureAdapter`，通过`lockAndRead`提供当前问题 / 实例 / 节点 / 内容版本及身份事实，`complete` / `returnForChanges`在原事务完成领域回调，不得网络副作用。生产适配器列表当前为空，发布和实际启动失败关闭；N3 / N5分别接入真实内部业务与供应商身份，不能把fixture注册为生产功能。

轮次写入支持外层ReadCommitted事务；先问题锁、再幂等锁、适配器事实、用户与组织结构锁，等待后重验会话 / MFA / 权限和原身份来源。提交版本、执行人、任职 / 分管及审批轮次一起复验，不取新人员继承旧结果。配置变化只读立即过滤失效职责；原子取消与恢复编辑由写路径复验或后续领域变更钩子承担，本轮没有后台即时撤审任务。

新事件`WORKFLOW_CLOSURE_CHANGED`由应用根`APPLICATION_OUTBOX_HANDLER`聚合旧处理器与新处理器，实际Worker使用该token；原`OUTBOX_HANDLER`保留旧模块fixture兼容。新通知持久化后读取仍与实时资格取交集，离线投递通过适配器`canNotifyRecipient`验证，不合成会话，无此回调不投递。新审核不得同时产生旧单节点任务 / 通知。

生命周期保留所有历史引用用于阻止删除，只有pending轮次和仍有效的pending / waiting职责算在途；终态轮次、回执和通知不能单独阻止停用。工程范围、实际验证与发布 / 配置边界以[N2计划](../../docs/superpowers/plans/2026-10-24-qms-n2-configuration-and-workflow-foundations.md)为准。

## N2-A 配置接缝（2026-10-25，V0.0.29已部署）

实现范围及发布证据见 [N2 实施计划](../../docs/superpowers/plans/2026-10-24-qms-n2-configuration-and-workflow-foundations.md)，PR #67已部署70fdbab；生产首次配权、配置资料及人工验收仍待接续。新增四份追加迁移拥有组件项目资料、组件映射、职责绑定及部长分管；配置资料不复用失效物料码，也不改写既有新品阶段门。项目集中保存阶段及可空具体工程师任职，组件页返回批量读取的可辨认身份 / 失效原因，不逐行查询，不替换失效人员。

公共解析只输出映射结果、有效性与差异；非空人工工程师保留，空值可取阶段对应建议。实际台账回补、历史快照及取消审批由后续域链消费，不在本配置交付中偷偷改写。基础导入逐行回执，批量维护是另一个原子事务：预览指纹绑定选择、版本、修改及共享成员，应用时重算，任一冲突整体回滚；回放仍重新鉴权。

组织模块公开 `resolveManagementResponsibilities` 的锁顺序为候选用户后组织 / 结构 / 岗位，锁后重读候选，新增未锁候选返回并发冲突。后续事务调用者必须在取得结构 / 岗位锁之前调用，并协调已有操作人 / 用户锁、处理外层提交并发失败；该协议不是任意调用顺序下永不死锁的保证。新职责 / 分管已纳入 N1 删除停用引用投影，不用数据库 Cascade 代替受控依赖检查。N2-A 不修改工作流 assignment schema；N2-B 才接动态分派 / 并行轮次 / 发布绑定。

## N1 组织治理接续（2026-10-24，V0.0.28已部署，人工验收待完成）

组织生命周期依赖检查通过明确的存在性 / 在途读取模型覆盖迁移实际关系，不以 Prisma 是否声明 relation 或数据库 Cascade 作为安全删除证明。历史引用阻止删除，但不能一概阻止停用；通知、审核导入、延期等表的终态语义分别处理，不把通用 `APPROVED` / `DELIVERED` 状态全局当作在途或终态。

产生有效部门责任引用的跨模块写入须通过组织模块公开的有效部门持锁查询，与部门停用共享锁协议；本轮补既有客诉分派路径，避免 ReadCommitted 的旧 ACTIVE 读取在停用提交后仍生成在途责任。GET 生命周期检查只作提示，最终写入必须锁后复验权限、版本与依赖。相关真实并发与失败证据、接口 / 前端范围及未上线边界见[基础管理前置计划](../../docs/superpowers/plans/2026-10-24-qms-basic-management-prerequisite.md)。

## REQ-0024 本地接续（2026-10-22，未推送／上线）

负责人确认“岗位就是角色”。新内部岗位自动拥有唯一内部角色存储，管理员仅从岗位权限入口维护自有权限与MFA；`PositionRole.isCanonical`及局部唯一索引表达所有权，历史标记默认false，不自动合并／删除旧授权或改变固定流程roleCode。历史来源单列只读，仍可能保留相同权限，取消自有权限不代表撤清全部来源。

新增岗位 `/positions/:positionId/permissions` GET/PUT与 `POST /organizations/:organizationId/position-authorization/preview`；预览覆盖完整结构、实际角色权限/MFA与目标来源基线。内部建号要求岗位及预览，账号、任职、审计和回执同事务；批量逐行提交，预览的岗位授予上限拒绝使用固定错误码 `POSITION_GRANT_CEILING_DENIED`，仅该类可转换为行错误，身份／组织／全局权限失败不能吞掉。公网调岗使用 `ReplaceUserPositionsWithPreviewDto`，新执行比较CAS与预览；合法回执不再写任职，但重放前仍重新核对目标读取及授予权限。

通用独立角色create/copy/update/delete/直接assign及旧岗位角色映射HTTP写已冻结为受控403，保留拒绝审计与回放前授权。可信内部服务继续承担历史领域回归、组织引导与供应商专用开通，不是客户端豁免。供应商固定门户角色及白名单不套内部岗位必填。部署须同批迁移与契约／Web上线，不得只上前端或先存canonical再回退到无保护旧接口。

本次真实一次性PG／Worker／浏览器及各批结果由[专项计划](../../docs/superpowers/plans/2026-10-22-qms-position-as-role.md)记账；不是生产发布或人工验收。负责人已完成开源操作并授权继续提交／PR；代理只读确认可见性，没有自行更改。当前Draft前限制为一条旧治理浏览器语言切换未通过，不得直接合并部署。历史迁移仅有受控设计，生产逐ID转换与回退仍需独立授权。

当前整合状态（2026-09-20）：已验收成果及后续P2c/P3/P4/P5均已进入 `D:/WorkSpace/QMS-2.0/qms-2.0`。最终P6完整PASS：PG404/API381/Web135/Worker3/browser17，另安全输入1；主/测试Swagger、构建、两Compose和归档隔离PASS，0 skipped。主目录原有修改保留；尚未Git提交、推送或生产部署。以下来源工作树及“未整合”描述保留其交付时点含义，当前状态以本段和FOUNDATION最新记录为准。未通过其他用户任务同步。

日期：2026-09-19。共同基线 `54621e09a8c4b469070c00497e55e58ea237da72` 已由用户提供的交接文本确认。早期成果来自 `D:/WorkSpace/QMS-2-platform-remaining`，现已整合并继续在主目录开发；按用户指令不读取、通知或等待其他任务。本文件用于本地交接，最终阶段二验收状态见 FOUNDATION。

## 已有能力与使用约束

阶段二后续接入协议已补充：[流程设计器](WORKFLOW-DESIGNER.md)、[问题工作空间/历史报告/个人视图/升级](PROBLEM-WORKSPACE.md)、[真实附件](ATTACHMENTS.md)。这些能力已在主目录实现。2026-09-22 阶段三已注册供应商内部公共读模型，要求公共与领域读权限同时满足；附件资源授权、历史报告快照、升级映射和专业写动作仍待领域接入。中性测试入口和测试专属契约不得引入生产。最终聚合状态以 FOUNDATION 和 PHASE-3 最新证据为准。

- `ProblemIndexService.createFromDomain(tx, input)` 在调用方事务中编号、索引、审计、Outbox。以 organizationId/sourceType/sourceId 去重；领域 sourceId 必须稳定 UUID，领域自行校验事实并保护创建请求幂等。编号永久不变，不能解析编号作权限或状态判断。
- 领域拥有自己的记录、附件证据关系及专业字段。平台索引只保存公共状态、责任引用、领域与来源引用。
- 流程运行时已替换原递增版本空壳；当前实现与签名如下，验证结果见本文件及 `FOUNDATION.md` 最新记录。生产领域动作入口与跨企业授权适配由领域实现；平台中性真实浏览器链独立验证公共能力。
- 授权必须同时满足功能权限、组织范围、当前节点规则。会话用户由后端解析，角色、组织、处理人不可直接信任请求体。供应商跨拥有组织参与需双方协调明确资源授权，不从客户端组织参数推断。
- API DTO/Swagger → `pnpm contracts:generate` → `@qms/contracts`。服务内部的 TypeScript 输入不是浏览器契约；供应商 HTTP 请求由其领域控制器描述并生成。

### 供应商流程绑定（S4.1c）

供应商领域已提供只负责配置的 `SupplierWorkflowBindingService`。平台仍拥有流程定义和版本；领域通过 `resolve(tx, ownerOrganizationId, selector)` 获取已发布固定版本、唯一供应商回复节点和节点 `slaMinutes`，正式发单时须在同一事务保存绑定引用并调用 runtime。平台不应提供默认流程或默认时限，也不能把绑定解析当作启动实例；禁用、缺配置、退休或不合规版本必须保持受控 409。

正式发单入口已经接入该协议：领域先用返回的固定版本调用 `startInstance`，在 runtime 成功后保存绑定 ID/版本和释放事实。平台不得在领域调用之外再创建编号或实例，也不能把供应商发单改写为平台替代状态机；Worker、通知和附件仍按各自交接状态处理。

## D–H 治理接口增量（2026-09-19）

本轮 D–H 开发、独立审查与九步整体验收均通过，PG 244、API 341、Web 90、真实 Worker 3、浏览器 13；数据保护另有真实备份恢复8项、密钥轮换4项、TLS 4项通过。完整证据与临时资源清理受阻记录见 [FOUNDATION](FOUNDATION.md)。未自动提交、合并、推送或部署；共同基线需由后续集成纳入这些修改。本文件供用户人工交接，不通过其他任务同步。

| 平台能力 | 消费契约与约束 |
| --- | --- |
| 组织与结构 | `/api/v1/organizations/tree`、`/:id/children`、`/:id/departments`、`/:id/positions`、`/:id/users/:userId/positions`。读/管理/任职分权，同组织引用，版本 CAS；层级不授予跨组织权限。停用用户主组织也使其身份失效 |
| 受控配置 | `/api/v1/admin/configuration/*?organizationId`。岗位类别、通知语言、导出保留 5–10080 分钟、TASK_ASSIGNED/REMINDER/ESCALATED 模板与开关。默认语言与规则由真实 Worker 消费，历史已发通知冻结 |
| 安全登录 | LoginResponse 增加 securityState；MFA_REQUIRED 和 MFA_ENROLLMENT_REQUIRED 只允许必要安全交互。`/mfa` 完成后才获得完整业务会话。角色增加 mfaRequired，策略 PATCH 须 expectedMfaRequired |
| 高风险写入 | 服务事务重新检查有效会话、用户/主组织状态、securityVersion 和最近五分钟完整认证。403 AUTH_REAUTHENTICATION_REQUIRED 时 Web 验证身份后只重试一次原请求，保留幂等键；领域不得绕开公共授权边界 |
| 邮箱与找回 | `/me/email-verification`、`/auth/email-verification/complete`、`/auth/password-recovery`、`/auth/password-recovery/complete`。邮箱先确认再找回，凭证单次15分钟，密码重置撤销会话但保留MFA。SMTP Worker 默认关闭，需要明确配置启用；真实业务通知邮件不在本轮 |
| 审计与导出 | `/api/v1/admin/audit-events` 和 `/audit-exports`。audit:read 与 audit:export 独立；导出最多5000，创建者实时会话/权限复验，保留设置生效、过期清除密文，不删除源审计 |
| 失败事件 | `/api/v1/outbox/failures` 和 `/:id/retry`。按真实聚合归属验证，失败载荷及原异常不出接口；未知事件归属不放行。P2c 任务/通知读取、已读和独占领取也已接入 |
| 数据保护 | 签名上传与私有对象版本/COMPLIANCE、TLS、密文轮换、开发备份恢复工具见 DATA-PROTECTION；完整附件生命周期见 ATTACHMENTS。生产灾备演练独立执行 |

新增数据库迁移覆盖组织结构、治理权限/配置、MFA、导出、邮箱凭证/投递及投递租约，须按顺序迁移并重新 seed。`packages/contracts/src/generated/api.ts` 已由 Nest Swagger 生成，禁止手写前端 DTO。Keyring、SMTP、对象凭据及 TLS 证书从部署外部配置；缺失不得在生产使用开发替代值。

## P1 事务调用契约

`WorkflowModule` 导出 `WorkflowRuntimeService`，两个方法均返回 `Promise<WorkflowActionResult>`：

```typescript
startInstance(input: StartWorkflowInstanceInput, transaction?: Prisma.TransactionClient, mutate?: WorkflowDomainMutation, domainAccess?: WorkflowDomainAccess)
submitAction(input: WorkflowActionInput, transaction?: Prisma.TransactionClient, mutate?: WorkflowDomainMutation, domainAccess?: WorkflowDomainAccess, participant?: WorkflowParticipantAccess)
```

真实领域写入必须提供 `domainAccess(tx, { replay })`，在公共 problem → instance → 当前 task 锁之后、用户/会话锁之前取得全部领域与证据锁，并验证资源授权。正常请求可以在此校验领域版本和通过 `FileLifecycleService.assertAttachable` 校验证据；幂等回放也会调用此入口，但不能用已成功操作前的领域版本拒绝合法回放。`mutate` 只修改已预锁的业务记录和创建本次不可变修订，不再申请新的既有领域锁。回调只允许事务内数据库操作，不可发送邮件、网络调用或其他无法回滚的副作用。旧内部纯平台调用保留可省略该参数的兼容边界；它不是省略领域授权的 HTTP 接口。

2026-09-22 增加 `WorkflowParticipantAccess`，仅可信领域服务可以传入：`authorize(tx, command, node?)` 在锁前、锁后及原节点重放时重新校验领域参与关系；`lock(tx, command)` 在公共行锁之后、`domainAccess` 和会话锁之前获取领域行锁。传入参与策略时 sessionId 必须存在且通过真实会话校验。供应商的功能权限与 assignment 在真实本企业组织中校验；内部仍使用问题拥有组织。此参数不是 HTTP DTO 或客户端 actor 声明，未新增通用流程推进 HTTP 路由。

- 共同输入：`organizationId`（问题拥有组织）、`actor`（服务端会话用户的 id/organizationId/accountType）、`problemIndexId`、`workflowVersionId`、`expectedProblemVersion`、`idempotencyKey`、`traceId`、可选 `commandPayload`。
- start 额外输入 `workflowDefinitionId`、`instanceKey`；只接受该拥有组织下的已发布版本，索引不得已有实例或已关闭。允许多个问题同时使用同一已发布定义。
- action 额外输入 `instanceId`、`currentNodeId`、`expectedVersion`、`action`。返回 `instanceId/currentNodeId/workflowVersionId/version/problemVersion/status`，status 为 RUNNING 或 COMPLETED。
- `mutate(tx): Promise<void>` 在授权、版本及分支校验后、平台写入前执行，同一数据库事务内完成领域事实校验和领域版本 CAS。领域 CAS 失败必须抛错；不能提交独立事务、网络请求或其他不可回滚副作用。传入外层事务时须让错误传播到 `$transaction`，不能捕获错误后提交部分写入。
- 把领域版本和全部会改变领域写入的请求内容放入 `commandPayload`，它参与幂等摘要；不得把原始密码等秘密放入该业务请求。traceId 不影响重放。平台只保存摘要及平台动作回执，不返回领域响应快照。
- 没有传入 transaction 时 runtime 自建 ReadCommitted 事务；外层事务也必须显式使用 `isolationLevel: 'ReadCommitted'`。服务在任何业务写入前检查实际隔离级别，其余级别返回 409 `WORKFLOW_TRANSACTION_ISOLATION_UNSUPPORTED`，避免旧快照使锁后撤权重检失效。创建领域和索引的事务需由领域创建幂等协议保护；动作 mutation 必须放入 callback，避免重放前重复写领域记录。
- 分支读取命令开始时的公共索引事实。callback 不得另外修改流程实例或公共索引版本；需要更新公共事实时由领域编排明确版本步骤，不能绕过索引 CAS。

start/action 提供可加入 `Prisma.TransactionClient` 的服务边界；动作验证 fixed workflowVersionId、expectedVersion、expectedProblemVersion 和当前 node。受控动作 SUBMIT/APPROVE/VERIFY/REJECT/RETURN/CLOSE/REOPEN；同 actor/organization/idempotencyKey 相同内容返回原回执，不重复领域 mutation/审计/事件，不同内容返回 409 IDEMPOTENCY_REPLAY。并发返回 409 CONCURRENCY_CONFLICT，失去授权后禁止重放。

### 动作、授权与职责分离

- 功能权限为独立 `workflow:start` / `workflow:act`，流程定义管理仍是 `workflow:manage`。迁移只注册代码，不把生产既有角色自动提权；管理员授予仍受现有权限子集约束，部署时需明确初始权限授予。不能把节点权限当功能权限或反向替代。
- 节点 assignment 支持角色代码字符串，或 `{ roleCode, assigneeUserId, permission }`；存在的条件全部满足才授权。每次动作及幂等回放重新读取用户、角色、权限；等待幂等锁和问题行锁后再次校验功能权限。客户端不得提供可信 actor。
- 节点默认前进动作：ACTION/CC→SUBMIT、APPROVAL→APPROVE、VERIFICATION→VERIFY；CLOSE 在当前终止节点显式完成实例。进入 CLOSE 时索引为 RESOLVED，实际 CLOSE 后才为 CLOSED；REOPEN 清除 closedAt 并保留编号。
- `WorkflowTransitionDraftDto.action` 由 Swagger 生成至 contracts，并在草稿保存、发布快照及版本复制中保留。显式 RETURN/REJECT/REOPEN 只能返回前向图上的祖先，且运行时要求该节点实际访问过；前向图仍禁止环路。分支零命中或多命中一律 409 `WORKFLOW_TRANSITION_AMBIGUOUS`，不执行领域 callback。
- 默认动作也按相同的前进/后退规则校验，不能省略 action 绕过祖先校验。P1 的退回/驳回是处理节点上的动作，重开是已完成 CLOSE 节点上的动作；独立 RETURN/REJECT/REOPEN 节点的编辑器语义尚未交付，不能用它们连接未访问节点或构造不可关闭的定义。
- CLOSE 节点配置 `requireIndependentVerification: true` 时，必须存在有效 VERIFY 且验证人不同于关闭人，否则 403 `WORKFLOW_INDEPENDENT_VERIFICATION_REQUIRED`。RETURN/REJECT/REOPEN 后旧验证失效，后续跳过验证的分支不能借历史验证关闭。供应商领域绑定的版本必须显式开启该策略；通用流程不默认强加供应商规则。
- 未传入服务端参与策略时，供应商跨内部拥有组织调用仍返回 403；跨组织 START 不开放。阶段三 `SupplierWorkflowAccess` 已支持相关企业在已释放问题的显式回复节点参与，保留真实供应商 actor 和内部拥有组织，内部节点仍拒绝供应商。功能、assignment 和领域范围取交集；不拆复合外键绕过隔离。供应商 HTTP 提交、Worker/通知参与、严重度 SLA 及完整联调仍未接通。本轮 CC 为人工确认节点，SLA 为固定节点时限。
- 发布校验与当前人工运行时保持一致：assignment 的每个显式约束都必须有效，assigneeUserId 必须是 UUID；CC 需要 assignment 并由授权人员 SUBMIT。slaMinutes 为 1–2,147,483,647 的安全整数，该技术上限用于防止日期溢出，不是供应商业务时限策略。

事件约定 v1：`WORKFLOW_STARTED` / `WORKFLOW_ACTION_COMPLETED`，包含 schemaVersion、organizationId、problemIndexId、instanceId、workflowVersionId、instanceVersion、previousNodeId、currentNodeId、action、status；eventKey 使用实例 ID + 版本。P2 消费方必须防重复/乱序，不能仅按当前节点唯一键丢失重入记录。

### 迁移与验收边界

- `20260919120000_workflow_runtime`：显式动作边、幂等/历史回执、功能权限代码。
- `20260919121000_workflow_runtime_integrity`：把错误的组织+流程定义+运行版本唯一索引改为普通索引，保留 instanceKey 唯一；回执通过组织+流程版本复合外键绑定实例和节点。
- runtime 真实 PG 测试已纳入 `pnpm --filter @qms/api test:integration`，缺 DATABASE_URL 明确失败。中性夹具只在测试中，生产没有通用问题创建或绕过领域校验的动作 API。
- P2a 已接入流程事件 Worker、站内通知和待办重入，P3 附件与 P4/P5 工作空间、报告、简报升级也已实现；供应商领域端到端联调仍需使用其实际业务规则和表单独立验证。

## P2a 任务与站内通知投影

`TaskNotificationModule` 将 `OUTBOX_HANDLER` 绑定到 `WorkflowEventHandler`；P2a 保留一次最多 25 条的 `runConfiguredWorker` 单批函数，当前 CLI 的持续运行见 P2b。实例投影消费 `WORKFLOW_STARTED` / `WORKFLOW_ACTION_COMPLETED`，`PROBLEM_INDEX_CREATED` 等未知类型保留原状态。P1 v1 事件须匹配实例、节点、问题索引和幂等回执，错误数据按五次指数退避进入 FAILED。

- Worker 短事务 `SKIP LOCKED` 领取；处理事务锁事件并核对租约，再锁实例。任务、通知、`taskProjectionVersion` 和事件 PROCESSED 同事务提交；处理/确认失败全部回滚。开始和提交前检查租约，过期处理不写副作用、不增加失败次数，留待下一轮重领。
- `taskProjectionVersion` 独立于业务 `version`。事件只连续投影；已投影版本不重复写，未来版本延后 1 秒且不消耗失败次数。每次进入节点使用 `entryInstanceVersion` 创建新任务，退回/重开保留历史任务，结束上一轮活跃任务；CLOSE 结束任务而不新增。
- 每个节点轮次共享一条任务。通知候选人必须 ACTIVE、属于问题拥有组织，并同时满足 `workflow:act` 和节点配置的全部角色/处理人/额外权限条件；本批不通知跨拥有组织的内部授权人员或供应商。权限收紧后的读取授权仍由 P2c 实现，不能直接暴露持久化通知表。
- 追赶历史事件时，仅当事件版本、节点和状态仍等于实例当前值才发待处理通知。通知按实例+轮次+用户确定性去重，状态为 IN_APP/DELIVERED；这表示站内记录已写入，并不代表用户已读或邮件发送成功。
- `enteredAt` 使用事件创建时间，`dueAt` 为该时间加固定 `slaMinutes`。没有 SLA 时 dueAt 为空。提醒、超时升级与持续调度见 P2b；本轮不提供严重度时限决策表。

迁移 `20260919130000_workflow_task_projection` 补齐 Prisma 中已有数据库列 `workflowVersionId`，增加轮次、进入时间、投影游标与通知去重键。旧任务按实例内 `createdAt,id` 稳定排序回填为 -1/-2/...，旧 enteredAt=createdAt；兼容服务新建缺省轮次为 0；真实 P1 事件轮次始终为正数。迁移保持游标 0，允许逐条补投影而不跳过旧事件；首次投影结束仍活跃的旧任务但保留其历史行。旧通知键回填 `legacy:id`，新 handler 必须显式给出确定性键。

P2a 定向验证为 28 项真实 PostgreSQL + 15 项旧 Outbox 测试 PASS；聚合和复核结果见 `FOUNDATION.md`。P2c 已提供带会话与实时资源授权的任务/通知查询、领取/释放/失效重领、已读及审计；失败重试使用治理接口。没有绕过领域 runtime 的通用 complete 接口。

## P2b 时限事件与持续 Worker

本批实现、独立规格/质量审查及八步聚合均已通过，证据见 `FOUNDATION.md`。用户已确认提醒 offset 表示截止前分钟数，升级只通知负责人并保留当前任务。

- 发布节点配置 `reminders: [{ offsetMinutes }]` 需已有 SLA，各 offset 必须唯一、非负安全整数且不超过 SLA；0 表示到期提醒。`escalation` 沿用角色字符串或 assignment 对象形状，也需 SLA。
- 创建任务的同一事务内排定 `WORKFLOW_TASK_REMINDER`、`WORKFLOW_TASK_OVERDUE`，配置升级时再排 `WORKFLOW_TASK_ESCALATION`。事件聚合为 WorkflowTask，键为 `workflow-task:{taskId}:reminder:{offset}` / `:overdue` / `:escalation`，availableAt 使用截止前或截止时刻。
- 消费时从持久化任务与固定节点配置重新计算计划键和 scheduledAt，载荷须匹配组织、问题、实例、版本、节点和进入轮次。退避可改变 availableAt，不改变载荷的原计划时刻。事件→实例→任务为统一加锁顺序；定时副作用与确认保持 P2a 原子边界。
- 仅处理仍是实际实例当前节点/轮次的未完成任务。关闭、取消、归档、旧轮次、问题不再引用实例的事件静默确认；不能因为任务投影尚未追上就向旧节点发送通知。当前有效轮次迟到时逐条补发配置提醒，每个事件/收件人去重。
- OVERDUE 只将任务标为超时并增加 task.version，不另发处理人通知，不改变实例业务版本、投影游标或处理人。提醒仍需 `workflow:act` 与 assignment；升级需 `problem-index:read` 与 escalation 的全部约束，仍仅 ACTIVE、同拥有组织，不授予节点操作权。
- `worker.ts` 默认持续运行，支持 `--once`；默认轮询 1000ms、批次 25，可分别配置为 100–60000ms 和 1–100。非法配置/缺 handler 明确失败；终止信号停止新领取并等待当前批次，基础设施失败退出非零。Compose 同镜像、on-failure 重启及 60s 停止宽限；强制中止后的租约由下一进程恢复。

严重度 SLA 映射、多级/循环升级、业务通知邮件通道不在本次已确认范围；时限按固定节点配置。任务/通知/失败队列公共接口已交付，领域仍不得绕过这些接口的授权复验。

定时事件在新任务创建事务中排定，本批不会扫描并补排部署前已存在的任务。P2a/P2b 当前都未部署；若集成目标已有活跃任务，上线前需另行受控补排并验证原始 enteredAt/dueAt，不能重置投影游标或重新创建任务来模拟补排。

## 附件接入（P3）

P3 已提供 60 秒固定版本签名、防覆盖上传、完成校验、真实 ClamAV 扫描、隔离状态、资源授权和逻辑删除审计。扫描结论由服务端实际对象检测产生，不接受客户端自报。私有版本桶与 COMPLIANCE 保留保护和恢复工具沿用数据保护协议。

P3 接入：授权资源引用 → 隔离上传会话 → 实际对象上传 → 服务端 HEAD/哈希/大小校验 → 安全扫描 → AVAILABLE → 每次读取重新授权后发短时下载 URL。删除逻辑标记、保留期和对象版本保护；附件关联、流程提交、审计在领域事务内。领域提供 `resourceType/resourceId` 访问规则与证据业务用途，平台负责文件生命周期；供应商企业 ID 只从会话/服务端领域关系解析。生产文件资源注册表默认空，阶段三须实现真实领域授权并验证允许/拒绝路径后使用。

## 集成与门槛

### 阶段三何时可同步启动

用户要求在可启动时在本任务内明确通知；本判定不读取或联系另一个任务。

| 启动范围 | 当前条件 / 放行条件 |
| --- | --- |
| 供应商专业模型、业务规则、DTO/表单、门户页面结构 | 可独立并行开发，继续由阶段三拥有；使用领域自己的事实和企业关系，不把供应商字段加入公共索引 |
| 接入编号、索引、固定版本流程及 P1/P2 事务服务 | `D:/WorkSpace/QMS-2.0/qms-2.0` 为权威实现目录；按当前生成契约接入并跑阶段三实际服务测试。尚未 Git 提交或推送 |
| 供应商跨内部拥有组织的实际处理与整改协作 | 仍需明确并实现领域资源授权适配、平台运行时接入及企业 A/B 允许/拒绝证据。当前 P1 明确拒绝跨拥有组织的供应商 actor，不能用服务端内部账号替供应商绕过该边界 |
| 证据上传、下载及完整业务联调 | P3 生命周期和 P2c 实时任务/通知接口已可接入；领域须注册证据资源授权、不可变修订与专用处理接口，并运行自身跨企业和真实附件验收 |
| 真实供应商试点 | 还需平台与供应商端到端闭环、业务浏览器验收及既定 D–H 最小治理门槛；本批单测和底座浏览器通过不替代这些条件 |

因此无需等全部阶段二完成才开始非生产领域开发；共享接口联调和真实试点按上表分别放行，不能用同一个“阶段三已可用”结论覆盖。

共享 schema/迁移、权限目录、AppModule、导航和验收入口由平台协调，禁止覆盖其他工作树。逐批提供文件/迁移/验证清单，契约重新生成。平台真实 PG/浏览器验收与供应商端到端联调分别记录。D 通知配置、E MFA/找回/高风险保护、G TLS/密钥/存储/恢复和 H 导出/保留/国际化/无障碍门禁全部满足之前，不启动真实试点。
