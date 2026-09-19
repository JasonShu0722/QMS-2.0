# 底座与 ABC 账号治理验收记录

本文件按时间保留验证历史。前半部分是阶段 1 的原始矩阵（包括当时在线镜像下载 FAIL 和缓存替代验证），不代表当前功能或最新构建状态；ABC API 修订和 Web 回归之后的最新汇总位于文末“ABC 最终聚合与本地交付”。本轮范围仅为 ABC，D–H、批次 3 和原批次 2 深度业务门禁不在本轮完成声明内。

## 范围与执行计划

本记录对应仓库设计 `docs/superpowers/specs/2026-09-18-qms-2.0-redesign-design.md` 和阶段计划 `docs/superpowers/plans/2026-09-18-qms-2.0-phase-1-foundation.md` 的任务 8。仅补充验收、必要底座行为测试与文档；不重做任务 1–7，不修改仓库级阶段计划。

执行顺序：建立矩阵 → frozen install → PostgreSQL 迁移与种子 → 单测 → 构建 → Compose 配置 → 归档隔离 → OpenAPI 同步 → 真实 Playwright → 范围审查 → 规格复审 → 质量复审 → 修复并复验 → 主代理提交。实际运行入口是 `pnpm acceptance:phase-1`，结果逐项输出 PASS/FAIL，缺前置条件或前一步失败时，未运行步骤以 FAIL 和原因输出；不会跳过数据库或浏览器后宣称成功。

运行命令均从 `qms-2.0/` 执行。依赖 Node.js `>=22.22.0 <23`、pnpm `11.19.0`、真实 PostgreSQL 18、Docker Compose、Git、ripgrep 和 Playwright Chromium。验收入口会重新执行 frozen install，真实数据库测试会部署迁移、创建本地演示账号并清理自己的测试记录。只能使用可销毁开发数据库，且不能与其他 Outbox 消费者并行运行。

## 环境与入口

先按照 [README](../README.md) 构建并启动 Compose，等待 PostgreSQL 健康后迁移。网关、API 与 `DATABASE_URL` 必须使用同一套数据库；浏览器用种子账号 `local.internal` / `local.supplier` 真实登录。种子不重置已有密码。

| 变量 | 要求 |
| --- | --- |
| `NODE_ENV` | `development`，仅本机 HTTP 验收 |
| `DATABASE_URL` | loopback PostgreSQL 18 临时数据库，禁止 SQLite |
| `QMS_SEED_INTERNAL_PASSWORD` / `QMS_SEED_SUPPLIER_PASSWORD` | 不同的至少 16 字符口令，与已有本地种子一致 |
| `QMS_ACCEPTANCE_BASE_URL` | loopback Web/Nginx 网关 URL，例如 `http://127.0.0.1:8080` |
| `POSTGRES_PASSWORD` / `QMS_RATE_LIMIT_SECRET` | Compose 所需临时随机秘密 |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | Compose 所需本地对象存储凭据 |
| `COMPOSE_PROJECT_NAME` / 端口变量 | 可选，使用独立项目和未占用的本机端口 |

```powershell
corepack pnpm --filter @qms/web exec playwright install chromium
corepack pnpm acceptance:phase-1
```

浏览器测试也可用 `PLAYWRIGHT_BASE_URL` 单独运行，但聚合验收要求 `QMS_ACCEPTANCE_BASE_URL`。缺 URL、种子密码、浏览器二进制、数据库连接或 Docker Compose 均必须失败。验收脚本不主动输出密码、Cookie、签名 URL；浏览器 trace、视频和截图默认关闭。失败诊断仍可能包含请求上下文，原始日志及临时凭据不入 Git，仅在本文件保存脱敏摘要。

## 验收矩阵

本矩阵记录阶段 1 当时的最终验证结果；该轮保留的 FAIL 是在线容器依赖下载超时。PASS 仅针对列出的行为和证据层级，不能扩大成后续业务功能已交付；ABC 本轮在线镜像结果另见文末。

