# 阶段三供应商质量执行记录

## S4.1b 供应商运行时参与授权（2026-09-22）

基于主目录 `main` 的 `8e50ca1`，完成 `WorkflowParticipantAccess` 服务端回调和领域 `SupplierWorkflowAccess`，没有增加 HTTP 流程推进入口、客户端能力按钮或数据库迁移。本批未提交、推送或部署。

`submitAction` 可传入可信领域策略，在内部拥有组织的流程上保留真实供应商 actor；功能权限及节点 assignment 在供应商本企业判断，领域策略要求关联企业、正确索引/实例、已释放和显式回复节点全部成立。内部回复模式限定指定人员，供应商不能执行验证/关闭，内部人员不能冒充供应商回复。跨组织 START 和未传领域策略的跨企业动作仍拒绝。策略不替代回复内容、领域版本 CAS、证据与不可变修订校验，正式 HTTP 提交仍须同时交付这些能力。

锁顺序保持公共问题→实例→任务→领域→用户/会话。正常调用及幂等重放都检查真实会话、当前企业关系、原固定版本节点和现有权限。CLOSE 节点未启用独立验证时领域直接拒绝；已启用时仍由平台验证最近有效 VERIFY 与关闭人不同。复用 `isSecurityConcurrencyConflict` 将原始 SQL 死锁 `40P01` 转为 409。

真实 PostgreSQL 新增 20 项通过，联合既有供应商草稿、公共读取和平台运行时共 4 suites / 94 tests PASS。覆盖正常供应商动作的真实 actor 审计/Outbox、外企业/内部代回复/未释放/错误引用拒绝、指定内部回复人、节点角色交集、会话撤销与权限撤回、同键重放不重复 mutation、内容变更拒绝、并发 CAS、领域写失败、Outbox 注入失败、外层事务回滚，以及真实数据库死锁后的同键恢复。

红灯记录：最初 12 项中 11 项因参与适配器缺失失败；初步实现后 12/12 PASS。扩展阶段一个夹具试图保留释放时间并清除索引，被既有数据库约束拒绝，已修正夹具同时清除释放时间。独立验证配置用例实际复现同人关闭成功；真实死锁用例实际得到 `40P01` 原始错误，均先红灯后修复并进入最终无跳过回归。两次定向红灯使用 `-t` 选择用例，未选用例不计入验收通过数。

API 35 suites / 433 tests PASS，Web 工作空间及供应商定向 5 files / 22 tests PASS，API build PASS。契约检查第一次与 API build 同时操作 dist 发生 `ENOTEMPTY`，串行重跑 contracts:check PASS；契约生成无差异，归档隔离 PASS。独立只读审查提出职责分离配置与死锁错误映射两项问题，已修复并经同一审查者复核，无剩余实质阻断项。

本批临时环境：PostgreSQL 18，容器 `qms-supplier-participation-ab76b41c`，端口 `57503`，34 项已有迁移部署。第一次迁移在容器刚启动时失败，`pg_isready` 确认接受连接后部署成功。日志在 Git 外 `D:/WorkSpace/QMS-2.0-local/supplier-participation-20260922/`；未访问保留的 55440。

补充平台回归：`workflow-projection-schema.integration-spec.ts`、`task-inbox-schema.integration-spec.ts`、`worker-process-schema.integration-spec.ts` 共 3 suites / 65 tests PASS，使用本次构建的真实 Worker 进程；这些是既有平台能力回归，不是供应商任务通知交付证据。验证结束已核对容器名称和任务标签并删除本批容器、匿名卷及仓库外临时凭据文件，日志保留；`git diff --check` PASS。没有运行本批真实浏览器或阶段三完整验收。

边界：尚未接入供应商业务 Worker/通知受众、正式发单 HTTP/页面、严重度 SLA、回复修订和附件；测试中的索引与释放为明确夹具，不构成正式供应商主链。草稿保存仍先锁用户再锁领域，和 runtime 并发时可能产生死锁；本批证明失败事务回滚并返回受控 409，后续 HTTP 必须保留输入并按错误语义恢复，不自动宣称操作成功。真实试点与生产发布仍未放行。

## S4.1a 公共问题读取接入（2026-09-22）

