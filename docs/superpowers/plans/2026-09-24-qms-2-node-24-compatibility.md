# QMS 2.0 Node 24 兼容性实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将 QMS 2.0 的唯一支持 Node.js 运行时从 Node 22.22.0 切换到 Node 24.21.0，并验证本地、CI、Docker 与阶段验收入口一致。

**架构：** 以 workspace/API/Web 的 `engines.node` 作为机器可读约束，CI 和 Docker 使用同一固定 Node 24.21.0，phase-1 和证据采集继续从 manifest 校验运行时。只升级 `@types/node` 到 24 系列，不扩大到无关工具链大版本升级。

**技术栈：** Node.js 24.21.0、pnpm 11.19.0、GitHub Actions setup-node、Docker Bookworm Slim、NestJS、Prisma、TypeScript、Node test runner。

---

## 文件范围

- 修改：`qms-2.0/package.json`、`qms-2.0/apps/api/package.json`、`qms-2.0/apps/web/package.json`、`qms-2.0/packages/contracts/package.json`，统一 `engines.node`；API 同步 `@types/node` 24 系列，并让递归脚本通过 `corepack pnpm` 使用锁定包管理器。
- 修改：`qms-2.0/pnpm-lock.yaml`，由 pnpm 在 Node 24 下刷新，禁止手工编辑。
- 修改：`qms-2.0/deployment/api.Dockerfile`、`qms-2.0/deployment/web.Dockerfile`、`.github/workflows/qms-2-foundation.yml`，统一固定 Node 24.21.0。
- 修改：`qms-2.0/test/phase-1-acceptance.mjs`、`qms-2.0/test/engineering-tools.test.mjs`，更新运行时断言和证据夹具。
- 修改：`qms-2.0/docs/OPERATIONS-RUNBOOK.md`、`qms-2.0/docs/FOUNDATION.md`，记录当前 Node 24 要求和本轮验证证据；不改写历史 Node 22 事实。
- 已创建：`docs/superpowers/specs/2026-09-24-qms-2-node-24-compatibility-design.md`，作为本计划的设计依据。

## 任务 1：先让 Node 24 验收断言失败

**文件：**
- 修改：`qms-2.0/test/phase-1-acceptance.mjs:22-23`
- 修改：`qms-2.0/test/engineering-tools.test.mjs:20`

- [x] **步骤 1：改写运行时期望。** 将 phase-1 断言改成解析 `major/minor/patch`，只接受 major `24` 且版本不低于 `24.21.0`；错误消息明确写出 `>=24.21.0 <25`。将工程工具 fixture 的 manifest engine 从 `>=22.22.0 <23` 改为 `>=24.21.0 <25`。
- [x] **步骤 2：在当前 Node 22 下运行红灯。**

运行：`corepack pnpm --dir qms-2.0 exec node test/phase-1-acceptance.mjs`

预期：退出码非零，输出 `Phase 1 acceptance: FAIL`，原因包含 `>=24.21.0 <25`；不要连接数据库、浏览器或执行后续步骤。
- [x] **步骤 3：运行工程工具定向测试。**

运行：`corepack pnpm --dir qms-2.0 exec node --test test/engineering-tools.test.mjs`

预期：测试通过，证明 fixture 仍能被证据采集逻辑接受；phase-1 的红灯只来自当前 Node 22 运行时约束。

## 任务 2：更新运行时入口和依赖类型

**文件：**
- 修改：`qms-2.0/package.json`、`qms-2.0/packages/contracts/package.json`
- 修改：`qms-2.0/apps/api/package.json`
- 修改：`qms-2.0/apps/web/package.json`
- 修改：`qms-2.0/pnpm-lock.yaml`

