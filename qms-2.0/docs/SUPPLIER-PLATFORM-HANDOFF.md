# 供应商质量 → 公共平台交接

## N5 完整8D接续（2026-10-28，86d68f8已部署）

PR #79最终acf071c已合并部署`86d68f8506165bae2650986ba2b0cbbcac77825d`（V0.0.34含fix1～fix4），PR/main各9项CI与deploy40684505960成功，7迁移及三服务/公网机器核验PASS，见[N5计划第8节](../../docs/superpowers/plans/2026-10-28-qms-n5-supplier-eight-d.md)。不自动配生产岗位/发布启用绑定或实际释放资料；当前/批准/历史报告、门户选定披露附件与内部任务直达均随本版上线，真实角色人工验收仍待。下方未发布描述是历史，不覆盖本节。

本轮V0.0.34 / [Issue #78](https://github.com/JasonShu0722/QMS-2.0/issues/78)在既有供应商问题主表与回复修订上增加受控完整8D，不建立第二套主台账，也不将供应商加入内部三域执行器。核心、报告、来源复制、独立延期、真实披露、任务通知及正式页面按[N5计划](../../docs/superpowers/plans/2026-10-28-qms-n5-supplier-eight-d.md)整合；已有分项真实测试不代表最终发布门禁或人工验收通过。N4运行基线为PR #77合并部署的a60a189，N5尚无PR/部署。

- 完整供应商8D使用专用入口、真实外部账号和SUPPLIER关闭策略；旧BRIEF/INTERNAL及历史实例保持旧链，不通过通用动作绕过完整报告锁版。
- 发单的SQE目录使用组织公开任职接缝，过滤实际业务权限和有效任职后分页，不要求发单人取得组织配置权限。绑定与启用分开，草稿路由提示不替代正式发单时对已发布且启用绑定的事务校验。
- 来源复制只产生独立可编辑供应商草稿；正式发单后才呈现来源SQE协作。协作任务按实际源READ、指定SQE及复核/解析资格在扫描和计数前过滤，不凭来源关系开放内部报告或其他客户资料。
- 附件披露先预览，再显式确认实际文件清单及固定对象版本。门户只读取本企业已释放资料；上传扫描、当前会话、资料版本和读取清单均须复验。不把内部附件ID或已选草稿当作对外许可。
- 标准门户通过responses:read访问专用8D待办，不增加内部task:read；内部待办仍要求原task权限。真实通知冲突必须保留失败重试，明确结束/失效来源不产生新提醒。
- 报告区分CURRENT、批准版本和历史修订；关闭后的内部补充不改原审批/关闭事实，不向门户泄露。公共问题中心按真实源单ID进入完整工作区，旧单据不虚报新链能力。

夜间交付已由负责人取消，heartbeat已删除；当前按常规本地收口与PR检查点推进，不自动合并部署，不配置生产岗位/绑定，不释放生产资料，不关闭Issue/REQ或回填Base。

## REQ-0019 主数据交互增量（2026-10-18，开发中）

三类主数据采用新增/导入弹窗，平台管理将授权的供应商、客户、物料入口相邻排列。Excel 主数据导入在浏览器内按每批最多 100 行、完整 JSON UTF-8 不超过 96 KiB 串行发送，不提高服务端行数或请求体上限；账号与投诉等原读取调用仍保留默认 100 行限制。每批使用固定内容与幂等键，保留 Excel 全局行号、逐行结果和部分已提交事实；网络结果未知时以同键重试，确认停止须等待在途请求结束。刷新失败不能清掉导入回执，页面刷新后的恢复不在范围内。

供应商仍只新增独立档案，不自动创建企业或账号；客户只写权限与物料读/写/导入权限分别判断，不从读取失败推断没有写权限。权限、取消、未保存保护及真实结果验收见[本轮设计](../../docs/superpowers/specs/2026-10-18-qms-compact-account-master-audit-design.md)和[计划](../../docs/superpowers/plans/2026-10-18-qms-compact-account-master-audit.md)，当前不代表发布完成。

## P0/P1 独立档案与按需账号（2026-10-18，F1 候选）

商业事实仍唯一归 `SupplierBusinessProfile`，编码、名称和原联系人可独立维护；新增或导入清单不要求供应商企业，也不创建企业或用户。已有非空企业和历史问题、通知、附件不改写。完整目标、机器证据及逐版本部署状态见 [基础数据计划](../../docs/superpowers/plans/2026-10-17-qms-p0-p1-master-data.md)。

- 档案和内部专业记录允许企业快照为空；12 处强 `(profileId, ownerOrganizationId)` 外键始终保护内部拥有范围，原非空三元企业约束继续生效，不能利用 PostgreSQL `MATCH SIMPLE` 绕过隔离。对外已释放问题及 PUBLISHED 绩效仍要求企业非空。
- 管理员从档案显式开通供应商用户账号。首次关联已有受控 SUPPLIER 企业，或通过组织公开服务创建专属隔离边界；企业、绑定、人员账号、固定门户角色、临时密码和审计/幂等同事务，失败不留半成品。第二账号复用同一家边界；不开放注册、邀请、部门或岗位树。
- 专用 identity 公开事务入口治理供应商账号，目标严格同企业、同账号类型，所有角色的范围和权限须为门户 allowlist 子集；兼容既有同企业受限自定义角色或无角色账号，不要求历史 role code 相同。新创建使用固定门户角色，客户端不能指定权限；不放宽通用管理员 `assertTarget`。caretaker 只获得操作者在内部拥有组织已有的 create/read/reset/status 交集，不获得全局角色或组织治理权。
- 门户 allowlist 包含实际回复必需的 `workflow:act`，仍由领域与流程运行时复验当前节点。临时密码加密、7 天有效、首次改密、重置及停用撤会话沿 C 公开核心；明文不进入幂等回执，密码响应 `Cache-Control: no-store`，每次查询/复制/下载独立复验近期完整认证及目标权限。
- 内部业务允许未开通档案；只有供应商问题 SUPPLIER 发单和绩效发布等真实门户入口在缺边界时返回 `SUPPLIER_COLLABORATION_NOT_ENABLED`。内部特采放行、审核、目标、会议、PPAP、标准、条码及 ASN 不机械增加门户门禁。消费者经领域公开服务读取，不跨模块直接写档案/身份/授权表。
- 企业快照采用 owner 域懒回填：各域在自己的未发布写事务取当前绑定，空值才填，旧非空不同则冲突，不批量改写已处理历史。未开通不投递门户通知；已释放却为空是不变量失败，不解释成全部企业。未绑定内部证据归内部 owner，旧非空文件映射保持。

上线以本单元 PR 的 main/CD SHA 核验为准；新头像与既有文件扫描门禁不被此说明替代。浏览器按负责人要求部署后人工确认，新账号首登改密、同家多账号回复/隔离与无注册入口未获得人工反馈前不记浏览器 PASS。

## 当前主目录增量（2026-09-23）

早期供应商增量已由提交 `1b94d14` 整合到 `D:/WorkSpace/QMS-2.0/qms-2.0` 的 `main`；后续继续在用户指定主目录工作。下文旧工作树位置和“待提供”接口表为历史背景，当前可调用接口以 `PLATFORM-HANDOFF.md` 及实际代码为准。

S4.1c 已新增 `SupplierWorkflowBindingService` 和 `/api/v1/supplier-quality/workflow-bindings`。配置键是拥有内部组织、severity、BRIEF/EIGHT_D、INTERNAL/SUPPLIER；每次写入追加版本并以 expectedVersion 做 CAS，审计和同键幂等在同一管理事务中完成。内部管理员可在显式组织授权下管理内部组织，供应商组织一律拒绝；没有默认绑定或默认 SLA。

S4.1d 已新增 `POST /api/v1/supplier-quality/drafts/:id/issue`。领域入口在 ReadCommitted 事务内解析绑定、创建 `ProblemIndex`、调用 `WorkflowRuntimeService.startInstance`，再保存 `workflowBindingId/workflowBindingVersion` 和供应商释放时间；平台实例、领域记录、审计与 Outbox 任一步失败均回滚。正式入口使用 workflow mutation 做同键重放，变更请求或第二个 key 不会产生第二个编号/实例。

S4.2 已新增内部 `POST /api/v1/supplier-quality/problems/:id/actions` 和供应商门户 `POST /api/v1/supplier-portal/problems/:id/actions`。正式回复入口必须在同一 ReadCommitted 事务中调用 `WorkflowRuntimeService.submitAction` 与 `SupplierWorkflowAccess`，由平台校验当前节点/参与资格，领域校验当前问题版本并写入不可变 `SupplierResponseRevision`、删除草稿、递增内容版本和记录审计。回复节点推进后不得继续保存回复草稿；同键同内容只返回原结果，同键内容变化返回 409。`supplier-quality` 文件资源授权已注册，提交时复验可用文件并绑定当前修订；真实对象存储/ClamAV 纵向验收仍沿用附件平台门禁。

S4.3 已新增内部 `POST /api/v1/supplier-quality/problems/:id/workflow-actions`。`VERIFY`、`CLOSE` 等内部动作继续复用平台 action/runtime；验证写入按问题和当前回复修订关联的不可变 `SupplierVerification`，关闭在同一 ReadCommitted 事务中调用 `assertInternalClosure`，要求有效验证人与关闭人不同。供应商企业无内部动作路由，流程参与适配器仍拒绝供应商验证/关闭；RETURN/REJECT/REOPEN 后的重提、修订历史读模型和 Web 内部动作已完成真实 PG 回归。

正式发单事务应调用 `resolve(tx, organizationId, selector)`，保存返回的 bindingId/bindingVersion/workflowVersionId/replyNodeId/responseSlaMinutes，并把同一固定版本交给 `WorkflowRuntimeService.startInstance`。解析器只接受启用、精确选择、拥有组织一致且 PUBLISHED 的版本；必须存在唯一 `supplier-quality:responses:write` ACTION、正整数节点 `slaMinutes`、VERIFICATION 和所有 CLOSE 的独立验证。缺配置、禁用、退休或不合规版本均为受控 409；本批没有启动流程或提供发单成功替身。

本批增加 `SupplierProblemReadAdapter`，在 `ProblemReadModule` 注册 `supplier-quality / supplier-quality` 公共读取。只接入内部公共台账与当前专业资料，要求公共和领域读权限、拥有组织授权及双向索引引用同时满足；当前及升级前回复修订的证据引用可按修订读取。供应商门户隔离保持独立；回复写动作、附件资源授权、平台升级适配器和修订历史读模型已接入，历史报表仍不伪造缺少不可变快照的状态/时限。

正式发单、供应商回复、验证关闭、驳回重提、平台升级和供应商门户通知投影已接通。通知使用独立跨组织投影表，不放宽原有同组织任务/通知外键；Worker/门户真实回归已通过。一次性 PostgreSQL/MinIO/ClamAV/API/Worker/Web/Chromium 环境已完成发单→上传扫描→回复→验证→独立关闭纵向验收，供应商质量浏览器规格全量 2/2 PASS；阶段三开发收尾标记 PASS。该结论不等同于提交、部署或生产/试点放行，后者仍受阶段二 D–H 治理清单和发布审批约束。不得复用草稿 Serializable 事务、冒充内部 actor、放宽公共组织范围，或伪造默认时长。详细证据见 `PHASE-3.md`。

后续 S4.1b 已接入 runtime 服务端 `WorkflowParticipantAccess` 和领域 `SupplierWorkflowAccess`。调用 `submitAction(..., domainAccess, supplierAccess)` 时，回复节点必须为 ACTION 且 assignment.permission 为 `supplier-quality:responses:write`；内外回复身份由领域记录决定，角色/指定人约束继续由平台按权限组织校验。非回复节点只允许内部身份，CLOSE 必须启用平台独立验证。领域版本/证据 CAS 仍由正式业务 `domainAccess` 与 `mutate` 实现；不得把该参与策略当作回复内容提交校验。S4.2 已将该参与策略接入正式内部与门户回复动作。草稿保存与运行时仍存在相反锁顺序；数据库选择死锁受害者时回滚并返回 409，客户端保留输入后重试。

日期：2026-09-19。通过本地文件人工协调；跨任务工具交互已按用户反馈停止。

## 任务位置

- 任务：QMS 2.0 阶段三供应商质量开发。
- 工作树：`D:/WorkSpace/QMS-2-supplier-quality`。
- 分支：`codex/qms-2-supplier-quality`。
- 共同基线：`54621e09a8c4b469070c00497e55e58ea237da72`。
- 平台：`D:/WorkSpace/QMS-2-platform-remaining`，`codex/qms-2-platform-remaining`。

## 已确认业务规则

1. 一个问题对应一家责任供应商；多供应商拆单。
2. 发单必选 BRIEF / EIGHT_D，与严重度独立；工程师可升级，编号保持。
3. 时限依严重度配置，需要平台提供配置版本/计算后的 dueAt；领域不硬编码时长。
4. INTERNAL 回复模式必须指定内部个人；SUPPLIER 模式由相关供应商回复，内部人员不能冒充供应商提交。
5. 内部验证人与关闭人分离；关闭必须绑定当前内容修订的有效验证。驳回/重开后旧验证不应继续有效。

## 当前领域增量

用户已再次授权并行非生产开发。本工作树现已包含供应商领域规则、模型/迁移、真实草稿 HTTP、生成契约、内部表单与门户。草稿功能的真实授权与数据库测试已通过；不代表正式流程联调或上线。以下纯规则继续服务后续平台集成：

- `validateProblemFacts`：单供应商 UUID、物料/缺陷/数量、严重度、显式回复形式、内外回复人约束及拒绝服务端字段注入。
- `validateResponseContent`：简报/8D 草稿与最终回复内容；供应商自验与内部验证分离。
- `assertResourceScope` / `assertReplyActor`：仅校验领域范围，必须在平台真实功能权限校验之后调用；内部授权组织参数仅允许来自平台服务器，不能用客户端 body/query 直接填入。
- `assertInternalClosure`：当前内容版本、问题归属和验证人/关闭人分离；平台仍负责节点、角色、状态和驳回重开失效机制。
- `assertEvidenceReferences`：平台已授权解析的文件必须 AVAILABLE 且资源匹配；不可把浏览器的文件状态当输入。
- `mergeBriefContent`：仅补缺失共通字段；保留人工修改及显式空值。编号、流程替换、证据与审计迁移仍由平台同事务处理。

## 请平台提供的集成增量

| 依赖 | 需要的行为/接口证据 |
| --- | --- |
| 跨组织资源与节点授权 | 内部拥有组织与供应商会话企业分离；领域关系只授权单问题，不能赋予内部组织通用访问；功能+节点+领域范围同时校验 |
| start/action/upgrade 事务 | 同 Prisma.TransactionClient；领域 mutation 仅首次幂等请求运行；payload 摘要、领域/索引/流程 CAS、审计/Outbox 与回执同事务 |
| 关闭职责分离 | 可信当前验证记录/内容修订；REJECT/RETURN/REOPEN 失效后不可凭旧验证关闭 |
| SLA | 按严重度配置及版本化时限；用户未给具体小时值，不能默认为 24/48 小时 |
| 附件 | 真实上传隔离/扫描/授权解析 API；supplier-quality + problem UUID 资源引用；提交与读取时重新授权 |
| Worker | 真实业务 handler、重入节点待办、重复/乱序/失败恢复证据 |
| 共享集成 | Prisma/迁移、权限目录、模块注册、导航和 Swagger 生成契约按批次集成，不覆盖对方工作树 |

## 继续顺序

S1 规则完成，S2/S3 的非生产草稿子集已实现并验证；正式业务动作与 S4 平台联调仍未完成。测试释放夹具不算正式业务链证据。试点等待阶段 2A 对应治理门槛。

## 本轮共享增量清单（尚未合入平台）

| 文件/模块 | 增量与集成注意事项 |
| --- | --- |
| Prisma schema 与 `20260919200000_supplier_quality_domain`、`20260919201000_supplier_reference_integrity` | 五个领域模型、组织/供应商/回复人约束、身份引用保护；第二迁移使用外键错误语义，复用账号转组织 409 映射；六项权限只建目录不默认授权 |
| AppModule | 注册 SupplierQualityModule；不注册新流程或 Worker |
| AdminMutationService | 新增可选第三参数 authorizeResource，在查幂等回执之前重新执行领域授权；现有调用不变；仅草稿使用其 Serializable 事务，正式运行时仍采用平台最终事务约定 |
| OrganizationService/Module、IdentityService | 公开最小组织 lookup、供应商目录、内部回复人目录/身份检查，支持传入同一个事务；领域不直接读账号/组织表 |
| permission-catalog 与对应 HTTP 测试 | 三个可用模块六项权限；绩效、审核、PPAP 仍 planned 无可授予权限 |
| platform-error | 四项供应商可控错误，冲突沿用 CONCURRENCY_CONFLICT |
| Web layouts/navigation | 内部供应商质量与门户整改接入页面；共享供应商组件仅使用生成 contracts 类型 |
| Vite config | 可选 QMS_DEV_API_URL 隔离 API 端口；默认地址不变 |
| API package.json | test:integration 纳入供应商真实 PG 用例 |
| generated/api.ts | Swagger 生成；集成后必须重新 contracts:generate / contracts:check |

现有端点：内部 `profiles` GET/POST、`profiles/:id` GET/PUT、`supplier-options` GET、`reference-options` GET、`problems` GET、`problems/:id` GET、`drafts` POST、`drafts/:id` PUT、`problems/:id/response-draft` PUT、`problems/:id/actions` POST；门户 `problems` GET、`problems/:id` GET、`problems/:id/response-draft` PUT、`problems/:id/actions` POST。写请求均需 CSRF 与 Idempotency-Key，问题/回复更新需领域 expectedVersion，资料更新需资料自身 expectedVersion。

并行完善批次新增约定：SupplierProfileDto 返回 version；PUT profiles/:id 仅接受业务编码/联系资料及版本，省略可选联系资料表示清除，不允许变更企业归属。目录统一返回 `{ items, total }`，支持 page/pageSize/search/selectedId；reference-options 通过 kind=profiles（默认）或 responders 指定目录。此响应替换首批开发期组合数组契约，未发布兼容接口。问题列表增加 severity/responseForm/stage；筛选与领域授权用 AND 组合。Web 和生成契约同批更新，不可只摘取前端或 DTO。

草稿事务只提交领域、审计与回执。HTTP 不接受 problemIndexId / releasedToSupplierAt / supplierOrganizationId 等问题服务端派生字段。门户从会话企业和业务关系授权，不要求或允许供应商获得内部组织通用权限。已关闭/归档/已解决记录禁止继续保存回复草稿。

API 318、真实 PG 95、定向页面/导航 7、Web 幂等请求 2、真实浏览器草稿场景 1 项通过。全量 Web 仍有既有权限矩阵 2 项超时，不能宣称全量验收通过。详细结果及限制见 PHASE-3.md。平台合入前需人工审阅共享增量，重新生成契约并跑双方联合测试。继续通过本地文件人工协调，不使用跨任务交互工具。

最新并行完善批次：API 318、真实 PG 102（供应商 30）、供应商 Web 9、真实浏览器 2 项通过；全量 Web 原始结果 76/78，新增回归超时已优化并定向通过，既有权限矩阵切换草稿用例仍超时，未再次全量重跑。新增共享差异仅扩展 OrganizationService.supplierDirectory 和 IdentityService.internalResponders 的分页查询签名；保留同事务参数，不读取对方未提交实现，不新增迁移/默认授权/流程能力。详见 PHASE-3.md。
