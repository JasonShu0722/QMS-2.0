# OpenAPI 契约

NestJS DTO 和 Swagger 注解是前端 API 契约唯一来源。API 在 `GET /api/v1/openapi.json` 发布 schema；Web 仅从 `@qms/contracts` 导入生成类型及其派生类型，不手写重复 DTO，也不让 API 反向依赖 contracts。

| 当前端点 | 行为 |
| --- | --- |
| `GET /api/v1/auth/csrf` | 返回 `csrfToken` 并设置可供客户端读取的 CSRF Cookie |
| `POST /api/v1/auth/login` | 接受 `identifier`、`password`；设置 HttpOnly Session Cookie；返回账号类型与服务端 landingPath |
| `GET /api/v1/auth/session` | 解析会话并返回 user 的 id、organizationId、accountType |
| `POST /api/v1/auth/logout` | CSRF 校验后撤销会话、清除 Session Cookie，返回 204 |
| `POST /api/v1/auth/password-reset/complete` | 匿名 CSRF 和限流保护的一次性重置兑换，成功返回 204；精确契约见下文 |
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

写请求携带 Cookie 和 `x-csrf-token`，Web 请求使用同源 `/api/v1`。除匿名登录和重置兑换等认证入口外，账号与管理接口要求有效 Session。错误统一包含 `code`、`message`、`fields`、`traceId`；不对客户端暴露堆栈、SQL、口令或内部路径。CSRF、限流和组织权限错误都有稳定代码；具体 status/schema 以当前生成契约为准。

## 管理员接口

下表路径统一以 `/api/v1/admin` 为前缀。query 中的 `organizationId` 为可选 UUID，省略时使用会话主组织；`POST /users` 与 `POST /roles` 则由必填 body.organizationId 选择组织。其他组织的权限不能补充所选组织中缺失的权限；供应商只能本企业。路径中的 userId/roleId 为 UUID。

| 方法与路径 | 参数 / body | 返回与所需权限 |
| --- | --- | --- |
| `GET /organizations` | 无组织选择参数 | 200 `AdminOrganizationDto[]`：`id/code/name/type/permissions`；仅列当前账号拥有 `account:users:read/manage` 或 `account:roles:read/manage` 的组织，未获任何管理权限时为空数组 |
| `GET /users` | query：`organizationId`、`status=ACTIVE\|DISABLED`、`accountType=INTERNAL\|SUPPLIER`、`search`（最多 100 字符，按用户名/邮箱不区分大小写包含匹配）；不分页 | 200 `AdminUserDto[]`；`account:users:read` |
| `GET /users/:userId` | query：`organizationId` | 200 `AdminUserDto`；`account:users:read` |
| `POST /users` | `CreateAdminUserDto`：`username`、`initialPassword`、`accountType`、`organizationId`，可选 `email`（可为 null） | 201 `AdminUserDto`；`account:users:manage` |
| `PATCH /users/:userId` | query：源 `organizationId`；`UpdateAdminUserDto` 可选 `email`（null 清空）、`status`、目标 `organizationId`、`accountType`；不支持修改 username | 200 `AdminUserDto`；`account:users:manage`，跨组织更新校验两端和目标已有授权 |
| `POST /users/:userId/password-reset` | query：`organizationId`；`ResetAdminUserPasswordDto`：`temporaryCode` | 201 `PasswordResetIssuedDto`；`account:users:manage`；仅 ACTIVE 用户 |
| `GET /permissions` | query：`organizationId` | 200 `AdminPermissionDto[]`：`id/code/name`；`account:roles:read`，只读稳定权限目录 |
| `GET /roles` | query：`organizationId` | 200 `AdminRoleDto[]`；`account:roles:read`，只列所选组织角色 |
| `GET /roles/:roleId` | query：`organizationId` | 200 `AdminRoleDto`；`account:roles:read` |
| `POST /roles` | `CreateAdminRoleDto`：`organizationId/code/name/permissionCodes` | 201 `AdminRoleDto`；`account:roles:manage` |
| `POST /roles/:roleId/copy` | query：`organizationId`；`CopyAdminRoleDto`：`code/name` | 201 `AdminRoleDto`；`account:roles:manage`，复制同组织角色及其权限 |
| `PATCH /roles/:roleId` | query：`organizationId`；`UpdateAdminRoleDto` 可选 `name/permissionCodes` | 200 `AdminRoleDto`；`account:roles:manage`；省略权限字段保留权限，空数组清空权限 |
| `DELETE /roles/:roleId` | query：`organizationId`；无 body | 204；`account:roles:manage`，仍有成员返回 `ADMIN_ROLE_IN_USE`（409） |
| `GET /users/:userId/roles` | query：`organizationId` | 200 `AdminUserRolesDto`：`userId/organizationId/roles/permissions`；`account:roles:read` |
| `PUT /users/:userId/roles` | query：`organizationId`；`AssignAdminRolesDto`：`roleIds`（最多 100 个不同 UUID，空数组清空） | 200 `AdminUserRolesDto`；`account:roles:manage`，替换该组织角色分配 |

所有管理员 POST/PATCH/PUT/DELETE 必须携带 `Idempotency-Key` 和 `x-csrf-token`。key 为 8–128 字符，限字母、数字、点、下划线、冒号、连字符；同一操作者、组织、key 的同动作同内容重试复用原安全响应，不重复写业务或成功审计；异内容/异动作复用返回 409。记录保存用途隔离的 HMAC 请求摘要，不保存原始请求秘密。授权在 Serializable 写事务内重新检查，不能以幂等重放绕过已撤销权限；序列化冲突返回受控 409。

