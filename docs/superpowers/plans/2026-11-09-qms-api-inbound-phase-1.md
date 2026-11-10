# API 接入管理一期实施计划

2026-11-10接续：负责人取消外部收件Idempotency-Key设计与卡控，沿Issue97推进V0.0.44；当前范围/授权/状态与真实证据以[取消幂等卡控计划](2026-11-10-qms-inbound-without-idempotency.md)为准。原阶段记录保留，不把历史去重验收写成新语义。

> **面向 AI 代理的工作者：** 使用项目 `qms-superpowers-zh` 路由 `superpowers-zh:subagent-driven-development`，逐任务 TDD、规格审查、质量审查及主代理独立验证。负责人已批准实施；本地重命令按资源约束串行执行，降低负载不等于暂停开发。

**目标：** 公司内部系统经现有公网 HTTPS 向 QMS 推送 JSON，在管理端完成接口配置、机器鉴权、可靠接收和记录检索。

**架构：** 新 `api-integration` 模块拥有接口、凭据和收件数据，复用现有身份权限、审计、密钥保护、网关、PostgreSQL 与 Worker。独立机器接收和人员管理入口，接收回执不代表业务字段校验或业务入库。

**技术栈：** 现有 NestJS、Prisma/PostgreSQL、React/Ant Design、Swagger 生成契约、Nginx 和 Node.js 密码学能力，不新增服务或依赖。

## 当前摘要

| 摘要项 | 当前事实 |
| --- | --- |
| 最后核对与范围 | 2026-11-09，Asia/Taipei；负责人更新状态并明确“继续推进”，user 实时回读 rev363 开发中/P0，目标/五字段范围保持，提出人已由负责人改为舒子杰 |
| 批准与动作授权 | 负责人最新明确“没问题了就继续合并部署”，本轮已获PR98及同范围发布阻塞修复的集成发布授权；原开发/Issue/PR授权继续。生产岗位配权、凭据分发、接口启用、关闭Issue/台账写入及人工验收不自动扩大；阶段/提出人/优先级不代改 |
| 本次追加范围 | 2026-11-10负责人明确增加接口删除，批准已展示的“一次确认、停止接收撤凭据、移出列表、保留历史”方案，覆盖原不提供删除决定。沿Issue97/设计13/计划16推进到上线，原便捷化/默认Admin权保持，不代删生产具体接口 |
| 整体复核 | 一期A/B/C/D及公共接缝独立SPEC后QUALITY已通过；Admin默认权限与正文可见态等待返修也分别通过独立SPEC后QUALITY。机器发布已核，生产Admin实页/真实来源验收仍另列，历史阶段语句不代当前结果 |
| 定位与版本 | REQ0036 / reczz28XQpffP57y → Issue97 → PR98（含fix1/fix2）→ PR99（fix3）→ PR100（fix4/fix5）。最终main及部署为ce4a72f33f6c6261dbd7525e431c1db3655f0210，整tree与审候选e0ab78c一致；旧main042及PR100首候选1d0b2cb失败、旧分支档案及原始证据保留 |
| 源码与工作区 | 主代理已串行新建功能分支；活动checkout原地隔离分支，遵循项目唯一活动位置，不另建E/C回退worktree。原有 `.gitignore`、`AGENTS.md`、`docs/ENGINEERING-TOOLS.md` 及索引来源摘要改动保留，不纳入本期提交 |
| 当前检查点 | 删除功能已随最终main/生产d9d2a920f2a79cde20313767c233b753956ba833上线；PR104 CI42734768669与mainCI42736298039各精确24/24，候选Review clear，整tree一致；deploy42737916279真实success，快照→145迁移→同SHA健康→公网DELETE契约/新JS均核验，详第17节 |
| 重启后资源约束 | 恢复初查约21.8 GiB内存/4.3 GiB可用；负责人再次明确继续开发，降低负载不应停工。重测试/构建同一时刻只一项、单worker、Node默认堆上限1024 MiB；仅按需启动本任务PG并限512 MiB/1CPU，未恢复扫描/对象/邮件服务，不降低门禁。只读审查及独立源码编辑可继续，禁止代理自行启动重命令 |
| 证据与限制 | 已核对实际接缝；Node v24.21.0 / pnpm 11.19.0，治理检查 exit 0；技术参数为建议基线，真实来源样本/吞吐未知；详细文档验证见第 8 节 |
| 下一动作与负责人 | 本次接口删除开发及上线目标完成。负责人刷新API管理即可单次确认删除，Admin默认可用；未代删具体生产接口，真实账号人工操作/真实来源联调及容量验收仍另列。Issue97结果追加已回读仍open、不写飞书，最终事实仅本地归档避免无代码变化重复部署。原四dirty保留，自有资源已清理 |

## 1. 交付单元、映射与范围

一期作为一个可独立验收和回滚的交付单元、一个聚合 Issue 和一个功能 PR：配置、机器接收、安全例外、正文保护与检索必须在同一版本成立，避免只有接收入口而无管理或保护能力的中间版本。内部按任务分批审查与提交，公共文件由主代理串行整合。

| 映射项 | 当前状态与执行规则 |
| --- | --- |
| 需求 | REQ-0036 / `reczz28XQpffP57y`；已保存当前聊天确认目标和复核方案，实施前按ID回读核对变化 |
| Issue | 已先创建Issue97，附设计、范围、验收、回退和交付闭环；未找到同REQ-0036事项，不重复建单 |
| 分支 | 已新建codex/req0036-api-inbound，携原本地纯文档归档，保留用户已有未暂存修改 |
| PR | 实现、双审及适用验证通过后，按当前开发与持续交付授权独立完成提交/推送/创建步骤；不扩大为合并发布或接口启用 |
| 版本 | 实施时按交付流程核对远端、开放事项与预留序列，主动分配登记；本地 HEAD 不是远端最新版本证明 |
| 发布及关闭 | 分别核对合并、发布、启用、关闭、台账写入授权；工程验收、真实来源联调和生产启用分开记录 |

非目标见设计第 1 节。后期业务字段、任意转换脚本、业务同步及发出接口不得混入一期。

## 2. 文件所有权与调用方

下表路径相对 `qms-2.0/`；新增路径为实施命名建议，尚不存在。实施前读取各目录 AGENTS、前端规范及权限专项技能。每个任务按项目要求使用全新实现上下文，规格后质量独立审查；依赖与共同写集禁止并行覆盖。

| 所有者 | 文件范围与职责 |
| --- | --- |
| 领域实现 | 新 `apps/api/src/modules/api-integration/` 下 `api-integration.module.ts`、`integration-admin.controller.ts`、`integration-admin.dto.ts`、`integration-admin.service.ts`、`integration-credential.service.ts`、`inbound.controller.ts`、`inbound.guard.ts`、`inbound.dto.ts`、`inbound.service.ts`、`integration-receipt.controller.ts`、`integration-receipt.service.ts`、`integration-retention.service.ts`；请求结果明细及公开查询归收件 service，生命周期 effect 归本模块；按实际规模合并邻近 DTO，不单建观测平台 |
| 前端实现 | 新 `apps/web/src/console/api-integrations/` 下 `ApiIntegrationsPage.tsx`、`EndpointEditor.tsx`、`CredentialPanel.tsx`、`ReceiptList.tsx`、`ReceiptDetail.tsx`、`api-integrations-api.ts` 及同名必要测试；复用共享台账、语言、API client、工作标签与组织上下文 |
| 主代理公共整合 | `apps/api/prisma/schema.prisma` 与增量迁移、`apps/api/src/app.module.ts`、`http-body-parser.ts`、`worker.ts`、`rotate-security-keys.ts`、`modules/identity/csrf.guard.ts`、`modules/identity/console-context.service.ts`、`modules/identity/dto/console-context.dto.ts`、`modules/authorization/permission-catalog.ts` |
| 主代理审计与错误协议 | `apps/api/src/modules/audit-log/audit-log.service.ts` 的有界字段白名单、`common/contracts/platform-error.ts` 的业务码/文案、现有错误 DTO 与 `request-trace.ts` 的使用；默认保留 `global-exception.filter.ts` 的 5xx 安全降级，仅在实际证明需要时修改，不透传任意异常 |
| 主代理契约与路由 | `packages/contracts/src/generated/api.ts` 只通过生成命令更新；`apps/web/src/App.tsx`、`console/console-navigation.ts`、`console/console-api.ts` 及相关测试；接收机器身份不接入人员 Session DTO |
| 主代理部署与治理 | `deployment/nginx.conf`、`deployment/nginx.tls.conf`、按实际运行模板调整 Compose 配置；`governance/module-boundaries.json`、`docs/DEVELOPMENT-GOVERNANCE.md`、`docs/SECURITY.md`、`docs/DATA-PROTECTION.md`、`docs/OPERATIONS-RUNBOOK.md`、`docs/API-INTEGRATION.md`、能力状态与导航/索引按实际结果同步 |
| 生命周期与观测 | 主代理整合 `common/security/administrative-lifecycle.types.ts`、`administrative-lifecycle.registry.ts`、`modules/organization/organization-lifecycle.read-model.ts` 的新模型历史/有效引用分类与 `organization-force-delete.service.ts` 实际调用链；普通物理删受引用保护，强删 tombstone 停接口撤凭据保历史。接收模块使用 `system-management` 已导出端口，不反向依赖；观测 UUID 身份及非关键异常隔离由本模块负责 |
| 集成与浏览器验证 | 新 `apps/api/test/api-integration/` 集成测试及 `apps/web/playwright/api-integrations.spec.ts`；回归既有 CSRF、body parser、控制台、组织删除、交换观测、密钥轮换与 Worker 测试 |

现有接缝事实：CSRF Guard 对所有非安全方法生效；普通正文解析为 100 kB；交换来源启动后封存、标识限 80、终态不可改且 tryRecord 只吞 503；管理幂等持久化响应；轮换脚本和生命周期 effect 显式枚举模型。审计字段有白名单，业务错误码有目录且 5xx 统一 INTERNAL_ERROR；完整备份 dump 上限 256 MiB/包 512 MiB。上述边界必须显式接入，不得假设新增 Controller 或 register 已完成兼容。

## 3. 开工前置与建单（只在获准实施后执行）

- [x] 按负责人“先整理提交需求”要求完成字段/选项核对、同目标查重、REQ-0036创建、十字段逐项回读和记录链接取得；原历史需求不修改。
- [ ] 加载 `D:/WorkSpace/QMS-2.0-local/Enter-Qms.ps1`，核对 Node `>=24.21.0 <25`、pnpm `>=11.19.0 <12`、分支/HEAD/暂存区及 merge/rebase 状态，保护现有改动。
- [ ] 复核本文技术细化与负责人意见；若集成平台有现成协议约束，更新设计，禁止无声偏离。核对单机/多 API、代理拓扑及可用备份能力。
- [ ] 查重需求与 Issue，保留旧预留历史，建立本期聚合 Issue。记录真实映射与批准范围，不代改飞书开发状态。
- [ ] 依交付流程核对并登记版本；协调活动 checkout 的实现隔离；采集基线结果。纯策划不创建 worktree 或业务容器。
- [ ] 准备一次性 PostgreSQL、真实 API/Worker、临时证书、管理/查询/正文/拒绝角色及两个内部组织，不接预览库 55440；证据放 Git 外本次新目录。

## 4. 实施任务与 TDD

### 任务 A：配置、数据库约束与凭据

**写集：** 接口/凭据领域文件与 `test/api-integration/integration-admin.integration-spec.ts`、`integration-credentials.integration-spec.ts`；公共 Prisma/权限/context/lifecycle 由主代理串行整合。

