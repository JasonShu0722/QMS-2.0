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

## 后续任务

任务 3–16 共 14 项均为 PENDING：数据库平台模型、编号、薄索引、流程定义与运行、待办通知、平台页面、报告追溯和完整批次验收等按根目录阶段计划依次开展。本次修正停留在任务 2，未开始任务 3。

## 批次 2 交接记录

任务 1–14 已在隔离分支 `codex/qms-2-batch-2-platform` 实施并逐项提交；任务 15 的 `acceptance:phase-2` 已接入。任务 16 的最终验收仍需在 disposable PostgreSQL、Compose 网关和真实浏览器全部运行后更新本节。

已验证：编号并发/回滚、问题索引事务幂等与组织隔离、流程白名单/版本冻结/循环与脚本拒绝、API lint、Web lint、生成契约检查。真实 PostgreSQL 18.6 集成测试当前覆盖 10 张平台表、编号、问题索引和流程定义。

未完成的最终证据：完整批次 2 Playwright 登录主链路、待办 Worker 真实租约与失败重试、全量 acceptance 命令、Compose 服务运行验证。缺少配置时命令必须失败，不能用跳过代替证据。