当前基于主目录 `main` 的 `1b94d14` 继续开发；该提交已包含首批供应商草稿整合。本批未提交、推送或部署。

新增 `SupplierProblemReadAdapter` 并在平台 `ProblemReadModule` 注册。公共问题中心/台账可以聚合有正确双向索引引用的供应商记录，当前工作空间展示供应商专业资料；分页、总数及状态统计先按领域范围过滤。要求公共 `problem-index:read` 与拥有组织的 `supplier-quality:problems:read` 同时满足，支持内部显式跨组织授权，拒绝供应商进入内部公共范围及撤权后继续读取。

公共摘要最多 200 字符，完整 500 字符问题标题在专业资料区保留。未提交回复、联系人邮箱不进入公共投影；历史实例没有不可变快照就返回领域不可用，报告返回 `UNAVAILABLE`，领域修订审计标记 false。未提供附件引用或领域写动作。

验证证据：一次性 PostgreSQL 18，容器 `qms-supplier-read-deece497a5`，端口 `54027`，全新数据库部署已有 34 项迁移。没有使用 55440。日志在仓库外 `D:/WorkSpace/QMS-2.0-local/supplier-read-20260922/`。

| 验证 | 实际结果 |
| --- | --- |
| HTTP/PG 初次红灯 | 原 9 项中 6 FAIL / 3 PASS，合法记录列表为空、详情 404，证明缺少生产注册 |
| 接入首轮 | UUID/text 比较错误导致 500；直接 PostgreSQL 查询复现 `operator does not exist: text = uuid`，修正为 UUID 同类型比较 |
| 新增 HTTP/PG 用例 | 11/11 PASS；补充夹具 Outbox 清理后最终重跑 11/11 PASS |
| PostgreSQL 定向回归 | 草稿、公共读取、运行时、问题/流程模型共 4 suites / 80 tests PASS |
| API 单元回归 | 35 suites / 433 tests PASS |
| Web 定向回归 | 供应商、问题中心、工作空间共 6 files / 29 tests PASS |
| API 构建、Swagger 契约、归档隔离、结构/契约包检查 | PASS；无 DTO 变更，契约重新生成校验后无差异 |
| Web 构建 | PASS；保留既有 Ant Design 大包体积提示 |
| Foundation 及 scanning/TLS Compose 静态校验 | 首次缺 MinIO 必填环境变量失败；补齐本次临时验证变量后两种配置均 PASS，未启动或部署 Compose |

实际命令：在 `apps/api` 使用 `node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand` 执行 `test/supplier-quality/supplier-problem-read-schema.integration-spec.ts`，并与 `supplier-quality-schema.integration-spec.ts`、`test/workflow/workflow-runtime-schema.integration-spec.ts`、`test/database/problem-workflow-schema.integration-spec.ts` 合并回归；API 单元测试使用 `pnpm --filter @qms/api test`。Web 使用 `node node_modules/vitest/vitest.mjs run src/features/problem-center/problem-center.test.tsx src/features/problem-workspace/problem-workspace.test.tsx src/features/supplier-quality`。构建、契约、归档检查沿用工作区脚本。测试数据库配置由仓库外临时会话提供。

验证完成后已核对容器名称及 `qms.task=supplier-read-20260922` 所有权标签，销毁本批 PostgreSQL 容器及匿名卷，删除临时数据库凭据文件；验证日志保留在仓库外。未修改其他数据库或服务。

本批完成本地代码审查；独立审查子代理两次因模型容量不足未启动，不记录为独立审查通过。未运行全量阶段一/二验收、真实浏览器、附件扫描或业务 Worker 验收。索引绑定及历史实例使用明确的读取测试夹具；其中平台 runtime 的独立启动用于验证工作空间选择边界，不代表供应商发单接口已实现。

下一步仍是 S4.1 正式发单：先落实跨企业节点/任务参与授权与严重度 SLA/固定流程配置，随后验证领域、编号、索引、流程、审计和 Outbox 的同事务提交、幂等重放、撤权、CAS 及故障回滚。之后按 S4.2–S4.4 接回复修订、证据、验证关闭和升级主链。阶段三整体与真实试点仍未完成。

## 当前主目录整合状态（2026-09-22）