- [ ] 先写真实 PostgreSQL/HTTP 断言：跨组织读取/创建拒绝；接口编码组织内唯一；新建草稿；无有效凭据启用拒绝；配置 CAS 冲突；凭据到期/撤销；最近认证与 CSRF；无权限的平台标记不放行。
- [ ] 运行两个新增集成文件确认缺表/能力缺失引发的业务红灯。数据库或密钥不可用属于环境失败，不能作为红灯完成。
- [ ] 最小实现模型、索引、接口配置（包含 `returnReceipt` 布尔字段、默认 true、配置快照、CAS 与变更审计）、独立凭据以及权限映射；凭据原文仅首个成功响应返回，不写日志或管理幂等回执。为管理重试实现只返回标识的结果，并证明数据库无原文。
- [ ] 在真实 PG 测试凭据响应丢失后的幂等重试、两个有效凭据上限、并发撤销/启用和组织状态变化；读取数据库/审计确认秘密不泄露。
- [ ] 扩展机器审计允许的 UUID/布尔/版本字段，机器 `actorUserId=null`；测试 endpointId/credentialId/receiptId 实际保存、非法值/秘密不保存、人员审计行为不退化。
- [ ] 规格审查后质量审查；修复并重验受影响范围。主代理独立验证通过后在已核对版本下提交本任务范围，不混入其他修改。

### 任务 B：机器接收、事务与防重复

**写集：** `inbound.*`、接收 service、新 `test/api-integration/inbound-receive.integration-spec.ts` 和 `inbound-concurrency.integration-spec.ts`；主代理整合 CSRF、专用 raw parser、网关、观测固定来源及模块依赖。

- [ ] 写 HTTP/PG 红灯：无需人员 Cookie 但必须有效机器凭据；只对接收处理器免 CSRF；伪造头、错误接口凭据、body 指定其他组织、无效组织均拒绝，原人员写接口仍要求 CSRF。
- [ ] 加入固定字节 JSON fixture；开启回执断言首次 201、重复 200 同 receiptId；关闭时首次及重复均 204、零响应正文字节、无自定义回执响应头，内部记录/加密正文/计账不缺失；冲突在两模式均 409，白空格变化也冲突；并发相同消息仅一条收件、一次计账。
- [ ] 验证开关双向切换后原消息重试按当次配置响应，原记录/配置快照不改写；关闭时鉴权/格式/超限/存储故障仍返回 4xx/5xx，未提交前不能提前返回 204；响应丢失仍能防重复。
- [ ] 定向运行新增文件取得真实业务红灯，然后实现接收事务、锁顺序、唯一约束、容量/频率原子计数、加密正文及回执。接收、轮换/撤销、配置、保留清理共用明确的组织→接口→凭据/回执锁顺序，避免反向等待。
- [ ] 故障注入验证 COMMIT 成功但连接丢失、提交前失败、主密钥失效、审计失败；没有确定提交就不返回成功，重试只按数据库事实处理。
- [ ] 按平台错误目录登记 4xx 分类并验证实际响应 code；5xx 保留 INTERNAL_ERROR；应用响应 X-Request-Id 与错误 traceId 一致，204 仅有排查头且零正文，不回填回执字段。真实网关测试提前 413/429/超时可无 JSON，不要求所有拒绝都有应用正文或请求明细。
- [ ] 验证无 Content-Length、超大、错误媒体类型、压缩、非法 UTF-8/JSON、非对象、过深正文、重复 Authorization/幂等头、请求取消及恶意 HTML 文本；确保错误响应与日志不含正文或秘密。
- [ ] API 重启或多进程后复验配额与去重；重复计入请求频率但不重复占存储。注册固定交换来源，每 HTTP 请求用服务端 UUID 独立观测 identity（BATCH、batchId=接口UUID、correlationId=traceId、attemptNumber=1），业务消息编号另存；只报告传输事实，不伪造业务批次或业务阶段。
- [ ] 故障注入提交后请求结果/观测抛出 400/403/409/503 等错误：原收件及 201/204 不被反转，异常有界隔离且可见，不添加无限重试；失败→成功重试不因共享观测终态发生冲突，128 位消息号不受观测 80 位字段截断。
- [ ] 完成规格/质量双审及主代理独立并发、CSRF 和 body parser 回归后提交任务范围。

### 任务 C：检索、正文保护、保留与运维

**写集：** 收件查询/保留服务，`test/api-integration/integration-receipts.integration-spec.ts`、`integration-retention.integration-spec.ts`；主代理整合 Worker、轮换脚本、生命周期和运维文档。

- [ ] 先写红灯：列表不含正文/秘密；无正文权限无法读取；跨组织 ID/接口/消息过滤不能越权；相同时间稳定分页；正文访问审计失败时不能披露。
- [ ] 最小实现有界查询、授权正文读取和纯文本响应；到期正文按读取条件立即不可见，即使 Worker 尚未清理。
- [ ] 新增 `IntegrationRequestAttempt` 最小元数据及结果视图，支持同组织 traceId/合法消息编号精确查接收、重复、拒绝、失败/未知；复用收件读权。不可信身份仅全局安全汇总，不采信 body/URL 归组织。验证无秘密、无正文、无越权；数据库不可用或进程丢失可能无明细，页面不能显示无损采集。
- [ ] 用数据库可控时间 fixture 验证 7 天正文、90 天元数据边界，无需真实等待；正文清理后重试按当次开关返回原回执或 204；90 天后即使 Worker 未清理也允许事务内释放旧唯一键/计账并重新接收；撤销或停用后不能用旧回执绕过授权。
- [ ] 验证限批清理、密文字节容量释放、失败回滚、与接收/重加密并发、清理故障事实；请求元数据 7 天/每组织 10000 条限批淘汰不删收件或审计。接口详情显示容量80%提示、到期凭据、最近清理及采集缺口，不新增外部通知系统。
- [ ] 普通组织物理删除受引用预检/FK 阻止，旧收件及请求结果归历史引用不误阻普通停用；显式扩展 effect 类型/枚举，使强删 tombstone 同事务停接口撤凭据保历史。真实测试强删/接收竞争、强删后凭据失效、部门或人员删不误撤机器凭据、重复强删幂等及历史不级联丢失。
- [ ] 真实扩展密钥轮换并验证旧/新密钥期读取、并发清理 CAS；执行选定备份恢复路径，核对恢复后配置、凭据校验值、正文与去重。按实际全库/密文/配置保留上限验证容量，不能以小样本成功覆盖 1 GiB 建议限额；原工具 dump256 MiB/包512 MiB 不够时限制批准容量或另立备份改造，不擅改常量。恢复后入口先停用，再核对到期及凭据状态后授权启用。
- [ ] 完成规格/质量双审、Worker 及轮换/删除邻近回归，主代理独立验证后提交。

### 任务 D：管理页面与调用说明

**写集：** `console/api-integrations/` 页面及测试；主代理整合路由、context、导航和生成契约。

- [ ] 用真实生成 DTO 编写页面红灯：目标组织切换丢弃旧结果；保存冲突提示；草稿/停用；逐接口“返回接收回执”默认开启、可修改且不影响其他接口，无管理权不能修改；凭据仅一次展示及失去响应恢复；正文分权；发出页签无可执行动作。
- [ ] 在同一接收记录页提供已收数据/请求结果视图，测试失败原因和请求号检索、采集不可用/淘汰范围提示，以及关闭回执仍可用服务器请求号排查；容量、凭据到期和清理事实来自真实服务端结果。
- [ ] 运行新增页面测试确认行为缺失红灯，然后实现三个页签、配置详情、凭据管理、分页检索和正文详情；不手写前后端重复 DTO。
- [ ] 调用说明由固定协议和配置生成，显示当前回执开关，提供占位凭据 curl 示例、原字节重试与消息编号规则、开启201/200及关闭204、错误/网关非JSON及服务端排查号说明，标明技术收件/90天去重范围；示例不嵌真实密钥。
- [ ] 用合成技术数据验证加载/空态/错误/失权/未保存/dirty/busy、键盘焦点、浅深主题、320/390/1440 宽度；不把业务字段未知填成演示业务成功。
- [ ] 规格/质量双审及主代理独立路由/context/台账调用方回归；通过后提交本范围。

## 5. 验证命令与证据矩阵

所有实现命令从已加载入口的 `qms-2.0/` 执行。下列新增测试文件名与任务 A～D 一致，真实资源及密钥由 Git 外验收环境提供，不把环境值写入文档。缺资源必须 FAIL/NOT_RUN，不 Mock/Skip。

```powershell
corepack pnpm --dir apps/api exec node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --testPathPatterns=api-integration
corepack pnpm --filter @qms/web test src/console/api-integrations
corepack pnpm contracts:generate
corepack pnpm contracts:check
corepack pnpm check:governance
corepack pnpm check:archive-isolation
corepack pnpm --filter @qms/api lint
corepack pnpm --filter @qms/web lint
corepack pnpm --filter @qms/api build
corepack pnpm --filter @qms/web build
corepack pnpm --filter @qms/web exec playwright test playwright/api-integrations.spec.ts
docker compose -f deployment/docker-compose.foundation.yml config --quiet
docker compose -f deployment/docker-compose.foundation.yml -f deployment/docker-compose.tls.yml config --quiet
```

首次 PG 测试前执行当前迁移部署/seed；涉及 schema 修改后重新部署。作为 Foundation 安全入口扩展，必须执行 Web/API 测试、完整真实 PostgreSQL 集成、独立 Worker、构建及 Compose 配置，不只跑新增文件；完整阶段验收按根规则执行 `corepack pnpm acceptance:phase-1`，结果写 `docs/FOUNDATION.md`。本地测试分批须有完整清单/无跳过与冻结证据，按当前 CI 要求覆盖全量，不降低预算。最终契约应在所有 DTO 整合后重生，禁止手改生成文件。

| 验收面 | 核心证据 | 当前 |
| --- | --- | --- |
| 配置与权限 | 两内部组织、读/管/凭据/正文/拒绝角色；服务器及控制台允许/拒绝 | API/Web受控测试PASS；生产角色/人工验收待执行 |
| 鉴权与公网入口 | 真实 HTTPS 独立客户端，坏/过期/撤销/错接口凭据；CSRF 不退化；可信代理/IP | 本地真实PG/HTTP及HTTPS网关PASS；公司实际公网来源NOT_RUN |
| 可靠性 | 回执开关两模式及双向切换、204 真空正文且提交后响应、内部留存不受影响；并发重复、冲突、提交未知、断开重试、审计故障与事务回滚 | 76项整合及真实浏览器对应主链PASS；完整机器/密钥进程故障演练不据此泛称全覆盖 |
| 容量与安全 | 超大/超频/容量上限、数据库原子计账和 HTML 纯文本显示 | 真实PG/网关及浏览器PASS；多API进程同时部署、生产吞吐NOT_RUN |
| 数据保护 | 加密正文、轮换、保留、检索、清理事实、备份恢复及强删保历史 | 技术样本PASS；匹配生产全库批准容量恢复NOT_RUN |
| 观测与排查 | 独立UUID请求身份、非关键异常不反转成功；请求结果/上限/缺口 | 真实PG/HTTP及辅助故障注入PASS；不承诺无损明细 |
| Web | 正式入口、三个页签、组织隔离、主题/窄屏、浏览器真实主链 | 真实浏览器两例PASS；组织切换/拒绝由API及组件测试覆盖，物理设备/人工视觉待验 |
| 真实来源 | 调用方公网出站、真实协议及样本、流量和敏感性；不能由合成技术请求替代 | NOT_RUN |

每条证据记录实际源码/部署 SHA、环境、角色、命令、预期/实际、PASS/FAIL/NOT_RUN、来源（代理/CI/人工）、时间及 Git 外位置。自动浏览器故障按既有规则交具体人工清单，继续其他已授权步骤，反馈前不宣称 UI 验收通过。

## 6. 发布、最终回归、关闭及台账