| 项目 | 行为证据与 PASS 判定 | 可重现命令 | 本次状态 |
| --- | --- | --- | --- |
| 登录分流 | 真实 Chromium → 网关 → API → PostgreSQL；两类账号从同一登录表单进入服务端指定路径，刷新保持会话，跨门户跳转回正确入口 | `pnpm --filter @qms/web test:e2e` | PASS（最终真实浏览器 3 tests） |
| Cookie / CSRF | 浏览器不能读 HttpOnly Session；存储无令牌；缺失/错误 CSRF 返回 403；退出后旧 Cookie 返回 401；生产 Secure 属性由 API HTTP 测试验证 | `pnpm test`；`pnpm --filter @qms/web test:e2e` | PASS（最终自动门禁） |
| 限流与代理 | 真实网关改变伪造 XFF 仍触发 429；另一账号独立。Nest HTTP 测试验证直连忽略 XFF、仅一跳可信、伪造前缀无效、耗尽客户端仍不影响另一客户端 | `pnpm test`；`pnpm --filter @qms/web test:e2e` | PASS（最终自动门禁） |
| 功能权限 | 缺功能权限 403，权限来自会话归属；未实现流程权限按拒绝处理。策略与 Nest HTTP 测试使用受控持久层替身 | `pnpm --filter @qms/api test` | PASS（最终聚合：API 92 项） |
| 供应商允许 / 拒绝 | 真实浏览器 API 请求允许本企业并拒绝真实存在的另一组织参数；HTTP 测试再覆盖供应商 A/B、普通内部人员及跨组织授权人员、重复参数拒绝 | `pnpm --filter @qms/web test:e2e`；`pnpm --filter @qms/api test` | PASS（最终自动门禁） |
| 审计 | 真实 PostgreSQL + Nest HTTP 验证登录失败/授权拒绝自动审计及响应 trace 关联；会话撤销和审计同事务、审计失败回滚、重复撤销不重复记账；附件审计与 Outbox 事务回滚、元数据白名单 | `pnpm --filter @qms/api test:integration`；`pnpm --filter @qms/api test` | PASS（最终聚合集成 9 项、API 92 项） |
| 附件隔离 | 真实 PostgreSQL 中供应商附件 QUARANTINED 禁下载，拒绝扫描结果不改状态，干净结果才能 AVAILABLE，逻辑删除后拒绝下载；MIME/大小/数量由策略测试验证 | `pnpm --filter @qms/api test:integration`；`pnpm --filter @qms/api test` | PASS（最终聚合集成 9 项、API 92 项） |
| Outbox 恢复 | 真实 PostgreSQL 失败重试间隔 1/2/4/8 秒、第五次 FAILED，人工重试重置计数，两个并发 Worker 仅处理一次；已成功事件不能人工重开 | `pnpm --filter @qms/api test:integration` | PASS（最终聚合集成 9 项） |
| OpenAPI 同步 | Swagger HTTP schema 行为测试；从当前 DTO 导出并重新生成类型，字节比较失败即门禁失败，不修改已提交文件 | `pnpm contracts:check`；`pnpm --filter @qms/api test` | PASS（最终自动门禁） |
| 归档隔离 | Git/ripgrep 校验活动配置与源码无旧版引用；workspace/构建结构检查；允许只读边界 Markdown 引用，禁止执行路径接入归档 | `pnpm check:archive-isolation`；`pnpm test` | PASS（含负向注入验证） |
| Compose 配置 | 必填配置齐全，解析五个服务，API/Worker 同镜像；此检查仅证明配置解析，容器运行单独记录 | `docker compose -f deployment/docker-compose.foundation.yml config --quiet` | PASS（最终自动门禁；容器另有实跑证据） |
| 主机构建 | React/TypeScript/Vite 与 Prisma/Nest 构建均 exit 0 | `pnpm build` | PASS（最终自动门禁） |
| 在线容器构建 | 仓库 Dockerfile 在线取得依赖、构建 api/web 镜像均 exit 0 | `docker compose -f deployment/docker-compose.foundation.yml build api web` | FAIL（本次 npm 下载超时，约 275 秒后 error 23） |
| 缓存容器构建 | 校验已缓存依赖镜像锁文件一致，复制当前源码，以 `--network none`、`pnpm install --offline --frozen-lockfile`、`pnpm build` 重建 | 仓库外临时 Dockerfile 与镜像覆盖配置；命令摘要见执行记录 | PASS（主代理确认审计修复后已重建）；不替代在线构建 |
| Compose 实际运行 | Web/API/PostgreSQL/MinIO 启动、API 无公开端口、API/Worker 同镜像、网关 HTTP 可用、Worker 单次正常退出 | README 的 Compose up 命令、`docker compose ... ps -a`、health 请求、浏览器验收 | PASS（修复后容器与最终浏览器均已验证） |

## 本次执行记录（2026-09-18，最终回填）

工作树：`codex/qms-2-phase1-foundation`；任务 8 基线 `2d6f2f83f49ec47c3a6cd9d6f5fb47e9e1125a4c`。Windows PowerShell；主代理提供 Node 22.22.0 / pnpm 11.19.0，临时 PostgreSQL 18.6 端口 55438、网关端口 18088、Compose 项目 `qms2-task8-validation`。Node 24 可能被子进程 PATH 选中；需让 pnpm 的递归 scriptShell 使用相同 Node 22 运行时。临时凭据保存在仓库外，不在本文列值。

