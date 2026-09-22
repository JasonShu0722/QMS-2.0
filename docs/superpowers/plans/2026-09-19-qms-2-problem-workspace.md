# QMS 2.0 问题中心、工作空间与报告计划

## 范围与依赖

在主目录 `qms-2.0/` 实现 P4 公共页面余项，复用 P2c 节点/领取资格，等待 P3 的真实证据读取与 P5 的稳定实例历史归属。流程设计器使用独立计划。供应商专业表单由领域维护，不访问其他用户任务或工作树，不新增公共任意JSON完成接口。

执行顺序细化为：P3附件→P4设计器→P5稳定历史与升级→本计划工作空间/报告→P6聚合。这样报告不会先依赖缺失的历史关系，也不重复添加另一套实例归属。

## 明确的产品边界

- 显示当前节点、真实访问及完成事实，不臆造分支/退回后的完成百分比。
- 只读报告采用固定流程及不可变领域修订；无法证明的历史公共字段明确“历史数据不可用”，不拿当前值冒充旧值。
- 完整问题、报告、追溯先要求 `problem-index:read` 再叠加领域资源用途授权；任务处理资格不会自动授予全文阅读。只具任务资格的专用领域处理页面由领域注册，不扩大公共读权限。
- 保存视图只属于本人及所选授权组织，包含固定schemaVersion和白名单查询/显示偏好，不实现共享、团队默认或系统强制视图。
- 未注册领域默认拒绝，不退化为整组织可见。截止筛选采用明确时间，不先设未定义的“即将逾期”小时数或严重度业务顺序。

## 领域读取注册

新增固定provider注册的 `problem-domain-registry.ts`，精确匹配 `(domainCode, sourceType)`，未知/重复/缺sourceId默认拒绝。禁止通过HTTP、数据库配置或环境动态加载代码。

协议包括参数化 `visibilityPredicate`、`authorizeRead(purpose)`、批量 `readSummaries`、`readWorkspace`、版本化 `readReport`、`listEvidenceReferences` 与 `describeActions`。目的为overview/report/history；返回明确DTO字段而非任意Prisma记录或HTML。领域可自行进一步收紧用途权限。组合工作空间/报告读取必须让领域读取适配器与文件资源适配器对同一业务记录采用一致的全局锁顺序和兼容锁强度：只读路径不得先 `FOR SHARE` 后升级为 `FOR UPDATE`，写入/关联才可按统一顺序使用排他锁；全部业务锁等待完成后必须重新校验会话、功能权限和领域用途授权，不能靠捕获死锁重试掩盖锁序错误，也不能把全部公共读取粗暴改成排他串行。

问题可见谓词进入SQL WHERE，先授权再count/limit/统计；分页后批量读取授权摘要，禁止N+1或分页后删行。领域只注册读模型和能力描述，实际提交仍走该领域Swagger DTO/控制器，再由受控runtime执行。

前端以编译期映射解释受控domainUiKey/actionKey，不动态import数据库路径或执行任意脚本。中性测试域只注册于测试Nest/Vite入口，生产AppModule不导入。

## 文件与接口

- [x] `problem-index/problem-query.service.ts` 与查询DTO：统一 `/api/v1/problem-index`、现有problem-center查询的授权、筛选、稳定排序、分页和统计口径。公共索引不增加专业描述/原因/措施/8D正文。
- [x] 查询白名单：domainCode、problemType、status、severity、ownerId、报告编号、截止范围、逾期条件、固定排序字段/方向；有界分页、严格UUID/date/数组验证，始终附加id稳定排序。
- [x] `problem-workspace.service.ts/.dto.ts`：`GET /api/v1/problem-index/:id/workspace?instanceId=...` 返回公共身份、领域摘要/修订、当前或历史选择、固定流程节点/访问、当前TaskDto、服务端能力、预期问题/实例/领域版本、历史实例及升级概要。
- [x] 工作空间只能选择稳定problemIndexId归属本问题的实例；同组织另一问题也拒绝。历史一律只读。task未投影时表达projectionPending，不创建伪任务、不改变runtime动作规则。
- [x] workflow公开无副作用能力预检，复用实时assignment、独占领取、当前实例指针、条件唯一命中、实际访问祖先和独立验证；UI能力是快照，提交仍重验。
- [x] `problem-saved-view.service/controller/dto.ts` 与独立迁移：本人组织视图CRUD，name/version/configuration JSON；限定filters/sort/visibleColumns/columnOrder，更新/删除CAS。组织、owner来自会话授权；内部跨组织用户不强加主组织FK。
- [x] `reporting.service/dto/controller.ts`：`GET /api/v1/reports/problems/:id?instanceId=...` 返回生成时间、问题/实例/固定版本、领域修订、公共概要、领域段落、节点事实、证据、升级来源及数据可用性。只读预览，不顺带实现PDF签章/异步导出。
- [x] `audit-log/problem-audit-query.service.ts`：`GET /api/v1/problems/:id/audit-trail` 安全投影、稳定createdAt/id游标分页，先领域授权再展开可信范围，不暴露全站审计或任意metadata。
- [x] Web问题中心/工作空间/报告/追溯/视图使用生成契约，持续传递合法组织上下文，处理403、版本409、空态、网络错误及中英显示。