- [ ] 主代理在冻结整合版本复核规格覆盖、差异、生成契约与独立审查结果；补齐受影响联合回归及门禁。
- [ ] 按真实版本和授权提交/推送功能分支、创建或更新一个 PR；记录 Issue/PR 映射与当前状态，不因 PR 创建报告上线。
- [ ] 获准合并发布后核对精确 PR/main 检查、快照、迁移、同 SHA 三服务、公开路径与匿名拒绝；部署时保持接收接口停用，不生成/外发真实凭据。
- [ ] 在最终部署版本执行配置、凭据、接收、检索、隔离、停用及原管理页的联合回归；没有真实来源时区分技术验收与真实系统联调。
- [ ] 具体生产接口启用前核对真实出站、协议、原字节重试、201/200/204及非JSON错误识别、样本、全库容量及相应备份恢复证明、秘密交付渠道和启用授权；不在普通聊天/台账/Issue 粘贴真实 API Key。
- [ ] 对一期明确范围验收通过后，依据有效授权先写实际证据再关闭 Issue并回读；一期关闭不等于业务数据映射或真实来源已联调，未覆盖项保持显式。
- [ ] 有协作记录且获准写入时逐记录最小回填真实链接与阶段，写后回读；只读/并发/失败保持同步未完成，不重开开发或绕权限。
- [ ] 将实际密钥轮换/容量/重试/恢复经验沉淀到 `docs/API-INTEGRATION.md`、`docs/DATA-PROTECTION.md`、`docs/OPERATIONS-RUNBOOK.md` 对应拥有者文件，验证导航及来源；无通用新规则时说明理由。
- [ ] 本地归档、提交、远端同步、生产发布、人工验收分别结论；清理仅本任务确认可销毁的一次性资源，不触碰其他任务容器或保留库。

## 7. 回退与实施依赖

失败先停用接收或撤销受影响凭据，保留已接收数据及其密钥。容量不足拒绝新消息，调用方原编号退避重试；不得以覆盖旧消息、删表或关闭校验恢复服务。新增表/列兼容追加，镜像回滚前验证旧版本启动；若回滚导致新正文无法在正式页读取，则停接收、保留数据并向前修复，不声称功能完整恢复。

真实系统协议不支持本设计技术头时，必须在接入前修订协议或由其现有集成平台适配，不在本期擅增通用认证框架。正文敏感性、实测吞吐、公司出口 IP 和公网出站属于生产启用资料，本轮不为这些未知项编造 PASS。

## 8. 策划核验记录

### 2026-11-09 实现与验收接续

本节记录当前工程阶段；下方策划及首次提交记录保留原时点。Git外证据目录 `D:/WorkSpace/QMS-2.0-local/req0036-20261109/`，Node24.21.0 / pnpm11.19.0，真实一次性PG18/55636/143迁移，禁止55440。重命令单进程串行、单worker、Node默认堆1GiB，PG限512MiB/1CPU；不因资源约束降低真实验证。

| 范围 | 实际结果与证据 | 独立审查 |
| --- | --- | --- |
| A 配置/凭据 | 两完整文件27/27 PASS、0skip，`authorization-full-green.log`；创建人及最后资源锁后近期认证/授权返修完成 | SPEC/QUALITY PASS |
| B 可靠收件 | 两完整文件20/20 PASS、0skip，`inbound-final-green.log`；并发、未知提交/响应丢失、回执切换及加密计账 | SPEC/QUALITY PASS |
| C 检索/保留 | 三完整文件25/25 PASS、0skip，`receipts-complete-green.log`；来源精确匹配、限批、强删真实HTTP、采集隔离 | SPEC/QUALITY PASS |
| D Web与导航 | 六完整文件43 PASS/0FAIL/0pending，`web-spec-complete.json`；名称长度120最终对齐DTO | SPEC/QUALITY PASS |
| 密钥轮换 | `node --test test/operations/key-rotation.acceptance.mjs`，5PASS/0FAIL/0skip，`receipt-rotation-green.log` | 最终接缝只读PASS |
| 备份恢复 | `node --test test/operations/data-protection.acceptance.mjs`，8PASS/0FAIL/0skip，`receipt-backup-restore-final.log`；验证配置/凭据校验/密文/计账，非大容量证明 | 最终接缝只读PASS |
| 网关 | `gateway-case-red.log`原1FAIL3PASS；两模板regex返修后公共文件PASS。`gateway-live-final.log`实际HTTP/HTTPS 401/413/429及CA/308 PASS | 原P2限定SPEC/QUALITY PASS |
| 领域构建/契约 | `api-build.log`、`web-build-final.log`、`contracts-generate.log`成功；Web保原大chunk告警，最终check另记 | 不把构建代业务验收 |
| 邻近生命周期/Worker | 首`public-neighbor-final.log`98PASS4FAIL；同步第四owner后`lifecycle-neighbor-final.log`79PASS1FAIL，余FAIL为对象PUT前置；init-storage后`identity-worker-final.log`两完整文件40PASS/0skip，原断言/预算保留 | 五fixture差异已限定复核PASS |

A实现者 `/root/implement_config`，B `/root/implement_inbound`，C `/root/implement_receipts`及`finish_receipts`，D `/root/implement_web`及`finish_web_spec`。公共文件/迁移/生成契约与Git由主代理串行整合；原各红灯、夹具失败、锁等待及返回追踪头/无缓存/来源P2返修在同目录保留。最后网关与五fixture/浏览器spec由独立`final_seams_review`限定复核；来源范围及未运行门禁不混记。

备份首完整失败系负例错误容器名不可用而不是目标不匹配，指向本任务真实非PG容器后8项全绿，不修改恢复安全校验。对象历史COMPLIANCE桶/版本无法提前删除，保留到本任务容器销毁，不绕保护。正文小样本恢复成功不覆盖接口默认256MiB/组织1GiB生产容量；按设计保留启用门禁。

真实浏览器使用新`playwright/api-integrations.spec.ts`、生产构建及真实Nginx/API，凭据无trace/video/自动截图，MFA缓存外置加密。首轮按钮空格、虚拟Select选项及关闭按钮歧义属于测试定位失败，修复不改动效或预算。初320px即刻几何断言FAIL，诊断documentWidth1416但main最大可见右缘874（含表格正常局部横滚），未证实持续布局缺陷。拆分独立响应式场景并以现有默认expect预算轮询真实无溢出条件后，独立1PASS10.5s、最终两完整场景2PASS21.7s，未改CSS、关动效、增加预算或弱化几何条件。`browser-final.log`为最终结论，六组截图已生成到Git外browser目录；本机文件二次读取非PNG签名、view_image无法解码，未人工目视审图，不假称人工视觉/物理设备验收。

最终`api-integration-final.log`八完整文件76/76 PASS、0skip/exit0，53.884s，覆盖公共过滤器/机器审计/网关模板与全部A/B/C。`contracts-final.log`实际重新生成对比PASS、两端lint/归档及HTTP/TLS Compose配置均exit0；此前Web lint首轮测试ByRoleOptions误用exact已修，最终lint/build成功，不将首FAIL抹去。Web仍保原大chunk告警。

`web-complete-final.json`最后单worker六完整文件43/43 PASS、0FAIL/0pending；`governance-complete-final.log`38文档/485链接/20来源/160依赖及覆盖1项PASS。治理首轮因MAINT-003运维来源已变而FAIL，定向复核新增本地排查与恢复说明后只追加事实/摘要，open、reviewedOn与原2026-11-23期限不变，独立限定复核PASS；没有借来源同步关闭生产告警事项。版本提交前实时GitHub核仓库public、main仍badd14b、V0.0.40仅Issue97使用，沿用原预留。

2026-11-09末轮飞书 `+record-get` user回读实际返回`token_missing`，未取得新的状态/五字段，不重试裸API或代写台账。当前聊天直接批准继续及先前rev363快照仍为本地范围授权来源；本次不将旧快照称最新回读。GitHub实时核Issue97仍是唯一V0.0.40预留，远端main仍badd14b；提交前再核分支差异。

本轮实际规则沉淀为API调用/开关/重试/检索/容量/启用、DATA-PROTECTION轮换计账与恢复停用、SECURITY处理器级CSRF与显式权限、OPERATIONS-RUNBOOK故障排查和恢复，未新增通用框架。相关来源差异已定向复核，仅刷新实际变动的摘要，原用户CodeGraph规则/工具改动及其来源hash不纳本期提交。

- 已复核现有 CSRF、正文解析、控制台导航/context、管理事务回执、密钥轮换脚本、交换注册/DTO、网关和 Worker 维护入口；采用直接源码定向核对，未依赖不明新鲜度的图谱。
- 已内联检查目标与任务映射、机器/人员身份、正文/元数据保留、防重复边界、凭据一次响应、生产停用和交付闭环；本轮未启动实现或独立业务审查。
- 实际环境 Node v24.21.0、pnpm 11.19.0；`corepack pnpm check:governance` exit 0：文档 38 份、本地链接 478 个、来源复核 20 份、模块依赖 157 对通过；现有阶段五覆盖检查 1/1 PASS，0 skip。`git diff --check` exit 0，原索引 LF/CRLF 提示保留，不调整行尾规则。
- 上述为工作区整体文档/治理结果，包含已存在的用户改动，不将结果归因于本轮业务实现；本轮未运行业务单测、集成、构建、浏览器或生产联调，不创建开发资源，不提交或推送。
- 2026-11-09 接收回执开关追加：同步设计、模型配置、成功/失败协议、重复/切换语义、页面调用说明及验收任务。修改后 `git diff --check`、三份策划文档开关/204覆盖及空白检查通过；`corepack pnpm check:governance` exit 0，38 份文档/478 本地链接/20 来源复核/157 依赖对及覆盖检查 1/1 PASS、0 skip。以上仅为文档验证，开关运行行为未实现或测试。

### 2026-11-09 整体策划审查与修订

独立只读审查 `/root/review_inbound_plan` 与主代理定向源码复核一致：一期主目标覆盖，不增加业务子系统；以下为策划缺口，不是已上线故障或运行测试结果。

| 审查项 | 原缺口与修订 | 对应任务 |
| --- | --- | --- |
| P1 观测隔离 | 80位身份/不可改终态/仅吞503可能使观测干扰已提交响应；独立服务器UUID，非关键错误隔离并显式缺口 | B |
| P1 备份容量 | 接口256 MiB/组织1 GiB与旧dump256 MiB/包512 MiB不匹配；容量须有实际完整备份恢复证明，新增备份改造不默认入期 | C、生产启用 |
| P1 生命周期 | effect固定三模块，强删实际tombstone；明确类型/枚举接入、普通删受引用保护、强删停接口撤凭据保历史 | A/C |
| P2 审计身份 | 新UUID会被白名单过滤；空人员机器身份及有界字段明确列写集与回归 | A |
| P2 失败排查 | 旧观测聚合无法按消息号/traceId查失败；增加最小有界请求结果视图，缺记录不伪装完整 | C/D |
| P2 错误协议 | 新码须目录登记，5xx保持统一安全错误，网关可能非JSON；服务端请求追踪头用于关联 | B/D |

真实调用方协议、网络出站、出口IP、敏感样本、吞吐和凭据交付继续作为启用资料；无须为未知情况增建网关、认证或告警平台。

修订后 `/root/review_inbound_plan` 对原六项限定复核 PASS，无新增阻断矛盾；204 与排查头、非关键采集异常隔离、独立UUID请求身份、审计白名单、生命周期和备份门禁均对应设计及实施任务。此为独立策划规格复核，不是实现双审或业务验证 PASS。

本次 `git diff --check`、三文件格式/占位及六项关键标识覆盖检查通过；`corepack pnpm check:governance` exit 0：38 份文档、478 个本地链接、20 份来源复核、157 对依赖及覆盖检查 1/1 PASS、0 skip。未修改业务源码/契约/迁移/运行配置，未提交、推送或操作生产，所有业务验证仍 `NOT_RUN`。

### 2026-11-09 需求提交与回读

