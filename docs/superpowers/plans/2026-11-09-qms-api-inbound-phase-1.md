# API 接入管理一期实施计划

> **面向 AI 代理的工作者：** 使用项目 `qms-superpowers-zh` 路由 `superpowers-zh:subagent-driven-development`，逐任务 TDD、规格审查、质量审查及主代理独立验证。负责人已批准实施；本地重命令按资源约束串行执行，降低负载不等于暂停开发。

**目标：** 公司内部系统经现有公网 HTTPS 向 QMS 推送 JSON，在管理端完成接口配置、机器鉴权、可靠接收和记录检索。

**架构：** 新 `api-integration` 模块拥有接口、凭据和收件数据，复用现有身份权限、审计、密钥保护、网关、PostgreSQL 与 Worker。独立机器接收和人员管理入口，接收回执不代表业务字段校验或业务入库。

**技术栈：** 现有 NestJS、Prisma/PostgreSQL、React/Ant Design、Swagger 生成契约、Nginx 和 Node.js 密码学能力，不新增服务或依赖。

## 当前摘要

| 摘要项 | 当前事实 |
| --- | --- |
| 最后核对与范围 | 2026-11-09，Asia/Taipei；负责人更新状态并明确“继续推进”，user 实时回读 rev363 开发中/P0，目标/五字段范围保持，提出人已由负责人改为舒子杰 |
| 批准与动作授权 | 当前聊天对一期的直接批准及状态更新接续，覆盖实现、验证、独立审查及按持续流程建Issue/验证后PR；不含合并发布、生产配权/凭据分发/接口启用。阶段/提出人/优先级本轮不代改 |
| 本次追加范围 | 负责人要求的逐接口 `returnReceipt` 已实现，默认开启；关闭成功返回 204 空正文，失败仍返回错误，内部收件与防重复保持；真实HTTP及浏览器主链已覆盖双向语义 |
| 整体复核 | 独立策划复核六项缺口已纳入设计/任务；现进入实现、逐项SPEC/QUALITY与真实验证，历史“仅策划”段保留阶段边界，不代表当前未实施 |
| 定位与版本 | [REQ-0036](https://larkcommunity.feishu.cn/record/E126rHft6eSfvQc69Fcc2sl4nQh) / `reczz28XQpffP57y` → [Issue97](https://github.com/JasonShu0722/QMS-2.0/issues/97) → [PR98](https://github.com/JasonShu0722/QMS-2.0/pull/98) / `codex/req0036-api-inbound`。V0.0.40首提交dfc7ba79已推送，main仍badd14b，携纯文档归档c198b8b；同范围CI/审查返修沿用V0.0.40-fix1，不新建PR |
| 源码与工作区 | 主代理已串行新建功能分支；活动checkout原地隔离分支，遵循项目唯一活动位置，不另建E/C回退worktree。原有 `.gitignore`、`AGENTS.md`、`docs/ENGINEERING-TOOLS.md` 及索引来源摘要改动保留，不纳入本期提交 |
| 当前检查点 | PR98最新代码head6efba7485621403aa57a5b4cbc95a8d1c638c350 / CI42584067733 attempt1已24/24全success；主代理用现有evaluateDeployJobs精确核head/run/attempt判full。API163套2381项、四PG分片、独立Worker及Web16分片均通过。fix1本地106unit/37PG与SPEC后QUALITY通过，Codex大写UUID发现已修。首CI20成功4失败真实保留；尚未合并发布/真实来源启用 |
| 重启后资源约束 | 恢复初查约21.8 GiB内存/4.3 GiB可用；负责人再次明确继续开发，降低负载不应停工。重测试/构建同一时刻只一项、单worker、Node默认堆上限1024 MiB；仅按需启动本任务PG并限512 MiB/1CPU，未恢复扫描/对象/邮件服务，不降低门禁。只读审查及独立源码编辑可继续，禁止代理自行启动重命令 |
| 证据与限制 | 已核对实际接缝；Node v24.21.0 / pnpm 11.19.0，治理检查 exit 0；技术参数为建议基线，真实来源样本/吞吐未知；详细文档验证见第 8 节 |
| 下一动作与负责人 | 当前到已获准的PR检查点，负责人决定合并发布后再接续main全量CI、迁移快照/同SHA健康及部署验收；不自动合并、配权或启用来源。最新CI结果仅本地文档归档，避免为记录再次触发同一PR全量CI；交付代码已推送，档案同步状态单列。飞书token_missing未回读/代写，Issue97保持开放 |

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