## 历史与证据规则

WorkflowMutation只证明平台动作，不等同于领域专业节点结果。领域必须在原事务维护instance/node/instanceVersion到不可变领域修订的关系；P5升级前后修订不能代替所有早期节点结果。

历史迁移只从明确且唯一的当前一对一指针回填 `workflow_instances.problem_index_id`。无法唯一证明归属的 legacy 实例保留 NULL，runtime、升级和历史读取默认拒绝；现有当前指针复合外键以 `NOT VALID` 接入，不追认旧脏行，新写入继续受约束。这一边界不通过编号、Outbox payload 或审计事件猜测修复。

报告由领域给出该修订真实关联的file IDs，再由P3批量复验资源用途、状态、扫描、固定版本及实测摘要。批量复验按稳定资源键和文件ID顺序加锁；文件行可保持排他锁以固定读取快照，但领域读取授权和文件读取授权若落在同一领域记录上必须始终使用共享锁，避免并发报告在共享锁之后互相升级为排他锁。只返回受限证据元数据和ID；下载另行实时授权签60秒URL，不把签名URL或扫描原始输出持久化。隔离/删除记录可按授权显示历史状态，不作为可下载证据。

追溯范围由可信关系展开：ProblemIndex→全部历史WorkflowInstance→WorkflowTask/WorkflowUpgrade→领域修订与证据。SQL按 `(resourceType, resourceId)` 配对并带授权组织，不信任客户端资源集合、任意traceId或Outbox payload。安全事件投影包含动作、结果、时间、操作者安全显示名、资源、版本和稳定reasonCode；禁止账号秘密或无关管理事件进入问题时间线。

## 验证矩阵

- [x] 真实PG授权分页/计数/统计：组织与领域允许/拒绝配对，未知领域拒绝，混合可见记录、稳定排序和空末页。
- [x] 工作空间：读权限不等于节点权，他人领取只读；Worker滞后不暴露旧动作；能力读取后撤权或变更版本，提交仍拒绝。
- [x] 历史：跨问题实例拒绝，升级旧简报只读，新发布定义不影响旧版本；历史专业内容来自不可变修订。
- [x] 视图：本人组织允许，另用户/组织拒绝；未知列/SQL/脚本/URL拒绝，两个标签并发一胜一409，撤权后旧视图不泄露。
- [x] 报告：节点事实/修订/升级链一致，无来源字段明确不可用；真实PG+MinIO+ClamAV清洁文件可读，隔离/删除/跨资源拒绝，latest改变仍固定已扫描版本。
- [x] 并发报告：用屏障保证两个读取事务都已持有领域共享授权锁，再进入证据复验；两者都成功且无共享锁升级死锁，写入/关联路径仍保留排他锁。
- [x] 追溯：旧新实例、领取/升级/证据事件齐全，同ID错误resourceType不混入，复用traceId不扩范围，敏感metadata不返回。
- [x] 真实中性测试浏览器：登录→失败队列人工重试→检索/视图→工作空间→领取/领域处理→审批→验证→报告证据→升级历史→追溯；真实 Worker 重放不重复创建当前实例任务/通知，两会话409与直接HTTP拒绝。缺真实依赖必须FAIL，生产对测试领域仍拒绝。

2026-09-20：公共查询、工作空间、保存视图、不可变报告与可信追溯已实现。问题读取真实 PG 10/10（含并发报告锁序）、保存视图 14/14、附件与通知联接 65/65、工作空间 Web 13/13、问题中心 Web 10/10、任务 Web 6/6 PASS；独立复核通过。领域写入新增 runtime domainAccess，在身份锁前固定领域与证据并在回放时重新授权，runtime 33/33 PG PASS。扩展中性真实浏览器在全新专库 1 PASS（1.0 分钟），覆盖真实 MinIO/ClamAV、治理页授权人工重试及 Worker 幂等、双会话视图 CAS、专用处理/审批/验证三步不可变修订、验证后与升级后旧实例报告 `RESOLVED` 快照、同编号升级、报告精确字节下载、成对追溯、旧实例只读、跨组织拒绝，以及证据删除后原键回放原成功回执；日志为 `D:/WorkSpace/QMS-2.0-local/main-integration-20260919/problem-browser-approval-verification-retry-pass.log`。最终 P6 四步聚合约 1130 秒全部 PASS（0 skip）：PG 20 套 404、API 36 套 381、Web 21 文件 135（440.39 秒）、Worker 3、安全输入 1、真实浏览器 17（3.7 分钟，其中中性闭环 40.4 秒），主契约与测试契约、API/Web build、两套 Compose、archive 与 frozen 检查全部通过；日志为 `D:/WorkSpace/QMS-2.0-local/main-integration-20260919/p6-final-green3.log`。生产领域注册保持默认拒绝，供应商专业表单及业务字段仍属于独立的阶段三领域接入。