- 用户指令：“没什么补充可以启动了，按我们的流程先整理提交需求”。本次先提交一条完整一期需求，未把发送、业务字段/映射/入库、自动重放加入范围。
- 使用项目接单流程和 `lark-base`，CLI user 身份核对 Base 为“QMS 筑梦空间”、时区 Asia/Shanghai、需求表19字段及实际选项。当前 CLI 不支持 url-resolve，按其内置技能的 `/base/{token}` 规则定位；旧表单管理端点返回只支持新表单，改用已有获准记录创建 shortcut，未修改表单或权限。
- 写入前按需求名称 API/接口/接收/互联云端过滤及“接入”关键词查询，均返回空且 has_more=false、rev358；查重范围为本期相关标题，不宣称整表没有任何关联需求。未修改旧REQ-0015或REQ-0032。
- 创建返回 `created=true` 与实际 `reczz28XQpffP57y`。阶段写入“待评估”被明确 `READONLY` 忽略，未重试、切身份或绕权限；随后原ID回读为 REQ-0036、rev360、实际阶段“待评估”。本次未代设“开发中”。
- 需求名称、提出人（角色说明“项目负责人，当前聊天提出，Codex代整理”，未猜个人姓名）、业务模块、变更类型、涉及端、业务背景、期望效果、方案要点、子任务清单、验收标准10字段逐项回读相符。五个方案字段包含独立策划复核六项修订；提出日期由表默认生成，负责人沿用表默认，紧急程度未指定且未擅填。
- 分享链接已通过官方 shortcut 取得；创建请求、实际响应、完整回读及字段比对在 Git 外 `D:/WorkSpace/QMS-2.0-local/api-inbound-phase1-20261109-request/` 保存。未存令牌或秘密，未发消息、未建Issue/PR、未写业务源码或运行业务测试，尚未提交/推送本地文档。
- 本次登记结果写回文档后，`git diff --check` 与 `corepack pnpm check:governance` 均 exit 0；文档38/链接478/来源20/依赖157及覆盖检查1/1 PASS、0 skip，属于文档治理验证，不替代后续业务门禁。

### 2026-11-09 开发中断与低负载恢复

- 负责人报告电脑刚重启并要求“悠着点”。本次不归因硬件、Docker或具体进程，未做重启根因诊断，不修改全局Windows/WSL配置。此前多实施任务分别运行测试，另启动扫描/对象存储/邮件一次性服务，资源安排需要收敛。
- 恢复时只读核对：LastBootUpTime为本机记录2026-11-09 12:18:53（+08:00）；21.8 GiB可见内存、4.3 GiB可用；无存活子任务、无本任务测试/构建、无运行的REQ0036标签容器。现有QMS路径Node进程不属于测试/构建，不按名称批量终止。
- 工作区改动与Git外证据仍在；143链迁移先前已部署，容器数据能否恢复尚未连接核验。配置A已有完整19项通过、B完整20项通过；C首完整三文件20项通过日志仍在。以上历史只证明各自当时范围，不覆盖后来修改或重启后的环境。
- A独立SPEC创建人P2已修复并复核通过；QUALITY发现锁等待跨过近期认证/任职到期后未重新授权的P1，追加8场景回归尚未取得完整结果，源码仍未补锁后auth/access。该项明确未解决，不能沿用原19项PASS称A质量通过。
- 最近一次契约生成会话已丢失，当前生成类型未含C的IntegrationReceiptDto；本次生成记中断/结果未证，不称构建或契约通过。Web交互复验、C补充强删/限批/并发、密钥轮换和备份、独立B/C/D审查、最终门禁/PR仍未完成。
- 本任务Git外入口将Node默认堆上限收紧到1024 MiB；本地同时最多一个测试/构建进程、测试单worker，资源紧张时先源码/文档工作。数据库如需重启仅启动本任务PostgreSQL并限制512 MiB/1CPU；不恢复ClamAV、全量服务或并发分片，不因资源不足Mock/Skip或伪造PASS。

## 9. PR98 首轮失败与 fix1 接续

