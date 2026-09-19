# 批次 2 执行记录

工作树：`C:\Users\29591\.codex\worktrees\qms-2-batch-2-platform\QMS`；分支：`codex/qms-2-batch-2-platform`；用户指定基线：`2e3ca22`。执行日期：2026-09-18。

## 任务 1：基线

主代理执行并记录：冻结依赖安装 934 包 PASS（40 秒）；`corepack pnpm --dir qms-2.0 test` PASS（structure 1、API 13 suites / 92 tests、Web 4 files / 19 tests）；`build` PASS（contracts、API、Web）；`contracts:check` PASS；`check:archive-isolation` PASS。空记录提交 `ef9e66a`，父提交 `2e3ca22`，规格与质量审查 PASS。

主命令环境为 Node 22.22.0、pnpm 11.19.0；早期递归命令出现过 Node 24.19.0 engine 警告。任务 1 未宣称 PostgreSQL、浏览器或 Compose 完整验收完成。

## 任务 2：共享契约与架构修正

初始实现提交 `d6ff813`，前次修正提交 `6d9ed6b`。本次恢复单向契约：API 独占枚举与固定错误消息，`PlatformTypesDto` 通过 Swagger extraModels 参与在线与离线 schema 导出；前端 contracts 仅导出生成 schema 派生类型。领域码采用 string，测试示例为 `neutral-test`，不预设业务分类、不增加业务 HTTP 入口。任务 2 实现已验证，待主代理复审。

所有下列命令从仓库根目录执行；命令前加载仓库外临时环境脚本，脚本携带本地配置，不提交或打印其内容。验证顺序执行 Prisma generate，避免 Windows 文件锁冲突。单独确认 `node --version` 为 v22.22.0、pnpm 为 11.19.0；针对性绿灯前依赖重新链接时仍出现过 Node 24.19.0 engine 警告。

| 验证命令 | 实际结果 |
| --- | --- |
| `corepack pnpm --dir qms-2.0 --filter @qms/api test -- platform-error-contract.spec.ts platform-error-http.spec.ts contract-direction.spec.ts openapi.spec.ts`（实现前） | FAIL：2 suites failed / 2 passed；3 tests failed / 25 passed。捕获 API 对 contracts 的依赖、contracts 运行常量、OpenAPI 缺失平台枚举 schema。新增真实 HTTP 安全/trace 回归在现状通过。 |
| 同一针对性命令（实现后） | PASS：4 suites / 28 tests。 |
| `corepack pnpm --dir qms-2.0 contracts:generate` | PASS；生成 `packages/contracts/src/generated/api.ts`。 |
| `corepack pnpm --dir qms-2.0 --filter @qms/api test` | PASS：16 suites / 119 tests。此命令排除真实 PostgreSQL schema 集成测试。 |
| `corepack pnpm --dir qms-2.0 --filter @qms/api lint` | PASS。 |
| `corepack pnpm --dir qms-2.0 contracts:check` | PASS；生成结果无漂移。 |
| `corepack pnpm --dir qms-2.0 --filter @qms/web lint` | PASS。 |
| `corepack pnpm --dir qms-2.0 check:archive-isolation` | PASS。 |
| `node qms-2.0/apps/api/node_modules/typescript/bin/tsc --noEmit -p qms-2.0/apps/api/tsconfig.spec.json`（额外检查） | FAIL：未修改的 audit、authorization、database、file-management、identity、outbox 测试存在 `@jest/globals` 解析及测试类型错误；新增契约测试没有报告类型错误。未把无关测试修复混入任务 2。 |

HTTP 回归使用真实 Nest 应用、全局异常过滤器和 Supertest，验证全部受控代码的固定消息、同请求 trace 一致、不同请求 trace 不同、未知代码降级、HTTP 500 和非 HTTP 异常的通用响应。异常原始 message/fields 不回显；现阶段过滤器默认空 fields，安全字段构造函数的既有能力与测试保留。

完整底座 PostgreSQL、网关登录、浏览器、Compose 及批次验收尚未在此任务声明通过，由主代理统一执行并记录；当前测试不替代这些证据。