| 实际命令 / 动作 | 结果与局限 |
| --- | --- |
| `pnpm --filter @qms/api test --runTestsByPath test/identity/proxy-ip.spec.ts` | 实现代理实跑：1 suite / 5 tests PASS，含新增预算耗尽后客户端隔离；无数据库替代声明 |
| `node --check test/phase-1-acceptance.mjs`；`git diff --check` | 实现代理实跑 PASS；仅脚本语法和补丁格式 |
| `pnpm install --frozen-lockfile` | 主代理回报 PASS；最终聚合入口仍需实跑 |
| 原基线迁移 / seed / integration | 主代理回报 PostgreSQL 18.6 五迁移、种子、原 4 项 PASS；第一次数据库未 ready 失败，健康后重跑通过；不覆盖新增 3 项 |
| 原基线 API 单测 | 主代理回报 89 项 PASS；不代替新增后的最终测试 |
| 审计回归先失败 | 实现代理 `pnpm --filter @qms/api test:integration`：2 failed / 7 passed；实际请求无审计记录、审计失败却仍撤销会话，证实缺陷 |
| 审计接线后集成 | 同一命令 9/9 PASS；真实 PostgreSQL 18 版本断言、HTTP 错误 trace 关联、会话撤销失败回滚全部通过 |
| 审计接线后 API 验证 | `pnpm --filter @qms/api test` 13 suites / 90 tests PASS；`pnpm --filter @qms/api build` PASS。之后追加两条审计不可用受控 500 测试待完整门禁覆盖 |
| 最终聚合入口 | 主代理 `corepack pnpm --dir qms-2.0 run acceptance:phase-1` exit 0：frozen install、迁移/种子、真实 PostgreSQL 9/9、API 13 suites / 92 tests、Web 19 tests、structure 1 项、构建、Compose 配置、归档、契约和真实浏览器 3 tests 全部 PASS |
| 在线 `docker compose ... build api web` | 主代理回报 FAIL：npm 依赖下载超时，约 275 秒后 error 23；不能记为成功 |
| 锁文件一致的缓存镜像离线复制当前源码并重建 | 主代理回报审计修复后当前源码 PASS：`docker build --network none ...`，临时 Dockerfile 内执行 `corepack pnpm install --offline --frozen-lockfile`、`corepack pnpm build`；依赖镜像与工作树锁文件 SHA-256 一致。当前源码容器证据不表示干净网络在线构建成功 |
| Compose 实跑（审计修复前） | 主代理回报 api/postgres healthy、web/minio running、worker exited 0；API port bindings 为空；API/Worker 同镜像；网关 OpenAPI、SPA、MinIO health 均 200 |
| Compose 实跑（审计修复后） | 主代理回报 api/postgres healthy、web/minio running、worker exited 0，API/Worker 都更新至本次新建镜像；MinIO health 200；最终聚合已通过 |
| 真实 Playwright（审计修复前） | 主代理回报 3/3 PASS；后续拒绝测试改用真实存在的另一组织 ID，随最终门禁复跑 |
| 缺失数据库配置负向门禁 | 主代理确认移除 `DATABASE_URL` 后聚合脚本 FAIL / exit 1，无 skip |
| 归档隔离负向注入 | 主代理创建独立临时 probe，包含归档 import；仅执行 checker 得 FAIL / exit 1，未执行 probe 或归档代码；删除 probe 后 PASS，归档 diff 为空 |
| 聚合验收 | `corepack pnpm --dir qms-2.0 run acceptance:phase-1` exit 0：8 项 PASS；frozen install 1s、PG migration/seed/integration 30s、test 64s（structure 1 + API 92 + Web 19）、build 41s、Compose config、archive 4s、contracts 22s、真实 browser 3 tests 15s |
| Compose 生命周期 | 修复后缓存镜像实际运行 PASS：api/postgres healthy、web/minio running、worker exited 0、API/Worker 同镜像且 API 无宿主端口、MinIO health 200、网关 OpenAPI/SPA 200 |
| 规格复审 / 质量复审 | 主代理在提交前执行；本记录只保存最终证据，不以测试通过代替范围与文档审查 |

## 阶段 1 当时的边界与限制（历史）

- 附件仅提供元数据策略、生命周期服务与 S3 兼容地址适配边界；没有公开上传/下载 API、签名上传、真实病毒扫描、对象版本保护或附件 UI。集成测试的扫描结果是受控输入，不代表运行防病毒服务。
- 审计具备事务写入和元数据白名单，已接线登录失败、会话撤销、已认证授权拒绝与附件初始化。密码重置/权限修改/MFA 尚无接口，CSRF/限流/未认证拒绝也未纳入本次自动审计覆盖；不能用 `SECURITY_AUDIT_ACTIONS` 常量断言替代行为证据。
- Outbox 有数据库领取、租约、有限重试、失败状态和服务级人工重试；Worker 当前没有业务 handler，单次启动不领取事件并退出 0。不存在常驻轮询、通知投递或管理重试 UI。
- 流程权限尚未启用，要求流程权限的动作拒绝；没有编号服务、公共问题索引、业务流程运行时或业务闭环。导航中的业务名称是入口占位。
- 生产 TLS、管理员 MFA、密码重置全流程、备份恢复演练和真实对象存储上传仍不能由此次本机底座验收证明。具体边界见 [SECURITY](SECURITY.md)。