首提交 `dfc7ba79be0d9579dcdacc813edf4976e0ec9e1b` 已推送并创建 [PR98](https://github.com/JasonShu0722/QMS-2.0/pull/98)，base `badd14b08275d29b361e596e2184d74e649b5acf`。首 [CI42580718216](https://github.com/JasonShu0722/QMS-2.0/actions/runs/42580718216) attempt1 的合成合并SHA为 `6b8fdda5a068fc2c16707aafbe6e2f28c9651aaa`；最终24/24任务完成，20success/4failure，无取消/跳过/运行中任务。Web16分片全部成功，integration2/3成功。失败逐项如下，不能只修第一条或重跑旧run：

| 失败/发现 | 实际根因 | 最小修复与证据 |
| --- | --- | --- |
| api-unit / job129038878523，163 suites中2FAIL、2375项18FAIL/2357PASS | 六新审计动作未登记中文标签；供应商报告17错误例的旧Response夹具缺新增setHeader | 既有审计目录补六标签/精确样例并保AST源扫描；夹具补setHeader及头体trace一致，保状态/code/5xx脱敏，生产filter不降级。原两完整文件本地RED18FAIL2PASS，`fix1-api-unit-red.log`；修后五完整邻近文件106PASS，`fix1-unit-green.log` |
| integration1 / job129038878450，777项7FAIL/770PASS | CI未配置QMS_PUBLIC_BASE_URL，创建接口在配置校验处503 | `.github/workflows/qms-2-foundation.yml`仅在真实PG integration step显式配置`https://qms.example.test`，与原测试断言相同，不提供生产默认值或放宽校验 |
| integration4 / job129038878540，749项16FAIL/733PASS | 同上，接口配置完整文件创建503 | 与credentials文件合计两完整文件27项，及返修后的receipts完整10项共同37PASS、0skip/49.084s，`fix1-postgres-green.log` |
| foundation / job129043853007 | 聚合依赖失败，短日志明确`api-unit must be success` | 派生失败，没有新业务根因；由新head完整必需检查解决，不绕过门禁 |
| [Codex Review P2](https://github.com/JasonShu0722/QMS-2.0/pull/98#discussion_r4510412232) | 大写合法receipt UUID能被PG匹配，但AAD用原路由字符串，大小写改变认证数据，解密503 | 锁定行复读canonical `id/organization_id/endpoint_id`，用于AAD/审计/响应；锁、双授权、到期和事务内审计保持。新增真实HTTP小/大写同正文、规范ID/两条审计/no-store；fixture强制含字母。真实RED期望200实503（`fix1-uppercase-red.log`），完整10例已随37项GREEN |

`diagnose_ci_integration` 已核最终全部失败并归档 `ci-first-integration-diagnosis.md`。GitHub插件长日志中部截断，公开下载403且本机无gh，未称完整原始日志已下载；job尾部总计、失败文件和源码缺配置调用链已实际核对，foundation短日志完整，未据截断内容虚报额外成功范围。

独立实现者 `fix_api_unit`、`fix_receipt_uuid` 分别只改分配文件；主代理串行处理CI环境和公共记录。独立 `fix1_spec_review` SPEC PASS后 `fix1_quality_review` QUALITY PASS，六文件限定审查无P1/P2，原断言及安全控制保留。`GlobalExceptionFilter.catch`直接测试调用方共四处，除已修夹具外其余三处已具备setHeader；integration其他加/解密AAD均来自DB canonical身份，没有扩展全局UUID兼容层。

本地尝试完整API unit在1GiB堆上限触发Node heap OOM、exit134，未得到完整测试结论（`fix1-api-unit-full.log`）；这是受限本地验证资源失败，不是CI业务失败，也不以部分运行称PASS。不增加本机内存预算或恢复并发，改为串行相关完整文件，全部API单测由新head云端完整CI证明。API lint/build及CI配置/分片/结果门禁19项均已exit0，Web/DTO/迁移/网关及原浏览器源码未变，按影响范围复用既有有效证据；不据旧CI或本地绿色放行新head。

当前按持续授权提交 `V0.0.40-fix1` 并更新同PR98；新head完整CI与Review处置仍待核验。未合并发布、生产配权/分发凭据/启用、关闭Issue或写飞书。用户原CodeGraph四项修改继续保留并排除提交。

### fix1 最新代码检查点（2026-11-09，未合并）

上述“待核验”为提交时点，当前已推送 `6efba7485621403aa57a5b4cbc95a8d1c638c350`。[新CI42584067733](https://github.com/JasonShu0722/QMS-2.0/actions/runs/42584067733) attempt1全24任务completed/success，零failure/skip/cancel/running；scope、checks、api-unit、四integration、16个web-tests和foundation全部成立。独立只读跟踪后主代理读取Actions原始JSON，复用`evaluateDeployJobs`核同head/run/attempt及精确任务集合，返回`full`，Git外`fix1-ci-verified.json`保存实际原始run/jobs。没有用首run、不同head或只看Web绿色代替。

新API单测日志实际163 suites/2381 tests全PASS；PG2为53 suites/547 tests、PG3为53/675、PG4为53/749全PASS，PG1 job成功但主测试总计处于插件长日志中部截断，保持NOT_VISIBLE、不猜总数；该job额外真实compiled Worker为1suite/8tests PASS。16个Web任务均success，本轮未逐份汇总16份JSON的测试总数，不虚报全站case计数。前述本地1GiB完整unit OOM不抹去，也不再阻断由云端完整单测已证明的相同代码。

PR说明已写入四项修复、真实首FAIL、最新HEAD和限制，Codex Review大写UUID问题由真实RED→GREEN与独立SPEC/QUALITY承接，不把本地审查称为GitHub人工批准。源代码已推送；本条CI核验结果作为本地文档归档，不再为无运行变化重新推送触发相同PR全量门禁。用户原四dirty仍保留；本机API、测试/构建及一次性服务均已停下，后续仅销毁已确认本任务资源。合并发布、线上/真实来源/人工验收及Issue关闭/飞书回填均未执行。

## 10. fix2 补查与新 Review（2026-11-09）

负责人要求“看下是否还有别的问题”，并指出Codex Review又有新条目。实时回读确认其针对6efba74：组织私表访问P1与90天分页P2，首轮大写UUID评论已outdated。本轮按既有批准规格与有效证据定向补查，没有重新启动完整设计或扩展业务范围。上轮收尾只核了CI，漏核新提交的Review；本轮必须分别核最新head的CI和Review后才能报告检查点成立。

| 发现 | 证据与实际影响 | 最小修复 |
| --- | --- | --- |
| [组织域所有权P1](https://github.com/JasonShu0722/QMS-2.0/pull/98#discussion_r4510668938) | types/inbound及维护/采集/生命周期共5文件直接查锁organizations，违反API AGENTS公开服务/读取模型规则 | 在组织域新增transaction-aware公开readOrganizationRuntime纯读取模型，返回canonical5字段或null；FOR UPDATE由owner执行，各调用方维持原管理/机器错误码和组织→接口→凭据/收件顺序，维护不强求ACTIVE；治理登记依赖 |
| [90天固定查询翻页P2](https://github.com/JasonShu0722/QMS-2.0/pull/98#discussion_r4510668943) | Web固定from/to，过一分钟from落到滚动DBnow-90d之前，首分页应200实际400 | 仅删除服务端滚动from下界，保日期/顺序/90天跨度/未来上界/分页；Web固定快照不变，metadata到期和请求7天过滤仍按当前DB时间执行 |
| HTTP等价表示P2 | percent-encoded endpoint UUID被路由解码成同一UUID，却跳过raw parser，实际raw=false；合法quoted UTF8/Identity大小写首收应201实415 | raw挂同Controller参数路径，Guard仍验UUID；保原1MiB、禁解压、普通100k；仅支持JSON UTF8/identity的等价表示，不加依赖/其他charset或压缩 |
| 失败记录配置追溯P2 | 真实receive按v1拒413后管理员改v2/false，事后采集错误记v2/false，应为v1/true | 请求私有Symbol保存每次锁内实际读取的version/returnReceipt，成功result优先，失败用实际快照；完全没读到接口时才保原fallback上下文，无新表/公有DTO/秘密 |

实现者`fix2_owner_boundary`、`fix2_query_snapshot`、`fix2_wire_and_capture`分配独立文件；主代理最后接inbound/recordAttempt公共owner调用及治理，重命令冻结源码后单worker串行。`fix2_spec`SPEC PASS后`fix2_quality`QUALITY PASS，限定14文件，无新增P1/P2；用户4dirty排除，未顺手修改common security或平台轮换脚本的既有权限内核。

真实RED：`fix2-owner-red.log`静态源所有权5FAIL/11PASS，明确不代PG；`fix2-boundaries-red.log`三文件定向6FAIL/1PASS/21按名称过滤，包含老快照400、encoded rawfalse、v1错误记v2和三种合法头415，非法charset/gzip负例原本PASS。随后`fix2-integration-green.log`9个完整文件101/101 PASS、0skip、54.076s；含原锁等待/撤销/停用/强删/清理竞争、编码首收与原路径同号重试、原字节摘要、跨页固定参数和实际到期行排除。

重新建立一次性PG18/55636容器`qms-req0036-fix2-pg`，label=REQ0036-FIX2、512MiB/1CPU，143迁移/seed成功；没有恢复扫描/对象/邮件或连接55440。API源码仅内部port、参数处理及私有Symbol/查询校验变化，无DTO/迁移/Web/网关/备份语义变化；对应旧证据按影响复用，最新头全量CI另核。真实来源与人工/物理设备、生产启用仍未执行。

## 11. 获准合并部署与 main 门禁 fix3（2026-11-09）

负责人明确“没问题了就继续合并部署”。合并前实时回读PR98仍open/mergeable、head48d403d/base badd14b/标题V0.0.40正确，CI42592556853 completed/success，bot同head completed/has_any_findings=false/has_unresolved_findings=false；沿用未变化的精确24任务及本地SPEC/QUALITY证据。以expected_head_sha约束squash为`042f7d9dd947464369ec079747f92f4b27314882`，GitHub原始git commit/tree独立比对整树相同（`release-042f7d9/merge-tree-verified.json`）。没有合并本地仅档案f5b00d8或用户4dirty。

main push [42597522794](https://github.com/JasonShu0722/QMS-2.0/actions/runs/42597522794) attempt1精确24任务全部结束：22success/2failure，API及16个Web均成功、PG2/3/4成功。唯一实质FAIL：PG1 job129093809666，`platform-administrator.integration-spec.ts:83` 的全权限目录ORM/SQL parity case超过默认5000ms；54 suites中1FAIL/53PASS、777项1FAIL/776PASS，未发现API收件断言失败。foundation129099637727短日志明确`integration must be success`，为派生失败。自动deploy42599373515/job129099811950 skipped，未执行SSH/部署。原始状态存`release-042f7d9/main-attempt1-final.json`，失败摘要同目录；插件长日志中段截断，未称完整原始日志已下载。

源码确认该case逐个permission串行await真实SQL，往返次数随完整目录大小增加，本期目录增加5项后此路径仍须完整覆盖。具体CI宿主为什么迟缓未证实，不定性为偶发，也不声称新增5项是唯一原因。最小技术修复仅该测试首case：独立ORM全目录构建`{code,allowed}`期望，一条真实SQL对完整permissions表逐行调用原featurePredicate；使用无冲突外层alias，双方同JS排序后完整深比较，保留数量/每个code/每个正负结果。原registered/ormCodes、四项否定探针、未来组织、无新增membership、sources/platformScope及其余28case、所有超时预算不变；不改生产鉴权、CI或API。

从origin/main042建立`codex/req0036-release-fix3`，用户4dirty原样携带且Git外保存diff，原feature分支档案保留；沿用Issue97，不在已合并PR98上继续推送。`release_parity_fix`独占一个测试文件；`release_fix3_spec`SPEC PASS后`release_fix3_quality`QUALITY PASS，无弱化/新缺陷。真实CI为RED；本地同原case基线1PASS/28按名称过滤，Jest4.376s，不冒称本地RED。改后原完整文件29/29 PASS/0skip，Jest10.264s，不将原单例与新全文件耗时相除声称加速。

本地PowerShell一次CoreCLR/GC初始化失败，未诊断为确定内存或硬件故障；改用cmd与显式Node24.21轻量命令。实际可用内存核5.67GiB后，才建立仅本任务PG18/55636（label REQ0036-FIX3、512MiB/1CPU），143迁移/seed真实成功；Node1GiB单worker，未恢复全量服务/并发或修改系统配置。Git外Node launcher继承同任务配置并核版本/非55440，所有秘密仅进子进程环境不输出。修复后的新PR、精确新main、自动部署与公网验证仍待完成，不以PR旧绿或同树推断main已过。

## 12. 最终机器发布核验（2026-11-09）

本节接续第11节的待办，先前失败及当时未发布状态保持为历史事实。负责人“没问题了就继续合并部署”覆盖本期及其发布阻塞修复；未扩展为生产岗位配置、机器凭据发放/分发、接口启用、Issue关闭、飞书回填或人工业务验收。

| 检查点 | 实际结果与证据 |
| --- | --- |
| 修复PR | [PR99](https://github.com/JasonShu0722/QMS-2.0/pull/99)候选8d761c02a7273a70c5010bb988fe02cbf39d62c8；[CI42604558840](https://github.com/JasonShu0722/QMS-2.0/actions/runs/42604558840) attempt1精确24/24 success。同head Codex Review completed、has_any_findings=false、has_unresolved_findings=false；主代理独立重新读取并用既有evaluateDeployJobs核完整集合及来源为full |
| 合并 | 合并前重新核open/非draft/mergeable、head/base与main一致，expected_head_sha约束squash为0181a899eee277585eb38448ce956c147572d518；GitHub git commit/tree独立核整树与候选一致。首次回读命中短缓存旧merged=false，随后加观测nonce回读明确true，不把缓存误作生产故障 |
| 主分支门禁 | [CI42606383814](https://github.com/JasonShu0722/QMS-2.0/actions/runs/42606383814) push/main/attempt1 completed/success，精确24/24全success、零skip/cancel/running；主代理独立核head/run/attempt及原全集，evaluateDeployJobs=full，不用PR绿或同树替代 |
| 自动部署 | [deploy42607996737](https://github.com/JasonShu0722/QMS-2.0/actions/runs/42607996737)/job129128768750 workflow_run/attempt1 completed/success，同0181a89；日志明确RUN_ID=42606383814、RUN_ATTEMPT=1、HEAD_SHA同版且Full validation scope，不是skipped或superseded |
| 迁移前保护 | 11:27:46Z明确Pre-migration encrypted database snapshot verified，同SHA；为服务器本地加密数据库快照、独立密钥及加解密/目录校验，不等于全容量恢复或对象/异地灾备证明 |
| 数据库 | 11:27:50Z实际应用20261109000000_api_inbound_phase_1与20261109000100_integration_provenance_and_cleanup，两条成功、143迁移链；未跳过迁移 |
| 服务与出口 | compose日志与ps显示API/Worker/Web镜像标签均为0181a89，API healthy，Worker启动、Web可达；11:28:11Z明确Deployment successful。Worker稳定实例READY、公共HTTP200及原子deployed-sha是同版脚本的强制成功出口条件，未另SSH读marker，不补造直接读回证据 |
| 独立公网 | 11:30:19Z，https://qms.bigshuaibee.cn 的login/OpenAPI、console/api-integrations SPA及JS/CSS均200；OpenAPI新机器接收契约含200/201/204。四受控管理GET匿名401 AUTH_SESSION_REQUIRED，无Bearer机器请求401 INTEGRATION_AUTH_INVALID且X-Request-Id与正文traceId一致；未写生产业务数据 |
| 目标变化 | 发布前无接收契约；新index-B6Iqlx7U.js及index-3kA8cBHz.css与旧index-BpThNLlk.js/index-BlMtSdkC.css不同，新包含路由、凭据权限、returnReceipt及页面CSS标识，已保存实际指纹。不以资源名推断本地/Linux字节相同 |

Git外最终证据：`D:/WorkSpace/QMS-2.0-local/req0036-20261109/release-fix3-final/`中的merge-tree、main-ci-verified、watch-deploy-jobs、public-final JSON、资源文件、deploy-log-evidence摘录及release-record。部署运行中首次取日志404/BlobNotFound，仅是当时证据未就绪；完成后取日志成功，但工具省略中段构建内容，不宣称完整日志已下载。保留慢仓库请求、Vite大chunk、punycode弃用及SSH非后量子提示，不因此擅改全局配置或依赖。

本任务fix3临时PG已先核精确名称、REQ0036-FIX3标签及停止状态，只删该容器并回查为空；未做全局prune或操作55440。四处用户原修改与Git外原diff规范化换行后完全一致，独立断言通过。最终机器发布记录仅本地归档，不为无运行变化再推送触发发布；源码及权威能力规则已随PR98/99进入远端main。

仍为NOT_RUN或待确认：生产岗位配权、真实凭据交付、接口启用、QMS_PUBLIC_BASE_URL实际生产值的独立读取、真实来源字段/协议/吞吐、匹配容量恢复、真实物理设备/人工视觉验收。已有一次性浏览器与样本恢复证据按原范围有效，不替代这些未覆盖项。Issue97保持开放；飞书令牌缺失未代写/回填，不以机器发布称整个需求已关闭。

## 13. Admin默认权限与菜单入口返修（V0.0.40-fix4）

负责人在0181a89上线后提供真实页面截图：直接进入API接口管理仅见“无权访问此管理模块”，菜单也没有入口，并明确要求Admin默认具备权限。源码确认五项INTEGRATION_PERMISSIONS在INTERNAL_PLATFORM_PERMISSION_CODES中被显式排除；既有平台管理员context因此无api-integrations模块，导航按同一context隐藏。截图可见的供应商账号和待配置管理使用同一平台身份链；不据用户名绕过身份或猜测普通岗位是平台管理员。

本次明确要求覆盖先前“平台管理员不自动获得API权限”的设计：显式有效platform:admin来源按已有规则获得五项integration权限及活跃内部目标组织的API管理能力，普通账号仍须岗位授予；停用/待配置/供应商组织、失效来源、机器鉴权、近期认证、CSRF、幂等、正文审计保持。只移除目录的integration排除条件，不动观测权限例外、不修改历史迁移或按用户名创建特权。不新增生产角色赋权脚本或重复菜单。

实施与完成条件：

1. 全新实施代理只改权限目录及对应测试，先取得真实失败：平台标记账号能从context获得API模块、HTTP创建/读取接口与凭据，五项权限在ORM/SQL一致；普通无权、只读、供应商/停用目标仍拒绝。原“marker应拒绝”断言按负责人新规则改为精确允许，不删相邻拒绝覆盖。
2. 导航测试使用实际返回形状的五项能力验证“基础数据与配置”下API接口管理菜单及路由允许；无读权继续隐藏。真实浏览器至少使用平台标记账号验证侧栏入口→页面配置可见，不把SPA200当作账号可用。
3. 主代理同步设计、API-INTEGRATION与SECURITY政策，更新受控来源摘要；独立SPEC后QUALITY、真实PG完整受影响文件、Web导航、API构建/契约复用或复验、治理通过后沿Issue97提交fix4 PR。PR/main最新CI与部署分别核验，保持低负载单重命令。
4. 延续合并部署授权完成同范围返修；不启用具体接收端点、不分发凭据、不关闭Issue或代写飞书。生产真实Admin页面由可用会话或负责人反馈单独确认，缺会话不得假称人工验收。

版本及基线：远端main0181a89/PR99，旧范围最大fix3，本次预留V0.0.40-fix4；本地文档归档d17ece1已在新分支接续为202f3d0。四处用户既有CodeGraph改动保护并排除。

实际TDD：生产未变时unit四完整文件1FAIL/52PASS，真实PG四完整文件1FAIL/101PASS；失败精确为平台目录缺integration:read及marker-only账号context缺api-integrations。原实现代理持续pending_init，父中断并收回其测试所有权后先写/运行RED；全新fix4_minimal_implementation在RED后只移除catalog一项排除，未扩展通用授权内核。父随后完整unit53/53、真实PG102/102（50.52s）、导航22/22与API build退出0，原预算/断言保持；fix4_spec独立SPEC PASS后fix4_quality独立QUALITY PASS，无P1/P2。

真实浏览器两完整场景2/2 PASS、39.1s：测试角色仅追加platform marker并明确断言无integration直接grant，登录后从/console真实侧栏点击API接口管理；配置、一次性凭据、201/200/204、来源检索、正文审计纯文本与浅深/320/390/1440几何均通过。使用一次性PG与真实本地API、现有Vite同源代理，网关/TLS配置未改并按原有效证据复用，不冒称本轮重跑HTTPS或生产Admin已验。两个服务会话已停止，生产新版本仍待PR/main/部署门禁。

### fix5：同PR100的正文可见态回归

[PR100](https://github.com/JasonShu0722/QMS-2.0/pull/100)首候选1d0b2cb8512df53621ed4f7165046b32fe5ce4fc的[CI42617559662](https://github.com/JasonShu0722/QMS-2.0/actions/runs/42617559662) attempt1全24任务已结束，22success/2failure，无skip/cancel。唯一实质失败Web11/job129161228883，ReceiptList.test.tsx:60的正文纯文本场景在pre节点已存在但不可见时立即toBeVisible失败；该片15文件166项1FAIL/165PASS。foundation/job129168221984明确web-tests must be success，是派生失败；API、四PG和另外15个Web均success。同head Codex Review completed、无发现/无未解决项，但不能代替失败CI门禁。

全新fix4_receipt_visibility只改一行测试：复用已导入waitFor，在原dialog中等同一精确payload真正可见，随后保原PRE标签及无img/script子节点断言。与既有CredentialPanel等待方式一致；生产Modal、权限、fixture、动效、默认超时以及原8例均保持。真实RED来自本次CI，未声称本地复现或已确认具体云端调度/动画帧原因；永久缺失/隐藏仍须失败，不重跑旧run或放宽预算。

父串行六个完整UI/导航文件44/44 PASS、0skip（138.22s），其中原ReceiptList全部8/8，失败场景4.250s；没有同环境原完整基线，不宣称性能改善。fix4_spec限定SPEC PASS后fix4_quality限定QUALITY PASS。父核生产源码与1d0b2cb保持，按范围复用原真实PG、API build、契约及浏览器证据；本次新增代码消耗V0.0.40-fix5，仍更新同PR100及原Issue97，不另建PR或扩大业务。

Git外fix4目录保留first-failed run/jobs/comments、web-ui完整日志、原RED及修后证据；check:governance/暂存来源核验按当前提交再核。生产浏览器绑定因CUA无法可靠识别Windows浏览器URL而被安全策略中止，已停止且未用其他手段绕过；生产实页NOT_VERIFIED，不影响继续核云端/部署及公开HTTP。fix4临时PG已核精确ID/标签/端口/tmpfs后stop与rm --volumes，回读为空；3136/5186已空闲，没有恢复重服务或连接55440。

### fix4/fix5最终发布与可见性确认

| 验证项 | 实际结果 |
| --- | --- |
| 候选与合并 | PR100的e0ab78c2a061e4465ade04577ff273131cb82ea0，CI42620866574 attempt1精确24/24及同head Review completed/无发现；父独立复核后按授权squash ce4a72f33f6c6261dbd7525e431c1db3655f0210，完整Git tree一致 |
| main门禁 | [CI42622679109](https://github.com/JasonShu0722/QMS-2.0/actions/runs/42622679109) push/main/attempt1精确24/24 success，父独立读取并用原evaluateDeployJobs核head/run/attempt全集为full |
| 部署 | [deploy42624847559](https://github.com/JasonShu0722/QMS-2.0/actions/runs/42624847559)/job129185860112同ce4a72f，attempt1 completed/success；日志明确来源RUN_ID42622679109/ATTEMPT1/HEAD_SHA同版及Full validation scope，未skip或superseded |
| 快照与迁移 | 13:35:48Z迁移前加密快照验证成功；13:35:51Z确认143链且No pending migrations，本次无新增迁移，迁移步骤实际执行 |
| 服务与出口 | API/Worker/Web镜像标签均ce4a72f，API healthy、Worker/Web启动健康，13:36:16Z明确Deployment successful；稳定Worker READY、公共HTTP200及原子deployed-sha由同版脚本强制成功出口支持，未另SSH读marker |
| 独立公开HTTP | 13:38:09Z，login/OpenAPI/console/api-integrations及资源200；四受控GET匿名401 AUTH_SESSION_REQUIRED，无Bearer机器401 INTEGRATION_AUTH_INVALID且头体traceId一致。接收契约200/201/204、路由/权限/回执及CSS标识存在 |
| 资源与行为边界 | JS仍index-B6Iqlx7U.js、CSS仍index-3kA8cBHz.css，与0181a89相同符合生产Web源码未变；本次变化来自API默认权限投影，不以资源变化冒充证明。真实marker-only侧栏→配置/凭据/收件由一次性浏览器2例证明，公开匿名HTTP不代生产角色 |
| 人工反馈 | ce4a72f上线后，负责人在本次会话直接确认已可看到。记Admin入口/页面可见性MANUAL PASS；不扩为创建接口、发放凭据或真实系统联调已通过。此前CUA网址识别策略中止仍保留为自动验证限制，不要求重复截图或重做该可见性确认 |

Git外fix4/release保留merge-tree、main-ci-verified、fix5-main/deploy-verified、public-final、资源及部署日志摘录。工具省略中段构建日志，不称完整日志已下载；已读取首尾关键证据。慢仓库请求、pnpm升级、Vite chunk及SSH提示未被当作产品失败或擅改全局设置的理由。

权限修复已上线，Admin的有效platform marker无需额外逐项数据库grant，普通岗位仍显式授权。“基础数据与配置→API接口管理”已由负责人确认可见。Issue97保持开放，未启用生产端点、分发秘密或回填飞书；真实来源与其余未覆盖项继续承接，最新结果本地归档避免为记录重复触发部署。

## 14. 便捷化交付单元：编码地址、完整复制及永久凭据

本轮输入是负责人三项直接修改指令，不是重新盘点/接单，也无只策划或只本地限制。复用REQ0036/Issue97与现有一期设计第12节；不重复启动原A～D整套策划，不增加用户确认层。新旧地址及有限期凭据保留真实使用路径；旧校验值不能逆推出原文，新建可复制凭据即可使用新功能，旧凭据不自动撤销。预留版本V0.0.41（提交前核远端和开放预留），一个功能PR交付三项关联行为。

### 合同及文件所有权

| 任务 | 独占写集及实现要求 |
| --- | --- |
| A 永久凭据/受控复制API | integration-admin.dto.ts、integration-credential.service.ts、integration-admin.controller.ts；credential集成测试和新增connection集成测试。CreateIntegrationCredentialDto.validityDays允许null，省略仍90天；返回expiresAt可空。新增IntegrationConnectionQueryDto/Dto及GET :id/connection，按设计的权限/锁/审计/no-store返回真实授权信息。密文字段secret_ciphertext，AAD integration-credential:org:endpoint:credential |
| B 编码接收地址 | integration-types.ts、inbound.service.ts、inbound.controller.ts及inbound相关真实PG/HTTP测试；publicUrl使用encodeURIComponent(endpoint.code)，原参数路由不变。Bearer先确定唯一接口，再按编码或UUID匹配，组织相同编码不串线；expires_at=null不算过期，锁后仍复核撤销/组织/当前配置 |
| C 正式管理页 | ApiIntegrationsPage.tsx、CredentialPanel.tsx、integration-ui.ts及必要小型复制组件与对应Web测试；只从生成契约导入类型。有效期默认永久，可选1～365天；凭据名称给可编辑默认值。复制完整文字含真实Authorization，调用说明及凭据行都复用同一操作，保持作用域ABA/关闭/权限变更后的清敏与旧响应拒绝 |
| 主代理公共整合 | schema.prisma及新增144链迁移、integration-admin.service.ts的空有效期启用判断/编码URL预检、错误码及审计中文标签、rotate-security-keys.ts、两份运维acceptance脚本、Swagger生成契约、浏览器验收和权威文档。旧历史迁移不修改，用户四处dirty不混入 |

### 顺序与真实验证

- [x] A/B各先写真实HTTP失败用例，父在143链一次性PG上串行取得RED：null有效期应永久但实际有限期、connection路由应200实际404、可读编码收件应成功实际401、公开URL应含编码但实际UUID。前置不可用按FAIL，不当功能RED；禁止代理自行运行重命令。
- [x] 父新增integration_credentials.expires_at nullable与secret_ciphertext TEXT nullable迁移，旧行保有限期及null密文；更新Prisma模型。A/B在父RED后最小实现；父生成客户端，保持组织→接口→凭据锁序和最后资源锁后授权/到期复核。
- [x] C先写永久选择、完整剪贴板文字、重新打开后仍可复制、无权不复制、旧身份响应不写剪贴板及失败不假报成功的RED，再接稳定生成类型实现。新复制查询不经过AdminMutation秘密缓存；创建幂等回放仍metadata，显式读取可以恢复新凭据。
- [x] 父真实PG覆盖永久/有限期/旧无密文、两有效凭据计数、撤销/到期/停用/跨组织与最后锁后失效、无正文秘密进入列表/审计/幂等、审计故障不披露、编码/UUID/同编码跨组织/同号去重。沿用原bytes/raw parser/限流及当前回执开关语义。
- [x] 接入既有keyring轮换，新增凭据密文逐行重加密并在去掉旧key后仍可复制；真实备份恢复同时证明永久空日期、密文及校验值保留、原有限期行保持。使用小样本，不宣称全容量恢复。
- [x] contracts:generate、contracts:check、API/Web受影响完整测试和构建、Compose；浏览器从marker-only管理员真实页面创建永久凭据，复制出的token可实际按编码地址收件，重开再复制相同有效凭据，撤销后拒绝。并证明旧UUID地址仍可接收。治理/归档见最终提交前独立结果。
- [x] 独立SPEC后QUALITY覆盖A/B/C及公共接缝，主代理核实际完整日志；修后只复验受影响不确定性或门禁。所有重命令单worker串行，Node默认堆1GiB，一次性PG512MiB/1CPU；仅对象恢复时启动本任务对象存储，不连55440。
- [ ] 更新原Issue实际范围；提交/推送功能分支并建一个PR，最新head的CI/Review及main/部署分别核验。原范围集成发布授权接续，生产不自动创建新凭据或撤销旧凭据；更新后用户自己创建一份可复制永久凭据即可。关闭/飞书回填仍另核，实际PASS/FAIL/NOT_RUN记录FOUNDATION和本摘要。

非目标：缩短或削弱秘密随机性、无鉴权公网接收、移除消息去重、自动业务字段校验/入库、发送功能、新短链/认证/密钥服务。已有公网URL漏配由负责人按指导补入持久env；后续页面能创建接口并生成正确公网地址是API侧配置生效的人工证据，不伪称读取了Worker实际环境。

### 本地实际证据与失败保留

Git外证据为 `D:/WorkSpace/QMS-2.0-local/req0036-convenience-20261109/`。恢复核Node24.21.0/pnpm11.19.0，空暂存及a52519f基线；首次准备前可用7.97GiB。A/B RED分别18项13FAIL/5PASS及37项4FAIL/33PASS，明确缺功能；最初含空格的cmd筛选参数被拆分导致37项名称过滤，随后含shell管道的命令被cmd拒绝，两次都不当作RED。父改完整文件执行取得真实红灯。旧库迁移143后只新增144，不改历史迁移。

最终治理PASS：38文档/490链接/20来源复核/161依赖及阶段覆盖1项；归档隔离PASS。公开PR查重为空、远端main仍ce4a72f，最近发布最大V0.0.40-fix5，本功能确认采用V0.0.41。索引仅本任务DATA-PROTECTION与恢复验收三处来源摘要更新，消费者已核仍相容，不混用户CodeGraph来源改动。

GREEN为五完整文件63/63（49.944s）、邻近四文件38/38（16.557s）、审计标签9/9。Web行为RED三文件9FAIL/10PASS；源实现后六文件50PASS/1FAIL，唯一是点击指定天数立即查字段早于useWatch重渲染；DOM已选中days，测试最小改为等待字段出现，原POST30天/复制断言及预算不变，受影响CredentialPanel完整3/3（27.70s）后六文件组合51项全通过。轮换先预期5实际4 RED，新增既有脚本credential循环后5/5；真实PG+MinIO备份恢复8/8，包括所有原负例，无环境跳过。

一次性marker-only浏览器2/2（29.2s）从侧栏→默认永久创建→实际clipboard完整鉴权→重开复制相同有效凭据→编码路径201及UUID路径200同收件→204模式→来源/正文→撤销401；浅深及320/390/1440几何沿原第二完整场景通过。秘密仅布尔比较，无trace/video/secret截图。API/Web构建与生成/检查契约退出0，Compose基础+扫描+生产配置quiet通过。未跑完整阶段全业务验收或生产业务写入；全API/Web全集交给当前新head云端门禁，不能用旧head通过替代。

convenience_credentials与convenience_address分别实施A/B，convenience_web实施C；convenience_spec对A/B后C/运维逐段SPEC PASS，convenience_quality独立QUALITY PASS及父浏览器差异限定PASS，均只读不竞争重命令。父负责迁移、公共计数/错误/审计、轮换/恢复、契约、实际测试及文档。资源清理核任务名称、ID、label及tmpfs；只移除本任务PG/对象容器，两个浏览器服务按PID/父命令停止，端口空闲，未触55440。

### V0.0.41-fix1：PR101首CI失败与最小测试修复（2026-11-10）

PR101候选33e4feaf05704e5f06cc3b62dfde88c501277ff2的CI42650559416 attempt1精确24任务全部结束，22success/2failure。唯一实质失败Web15/job129275592380，原admin-language.test.tsx:40联合用户/角色/矩阵语言case超原30000ms，实际31083ms；该片15文件261项1FAIL/260PASS。foundation/job129285842745日志明确web-tests must be success派生失败；API、四PG及另外15Web均success。16份真实JSON逐份保存，239文件3329项3328PASS/1FAIL、0pending；所有失败原始日志完整下载保留。同head Codex Review completed/无发现，未据此合并或rerun旧CI。

源码证据为该case同时渲染三棵真实管理组件树，重复screen角色查询扫描整个document并计算候选可访问名。父原完整本地6/6、目标case26463ms（总49.92s），不是本地RED；CI超时才是RED。具体云端宿主为何更慢未证，不定性偶发。convenience_web仅在该case增四个test wrapper、within定向查询并缓存原语言trigger；portal选项仍用真实menu/menuitemradio。保同case中文→英文→中文、三真实组件、全部原控件/客户文本断言、原30秒预算及其余5case，不改生产或全局测试配置。修后原完整6/6，目标16003ms（总36.16s），仅报告一次同环境观察，不推断性能保证。

限定SPEC PASS后独立QUALITY PASS，已读实际6/6日志；治理复验38文档/490链接/20来源/161依赖及阶段覆盖PASS。父diff确认API/迁移/生成契约/Web产品/部署与33e4fea一致，原便捷化真实PG/浏览器/轮换/恢复证据保持有效。只同PR101推进fix1，新精确head完整CI及Review、main/部署仍须分别核，不用首轮其他绿片替代新head门禁。

### V0.0.41-fix2：原离页保护测试的异步出口（2026-11-10）

第二候选f0dae0914dc8c7959860627b80f119b8eaee76e4的CI42654844976 attempt1首个实质失败为Web6/job129290571446：UserAdministration.profile.test.tsx:80的matching remote期望beforeunload不拦截(false)，实际true；该片15文件73项1FAIL/72PASS。此处不是超时，也不是新接口失败。先保存完整失败日志，不在剩余任务结束前声称最终计数。

源码归一化计算正确：remote姓名Draft与保留输入` Draft `经trim一致、电话已采用remote，setDirty(false)。输入enabled仅证明busy对应DOM更新，useUnsavedChanges及useNavigationBusy向Provider Set的同步在useEffect，测试立即派发事件不能证明两effect已完成。父原完整8/8本地通过、matching7483ms（总69.64s），未本地复现，不伪造RED；真实RED来自本次CI。convenience_web仅原beforeunload出口包waitFor，每次回调创建fresh事件、派发并保原精确预期。保两场景whitespace=true/matching=false、原字段断言、其他六项及30000ms，未改产品或全局配置。限定SPEC PASS，修后完整及QUALITY由本检查点接续。

第二轮全部24终态最终22success/2failure/0pending，foundation/job129299065569经原日志确认web-tests must be success派生；其余API/四PG/十五Web均success，包含已修语言Web15。profile修后原完整8/8（66.44s）与限定QUALITY PASS，治理38/490/20/161及阶段覆盖PASS；未用本地等待掩盖永久错误，matching若仍阻止会明确失败。第二轮完整日志/16artifact下载的Azure blob连接超时，已从连接器读取具体Web6与foundation原日志及保存完整run/jobs；不声称下载成功，首轮完整16JSON证据保持。fix2只三文件test+两记录，业务源与33e4fea相同，继续同PR新head全量门禁。

### V0.0.41-fix3：main发布阻塞的原导入可见态测试（2026-11-10）

负责人再次明确要求持续推进至上线部署。PR101最终2e9aeb314dc0d518ecc30333ba88b331ece9532a的CI42657970565 attempt1精确24/24 success，原evaluateDeployJobs=full，同head Review completed/无发现；16真实JSON与Git测试清单逐一核239文件3329项全PASS、无重复遗漏/skip/pending/runtimeErrors。父独立premerge复核head/base/main后squash8a6a8bc88e239b3d7c91e93529627e71c1d80704，GitHub整tree与候选相同，未以同树替代新main检查。

新mainCI42660282110 attempt1的Web1/job129309842910实质FAIL：MasterDataImport.authentication.test.tsx:64的request without callback，完整未知批次提示节点已存在但notvisible；该片15文件233项1FAIL232PASS。源码onImported在finally执行，不证明Modal中的Alert可见，组件setUnknown(true)存在且无持续隐藏证据。真实RED来自本次CI；父原本地完整5/5（11.39s）未复现，不能冒称RED或具体云端调度慢因。

新release_import_visibility实施代理仅一行复用waitFor等待原完整提示可见，保原回调边界、API/CSRF次数、全部5case/预算/既有motion:false和产品代码；父修后完整5/5（11.38s）通过，限定SPEC PASS。父由origin/main8a6隔离codex/req0036-convenience-release-fix3，旧V0.0.40同名分支保留未动，用户四dirty原样携带。源功能自33e4fea保持，本地业务/轮换/恢复/浏览器证据按范围有效；只发布阻塞测试返修另开PR接续原Issue97，不能再向已合并PR101推送。main全部终态/自动部署跳过、限定QUALITY、治理及新PR/main/部署按本检查点接续。

main全部24终态实际22success/2failure，foundation129317756113明确web-tests must be success派生；其余15Web/API/四PG均success。自动deploy42662648311/job129317943127 completed/skipped，没有执行SSH或生产迁移。fix3限定QUALITY PASS、完整5/5、归档隔离范围不变；治理首因新test来源摘要未同步FAIL，复核前端指南的鉴权回调边界与本次test语义不变后仅更新该一来源摘要，复验38文档/491链接/20来源/161依赖及阶段覆盖PASS。失败记录不删除、不rerun旧run，新修复PR继续同范围授权直到真实上线。

## 15. V0.0.41 便捷化最终上线核验（2026-11-10）

| 检查点 | 实际结果 |
| --- | --- |
| 修复PR | [PR102](https://github.com/JasonShu0722/QMS-2.0/pull/102)候选34193600f97b3c837a969144cdc7f7a0aedbbcd8；[CI42663249821](https://github.com/JasonShu0722/QMS-2.0/actions/runs/42663249821) attempt1精确24/24 success，同head Review completed/无发现。父独立读取原run/jobs/summary复核full+clear，未用旧head绿 |
| 合并与树 | 合并前再核open/non-draft/mergeable、候选/base8a6与实时main一致，以expected_head_sha约束squash为9fe60f48a7f5db0344553d85fdc049e05c6336d3；GitHub整tree与候选独立比对一致 |
| main | [CI42665525682](https://github.com/JasonShu0722/QMS-2.0/actions/runs/42665525682) push/main/attempt1精确24/24全success，父再次核head/run/attempt及任务全集，evaluateDeployJobs=full；未将PR绿或同tree代替 |
| 完整Web报告 | PR102与新main分别16份真实artifact JSON，均与当前Git测试清单逐一核239文件3329项全PASS，0skip/pending/runtimeError，无漏重；下载原ZIP/JSON及inventory-verified均在Git外 |
| 实际部署 | [deploy42667918837](https://github.com/JasonShu0722/QMS-2.0/actions/runs/42667918837)/job129336426234 attempt1 completed/success、非skip；完整原日志已下载，明确来源RUN_ID42665525682/ATTEMPT1/HEAD_SHA同9fe，Full validation scope |
| 保护与迁移 | 2026-11-09T17:53:53Z明确迁移前加密数据库快照验证成功；17:53:57Z确认144迁移链并实际应用20261109000200_integration_connection_convenience，All migrations successfully applied；不是只查无待迁移 |
| 服务与出口 | API/Worker使用qms2-foundation-api:9fe，Web使用qms2-foundation-web:9fe，日志三服务Healthy；17:54:30Z明确Deployment successful同SHA。Worker稳定READY/公共HTTP/原子deployed-sha由同版强制成功出口核验，未另SSH读marker |
| 独立公网 | 17:55:34Z（台北11-10 01:55），login/OpenAPI/console页面与新资源200；新增connection契约及nullable日期存在；管理GET/connection匿名401 AUTH_SESSION_REQUIRED，编码机器路由无凭据401 INTEGRATION_AUTH_INVALID且头体trace一致。未写生产业务或读取真实秘密 |
| 目标变化 | 发布前connection契约不存在，JS index-B6Iqlx7U.js；发布后connection存在，JS index-DBEs0LhS.js含复制对接配置/永久有效/专用恢复提示。CSS保持index-3kA8cBHz.css符合本轮未改样式；保存实际SHA，不声称Windows/Linux构建字节一致 |
| 记录与清理 | [Issue97结果追加](https://github.com/JasonShu0722/QMS-2.0/issues/97#issuecomment-6747441181)已保存并回读；仍open，未写Base。自有临时PG/MinIO及本地API/Vite已清理，四原dirty差异忽略基线blob头后hunk完全一致；最初全patch字符串因索引base变化比较失败已核原因，不伪称逐字patch相等 |

最终证据Git外req0036-convenience-20261109的final-release-record、main-gates-verified、deployment-log-verified、完整deploy日志、public-final及assets、两轮Web inventory。旧main8a6失败及部署skipped、首两PR失败、真实RED/修后完整结果保留。最终记录只本地归档，不再为无代码变化推送触发部署。

本轮目标完成的是三项便捷能力及实际上线。已存在接口会显示编码URL，旧UUID与旧有限期凭据仍有效；旧hash不可反推原文，需要负责人在页面新建一份默认永久凭据使用反复复制。未代发/分发/撤销生产凭据、启用接口或关闭Issue；当前真实来源协议/业务字段/吞吐、匹配全容量恢复及生产物理设备/人工操作验收保持未覆盖。迁移前本机数据库快照不等于异地/对象灾备，144空日期仍不支持直接回退旧镜像。

## 16. 接口删除交付单元（V0.0.42）

负责人明确增加，复用Issue97与本会话持续集成上线授权，不重复飞书接单或审批。采用设计13节最小逻辑删除，允许复用编码，保留历史与现有配额清理。一个功能PR，独立SPEC后QUALITY，主代理串行真实验证；不实际操作生产删除。

| 任务/写集 | 完成条件 |
| --- | --- |
| A后端实施代理 | integration-admin.dto/controller/service、integration-types、integration-credential.service、inbound.service、新integration-delete.integration-spec.ts；先旧144链HTTP DELETE期待204实际404 RED，随后实现CAS/幂等/事务撤key审计、隐藏所有管理读写/复制入口，历史仍检索，锁等待与同码新建旧key拒绝 |
| B前端实施代理 | ApiIntegrationsPage.tsx/test与integration-ui.ts；先按钮/确认/DELETE原body/失败重试RED，待稳定DTO及生成契约实现。管理权才显示，单确认、pending阻离/双击/其他操作、未知同key重试、scope旧结果隔离，不加新页面或审批 |
| 父公共整合 | 145迁移及Prisma deletedAt、活动接口编码partial unique及INSERT冲突目标、审计label、AdminBody新增生成DTO、生成契约、真实浏览器、文档/API-INTEGRATION及FOUNDATION；旧历史迁移不改。现有唯一不破坏时先做RED，再迁移 |
| 审查/验证/交付 | A/B独立SPEC→QUALITY，真实一次性PG完整API模块及公共parser/审计、Web6完整、真实浏览器删除前后/历史/同码/旧token、构建/契约/归档/Compose/治理。旧有效轮换/恢复按影响复用，新增schema历史兼容/恢复需实际验证；单worker/Node1GiB/PG512MiB，不连55440。提交PR精确head CI/Review→授权合并→新main→真实部署/公网核验，Issue保持开放、结果追加回读，不写飞书或代删生产数据 |

删除字段是内部生命周期事实，公开IntegrationEndpointDto不扩无消费者的deletedAt；删除返回204。旧镜像无法过滤已删接口，不直接回退，优先向前修复；已有删除状态/撤销保留，不通过清空表回退。

### 本地实际验证与失败保留

实现代理delete_backend独占API/新测试，delete_web独占页面/作用域writer/新Web测试；父负责迁移、历史正文helper、审计label、AdminBody/契约、浏览器、备份恢复及文档。delete_spec对后端及Web/公共接缝SPEC PASS，delete_quality独立QUALITY PASS；最后取消可访问名称及测试定位返修亦限定双审PASS。所有重命令父串行，代理未运行服务/测试/build/Git。首次代理路径消息写错导致无效workdir，已明确纠正为活动D路径；误创建的一份测试立即Move到正确路径，未在其它checkout开发，错误过程保留。

Node24.21.0/pnpm11.19.0，准备前可用5.59GiB，一次性PG18/55636、512MiB/1CPU/tmpfs；先144链真实RED：DELETE预期204实际404，1FAIL/13名称过滤，不以新DTO编译错误当RED。随后145迁移/客户端生成成功。新文件首12PASS2FAIL为夹具：匿名请求先被CSRF403(补合法CSRF但无session隔离401)、等待计数只查直接blocker遗漏队列软阻塞(改递归pg_blocking_pids，保2事务/3秒断言)。最终原完整14/14 PASS（15.051s）；邻近10完整文件110/110 PASS（76.5s），含旧管理/凭据/连接复制/接收/并发/检索/清理/观测/parser/审计标签，无skip。

Web新8项RED7FAIL/1PASS，明确缺删除按钮。首GREEN3PASS5FAIL为取消双字可访问名及大DOM查询成本，给取消补aria-label、测试定向既有label/text，不改timeout/motion。次7PASS1FAIL为确认浮层离场后重新查询按钮，缓存首次可见真实节点仍做双击只1DELETE；后续分页英文title不存在、innerbutton无native disabled各次失败如实保留。核安装rc-pagination以根ant-pagination-disabled及handleChange(!disabled)为真实禁用协议，测试断言根禁用后实际点击仍0新增GET，未放宽行为要求。最后新完整8/8 PASS（47.86s），前七文件运行其它六完整51项PASS，组合59项有效。pending fixture finally真实释放，避免失败未决请求影响后case。

恢复演练完整8/8（29.189s）含原负例，证明deleted时间/DISABLED/version、主key撤销及密文、旧收件/计账及同码新接口原样恢复；只证明小样本，旧轮换脚本未改且遍历保留对象，复用原密钥轮换证据。真实marker-only浏览器两完整场景2/2（31s）保原永久复制/编码及UUID重试/204/来源/正文，追加真实操作栏单确认DELETE204、列表移除、未先撤的旧key401、历史payload同文、同码新UUID旧key仍401。浅深与320/390/1440几何沿原第二场景通过，未开trace/video或输出真实秘密。

API/Web build、contracts:generate exit0；新head全量CI/Review、合并及新main/部署分别待核。本地API/Vite已按PID/父命令核后停，MinIO仅恢复期间启动并已按ID/label删除，PG待最终门禁结束再精确清理。Git外证据D:/WorkSpace/QMS-2.0-local/req0036-delete-20261110；[Issue97追加已保存回读](https://github.com/JasonShu0722/QMS-2.0/issues/97#issuecomment-6755169621)。不代删生产接口，不将本地PASS当上线，具体业务/真实来源限制保持。

最终contracts:check明确OpenAPI PASS；Compose基础+扫描+生产config quiet、归档隔离、diff检查均通过。治理38文档/493链接/20来源/161依赖及阶段覆盖PASS，索引只同步DATA-PROTECTION/现有client及恢复验收四处源摘要，消费者复核不改变原协议。PG按精确ID/标签/tmpfs删除回查为空，3136/5186空闲。delete_quality独立读取各实际JSON/完整日志核exit0和上述组合范围，最终QUALITY PASS。远端main仍9fe60f4，开放PR查重为空，当前版本最大V0.0.41-fix3，采用V0.0.42；暂存只本任务写集及源摘要，不混用户四处CodeGraph差异。

### V0.0.42-fix1 发布阻塞的原客诉附件测试（2026-11-10）

PR103候选89aa8471f3b1963dd5546f5451baef3ce3fdedaf经CI42730202802 attempt1精确24/24及同head Review completed/无发现，父独立再核head/base/main后expected-head约束squash为9a22cb63306444969e537852435825d7afe34389，GitHub整tree相同。16份真实artifact JSON与Git清单逐一核240文件3337项全PASS、无漏重/skip/pending/runtimeErrors，原ZIP和inventory保存。未以同tree代main门禁。

新mainCI42732103400 attempt1全部24终态22success/2failure，唯一实质Web3/job129552486252：旧customer-analysis-attachments.test.tsx首case在line53等“扫描通过，可作为证据”缺失，该片15文件297项1FAIL296PASS。foundation129558167346完整日志明确web-tests must be success派生；四PG/API/另外15Web均success。自动deploy42733879410/job129558341683 completed/skipped，未执行生产SSH/145迁移，生产仍旧9fe60f4。

源码可达竞态为AttachmentPanel.complete先observe(PENDING)，upload finally触发refresh；readEffect还会setLoading(true)再Promise.allSettled后false。PENDING文本出现不代表“刷新附件”已enabled，原test立即fireEvent.click可能被disabled忽略，默认findByText等待1秒早于自动poll2秒。实际CI DOM截断未捕获点击当帧，不冒称已本地复现或确定宿主慢因；父原完整5/5（43.34s，首case4192ms）不是RED，真实RED来自mainCI。新实施代理delete_release_fix1只首case缓存真实refresh按钮并waitFor enabled后设置clean和click，保原CLEAN/保存可用/资源/PUT/解析前后全部断言、原mock/motion/timeout，未改产品或CI。

父从origin/main9a22隔离codex/req0036-delete-release-fix1，用户四dirty携带且旧功能分支保持。修后原完整和限定SPEC→QUALITY、治理及新PR/head/main/部署继续本检查点，不rerun旧失败刷绿，不向已合并PR103推送。原删除实现/迁移/契约/浏览器/恢复证据在源码保持时复用。

修后原完整5/5 PASS（32.38s，首case3414ms）及限定SPEC后QUALITY PASS，父核产品API/Prisma/生成契约/删除页面/部署与main9a22相同；治理38文档/494链接/20来源/161依赖及阶段覆盖PASS，diff检查无错误。只本测试+计划/FOUNDATION三文件提交fix1，用户CodeGraph四dirty排除；新PR/head全量CI及Review、main和自动部署实际核验仍待执行。

## 17. 接口删除 V0.0.42-fix1 最终实际发布（2026-11-10）

| 检查点 | 实际结果 |
| --- | --- |
| 修复PR | [PR104](https://github.com/JasonShu0722/QMS-2.0/pull/104)候选4815315087b7a195af9d27f28acbf574bb4f7752，[CI42734768669](https://github.com/JasonShu0722/QMS-2.0/actions/runs/42734768669) attempt1精确24/24 success，同head Review completed/无发现；父premerge独立核head/base/main/mergeable与full集合，不依赖代理口头结论 |
| 合并与树 | expected_head_sha约束squash main d9d2a920f2a79cde20313767c233b753956ba833；GitHub整Git tree与候选独立比较一致，非只比较单文件 |
| 新main | [CI42736298039](https://github.com/JasonShu0722/QMS-2.0/actions/runs/42736298039) push/main/attempt1独立精确24/24 success，原evaluateDeployJobs=full；原Web3失败片本轮success |
| 完整Web | PR104和新main各16份实际artifact ZIP/JSON，逐文件核当前Git测试清单240文件3337项全PASS，无漏重/skip/pending/runtimeError；原PR103同样独立核240/3337 |
| 自动部署 | [deploy42737916279](https://github.com/JasonShu0722/QMS-2.0/actions/runs/42737916279)/job129571581957 attempt1 completed/success、非skip；完整日志已下载，明确RUN_ID42736298039、HEAD_SHA同d9、Full validation scope |
| 快照与迁移 | 台北09:52:27迁移前加密DB快照验证；09:52:31明确145链并实际应用20261110000000_integration_endpoint_delete，All migrations successfully applied。未修改历史迁移或生产数据测试 |
| 服务与出口 | API/Worker同qms2-foundation-api:d9，Web为qms2-foundation-web:d9，日志三服务Healthy；09:52:53 Deployment successful同SHA。稳定Worker READY/公共HTTP/原子deployed-sha由同版强制成功出口支持，未单独SSH读marker |
| 公网独立核验 | 09:55:13台北，login/OpenAPI/console页面及新资源200，DELETE契约/expectedVersion/204存在，管理匿名401；新JS index-ChNX2RB_.js含删除/重试标识，旧index-DBEs0LhS.js已替换，CSS保持符合无样式变更。保存实际SHA，不声称本地/Linux字节相同 |
| 行为/边界 | 真实单确认删除204/列表消失/旧key401/历史payload同文/同码新UUID已由一次性marker-only浏览器证明；公网不执行DELETE、不读取真实秘密，不把匿名读代生产账号人工验收 |
| 记录 | [Issue97发布追加](https://github.com/JasonShu0722/QMS-2.0/issues/97#issuecomment-6756738463)已保存回读，保持open、不写Base。最终事实只本地归档，不为无产品变化再推送触发CI/部署 |

Git外req0036-delete-20261110保留pr104-premerge/tree、d9-main/deploy-verified、完整job日志及deployment-log-verified、public-final与新旧资源、各次Web inventory、本地RED/夹具失败/最终完整日志及cleanup。旧main9a22的22success/2failure、自动deploy skipped及修复依据保持真实历史；未重跑旧run或增加预算刷绿。旧四dirty按hunk核验保留，自有PG/MinIO与本地API/Vite已精确清理，不连接55440。

本轮接口删除开发及实际部署目标完成；负责人刷新页面即可操作，Admin不需额外授新权限。删除仍保留历史正文至原期限，容量不提前释放；需物理清空或回收站恢复另立范围。真实来源字段/协议/吞吐、匹配生产全容量恢复、生产物理设备和人工操作验收未覆盖。145旧镜像不识别删除过滤，不能直接回退，优先向前修复保历史。