阶段三首批供应商增量已接入 `D:/WorkSpace/QMS-2.0/qms-2.0` 当前主目录，保留平台阶段一、二实现和界面改版。已接入供应商 Prisma 模型与两项迁移、API 模块、权限目录、生成契约、内部台账/供应商门户入口及供应商测试夹具；共享平台代码仅补充供应商所需的目录查询、资源授权回调和会话适配。未提交、推送或生产部署。

本次整合验证：Prisma schema 校验、API build/lint、Web build/lint、OpenAPI contracts、archive isolation 通过；供应商规则 API 单测 58/58、真实 PostgreSQL/HTTP 30/30、供应商 Web 定向 9/9、受影响平台 API 全量 35 suites/433 tests、受影响 Web 9 files/60 tests 通过。真实数据库使用一次性 PostgreSQL 55453，迁移 34 项全部部署后销毁；未使用 55440。

当前增量仍属于阶段三非生产领域与草稿能力。正式发单/编号/公共索引事务接入、流程分派、回复修订提交、修订级证据上传扫描、驳回重提、内部验证、关闭归档、简报升级、严重度 SLA、业务 Worker 和完整供应商浏览器主链仍未完成联调。下一批以当前主目录平台 runtime、附件和任务契约为边界，逐项接通并单独验收；本次门户使用的释放夹具不构成正式流程证据。

日期：2026-09-19。任务：QMS 2.0 阶段三供应商质量开发。

工作树 `D:/WorkSpace/QMS-2-supplier-quality`；分支 `codex/qms-2-supplier-quality`；共同基线 `54621e09a8c4b469070c00497e55e58ea237da72`。主仓库迁移修改保留，未提交、推送或部署。

## 最新状态：并行完善批次

按用户“可以并行的任务都处理掉”的授权，完成已知、无需平台接口的资料与草稿完善项；正式流程联调仍未完成。本轮没有新迁移，不修改平台工作树。

- 供应商资料编辑：新增单条读取/PUT 更新，支持业务编码、联系人、邮箱维护及清除；企业归属不可改；同事务 CAS、审计、幂等、撤权重放拒绝。编辑冲突保留输入，明确确认后加载最新资料。
- 企业/业务资料/内部回复人目录：服务端搜索、稳定分页、单页最多 100、页码最多 1000000，以及 selectedId 回显；用 105 条真实记录验证越过原 100 条上限，跨组织和供应商身份仍拒绝。
- 台账筛选：严重度、简报/8D、内部草稿/已发单条件与拥有组织/企业释放范围同时生效；门户不能通过筛选扩大范围。
- 表单修复：保存问题资料不再清空未保存回复，保存回复也保留未保存事实；8D 自验字段明确为“整改自验结果”。资料登记与编辑表单使用独立字段 ID，保证标签和辅助访问正常。
- 远程选择器处理加载失败重试、分页追加、已选值回显和旧搜索结果晚到；资料页面与读取 hook 按职责拆分。

本轮验证：API 全量 33 suites / 318 tests PASS；真实 PostgreSQL 全量 4 suites / 102 tests PASS（供应商 30 项），补充超大页码限制后供应商 30 项再次通过；最终供应商 Web 4 suites / 9 tests PASS；真实 Chromium 2/2 PASS，包括资料冲突恢复、内部指定回复人 8D、双表单输入保留、台账筛选及原供应商隔离场景。API/Web 类型检查、构建、契约检查、归档隔离、结构/契约包导出及 Compose 静态校验通过。

全量 Web 命令 `pnpm --filter @qms/web test --maxWorkers=1` 实际为 76 PASS / 2 FAIL（14 suites / 78 tests），不能标为全量通过：既有 permission-matrix 的脏草稿切换用例 45 秒超时；新增跨表单回归 5 秒超时。新增用例随后减少重复的昂贵角色查询，保留同一行为断言，不提高超时；定向重跑所有供应商 9 项 PASS，该用例从 5.7 秒降至约 0.7 秒。没有再次执行全量 Web，既有权限矩阵问题仍未解决。本轮一次定向重跑因 Enter-Qms.ps1 改变目录而未找到测试，已显式切回独立工作树后取得上述通过结果；该失败不能算验证证据。

