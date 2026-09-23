# QMS 2.0 工程与本地开发

`qms-2.0/` 是 QMS 2.0 唯一的活动实现目录，包含 React 19 / Ant Design 6 Web、NestJS 11 模块化 API 与 Worker、Prisma 7 / PostgreSQL 18，以及由 API 生成的前端契约。早期版本位于活动工作区之外的只读归档中。

开始工作前阅读 `AGENTS.md`、相关子目录 `AGENTS.md`、适用的设计规格和阶段计划。项目规则和文档入口由 `governance/documentation-index.json` 管理。

## 前端设计基线

前端工作遵循[前端统一设计规范](../docs/superpowers/specs/2026-09-21-qms-frontend-design-standard.md)和[实施及参考代码指南](docs/FRONTEND-DESIGN.md)。UI V2 原型只作为设计参考，不代表生产页面已经迁移；正式 Web 变更前必须阅读 [Web 目录规则](apps/web/AGENTS.md)。

## 本地预览

本地预览入口是 `http://127.0.0.1:5173`，从 `D:\WorkSpace\QMS-2.0\qms-2.0` 提供热更新。Windows 配置、启动器、凭据和日志位于仓库外的 `D:\WorkSpace\QMS-2.0-local`。

```powershell
. D:\WorkSpace\QMS-2.0-local\Enter-Qms.ps1
& D:\WorkSpace\QMS-2.0-local\Start-Preview.ps1
```

使用同目录的 `Stop-Preview.ps1` 停止由启动器记录的进程。不要对保留的预览数据库 `55440` 运行验收；验收必须使用一次性 PostgreSQL、对象存储、扫描服务和邮件接收器。

## 本地开发

使用 Node.js `22.22.x`、pnpm `11.19.x`、PostgreSQL 18 和 Docker Compose。命令从本目录执行：

```powershell
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

API 使用服务端会话、`HttpOnly` Cookie 和 CSRF 保护；浏览器不得保存 Session ID、JWT 或刷新令牌。`DATABASE_URL` 和 `NODE_ENV=development` 由仓库外环境提供。

账号 MFA、邮件找回、TLS、密钥轮换、私有对象存储和备份恢复分别见 [账号管理](docs/ACCOUNT-ADMINISTRATION.md)、[邮件恢复](docs/EMAIL-RECOVERY.md) 和 [数据保护](docs/DATA-PROTECTION.md)。生产密钥、SMTP、对象存储凭据和证书不得进入仓库。

## 开发治理

任务模板、交付证据矩阵、分层质量门禁、独立审查和模块边界见[开发治理](docs/DEVELOPMENT-GOVERNANCE.md)。当前能力状态见[能力状态总账](docs/CAPABILITY-STATUS.md)，完整文档入口见[文档导航](docs/README.md)。每次完成变更前运行：

```powershell
corepack pnpm check:governance
```

## OpenAPI 契约

API DTO 和 Swagger 注解是请求体、响应体、参数和错误结构的唯一来源。修改 API 后运行：

```powershell
corepack pnpm contracts:generate
corepack pnpm contracts:check
```

提交 `packages/contracts/src/generated/api.ts`。该文件禁止手工编辑；Web 请求客户端只能从 `@qms/contracts` 导入生成类型，不得重复定义 API DTO。

## Foundation Compose

`deployment/docker-compose.foundation.yml` 定义 `postgres`、`minio`、`api`、`worker` 和 `web`。API 与 Worker 使用同一镜像和不同启动命令，Nginx 提供静态 Web 和 `/api/` 代理。Compose 配置检查不等于镜像构建、部署或生产验收。

```powershell
docker compose -f deployment/docker-compose.foundation.yml config --quiet
```

密钥通过环境变量或仓库外配置注入。Docker 构建上下文必须在 `qms-2.0/` 内；依赖目录、生成源码、测试输出、环境文件、上传文件、日志和备份不得进入镜像上下文。

Worker 持续轮询流程、任务时限和附件扫描事件，支持有限重试、失败队列、租约恢复和 `--once` 单批运行。无效配置、缺失处理器和必需前置条件必须显式失败。

## 验证与 CI

默认测试包含治理检查、结构测试、契约包测试以及 API/Web 测试：

```powershell
corepack pnpm test
corepack pnpm build
corepack pnpm --filter @qms/api test:integration
corepack pnpm --filter @qms/api test:worker-process
```

基础阶段完整验收：

```powershell
corepack pnpm acceptance:phase-1
```

阶段二平台验收会重跑阶段一，并追加测试域 Swagger、扫描 Compose 和完整浏览器链路：

```powershell
corepack pnpm acceptance:phase-2
```

缺少 PostgreSQL、网关、浏览器、密钥、邮件或对象存储前置条件时必须失败；不得使用 SQLite、Mock、Skip 或旧日志替代真实证据。实际命令、环境、PASS/FAIL、失败原因和限制统一记录在 [FOUNDATION](docs/FOUNDATION.md)，供应商领域边界记录在 [阶段三](docs/PHASE-3.md)。

## 临时环境清理

验收使用一次性资源，完成后销毁容器、网络、卷、进程和临时数据库：

```powershell
docker compose -f deployment/docker-compose.foundation.yml down --volumes --remove-orphans
```

备份、日志、凭据、证书和测试夹具必须保留在仓库外指定目录，便于复核但不会进入 Git。