用户 username 为 1–100 个 ASCII 字母、数字、点、下划线或连字符；邮箱最多 254 字符；新密码/初始密码为 12–256 字符。username/email 全局去首尾空格、大小写无关唯一。用户响应包含标识、邮箱、类型、状态、MFA 状态、组织摘要和创建/更新时间，绝不返回密码哈希、Session 或重置代码。账号类型必须与目标组织类型一致。

主组织迁移的 query.organizationId 是源组织，body.organizationId 是目标组织。管理员必须有两端管理权并覆盖目标用户各组织既有权限；禁止自停用、自迁移/自类型变更及携全局角色身份迁移。成功身份变更清除旧角色、撤销会话和未消费的重置凭证。用户仍有问题负责人、流程任务办理人或通知接收人引用时返回 `ADMIN_USER_ORGANIZATION_IN_USE`（409），保留业务归属及全部角色、会话、重置凭证；数据库外键同样禁止级联迁移。普通邮箱编辑和停用不受该引用限制。

角色 code 为 1–100 字符、字母开头且仅含字母/数字/下划线/连字符；name 为 1–150 字符且不得全空白；permissionCodes 最多 200 个不同代码。角色响应为 `id/organizationId/code/name/permissions`。创建、复制、修改及分配只能使用当前组织中操作者已有权限，不能管理更高权限角色。组织接口不提供全局角色 CRUD，分配接口也不能移除既有全局角色；权限变更不能造成操作者失去既有管理权限。权限矩阵由上述目录与角色结果在 Web 展示，无单独 HTTP 端点。

## 一次性密码重置

管理员页面使用 `crypto.getRandomValues` 生成随机 temporaryCode，以 `POST /api/v1/admin/users/:userId/password-reset?organizationId=...` 提交 `{ temporaryCode }`。代码为 32–256 个 base64url 字符（字母、数字、`_`、`-`），服务端只保存 SHA-256 摘要；201 响应仅含 `{ resetId, expiresAt }`（UUID / date-time），不含代码。凭证有效 30 分钟，新签发使旧凭证失效，但不修改当前密码、不撤销当前会话。页面一次展示 resetId 和内存中的代码；关闭后无法从 API 取回，也不自动发送邮件。

`/reset-password` 页面接受 `resetId.temporaryCode` 形式的完整凭证和新密码，先调用 `GET /api/v1/auth/csrf`，再以 CSRF Cookie 和匹配 header 调用 `POST /api/v1/auth/password-reset/complete`，body 为 `{ resetId, temporaryCode, newPassword }`。该端点无需登录、无需 Idempotency-Key；成功 204 且不自动登录。无效/过期/已消费凭证及并发重复消费返回 `AUTH_PASSWORD_RESET_INVALID`（400）；重置 ID 与 IP 组合限流，伪 Session Cookie 不能更换预算。成功兑换在同一事务更新密码、消费凭证、撤销该用户全部会话和写审计；旧密码失效。角色权限/分配变化、账号停用/身份迁移和本人改密会使相关凭证失效，纯角色改名不会。临时代码和密码不得进入 URL、持久存储或审计元数据。

## 生成与验证

从 `qms-2.0/` 执行：

```powershell
corepack pnpm contracts:generate
corepack pnpm contracts:check
```

`contracts:generate` 构建 API、以同一 Swagger 配置离线导出 schema，再运行 `openapi-typescript` 写入 `packages/contracts/src/generated/api.ts`。不初始化 API 服务、不连接数据库、不需要生产凭据。修改 DTO 时连同生成文件一起提交，不手工编辑生成文件。

`contracts:check` 在系统临时目录生成并逐字节比较，失败输出重新生成指令；不会覆盖已提交文件，结束后清理临时目录。生成结果统一 LF，跨平台换行不得造成漂移。CI 与 `pnpm acceptance:phase-1` 都执行同步检查。

`test/common/openapi.spec.ts` 验证真实 Nest HTTP schema 发布、登录请求响应、组织参数、权限响应和错误必填字段；使用持久层替身，不冒充真实数据库登录。Playwright 另行验证运行网关的真实登录、CSRF、组织隔离与会话撤销。

附件上传/下载、Outbox 运维和编号分配目前没有公开 HTTP 契约；流程草稿/校验/发布/复制和问题查询已有表中接口。接口存在不等于完整流程运行、业务 Worker 或平台浏览器主链路已验收；后续公开接口仍须先在 API 定义 DTO、权限与 OpenAPI，再生成前端契约。

管理员用户与组织角色治理已有上述接口和 `/app/admin` 页面；组织目录为只读选择器，不是组织树维护。组织/部门/岗位 CRUD、系统配置、通知规则、审计查询导出、失败队列监控、MFA 和自助邮件找回属于 D–H 后续工作，本轮不启动。

批次 2 任务 2 使用 `PlatformTypesDto` 作为 Swagger extra model 暴露平台枚举，不新增业务 HTTP 入口。枚举和固定错误消息由 API 持有，contracts 只导出生成 schema 的派生类型。领域码为领域服务拥有的稳定 string，中性测试域使用 `neutral-test`；平台不预设业务分类。

异常过滤器只根据稳定错误码构造固定公开消息，HTTP 5xx 始终返回 `INTERNAL_ERROR` 和通用消息，并保留服务端请求 trace。现阶段过滤器的 `fields` 默认为空；后续字段反馈必须从受控字段错误码映射固定消息，禁止直接转发异常中的字段值或任意消息。受信任调用方通过 `toErrorResponse` 构造的安全字段反馈仍予保留。