## 最终交接记录

最终提交：`2b310ab2886a08a83d97d17dfd25557259d66e7f`。

任务状态：1 PASS 基线；2 PASS 契约；3 PASS PostgreSQL 模型；4 PASS 编号；5 PASS 薄索引；6 PASS 流程定义；7 PASS 运行时最小实现；8 PASS 任务/通知最小边界；9 PASS 查询 API；10 PASS OpenAPI/Web 请求层；11 PASS 问题中心/待办页面；12 PASS 流程设计器页面；13 PASS 工作空间页面；14 PASS 浏览器夹具（真实网关未运行）；15 PASS 自动验收命令/文档；16 PASS 范围复审与交接。

验收摘要：`pnpm test` 23 suites/158 API tests + 19 Web tests PASS；真实 PostgreSQL 18.6 集成覆盖 10 平台表、编号、索引与流程定义；`build`、`contracts:check`、`check:archive-isolation`、Compose `config --quiet` PASS；`acceptance:phase-2` 在 disposable 环境 PASS。缺少 `DATABASE_URL` 时 acceptance 明确失败。Playwright 真实登录、Worker 租约/失败重试和 Node 22 递归构建需在配置齐全的发布环境重跑。

任务 1–16 的实现提交已完成于隔离分支 `codex/qms-2-batch-2-platform`；任务 15 的 `acceptance:phase-2`、Playwright 夹具和任务 16 复审文档已提交。任务 8、14 的深度浏览器/Worker 证据仍受环境配置限制，不能以跳过代替通过。

已通过：真实 PostgreSQL 18.6 迁移/种子与平台集成（10 张表、编号、问题索引、流程定义）、API 23 suites/158 tests、Web 19 tests、Web/API 构建、contracts:check、archive isolation、Compose config。`acceptance:phase-2` 在 Node 22 环境实际 PASS；递归 pnpm 输出 Node 24 engine warning，需以 Node 22 重跑作为发布环境证据。

未运行或受限：真实登录主链路 Playwright（缺 `QMS_PHASE2_BASE_URL` 和运行网关）、完整待办 Worker 租约/失败重试集成（任务服务为最小边界实现）。清理：本次临时 PostgreSQL/MinIO 容器由执行环境保留，交接前应运行 `docker compose -p qms2-batch2-validation down --volumes --remove-orphans`，并删除仓库外临时环境文件。

批次 3 起点：以现有薄问题索引和受控流程为基础建立供应商质量试点；前置条件是浏览器登录证据、Worker 真实租约/失败队列、权限与数据范围验收全部补齐。批次 4 其他域需复用稳定 OpenAPI/权限/审计/编号/流程运行时，不得复制通用业务大表单或引入 QMS 1.0 兼容层。
## 批次 2A 前置工作包

横向复审确认：批次 1/2 已交付身份与授权底座，但没有交付管理员可用的用户、组织、角色权限、系统配置、通知或审计管理功能。相关路线和首个实现切片记录在 [账号与系统管理](ACCOUNT-ADMINISTRATION.md)、[设计规格](../../docs/superpowers/specs/2026-09-18-qms-2.0-account-administration-design.md) 和 [执行计划](../../docs/superpowers/plans/2026-09-18-qms-2.0-account-administration.md)。

首个切片已启动并接入生成契约：个人资料读取/编辑、修改密码、登录会话列表与单会话撤销；内部与供应商账号均可从现有门户进入个人账号页。管理员用户生命周期、组织/部门/岗位、角色权限矩阵、系统配置、通知规则、任务/失败队列监控和审计查询仍未标记完成，必须在供应商质量试点前按依赖顺序验收。

该工作包的验收不能用 Prisma 模型或导航占位代替真实行为；必须证明权限/数据范围、CSRF、密码策略、会话撤销、事务审计、OpenAPI 同步、PostgreSQL 和浏览器主链路。供应商质量试点的明确起点仍是 2A 的用户组织与角色权限切片完成之后。
