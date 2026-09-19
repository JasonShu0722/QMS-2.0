# OpenAPI 契约

NestJS DTO 和 Swagger 注解是前端 API 契约唯一来源。API 在 `GET /api/v1/openapi.json` 发布 schema；Web 仅从 `@qms/contracts` 导入生成类型及其派生类型，不手写重复 DTO，也不让 API 反向依赖 contracts。

| 当前端点 | 行为 |
| --- | --- |
| `GET /api/v1/auth/csrf` | 返回 `csrfToken` 并设置可供客户端读取的 CSRF Cookie |
| `POST /api/v1/auth/login` | 接受 `identifier`、`password`；设置 HttpOnly Session Cookie；返回账号类型与服务端 landingPath |
| `GET /api/v1/auth/session` | 解析会话并返回 user 的 id、organizationId、accountType |
| `POST /api/v1/auth/logout` | CSRF 校验后撤销会话、清除 Session Cookie，返回 204 |
| `GET/PATCH /api/v1/me` | 读取或更新当前账号邮箱等可编辑资料；用户名、账号类型、组织和状态由服务端维护 |
| `POST /api/v1/me/password` | 校验当前口令后修改密码，并撤销其他登录会话 |
| `GET /api/v1/me/sessions` | 返回当前用户的登录会话摘要，不返回 Session 原文或哈希 |
| `POST /api/v1/me/sessions/:sessionId/revoke` | 撤销当前用户的其他登录会话；当前会话使用退出登录 |
| `GET /api/v1/organizations/current` | 功能与组织范围校验后返回组织；可选 organizationId 不能拓宽供应商范围 |
| `GET /api/v1/system/permissions` | 返回服务端授权上下文的组织及权限列表 |
| `GET /api/v1/problem-index` / `:id` / `:id/workspace` | 返回组织范围内的薄问题索引 |
| `GET /api/v1/problem-center` | 返回问题中心分页查询 |
| `GET /api/v1/reports/problems/:id` | 返回只读报告预览，不暴露隔离附件下载地址 |
| `GET /api/v1/problems/:id/audit-trail` | 返回问题审计追溯 |
| `POST/PATCH /api/v1/workflows...` | 受 `workflow:manage` 保护的草稿、校验、发布和复制接口 |

写请求携带 Cookie 和 `x-csrf-token`，Web 请求使用同源 `/api/v1`。错误统一包含 `code`、`message`、`fields`、`traceId`；不对客户端暴露堆栈、SQL、口令或内部路径。CSRF、限流和组织权限错误都有稳定代码；具体 status/schema 以当前生成契约为准。

管理员主组织迁移接口 `PATCH /api/v1/admin/users/:id?organizationId=源组织` 的 body.organizationId 表示目标组织。用户仍有问题负责人、流程任务办理人或通知接收人引用时返回 `ADMIN_USER_ORGANIZATION_IN_USE`（409）；不会连带迁移业务数据，也不会清除角色、会话或重置凭证。普通邮箱编辑和停用不受此限制。

从 `qms-2.0/` 执行：

```powershell
corepack pnpm contracts:generate
corepack pnpm contracts:check
```

`contracts:generate` 构建 API、以同一 Swagger 配置离线导出 schema，再运行 `openapi-typescript` 写入 `packages/contracts/src/generated/api.ts`。不初始化 API 服务、不连接数据库、不需要生产凭据。修改 DTO 时连同生成文件一起提交，不手工编辑生成文件。

`contracts:check` 在系统临时目录生成并逐字节比较，失败输出重新生成指令；不会覆盖已提交文件，结束后清理临时目录。生成结果统一 LF，跨平台换行不得造成漂移。CI 与 `pnpm acceptance:phase-1` 都执行同步检查。

`test/common/openapi.spec.ts` 验证真实 Nest HTTP schema 发布、登录请求响应、组织参数、权限响应和错误必填字段；使用持久层替身，不冒充真实数据库登录。Playwright 另行验证运行网关的真实登录、CSRF、组织隔离与会话撤销。

附件、Outbox、流程设计、业务台账与编号目前没有公开 HTTP 契约。服务或模型存在不表示已有可用 API；后续公开接口必须先在 API 定义 DTO、权限与 OpenAPI，再生成前端契约。

管理员用户 CRUD、组织树、角色权限矩阵、系统配置、通知规则、审计查询和失败队列监控尚未公开接口，属于批次 2A 后续切片，不得把底座模型误认为已交付管理能力。

批次 2 任务 2 使用 `PlatformTypesDto` 作为 Swagger extra model 暴露平台枚举，不新增业务 HTTP 入口。枚举和固定错误消息由 API 持有，contracts 只导出生成 schema 的派生类型。领域码为领域服务拥有的稳定 string，中性测试域使用 `neutral-test`；平台不预设业务分类。

异常过滤器只根据稳定错误码构造固定公开消息，HTTP 5xx 始终返回 `INTERNAL_ERROR` 和通用消息，并保留服务端请求 trace。现阶段过滤器的 `fields` 默认为空；后续字段反馈必须从受控字段错误码映射固定消息，禁止直接转发异常中的字段值或任意消息。受信任调用方通过 `toErrorResponse` 构造的安全字段反馈仍予保留。