## 范围审查与批次 2 起点

```powershell
rg -n -i 'supplier.?quality|problem.?index|bpmn|react.?flow|ZXPR|8D|简报|compat' apps packages deployment package.json
rg -n '^model |^enum ' apps/api/prisma/schema.prisma
git diff --stat
```

审查匹配语义：允许导航标签、占位路由、阶段边界说明和非业务测试示例；不允许借此引入供应商质量专属业务字段、编号、公共问题索引、BPMN/React Flow 设计器、简报/8D 或旧系统兼容层。归档 Markdown 引用只用于边界说明，不能据此在归档构建、测试、安装或修复。

实现代理本次 `rg` 范围审查仅命中供应商质量导航标签/占位路径及 S3CompatibleObjectStorage 的标准协议名称；Prisma 仅含组织、用户、角色权限、会话、审计、附件与 Outbox 十个底座模型，无上述业务模型。S3 兼容适配不是旧系统兼容层，合法导航和边界说明保留。新增安全审计是验收发现的底座缺陷补修，主代理确认范围后实施；未添加密码重置或权限修改接口。

批次 2 从新批准的“问题与流程平台”设计/阶段计划开始：明确薄公共索引与领域所有权、编号不变性、受控节点及不可变流程版本、运行权限、幂等/乐观锁/事务边界；然后设计待办通知、台账个人视图、处理空间及报告追溯。先消除本矩阵未通过项，再建立这些能力的真实测试。供应商质量专业业务闭环属于后续批次 3，不在任务 8 实现。

## ABC API 安全修订验证（2026-09-18 本地 / 2026-09-19 UTC）

本节保留 API 修订时的阶段证据：B/C 管理 API 和一次性重置 API 已实现，功能权限改为选定目标组织；当时管理员 Web 界面与完整浏览器聚合尚未完成。后续 Web 实现和本轮最终状态见文末，不能据本节单独宣称 ABC 产品验收完成。

环境：独立工作树 `codex/qms-2-admin-foundation`，Windows PowerShell，Node 22.22.0（`corepack pnpm exec node --version` 实测）、pnpm 11.19.0，临时 PostgreSQL 18.6 / 本机 55442。凭据从仓库外临时 XML 加载，未写入代码或本文；原有 local seed 账号密码保持不变。首次红灯启动时数据库尚未迁移，先得到缺表错误；部署既有迁移后重新运行才作为有效缺陷证据。

| 实际命令 / 动作 | 结果与范围 |
| --- | --- |
| 新 `admin-security-schema.integration-spec.ts`，修复前实跑 | FAIL：5 条分别复现目标组织越权、非法 UUID 导致 500、创建重放失败、重置 DTO 缺失、跨组织同名被接受 |
| C 全局角色移除 / 拒绝审计新增单测 | FAIL：2 条新增失败，旧 20 条通过；接入公共事务与全局角色拒绝后通过 |
| A 原子资料审计 / 密码 CAS / 有效会话新增单测 | FAIL：3 条复现旧行为，修复后通过 |
| B 全局角色迁移旁路 / C 升权后旧重置凭证 | FAIL：原行为返回 200 / 204；补同事务拒绝和凭证失效后通过 |
| 重置兑换限流伪 Cookie 回归 | FAIL：第 31 个不同假 Cookie 仍放行；改为用途前缀 + resetId + IP 后通过 |
| `pnpm --filter @qms/api test`（加载临时 PG） | PASS：31 suites / 221 tests；现有两个 problem-index integration 文件仍由该入口运行，因此本次提供真实 PG，没有跳过或 SQLite |
| `pnpm --filter @qms/api test:integration` | PASS：12 个迁移部署、seed 保持既有密码，3 suites / 36 tests；新增 21 条覆盖真实授权、迁移、幂等、并发、一次性重置、审计回滚、邮箱冲突及 A 密码 CAS |
| 新 PG 安全套件 + C service + 重置限流定向测试 | PASS：3 suites / 44 tests，含成功重放不重复审计、并发消费只成功一次、全局角色旁路拒绝和升权后旧凭证失效 |
| 移除 `DATABASE_URL` 后运行新 PG 安全套件 | 预期 FAIL / exit 1：明确提示需要 PostgreSQL 配置，0 tests 执行，没有静默跳过或数据库替代 |
| `pnpm contracts:generate`；`pnpm contracts:check` | PASS：Swagger 导出和生成类型同步，包含组织目录、typed organization、B/C 幂等头及重置签发/兑换 DTO；生成脚本同时完成 API Prisma/Nest 构建 |
| `pnpm --filter @qms/web test`；`pnpm --filter @qms/web build` | PASS：5 files / 20 tests，TypeScript/Vite 构建通过；已有 Ant Design 废弃属性提示，不影响结果 |
| `pnpm check:archive-isolation`；`docker compose -f deployment/docker-compose.foundation.yml config --quiet`；`git diff --check` | PASS；仅配置解析和归档/格式隔离，不冒充新容器部署或真实浏览器验收 |

