# 问题工作空间与领域接入

阶段二提供公共问题查询、个人视图、工作空间、只读报告、问题追溯和受控流程升级。生产领域适配器注册表默认留空；供应商专业字段、表单、跨企业授权必须由领域实现和验收。中性验收模块只存在于 `apps/api/test/problem-index/` 与 `apps/web/playwright/fixtures/`，不由生产入口导入。

## HTTP 契约

浏览器类型由 Nest Swagger 生成到 `@qms/contracts`。`organizationId` 只是所选组织上下文，不能替代会话授权；历史实例还必须具有稳定的本问题归属。

| 接口 | 行为 |
| --- | --- |
| `GET /api/v1/problem-index`、`GET /api/v1/problem-center` | 在 SQL 授权范围内筛选、统计和分页，返回领域摘要；未知领域不可见 |
| `GET /api/v1/problem-index/:id/workspace` | 公共身份、当前或所选 `instanceId`、固定流程、节点访问事实、任务资格、领域修订、升级历史与证据 |
| `GET /api/v1/reports/problems/:id` | 对应固定实例的不可变领域修订；不能证明的历史字段明确不可用 |
| `GET /api/v1/problems/:id/audit-trail` | 问题可信关系内的安全审计投影，按时间与 ID 游标分页 |
| `GET/POST /api/v1/problem-views`、`PATCH/DELETE /api/v1/problem-views/:id` | 本人及所选授权组织的个人视图；更新、删除必须 `expectedVersion` |
| `GET /api/v1/problem-index/:id/upgrade-preview` | 领域绑定的目标流程、映射摘要、当前资格及预期版本 |
| `POST /api/v1/problem-index/:id/upgrade` | CSRF、幂等键、当前实例/节点及问题/实例/领域版本；原因必填；全部事务提交或回滚 |

视图仅保存 schemaVersion 1 的白名单 filters、sort、visibleColumns、columnOrder。不能保存 SQL、脚本、任意查询对象、跨用户共享视图或完整问题快照。截止范围及逾期筛选使用带时区的明确时点。

## 领域读取适配器

在 `ProblemReadModule` 的固定 provider 中显式注册 `ProblemDomainReadAdapter`，精确匹配 domainCode/sourceType，sourceId 必须存在。不能用数据库或环境配置动态加载模块。

- `visibilityPredicate` 返回参数化 Prisma SQL，公共问题别名固定为 `p`。可见性参与 count、分页及状态统计，不在分页后过滤。
- `authorizeRead` 分别证明 overview、report、history 用途。批量 `readSummaries` 也必须在最终会话锁前完成领域锁定与授权；单纯具有任务处理权限不等于能读取全文。
- `readWorkspace` 返回受限段落及字段；`readReport` 必须返回真实关联 instanceId/instanceVersion 的不可变领域修订。平台用已提交 WorkflowMutation 回执重建当时流程节点，不以当前值填补历史。
- `listEvidenceReferences` 给出文件与真实资源的成对关系。平台单次 `readEvidence` 批量复验；最多 100 个文件，不持久化签名 URL。`revisionId=null` 的 history 用途必须覆盖该问题历史关联证据。
- 可选 `revisionResourceType` 与 `listRevisionIds` 必须同时注册。最多 1000 个修订，超过上限明确失败；禁止占用平台资源类型。未提供时响应明确声明领域修订追溯不可用。
- `describeActions` 只描述能力，不执行写入。平台保留 `platform.upgrade` 作为升级预览入口；预览和提交仍独立重验资格。历史实例没有写动作。

领域读取及附件读取必须采用一致的锁顺序与锁强度。读路径已持有共享锁时，附件 read 授权不能再把同一行升级为排他锁；并发报告会因此死锁。所有领域/资源/文件锁先取得，再锁定和复验用户、会话及权限；再次授权只能重验已经取得的锁。写路径按 problem → instance → 当前 tasks → 领域记录 → 文件 → 身份顺序协作。具体附件协议见 [ATTACHMENTS](ATTACHMENTS.md)。

## 专业表单

`ProblemDomainUiProvider` 接受编译期固定的 domainUiKey → React 组件映射。默认注册表为空；不能把服务端字符串作为 import 路径、URL 或脚本执行。组件接收生成契约的 workspace 和 refresh。公共页面不会提供任意 JSON 的“完成任务”接口。

领域表单必须使用自己的 Swagger DTO 和控制器，取得真实会话 actor/sessionId，在 ReadCommitted 事务中调用 runtime，并提供第四参数 `domainAccess(tx, { replay })`。runtime 先取得公共问题/实例/任务锁，再由该入口取得领域和证据锁、校验资源授权及正常请求版本，最后复验身份；幂等回放也调用该入口重验领域访问。`mutate` 仅写已预锁记录和新增不可变修订，不在身份锁之后申请新的领域锁。提交按钮依据服务端能力提示，HTTP 提交仍重验授权；历史实例不挂载可写领域组件。

领取保持独占，可释放，原领取人失去处理资格后可以重新领取。不能用 workspace.readOnly 一并隐藏重新领取入口，应使用当前实例与 TaskDto.canClaim/canRelease。Worker 尚未投影任务时显示同步中，不合成假任务。

## 升级与迁移

`WorkflowUpgradeDomainAdapter` 证明资源授权、简报类型、可升级节点、已发布目标绑定和显式字段映射。浏览器不能任意指定目标版本。人工填写或有意清空的目标值（false、0、空字符串、null）必须保留；映射摘要只返回字段标识及 COPIED/PRESERVED/UNMAPPED。

升级保留问题 UUID、报告编号、source 引用、证据关系和审计，取消旧实例与未完成任务，创建新的独立实例和 START 回执。领域修改、问题 CAS、实例切换、升级事实、审计、Outbox 任一步失败都回滚。迟到旧实例事件验证可信引用后确认，不复活旧任务。网络结果不明时前端重用原幂等键及请求体；409 后保留原因并要求显式刷新确认。

迁移 `20260919220000_workflow_upgrade_history` 只回填明确的当前一对一关联。历史孤立实例保留 NULL 并默认拒绝运行与读取，不猜测归属。当前指针复合 FK 使用 `NOT VALID` 保留无法自动修复的旧记录，同时约束新增和更新；生产迁移前需审计、修复遗留关系并显式 VALIDATE，不能把开发临时库迁移通过视为生产数据修复完成。

## 验收

`pnpm acceptance:phase-2` 聚合真实 PostgreSQL、Worker、API/Web、构建、契约、Compose、归档隔离和全部浏览器验收，另核对测试领域 Swagger 契约。要求主验收库、附件浏览器库、问题浏览器库相互隔离，禁止 55440；缺依赖必须失败。凭据、夹具 JSON、扫描样本及日志均留在 Git 外。测试领域的单独类型包 `@qms/contracts/testing/problem-browser` 由测试 Nest Swagger 生成，不属于生产 HTTP 接口。

本文件说明已实现接入协议；实际 PASS/FAIL、命令和限制以 [FOUNDATION](FOUNDATION.md) 最新记录为准。