红灯与修复证据：最初新增 HTTP 用例 8 FAIL / 22 PASS，缺资料路由、目录分页和筛选；实现后 30 PASS。跨表单回归先证明回复被清空，再修复组件重挂载。真实浏览器发现创建/编辑表单字段 ID 重复，新增标签回归复现后用独立 Form name 修复。随后浏览器选择器匹配到已隐藏下拉内容，测试改为当前可见下拉后两条真实场景均通过。没有用跳过测试或放宽超时掩盖失败。

本轮已清理专用 API 3318、Web 5188、临时 PostgreSQL 55448 及专用密码文件，项目标签 qms2-supplier-quality 无残留容器；验证结果仅在仓库外。主仓库原有未提交修改保留。本轮未提交、合并、推送、部署或调用跨任务交互工具。

剩余项目全部列入平台依赖：正式发单及同事务索引/流程/Outbox、跨组织节点动作、正式回复修订、修订级证据与上传扫描、驳回重提、验证/关闭、升级、SLA 与 Worker 恢复。当前浏览器释放夹具仍不构成正式主链证据。真实试点和生产发布门槛不变。

## 上轮记录：非生产模型、API、表单及门户增量

用户再次授权同步开发后，已在本工作树完成下列草稿功能。下文 S1 记录作为历史保留，不代表当前仍只有纯规则。阶段三整体、平台联调及真实试点均未完成。

- 供应商业务资料登记、分页查询及目录选项；资料属于内部组织，关联一个供应商企业。
- 问题草稿创建、分页查询、详情和版本更新；显式选择简报/8D，区分供应商企业回复与内部指定个人回复。
- 内部台账 `/app/supplier-quality`、资料 `/app/supplier-quality/profiles`、问题表单与详情；门户 `/supplier/corrections` 查询本企业已释放问题、查看进度及保存回复草稿。
- 五个 Prisma 模型和两项迁移：业务资料、问题、回复草稿、回复修订、证据引用。修订/证据仅预留结构，尚无正式提交或上传入口。
- 六项真实后端权限进入目录及迁移，默认不授予既有角色；Swagger 生成 Web 契约。组织/企业范围、回复身份、CSRF、幂等、版本冲突、事务回滚与重放时重新鉴权均有真实 HTTP/PG 证据。
- 草稿写入复用 `AdminMutationService` 的 Serializable 事务，领域、审计、幂等回执原子提交；不生成问题编号、公共索引、流程实例或业务 Outbox。正式动作仍须接入平台规定的同事务接口。

### 本轮验证

| 验证 | 实际结果 |
| --- | --- |
| HTTP 测试初次红灯 | 缺失路由返回 404；实现后曾暴露 DTO 可选字段 undefined 导致部分回复错误 400，已修复 |
| API 完整测试 | 33 suites / 318 tests PASS；目录预期由 planned 调整为真实 active 增量后通过 |
| 真实 PostgreSQL | `pnpm --filter @qms/api test:integration`：4 suites / 95 tests PASS，其中供应商 23 项，包含六项权限逐项撤权拒绝；16 项迁移全部应用 |
| 新页面及导航 | 2 suites / 7 tests PASS；覆盖无数据、权限错误不伪装空台账、门户导航 |
| Web 幂等请求 | 2/2 PASS：网络响应丢失后同内容复用 key、成功及内容变更后换 key |
| 浏览器 | `supplier-quality.spec.ts` 1/1 PASS，真实 Chromium 登录、登记资料、创建/编辑问题、刷新持久化、回复、当地完成时间、并发冲突保留输入、企业间隔离及内部不能代回复 |
| API/Web 构建 | PASS；Web 保留既有 Ant Design 大包警告 |
| `contracts:check` / archive isolation / `git diff --check` | PASS |
| Web 全量回归 | 69 PASS / 2 FAIL（共 71 项，当时尚未加入上述两项幂等测试）；均为既有 permission-matrix 测试 45 秒/30 秒超时，未放宽超时、跳过或擅改无关代码 |
| 权限目录补充回归 | 保留绩效、审核、PPAP planned 模块后，admin-role HTTP 7/7 PASS |
| 结构与契约包导出 | Node 两项结构/导出检查 PASS |
| Foundation Compose | 初次缺 QMS_RATE_LIMIT_SECRET / MINIO_ROOT_* 按要求失败；配置进程内临时随机值后 `docker compose -f deployment/docker-compose.foundation.yml -p qms2-supplier-quality config --quiet` PASS，未启动 Compose 服务 |

