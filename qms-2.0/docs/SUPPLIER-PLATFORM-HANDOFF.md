# 供应商质量 → 公共平台交接

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

现有端点：内部 `profiles` GET/POST、`profiles/:id` GET/PUT、`supplier-options` GET、`reference-options` GET、`problems` GET、`problems/:id` GET、`drafts` POST、`drafts/:id` PUT、`problems/:id/response-draft` PUT；门户 `problems` GET、`problems/:id` GET、`problems/:id/response-draft` PUT。写请求均需 CSRF 与 Idempotency-Key，问题/回复更新需领域 expectedVersion，资料更新需资料自身 expectedVersion。

并行完善批次新增约定：SupplierProfileDto 返回 version；PUT profiles/:id 仅接受业务编码/联系资料及版本，省略可选联系资料表示清除，不允许变更企业归属。目录统一返回 `{ items, total }`，支持 page/pageSize/search/selectedId；reference-options 通过 kind=profiles（默认）或 responders 指定目录。此响应替换首批开发期组合数组契约，未发布兼容接口。问题列表增加 severity/responseForm/stage；筛选与领域授权用 AND 组合。Web 和生成契约同批更新，不可只摘取前端或 DTO。

草稿事务只提交领域、审计与回执。HTTP 不接受 problemIndexId / releasedToSupplierAt / supplierOrganizationId 等问题服务端派生字段。门户从会话企业和业务关系授权，不要求或允许供应商获得内部组织通用权限。已关闭/归档/已解决记录禁止继续保存回复草稿。

API 318、真实 PG 95、定向页面/导航 7、Web 幂等请求 2、真实浏览器草稿场景 1 项通过。全量 Web 仍有既有权限矩阵 2 项超时，不能宣称全量验收通过。详细结果及限制见 PHASE-3.md。平台合入前需人工审阅共享增量，重新生成契约并跑双方联合测试。继续通过本地文件人工协调，不使用跨任务交互工具。

最新并行完善批次：API 318、真实 PG 102（供应商 30）、供应商 Web 9、真实浏览器 2 项通过；全量 Web 原始结果 76/78，新增回归超时已优化并定向通过，既有权限矩阵切换草稿用例仍超时，未再次全量重跑。新增共享差异仅扩展 OrganizationService.supplierDirectory 和 IdentityService.internalResponders 的分页查询签名；保留同事务参数，不读取对方未提交实现，不新增迁移/默认授权/流程能力。详见 PHASE-3.md。