限制：本修复代理未实现管理员 Web 页面、未运行更新后的 `acceptance:phase-1` 或真实网关浏览器主链路；由主代理在 UI 完成后执行最终聚合验收。本节不修改或重新认定既有阶段 2 工作流运行时、Worker、MFA、对象存储和生产治理的交付状态。新 migration 遇到历史用户名格式或大小写唯一冲突会明确失败，不删除既有数据。

### ABC 复审补修：主组织迁移（2026-09-19 UTC）

真实 PostgreSQL 红灯复现：问题负责人和通知接收人迁移得到 200 并级联修改业务组织，流程任务办理人迁移得到 500；三个复合外键均为 CASCADE，竞态 P2003 未映射。新增迁移 `20260919010000_restrict_business_user_transfer` 改为 RESTRICT，管理事务在主组织变化时检查三种业务引用，返回 `ADMIN_USER_ORGANIZATION_IN_USE`（409）并记录拒绝审计。

- `corepack pnpm --dir qms-2.0 --filter @qms/api test:integration`：PASS，13 个迁移和 seed，3 suites / 40 tests。新增三类引用均验证用户、业务组织、角色、会话和重置凭证原样保留，无成功审计及幂等记录；直接 SQL 也无法迁移。相同主组织的邮箱编辑和停用继续成功。
- `corepack pnpm --dir qms-2.0 --filter @qms/api test`（加载同一临时 PG）：PASS，31 suites / 223 tests；包括竞态 P2003 映射与拒绝审计回归。
- `corepack pnpm --dir qms-2.0 contracts:generate`：PASS，API 构建及新增错误代码生成完成。
- `corepack pnpm --dir qms-2.0 contracts:check`：PASS，新增错误代码无契约漂移；`git diff --check`：PASS。

本次仍只修复账号主组织迁移安全边界，不代表管理员 UI 或 ABC 整体验收完成。测试环境沿用本节临时 PostgreSQL，最终由主代理统一销毁。

### ABC 复审补修：登录与安全变更竞态（2026-09-19 UTC）

沿用 Windows PowerShell、Node 22.22.0、pnpm 11.19.0、临时 PostgreSQL 18.6 / 55442。环境从仓库外 XML 注入进程，不打印或提交凭据。登录在 Argon2 校验后获取用户 `FOR UPDATE` 行锁，在同一事务内重新核对 ACTIVE 状态、已验证密码哈希、主组织和账号类型并创建会话；身份已变化时返回既有 `AUTH_INVALID_CREDENTIALS`（401），记录失败审计且不清除失败限流记录。成功限流记录延后至会话事务提交。

| 实际命令 / 动作 | 结果与范围 |
| --- | --- |
| `node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand test/identity/admin-security-schema.integration-spec.ts --testNamePattern='verified login\|login session that commits'`（API 目录，修复前） | 有效 FAIL：暂停已完成真实密码校验的登录，完成一次性重置、A 改密、停用、主组织或类型变化后放行；五条均预期 401 实得 200。先登录提交后重置的反向顺序一条 PASS |
| 同套件与 `test/identity/auth.e2e-spec.ts` 定向运行（修复后） | PASS：2 suites / 45 tests；五条竞态返回 401、没有新会话 Cookie、没有新增有效会话、失败审计存在且未记录登录成功 |
| 新 `holds the user lock` 回归，临时仅移除 `FOR UPDATE` | 有效 FAIL：独立 PostgreSQL 事务可在最终身份校验后、会话插入前修改密码。恢复锁后该写入触发真实 lock timeout，会话提交后写入恢复；不以普通事务重新读取替代行锁 |
| `corepack pnpm --filter @qms/api test:integration`（恢复锁后） | PASS：13 个迁移、seed，3 suites / 47 tests；新增七条覆盖五类身份竞态、先登录后重置撤销、锁持有至会话提交 |
| `corepack pnpm --filter @qms/api test`（同一临时 PG） | PASS：31 suites / 223 tests |
| `corepack pnpm --filter @qms/api build`；`git diff --check` | PASS；无 API DTO / OpenAPI 变更，无生成契约修改 |

组织和账号类型并发夹具通过真实 PostgreSQL 事务写入并撤销会话；一次性重置和停用走 HTTP，A 改密走实际 IdentityService。锁测试首次断言误用了旧 Prisma 错误元数据形状，修正为实际 adapter 的 lock timeout 错误后再移除锁取得上述有效红灯。完整 Web、Compose、契约和网关浏览器聚合验收由主代理在最终源码镜像上执行，本节不将针对性修复验证视为全部 ABC 验收。