浏览器使用真实 API 3318、Vite 5188（`QMS_DEV_API_URL=http://127.0.0.1:3318`）、临时 PostgreSQL 55448、独立浏览器 contexts。未启动网关 8088，因此这不是网关/TLS 验收。未访问 55440、55446。种子与测试用户全部为临时账号。

浏览器中的“已释放问题”由测试直接建立公共索引并设置释放标记；生产 HTTP 没有此入口。这仅证明领域门户保存行为，不证明正式发单、节点分派、Worker 或全业务链。正式发单、回复提交及证据上传按钮明确禁用。

复现先在专用临时 PostgreSQL 上执行迁移、种子及 API build，再运行 API 和 Web；配置 `DATABASE_URL`、临时 `QMS_SEED_INTERNAL_PASSWORD`、`PLAYWRIGHT_BASE_URL` 及 `QMS_SUPPLIER_E2E_DISPOSABLE=true`。从 `apps/web/` 执行 `node node_modules/@playwright/test/cli.js test supplier-quality.spec.ts --output <仓库外目录>`。缺必要配置即失败；测试清理自身账号、业务记录与组织，不删除外部数据库。Windows 下 `pnpm exec playwright` shim 执行失败，本次直接运行仓库已安装的 Node CLI 成功，未改动依赖。

### 待平台交付与本轮限制

正式发单/编号/公共索引聚合、跨组织流程节点授权、最终回复提交、驳回重提、内部验证/关闭归档、简报升级 8D、严重度 SLA 配置、附件上传扫描、业务 Worker 和失败恢复均未完成业务联调。草稿版本 `expectedVersion` 不是未来公共流程版本。专业规则的验证人与关闭人分离已有单元测试，尚无实际关闭入口。

本段为上轮限制，联系人维护与目录分页/搜索已在最新批次完成。回复修订及证据引用模型仍需在正式平台接口交付后补齐修订级关联、不可变性和授权验证，不能据此宣称证据提交能力已交付。

共享增量见 `SUPPLIER-PLATFORM-HANDOFF.md`。本轮没有跨任务工具调用、合并、提交、推送或部署；主仓库未提交迁移资料保持原状。

本轮结束已停止 API/Web 专用进程、删除临时 PostgreSQL 容器及专用密码文件；3318/5188/55448 无监听，本任务 Docker 项目无残留容器。浏览器截图及结果只在仓库外保存；截图读取工具返回格式错误，因此没有将截图作为人工视觉审查通过的证据。真实浏览器交互测试本身已通过。未执行完整 `acceptance:phase-1`、生产 TLS 或阶段三正式业务主链验收。

## S1 历史记录（以下描述首批纯规则时点）

## 已完成的首批范围

- 设计及执行计划分别位于根目录 `docs/superpowers/specs/2026-09-19-qms-2.0-phase-3-supplier-quality-design.md` 和 `docs/superpowers/plans/2026-09-19-qms-2.0-phase-3-supplier-quality.md`。
- 用户已确认单问题单供应商、发单必选形式、工程师升级、按严重度配置 SLA、内部个人/供应商回复边界、验证关闭职责分离。
- 只读查看旧版 Git 对象中的 SCAR schema 和回复表单作为字段参考；没有展开或执行归档，没有复制旧状态机、编号或兼容层。
- 新增领域类型、事实及回复输入校验、资源/回复人边界、当前修订验证与关闭分离、证据引用校验、简报到 8D 的显式内容映射及 58 项规则测试。
- 升级映射复审发现最初只保留四个字段会丢失简报中已填写的其他专业内容，新增回归先失败再修复；现保留所有已知专业字段且不覆盖目标人工内容，包括显式空字符串。

## 尚未交付

这些纯规则没有注册到 HTTP 或公共权限目录，不能作为真实 API 授权、数据库隔离或流程可用的证据。没有新增供应商持久化模型/迁移、生成 API 契约、页面、真实附件上传或业务 Worker。首批类型是 API 内部领域类型，Web 不导入它们。

