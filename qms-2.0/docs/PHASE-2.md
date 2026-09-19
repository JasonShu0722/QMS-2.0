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

## 原批次 2 交接记录与证据范围

原交接提交：`2b310ab2886a08a83d97d17dfd25557259d66e7f`。以下保留当时执行事实；原记录将任务 1–16 全部写为 PASS 的结论过宽，现按实现和验收证据区分。

任务 1–6 的基线、契约、模型、编号、索引和流程定义有对应实现/测试；任务 7–8 仅形成流程运行时和任务通知最小边界；任务 9–13 有查询 API、请求层与页面实现。任务 14 的现有 `phase-2.spec.ts` 只访问登录页并检查 URL，不能证明问题中心、流程处理、审批/验证、升级、报告或失败重试。任务 15 的脚本和任务 16 的交接文档存在，不等于原计划全部行为门禁通过。

当时验证摘要：`pnpm test` 为 API 23 suites / 158 tests、Web 19 tests PASS；另行真实 PostgreSQL 18.6 集成覆盖 10 平台表、编号、索引与流程定义；`build`、`contracts:check`、`check:archive-isolation`、Compose `config --quiet` PASS；`acceptance:phase-2` 在 disposable 环境 exit 0。递归 pnpm 曾输出 Node 24 engine warning，不能作为 Node 22 全链路验证证据。

`acceptance:phase-2` 当前只执行 `test`、`contracts:check`、`check:archive-isolation` 和 `build` 四项；它没有独立 frozen install、迁移/seed、完整 PG 集成、Compose 或浏览器步骤，也没有显式要求 `QMS_PHASE2_BASE_URL`。缺 `DATABASE_URL` 的历史失败来自测试链中的数据库依赖，不能扩写为脚本已完整验证所有前置条件。配置齐全时它通过也不能代替原计划深度验收。

仍待独立交付/验证：完整流程节点权限、运行状态转换/并发/回滚、业务 Worker handler 的任务/通知/超时/失败重试，以及真实“领域创建—问题中心—流程处理—报告追溯”浏览器主链路。底座 Outbox 服务级领取、租约和失败重试集成已存在，但无业务 handler 的 Worker 单次退出 0 不能证明通知业务完成。

原记录中的 `qms2-batch2-validation` PostgreSQL/MinIO 临时容器当时尚未销毁；该历史事实不是当前资源状态证明。ABC 本轮使用独立 `qms2-abc-validation`，其清理与本地预览保留状态以 FOUNDATION 最新记录为准。

## 本轮 ABC 账号治理

本轮在 `codex/qms-2-admin-foundation` 实现 A 个人邮箱/改密/有效会话与撤销、B 用户创建/查询/编辑/启停/受控组织类型迁移/一次性重置、C 组织角色 CRUD/复制/目录/分配/权限矩阵，完成 API/Web 安全修订和双阶段复审。ABC 最终验收 PASS：PG 47、API 223、Web 44、浏览器 10 项、phase-1 → phase-2 聚合和独立 production 构建通过；实际命令及早期 FAIL 见 [FOUNDATION](FOUNDATION.md)。产品源码已本地合并；预览从已验收 NTFS 工作树运行，E 盘安装和文件清理限制另行记录。相关行为边界、设计和计划分别见 [账号与系统管理](ACCOUNT-ADMINISTRATION.md)、[设计规格](../../docs/superpowers/specs/2026-09-18-qms-2.0-account-administration-design.md) 和 [执行计划](../../docs/superpowers/plans/2026-09-18-qms-2.0-account-administration.md)。

入口：内部个人账号 `/app/account`、供应商个人账号 `/supplier/account`、内部系统管理 `/app/admin`、匿名兑换 `/reset-password`。组织选择来自有权目录，管理写请求均使用 CSRF 与幂等键，权限按目标组织重新校验。Web 只使用生成的 `@qms/contracts` 类型。组织目录不是组织树维护，角色矩阵不提供流程节点权限编辑。

ABC 浏览器新增六个真实网关场景检验账号、用户与角色操作以及拒绝/单次重置。原 `phase-2.spec.ts` 即使随本轮聚合通过，仍只说明登录页可访问；本轮不宣称原批次 2 的 16 项完整闭环重新验收完成。

## 下一轮边界

本轮不启动 D–H 或批次 3。A/B/C 验收后可由用户另行分配治理工作和批次 3 领域建模、接口草案、测试夹具与非生产实现；G/H 无须等 F 结束才开始。真实供应商试点和发布仍须 D 通知/配置、E MFA/完整找回与重置策略/高风险保护、G TLS/密钥/对象存储/备份恢复、H 导出/保留/国际化/可访问性门禁通过，并补齐原平台运行时、业务 Worker 和业务浏览器主链路。批次 4 其他业务域必须拥有各自专属模型，复用稳定平台契约；不得复制通用业务大表单或引入 QMS 1.0 兼容层。
