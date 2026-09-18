# OpenAPI 契约

NestJS DTO 和 Swagger 注解是前端 API 契约唯一来源。API 在 `GET /api/v1/openapi.json` 发布 schema；Web 仅从 `@qms/contracts` 导入生成类型及其派生类型，不手写重复 DTO，也不让 API 反向依赖 contracts。

| 当前端点 | 行为 |
| --- | --- |
| `GET /api/v1/auth/csrf` | 返回 `csrfToken` 并设置可供客户端读取的 CSRF Cookie |
| `POST /api/v1/auth/login` | 接受 `identifier`、`password`；设置 HttpOnly Session Cookie；返回账号类型与服务端 landingPath |
| `GET /api/v1/auth/session` | 解析会话并返回 user 的 id、organizationId、accountType |
| `POST /api/v1/auth/logout` | CSRF 校验后撤销会话、清除 Session Cookie，返回 204 |
| `GET /api/v1/organizations/current` | 功能与组织范围校验后返回组织；可选 organizationId 不能拓宽供应商范围 |
| `GET /api/v1/system/permissions` | 返回服务端授权上下文的组织及权限列表 |

写请求携带 Cookie 和 `x-csrf-token`，Web 请求使用同源 `/api/v1`。错误统一包含 `code`、`message`、`fields`、`traceId`；不对客户端暴露堆栈、SQL、口令或内部路径。CSRF、限流和组织权限错误都有稳定代码；具体 status/schema 以当前生成契约为准。

从 `qms-2.0/` 执行：

```powershell
corepack pnpm contracts:generate
corepack pnpm contracts:check
```

`contracts:generate` 构建 API、以同一 Swagger 配置离线导出 schema，再运行 `openapi-typescript` 写入 `packages/contracts/src/generated/api.ts`。不初始化 API 服务、不连接数据库、不需要生产凭据。修改 DTO 时连同生成文件一起提交，不手工编辑生成文件。

`contracts:check` 在系统临时目录生成并逐字节比较，失败输出重新生成指令；不会覆盖已提交文件，结束后清理临时目录。生成结果统一 LF，跨平台换行不得造成漂移。CI 与 `pnpm acceptance:phase-1` 都执行同步检查。

`test/common/openapi.spec.ts` 验证真实 Nest HTTP schema 发布、登录请求响应、组织参数、权限响应和错误必填字段；使用持久层替身，不冒充真实数据库登录。Playwright 另行验证运行网关的真实登录、CSRF、组织隔离与会话撤销。

附件、Outbox、流程设计、业务台账与编号目前没有公开 HTTP 契约。服务或模型存在不表示已有可用 API；后续公开接口必须先在 API 定义 DTO、权限与 OpenAPI，再生成前端契约。