平台同事务 start/action/upgrade、跨组织资源及节点参与、当前验证失效、SLA 配置、授权文件解析及业务 Worker 仍依赖平台交付。公共 Prisma、catalog、AppModule、导航与契约合入批次尚未确认。对方任务发生工具调用配对错误后，本任务按用户反馈停止所有跨任务交互，以 [本地交接文件](SUPPLIER-PLATFORM-HANDOFF.md) 人工协调。

## 验证环境

命令从本工作树 `qms-2.0/` 执行，加载仓库外 `D:/WorkSpace/QMS-2.0-local/Enter-Qms.ps1`。PostgreSQL 使用一次性 Docker 容器 `qms2-supplier-quality-postgres`，镜像 `postgres:18`，仅绑定 `127.0.0.1:55448`，项目标签 `qms2-supplier-quality`，数据位于 tmpfs。运行前确认无端口占用；未连接保留预览库 55440 或平台测试库 55446。

实际版本：Node 22.22.0、pnpm 11.19.0、PostgreSQL 18.6。2026-09-19 验证结束后已删除本任务临时容器及专用数据库密码文件，项目标签查询无残留容器；保留预览库仍在 55440 运行。

数据库凭据和验证脚本在 `D:/WorkSpace/QMS-2.0-local/`，不入 Git、不输出口令。种子口令是临时环境专用值，不涉及真实供应商账号。

## 实际验证记录

| 命令/阶段 | 实际结果与范围 |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS，934 包，锁文件未修改 |
| 最初 `pnpm --filter @qms/api test`，未设 DATABASE_URL | FAIL，30 suites / 246 tests PASS；两组 PostgreSQL 测试按要求拒绝缺配置，没有跳过或 SQLite 替代 |
| 首次新增规则测试 | FAIL，缺少领域模块；实现后 48/48 PASS |
| 回复规则新增测试 | FAIL，缺少 validateResponseContent；实现后 57/57 PASS |
| 升级可选专业内容保留回归 | FAIL，1 failed / 57 passed；修复后 58/58 PASS |
| 初次 `pnpm --filter @qms/api test:integration` | FAIL，14 项迁移全部成功，种子因 NODE_ENV=test 且缺专用种子密码拒绝；修正仓库外配置后重跑 |
| 完整 `pnpm --filter @qms/api test:integration` | PASS，真实 PostgreSQL 3 suites / 72 tests；这是基线数据库/平台/账号回归，不是供应商持久化验收 |
| 中间 `pnpm test` | FAIL，执行期间新增的内容保留回归处于红灯，API 1 failed / 313 passed；已修复并启动完整重跑 |
| 最终 `pnpm test` | FAIL：structure/contracts 导出检查 PASS，API 33 suites / 314 tests PASS（含供应商 58 项）；Web 8 项失败，不能宣称全量通过 |
| `pnpm --filter @qms/api lint` | PASS，最终规则源码通过类型检查 |
| `NODE_ENV=production; pnpm build` | PASS，API、contracts、Web 构建完成；保留 Ant Design 包体大小警告 |
| `pnpm contracts:check` | PASS，无契约漂移；本次没有注册新 HTTP DTO |
| `pnpm check:archive-isolation` | PASS |
| `git diff --check` | PASS；仅 Git 的 LF/CRLF 提示，无空白错误 |

Web 失败范围：`admin-interactions.test.tsx` 两项 15 秒超时；`permission-matrix.test.tsx` 两项 30/45 秒超时及两项组织选项可见性断言；`account-center.test.tsx` 两项 5 秒超时。本批未修改 Web 文件，未放宽超时、跳过测试或混入无关修复；失败原因未完成独立诊断，不能直接归因为机器负载。API 纯规则对这些页面无调用依赖，但这不替代 Web 失败修复后的完整验收。

本批不修改底座实现，未执行完整 `acceptance:phase-1`/浏览器业务链/Compose 运行验证；上述 PG 及构建是回归证据，不是阶段三业务验收。代码内联审查完成，修复了升级内容遗漏与未知 `__proto__` 字段错误集合的处理；没有启动其他任务或子代理审查。

## 试点门槛

S2 API/数据库、S3 页面、S4 平台联调及真实浏览器业务链均未完成。规则测试夹具不证明运行时/授权/上传/Worker 集成。真实供应商试点仍等待平台业务主链及阶段 2A D–H 对应治理门槛通过，生产发布没有授权。