### ABC Web 复审补修：角色差异 PATCH（2026-09-19 UTC）

环境：同一独立工作树，Windows PowerShell，显式使用 `C:\Program Files\nodejs\node.exe`（22.22.0）运行 Web 本地 CLI。角色编辑使用生成的 `UpdateAdminRoleDto` 只发送变更字段；权限按集合比较，顺序变化和完全未修改均不发 PATCH。纯改名不再误触发服务端权限重建及成员重置凭证失效，也不会覆盖其他管理员并发修改的权限。无 API 或生成契约变更。

| 实际命令 / 动作（Web 目录） | 结果与范围 |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run src/features/admin/admin-interactions.test.tsx -t 'submits only changed role fields'`（修复前） | 有效 FAIL：4 条分别复现纯改名携带权限、未改仍写、权限更新携带名称、仅顺序变化仍写 |
| `node node_modules/vitest/vitest.mjs run src/features/admin/admin-interactions.test.tsx`（修复后） | PASS：10 条；另定向运行顺序回归，DOM 明确验证已重排，仍不写请求 |
| `node node_modules/vitest/vitest.mjs run` | PASS：9 files / 40 tests；已有 Ant Design 废弃属性提示 |
| `node node_modules/typescript/bin/tsc -b`；`node node_modules/vite/bin/vite.js build` | PASS；已有 Ant Design chunk 超过 900 kB 提示 |
| `git diff --check` | PASS |

主代理聚合发现凭证标签同时匹配 dialog 和 textarea 的实际失败，组件测试改用精确 textbox 角色定位，纳入以上 40 条通过结果。浏览器重置场景已扩展为真实成员分配、签发凭证、UI 纯改角色名、匿名兑换和拒绝重放；秘密仅保留内存，断言不输出秘密，关闭 failure DOM 快照及 trace/screenshot/video。该新增浏览器场景和最终镜像完整聚合验收由主代理运行，本节不将尚未执行的浏览器回归标记为通过。

### ABC Web 复审补修：保存期间创建入口（2026-09-19 UTC）

环境：同一独立工作树、Windows PowerShell，显式使用 `C:\Program Files\nodejs\node.exe`（22.22.0）运行 Web 本地 CLI。用户和角色保存尚未返回时，即使关闭编辑弹窗，顶部创建入口也保持禁用；成功或失败返回后恢复，允许新建并输入。生产变更仅为两处创建按钮添加 `disabled={busy}`，避免旧保存响应清空后开的表单。

| 实际命令 / 动作（Web 目录） | 结果与范围 |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run src/features/admin/admin-interactions.test.tsx -t 'blocks creating'`（修复前） | 有效 FAIL：用户/角色两组分别覆盖 200 和 409，共 4 条均因关闭待保存弹窗后创建按钮未禁用而失败 |
| `node node_modules/vitest/vitest.mjs run src/features/admin/admin-interactions.test.tsx`（修复后） | PASS：14 条，包含 4 条新回归；验证待响应时无法新建，响应后可打开新表单并输入 |
| `node node_modules/typescript/bin/tsc -b`；`node node_modules/vite/bin/vite.js build` | PASS；保留既有 Ant Design chunk 超过 900 kB 提示 |

主代理另报告完整浏览器聚合中 foundation 两条用例因仍断言旧标题 `QMS 2.0` 而失败；本次仅将该 heading 断言同步为现有登录页的 `账号登录`，保留后续真实登录、scope 与退出链路。其定向浏览器复验、最终源码全量和新镜像验收由主代理执行；本节不认定 ABC 整体交付完成。

## ABC 最终聚合与本地交付（2026-09-19 UTC）

结论：ABC 功能与最终验收 PASS，产品源码已本地合并，未 push。A 两门户邮箱/改密/有效会话与撤销，B 管理用户创建/查询/邮箱编辑/启停/受控组织类型迁移/一次性重置签发与兑换，C 组织角色 CRUD/复制/只读目录/角色分配/权限矩阵均有 API、生成契约、页面和验证证据。入口为 `/app/account`、`/supplier/account`、`/app/admin`、`/reset-password`。E 盘依赖安装 FAIL、临时文件清理被自动审批阻止，作为环境限制保留；不能将本轮写成全部清理完成。

源码：独立工作树 `codex/qms-2-admin-foundation`；API 双阶段复审通过于 `efcf56c`，Web 双阶段复审通过于 `75b35034c32fba1c4ed1dc27dcdf111da1ded137`。最终产品与测试源码为后者；本地 main 已以 `9bccf614e47d6b764a564d20254d41649c626ff1` 合并，完整产品树与 `75b3503` 比较无差异，开发分支也已快进至该合并提交。文档规格与质量复审均 PASS，本文档收口单独提交后由主代理同步 main。环境：Windows、PowerShell 7、Node 22.22.0、pnpm 11.19.0、Docker 29.8.0、PostgreSQL 18.6、Playwright 1.63.0 / Chromium 153.0.8010.12。