- [x] **步骤 1：切换四个 manifest 和递归脚本。** 将四处 `engines.node` 设为 `>=24.21.0 <25`；只在 API manifest 将 `@types/node` 改为 `^24.0.0`，将 `dev`、`test`、`build`、`lint` 中的递归调用改为 `corepack pnpm`，保留 pnpm 约束和其他依赖版本。
- [x] **步骤 2：刷新锁文件。** 使用 Node 24.21.0 环境运行 `corepack pnpm --dir qms-2.0 install --lockfile-only`，确认只产生与 `@types/node` 和 Node 24 解析有关的锁文件变化；随后运行 `corepack pnpm --dir qms-2.0 install --frozen-lockfile`。
- [x] **步骤 3：检查版本入口。** 运行 `rg -n --hidden -g '!node_modules' -g '!dist' '22\\.22|>=22|Node 22|node:22|node-version' qms-2.0/package.json qms-2.0/apps qms-2.0/packages qms-2.0/pnpm-lock.yaml`，预期没有活动 manifest 或锁文件中的 Node 22 入口。

## 任务 3：同步 CI 和 Docker 基础镜像

**文件：**
- 修改：`.github/workflows/qms-2-foundation.yml:44`
- 修改：`qms-2.0/deployment/api.Dockerfile:1`
- 修改：`qms-2.0/deployment/web.Dockerfile:1`

- [x] **步骤 1：更新固定版本。** 将 `setup-node` 的 `node-version` 和两个 Dockerfile 的基础镜像改为 `24.21.0`，保持 `bookworm-slim`、构建上下文和 API/Worker 共用镜像边界不变。
- [x] **步骤 2：静态检查入口一致。** 运行 `rg -n '22\\.22|node:22|node-version' .github/workflows/qms-2-foundation.yml qms-2.0/deployment`，预期无旧版本命中；运行 `git diff --check`。
- [x] **步骤 3：验证 Compose 配置。**

运行：`docker compose -f qms-2.0/deployment/docker-compose.foundation.yml config --quiet`

预期：退出码为 0；该命令只证明 Compose 配置有效，不记录为镜像构建或部署成功。

## 任务 4：更新当前运维说明并记录验证事实

**文件：**
- 修改：`qms-2.0/docs/OPERATIONS-RUNBOOK.md:11-17`
- 修改：`qms-2.0/docs/FOUNDATION.md` 顶部新增当前迁移记录

- [x] **步骤 1：更新运维入口。** 在运行时检查段写明 Node `>=24.21.0 <25`、pnpm `11.19.0`，并保留 `node --version`、`corepack pnpm --version` 和治理检查命令。
- [x] **步骤 2：写入当前证据。** 在 `FOUNDATION.md` 顶部新增日期、实际 Node/pnpm 版本、执行命令、PASS/FAIL 和未覆盖的真实资源限制；明确历史 Node 22 段落不可作为本轮证据。
- [x] **步骤 3：检查文档治理。** 运行 `corepack pnpm --dir qms-2.0 check:governance` 和 `corepack pnpm --dir qms-2.0 exec node scripts/check-documentation.mjs`，预期均退出码 0。

## 任务 5：执行分层验证

**文件：** 无新增文件；验证任务 1–4 的完整变更。

- [x] **步骤 1：运行治理和契约检查。**

运行：`corepack pnpm --dir qms-2.0 check:governance`

运行：`corepack pnpm --dir qms-2.0 contracts:check`

预期：两条命令均退出码 0，契约生成物无变化。
- [x] **步骤 2：运行 API 和 Web 定向检查。**

运行：`corepack pnpm --dir qms-2.0 --filter @qms/api test`

运行：`corepack pnpm --dir qms-2.0 --filter @qms/web test`

运行：`corepack pnpm --dir qms-2.0 --filter @qms/api build`

运行：`corepack pnpm --dir qms-2.0 --filter @qms/web build`

预期：测试和构建均退出码 0，无 Node 22 engine warning。
- [x] **步骤 3：运行完整非资源聚合。**

运行：`corepack pnpm --dir qms-2.0 test`

预期：治理、结构、API/Web 递归测试全部通过；缺少真实 PostgreSQL、对象存储、扫描、邮件或浏览器资源时必须明确失败，不得以 skip 记为通过。
- [x] **步骤 4：核对工作树和范围。**

运行：`git diff --check; git status --short; git diff --stat`

预期：只包含本计划列出的运行时、验证和文档文件；未修改归档、API 契约、数据库迁移或业务代码。
