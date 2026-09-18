# 阶段 1 底座验收与交接

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

矩阵记录本次最终验证结果；唯一保留的 FAIL 是在线容器依赖下载超时。PASS 仅针对列出的行为和证据层级，不能扩大成后续业务功能已交付。

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

## 已实现边界与未跑限制

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