临时验证项目 `qms2-abc-validation`：PostgreSQL 55442、MinIO 19042 / console 19043、网关 18092；API 与浏览器使用同一临时数据库，`NODE_ENV=development` 仅支持 loopback HTTP 验收。原始日志、临时环境 XML/Compose override 和诊断材料保存在仓库外 `%TEMP%/qms-abc-validation`；本文只记录脱敏结果。用户本地预览属于另一项目 `qms2-local-preview`（PostgreSQL 55440、MinIO 19040/19041、入口 5173），不能随验收资源清理。

Windows 运行时修正：系统 fallback `pnpm.cmd` 曾选择 Node 24；临时 Corepack 生成的 `.cmd` 又受本机透明加密影响无法被 cmd 读取。最终把仓库外临时 Corepack PowerShell shim 放在 PATH 前，设置 `pnpm_config_script_shell` 为 PowerShell 7 的实际路径、`pnpm_config_engine_strict=true`，并使用 Node 22.22.0 运行时；递归安装/测试/构建无 engine warning 才纳入本轮证据。临时脚本和秘密不提交。宿主 frozen install 使用已有依赖与缓存，不能宣称冷安装。

| 实际命令 / 动作 | 已确认结果与限制 |
| --- | --- |
| `pnpm --filter @qms/api test:integration`（API 安全补修最终轮） | PASS：13 迁移、真实 PG 18.6，3 suites / 47 tests；组织范围、迁移引用保护、一次性重置/并发、事务审计、密码 CAS、登录用户行锁均含行为证据 |
| `pnpm --filter @qms/api test`（同临时 PG） | PASS：31 suites / 223 tests；其中原有 problem-index integration 文件要求真实 PostgreSQL |
| Web 角色差异 PATCH 全量与最后创建按钮定向回归 | 前轮全量 9 files / 40 tests PASS；最后定向 14 tests PASS（新增 4 条红绿）；最终源码聚合全量 9 files / 44 tests PASS |
| 早期 `pnpm acceptance:phase-1` | FAIL：Web 凭证标签同时匹配 dialog 和 textarea；测试改用精确 textbox 角色定位后全量通过，历史失败保留 |
| 先前真实网关浏览器全量 | 8/10 PASS、2 FAIL：新增 ABC 6 条全部通过，foundation 2 条仍使用旧登录页标题；`75b3503` 将标题断言同步为 `账号登录` 后，最终源码全量 10/10 PASS（38.3 秒），包含 foundation 3、ABC 6、登录页 smoke 1 |
| 最终源码首次两次聚合 PG 步骤 | FAIL：一次 beforeAll、一次并发重试测试超过既有 5 秒时限；第二次无并行镜像构建仍失败，未直接调宽超时或跳过用例 |
| 上述 PG 失败诊断与定向复验 | Docker Desktop VM 占用约 8 GiB，其中文件缓存约 6.6 GB，Windows 可用内存约 0.81 GiB。停止本次闲置 BuildKit、同步后释放 VM 文件缓存，未删除数据库数据；Windows 可用恢复约 6.65 GiB。原 PG 专套 32/32 PASS（12.321 秒），随后最终聚合 PG 3/47 PASS（14.414 秒）、API 31/223 PASS（26.299 秒），后续 phase-1 全步骤通过；未改测试时限 |
| `docker compose -p qms2-abc-validation -f deployment/docker-compose.foundation.yml build api web`（按服务构建） | PASS：API `efcf56c` 与最终 Web `75b3503` 均使用仓库 Dockerfile 在线下载 npm 依赖并构建；基础层缓存不等于离线，未使用本轮 offline fallback。Web 最终镜像 `cf56b571d58c243798cb91c89169851a90d536fe95f84ad6c4477d292da3adb1` |
| Compose 运行与存储 health | 已确认 API/PostgreSQL healthy、API 无宿主 port bindings、API/Worker 同镜像、MinIO health 200；最终 Web 镜像已 up。Worker 无业务 handler，单次 exit 0 符合底座行为，不代表通知业务完成 |
| 最终 `pnpm acceptance:phase-1` | PASS / exit 0：frozen install、13 迁移/seed/真实 PG 3 suites / 47 tests、structure 与 contracts-package 共 2 tests、API 31 suites / 223 tests、Web 9 files / 44 tests、Web/API 构建、Compose 配置、归档隔离、contracts:check、真实浏览器 10/10 全部通过；源码 `75b3503`、同库运行网关 |
| 随后 `pnpm acceptance:phase-2` | PASS / exit 0：API 31 suites / 223 tests、Web 9 files / 44 tests、contracts:check、归档隔离和构建通过；phase-1 → phase-2 顺序聚合整体 exit 0。仅按该脚本实际覆盖的四个步骤判定，不扩写为原平台全功能验收 |
| 独立 `NODE_ENV=production` 构建 | PASS / exit 0；保留已有 Ant Design chunk 大小警告。聚合宿主为 development，此次另行设置 production 并完成构建，不以聚合步骤名称代替真实环境 |
| 本地 main 产品合并 | PASS：既有 main 历史合并造成 ff-only 不成立，确认无独立产品树改动后执行本地 no-ff 合并，提交 `9bccf614e47d6b764a564d20254d41649c626ff1`；与 `75b3503` 的完整树差异检查 exit 0。未 push |
| E 盘 `corepack pnpm --dir qms-2.0 install --frozen-lockfile` | FAIL：默认布局缓存跨盘复制 933 包后报 EISDIR，实测 E 盘为 exFAT，不支持所需符号链接；进程级 `pnpm_config_node_linker=hoisted` 两次重试均在 966/970 报 EPERM rename，分别涉及 class-validator、@prisma/studio-core。未修改 lockfile 或提交配置，停止重复安装；downloaded 0 不表示安装成功或完成离线验收 |
| 保留的 local-preview PostgreSQL 迁移与 seed | PASS：55440 数据库部署本轮新增 2 个迁移，总计 13 个；seed 成功，所有既有用户密码摘要前后相等，检查不输出摘要或凭据。未在用户保留数据上运行破坏性浏览器 fixture |
| 5173 本地预览恢复与轻量验证 | PASS：从已验收 NTFS 工作树的默认 isolated 依赖、各 app 自身 CLI，以 Node 22 启动 API/Vite。首次 API 编译未完成时 HTTP 500，启动完成后 `/login`、`/app/account`、`/app/admin`、`/reset-password`、`/api/v1/openapi.json` 均 200；schema 包含 admin organizations/users/roles 和 reset complete，匿名管理请求 401。另用真实 Chromium 验证登录页“账号登录”和重置页“重置密码”标题，exit 0 |
| 验证 Docker 资源清理 | PASS：`qms2-abc-validation` 的 5 容器、2 数据卷及网络已 down，按 project 标签查询无残留；本次 API/Web 镜像标签已删除。标准 BuildKit 缓存和其他用户资源保留，local-preview PostgreSQL/MinIO 继续运行 |
| 临时文件清理 | 受阻，未完成：对已核验绝对路径的递归删除、已列出 `.last-run.json` 与空目录删除、临时目录删除均被自动审批拒绝（`blocked by policy`，无更具体原因）。未绕过限制；仓库外 `%TEMP%/qms-abc-validation`（环境 XML、原始日志、临时 shims 等）与工作树 `qms-2.0/apps/web/test-results/.last-run.json` 仍保留且不入 Git。临时验收数据库已销毁，其测试凭据不可再用于该环境 |

**当前预览目录与 main 不同：** `http://127.0.0.1:5173` 的 API/Vite 进程工作目录来自 `C:\Users\29591\.codex\worktrees\qms-admin-foundation\QMS`；本地源码已经合入 `E:\WorkSpace\QMS` 的 main，但编辑 E 盘文件不会触发此预览热更新。预览运行期间需保留该 NTFS 工作树及依赖，不能将 E 盘失败的安装描述为可用。未来可把项目、开发工作树和 pnpm store 放在同一 D 盘 NTFS 布局以复用硬链接；这是后续建议，本轮未迁移项目或数据。完整 10 条浏览器验收使用已销毁的独立验证库，本地保留数据仅运行上述无破坏性检查。

ABC 六条浏览器行为分别为内部个人资料/改密/其他会话撤销、供应商邮箱恢复与内部入口拒绝、用户创建/搜索/差异编辑/启停、角色 CRUD/复制/分配/矩阵/在用删除拒绝、只读账号 UI 与 API 写入拒绝、签发凭证后纯角色改名及匿名一次兑换/拒绝重放。凭证只保留内存，trace、截图、视频和 failure DOM 快照关闭，断言不输出秘密。原 `phase-2.spec.ts` 只检查登录页 URL；即使该条通过，也没有验证完整平台工作流。

本轮不启动 D–H 或批次 3。ABC 验收后可由用户另行分配治理任务及批次 3 非生产开发；真实供应商试点须具备 D 通知/配置、E MFA/完整找回与重置策略/高风险保护、G TLS/密钥/对象存储/备份恢复、H 导出/保留/国际化/可访问性，以及原平台流程运行时、业务 Worker handler 和完整业务浏览器主链路的深度门禁。阶段 1 附件/Outbox 服务边界与 ABC 通过都不能替代这些能力。
