# OpenAPI 契约

NestJS DTO 和 Swagger 注解是前端 API 契约唯一来源。API 在 `GET /api/v1/openapi.json` 发布 schema；Web 仅从 `@qms/contracts` 导入生成类型及其派生类型，不手写重复 DTO，也不让 API 反向依赖 contracts。

| 当前端点 | 行为 |
| --- | --- |
| `GET /api/v1/auth/csrf` | 返回 `csrfToken` 并设置可供客户端读取的 CSRF Cookie |
| `POST /api/v1/auth/login` | 接受 `identifier`、`password`；返回账号类型、服务端landingPath及securityState，MFA挑战完成后才发完整业务Session |
| `GET /api/v1/auth/session` | 解析会话并返回 user 的 id、organizationId、accountType |
| `POST /api/v1/auth/logout` | CSRF 校验后撤销会话、清除 Session Cookie，返回 204 |
| `POST /api/v1/auth/password-reset/complete` | 匿名 CSRF 和限流保护的一次性重置兑换，成功返回 204；精确契约见下文 |
| `GET/PATCH /api/v1/me` | 读取或更新当前账号邮箱等可编辑资料；用户名、账号类型、组织和状态由服务端维护 |
| `POST /api/v1/me/password` | 校验当前口令后修改密码，并撤销其他登录会话 |
| `GET /api/v1/me/sessions` | 返回当前用户的登录会话摘要，不返回 Session 原文或哈希 |
| `GET /api/v1/me/sessions/history` | 本人现有会话历史分页；`page` 默认 1、上限 1000000，`pageSize` 默认 20、上限 100；拒绝额外目标参数，返回 `items/total/page/pageSize`，不返回令牌或哈希 |
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

### N1 组织生命周期契约（V0.0.28已部署）

- `UpdateOrganizationDto`、`UpdateDepartmentDto` 增加可选 `code`，格式与创建相同，仍需 `expectedVersion`。
- `GET /api/v1/organizations/:organizationId/lifecycle` 及 `.../departments/:departmentId/lifecycle` 返回 `OrganizationLifecycleDto` 的 `deleteBlockers` / `disableBlockers`；读取行政依赖提示要求相应治理权限，不是普通成员目录。
- 对应 `DELETE` 接受 `DeleteStructureDto { expectedVersion }`，携带 CSRF / Idempotency-Key，返回 `DeleteStructureResultDto { id, deleted }`。GET 检查不替代最终事务内复验；组织删除首执验证目标及冻结父范围，回执位于仍存在的父范围，并在重放前重新授权。
- 部门创建 / 子组织创建的原幂等键不能在对象已删除后假报创建成功或重建。Web 删除结果未知时只按原 path / body / key 恢复，不改版本或借新身份重放。
- 内部 `organization:read` 单权限可见其管理目录基本信息，但不能借此调用生命周期或写接口；不把该权限添加到全量管理权限集合改变授予 / 自锁语义。

精确 DTO / 路由由当前 Swagger 生成；最终SHA b4e51150e934314889287980d062fe389a89561b的生产OpenAPI已独立核验上述新增路由和code字段，人工业务验收仍待完成；验证与部署状态见[基础管理前置计划](../../docs/superpowers/plans/2026-10-24-qms-basic-management-prerequisite.md)。

REQ-0020 开发增量：审计事件增加 `actionLabel` 与可空 `actorSummary`（`username/accountType/organizationName`），保留原动作与操作人 UUID。`actionLabel` 对当前实际发出的已知动作提供中文说明，未知动作仍原码回退；不是对任意字符串自动翻译。摘要仅限操作人当前主组织匹配事件授权组织，不能视为历史身份快照。CSV 使用同一安全读取模型并保留既有权限、列、数量与下载边界；本轮状态见[实现计划](../../docs/superpowers/plans/2026-10-18-qms-compact-account-master-audit.md)。

下表路径统一以 `/api/v1/admin` 为前缀。query 中的 `organizationId` 为可选 UUID，省略时使用会话主组织；`POST /users` 与 `POST /roles` 则由必填 body.organizationId 选择组织。其他组织的权限不能补充所选组织中缺失的权限；供应商只能本企业。路径中的 userId/roleId 为 UUID。

| 方法与路径 | 参数 / body | 返回与所需权限 |
| --- | --- | --- |
| `GET /organizations` | 无组织选择参数 | 200 `AdminOrganizationDto[]`：`id/code/name/type/permissions`；仅列当前账号持有账号或新增治理目录权限中至少一项的组织，均未持有时为空数组；写权限不自动包含读取权限 |
| `GET /users` | query：`organizationId`、`status=ACTIVE\|DISABLED`、`accountType=INTERNAL\|SUPPLIER`、`search`（最多 100 字符，按用户名/邮箱不区分大小写包含匹配）；不分页 | 200 `AdminUserDto[]`；`account:users:read` |
| `GET /users/:userId` | query：`organizationId` | 200 `AdminUserDto`；`account:users:read` |
| `POST /users` | `CreateAdminUserDto`：`username`、`initialPassword`、`accountType`、`organizationId`，可选 `email`（可为 null） | 201 `AdminUserDto`；`account:users:create` |
| `PATCH /users/:userId` | query：源 `organizationId`；`UpdateAdminUserDto` 可选 `email`（null 清空）、`status`、目标 `organizationId`、`accountType`；不支持修改 username | 200 `AdminUserDto`；按提交字段要求 `account:users:update/status/transfer`，混合请求须全部满足，规则见下文 |
| `POST /users/:userId/password-reset` | query：`organizationId`；`ResetAdminUserPasswordDto`：`temporaryCode` | 201 `PasswordResetIssuedDto`；`account:users:reset`；仅 ACTIVE 用户 |
| `GET /permissions` | query：`organizationId` | 200 `AdminPermissionDto[]`：`id/code/name`；`account:roles:read`，只读稳定权限目录 |
| `GET /permission-catalog` | query：`organizationId`（可选 UUID） | 200 `PermissionCatalogGroupDto[]`；`account:roles:read` 和所选组织范围；分组目录、状态与可授予标记见下文 |
| `GET /roles` | query：`organizationId` | 200 `AdminRoleDto[]`；`account:roles:read`，只列所选组织角色 |
| `GET /roles/:roleId` | query：`organizationId` | 200 `AdminRoleDto`；`account:roles:read` |
| `POST /roles` | `CreateAdminRoleDto`：`organizationId/code/name/permissionCodes`，可选 `mfaRequired` | 201 `AdminRoleDto`；`account:roles:create` |
| `POST /roles/:roleId/copy` | query：`organizationId`；`CopyAdminRoleDto`：`code/name` | 201 `AdminRoleDto`；`account:roles:create`，复制同组织角色及其权限 |
| `PATCH /roles/:roleId` | query：`organizationId`；`UpdateAdminRoleDto` 可选 `name/permissionCodes/expectedPermissionCodes/mfaRequired/expectedMfaRequired` | 200 `AdminRoleDto`；`account:roles:update`；提交权限或MFA策略时须带对应读取基线；省略权限字段保留权限，空数组清空权限 |
| `DELETE /roles/:roleId` | query：`organizationId`；无 body | 204；`account:roles:delete`，仍有成员返回 `ADMIN_ROLE_IN_USE`（409） |
| `GET /users/:userId/roles` | query：`organizationId` | 200 `AdminUserRolesDto`：`userId/organizationId/roles/permissions`；`account:roles:read` |
| `PUT /users/:userId/roles` | query：`organizationId`；`AssignAdminRolesDto`：`roleIds`（最多 100 个不同 UUID，空数组清空） | 200 `AdminUserRolesDto`；`account:roles:assign`，替换该组织角色分配 |

账号、角色、组织及受控配置的管理 POST/PATCH/PUT/DELETE 必须携带 `Idempotency-Key` 和 `x-csrf-token`。key 为 8–128 字符，限字母、数字、点、下划线、冒号、连字符；同一操作者、组织、key 的同动作同内容重试复用原安全响应，不重复写业务或成功审计；异内容/异动作复用返回 409。记录保存用途隔离的 HMAC 请求摘要，不保存原始请求秘密。授权在 Serializable 写事务内重新检查，不能以幂等重放绕过已撤销权限；序列化冲突返回受控 409。

用户 username 为 1–100 个 ASCII 字母、数字、点、下划线或连字符；邮箱最多 254 字符；新密码/初始密码为 12–256 字符。username/email 全局去首尾空格、大小写无关唯一。用户响应包含标识、邮箱、类型、状态、MFA 状态、组织摘要和创建/更新时间，绝不返回密码哈希、Session 或重置代码。账号类型必须与目标组织类型一致。

用户 PATCH 按实际提交字段计算完整权限集合：`email` 要求 `account:users:update`，`status` 要求 `account:users:status`，`organizationId` 或 `accountType` 要求 `account:users:transfer`；空 PATCH 仍要求 update。混合请求须拥有全部对应权限，否则整体 403，不部分写入。Guard 和服务事务都检查该集合，拒绝审计记录实际缺失的权限，成功幂等回放前也重新授权。

主组织迁移的 query.organizationId 是源组织，body.organizationId 是目标组织。管理员必须在两端都有 `account:users:transfer`，并覆盖目标用户各已分配组织的既有权限；目标端 transfer 撤销后，旧成功请求也不能重放。禁止自停用、自迁移/自类型变更及携全局角色身份迁移。成功身份变更清除旧角色、撤销会话和未消费的重置凭证。用户仍有问题负责人、流程任务办理人或通知接收人引用时返回 `ADMIN_USER_ORGANIZATION_IN_USE`（409），保留业务归属及全部角色、会话、重置凭证；数据库外键同样禁止级联迁移。普通邮箱编辑和停用不受该引用限制。

角色 code 为 1–100 字符、字母开头且仅含字母/数字/下划线/连字符；name 为 1–150 字符且不得全空白；permissionCodes 最多 200 个不同代码。角色响应为 `id/organizationId/code/name/permissions/mfaRequired`；修改MFA策略须带expectedMfaRequired基线。创建、复制、修改及分配只能使用当前组织中操作者已有权限，不能管理更高权限角色。组织接口不提供全局角色 CRUD，分配接口也不能移除既有全局角色；自锁保护覆盖账号及新增治理管理权限。矩阵读取 catalog 和角色结果，保存仍走角色 PATCH，无独立批量写入入口。

### 分组目录与权限基线

`PermissionCatalogGroupDto` 为 `{ key, name, status, modules }`，`PermissionCatalogModuleDto` 为 `{ key, name, status, operations }`；两级 status 均为 `active | planned`。`PermissionCatalogOperationDto` 为 `{ code, name, enforcement, grantable }`，enforcement 为 `guarded | reserved`。名称、顺序和状态由 API 静态目录提供；grantable 表示代码已登记、存在于 PostgreSQL Permission 且操作者在所选组织持有该代码，仍须满足角色写权限、子集和自锁检查。

目录依次为平台功能、供应商质量、制程质量、客户质量、新品质量、审核管理、系统管理。平台登记工作台、问题查询和受控流程；系统登记组织目录、当前权限上下文、用户管理和角色管理。`workbench:read` 的 enforcement 是 reserved，仅为既有预留标识，不证明独立工作台 API 已拦截；`workflow:manage` 是真实覆盖创建、编辑、校验、发布和复制的单一管理操作。未来业务板块及模块为 planned，operations 为空，没有可提交代码或本轮业务入口。伪造 planned/未知代码即使手工插入数据库，也会被角色写入拒绝（400）。既有平铺 `/permissions` 保留，不能凭其返回值绕过 catalog 注册校验。

角色 PATCH 提交 `permissionCodes` 时，`expectedPermissionCodes` 条件必填，表示读取时的原权限集合；两数组最多 200 个不同的非空代码。缺失或非法基线在 DTO 校验返回 400，服务层也以 `ADMIN_PERMISSION_BASELINE_REQUIRED`（400）防守。生成类型把该字段标为可选并通过描述注明条件要求，不能据此省略基线。事务按集合比较当前权限与基线，不受顺序影响；不一致返回 `CONCURRENCY_CONFLICT`（409），包括同时提交的名称在内全部回滚。仅改名只发送 `name`，无须携带两个权限字段。Web 在 409 后保留草稿，重新加载前确认放弃；无变化不发送 PATCH。

### 旧授权迁移

当前账号权限为两个既有 read 和九个写权限：`account:users:read/create/update/status/transfer/reset`、`account:roles:read/create/update/delete/assign`（斜线列出同前缀的独立代码）。`20260919020000_granular_account_permissions` 在 PostgreSQL 事务内建立九个写权限，把旧 `account:users:manage` 角色关联展开为五项、旧 `account:roles:manage` 展开为四项，去重并删除旧关联和 Permission，包含全局角色。UserRole、已有 read 和历史审计原文不变，不补授 read。种子不会恢复旧 manage；运行时没有 manage OR 新权限兼容通道，升级应用须协调部署迁移。

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

附件上传/下载和编号分配目前没有公开 HTTP 契约；Outbox 运维已公开 `/api/v1/outbox/failures` 与 `/:id/retry`，带组织参数及独立权限。流程草稿/校验/发布/复制和问题查询已有表中接口。接口存在不等于完整领域业务浏览器主链路已验收；后续公开接口仍须先在 API 定义 DTO、权限与 OpenAPI，再生成前端契约。

D–H已新增组织树/部门/岗位/任职、系统配置与通知规则、审计查询/导出、失败队列、MFA与自助邮件找回契约。完整路径与行为见 [PLATFORM-HANDOFF](PLATFORM-HANDOFF.md)、[EMAIL-RECOVERY](EMAIL-RECOVERY.md) 及当前 `/api/v1/openapi.json`；本页既有端点表不是完整目录。治理敏感写入还要求有效完整会话和近期认证；审计导出、MFA、邮件等专用接口按Swagger声明使用CSRF，不借用旧管理员幂等回执存放秘密。

批次 2 任务 2 使用 `PlatformTypesDto` 作为 Swagger extra model 暴露平台枚举，不新增业务 HTTP 入口。枚举和固定错误消息由 API 持有，contracts 只导出生成 schema 的派生类型。领域码为领域服务拥有的稳定 string，中性测试域使用 `neutral-test`；平台不预设业务分类。

异常过滤器只根据稳定错误码构造固定公开消息，HTTP 5xx 始终返回 `INTERNAL_ERROR` 和通用消息，并保留服务端请求 trace。现阶段过滤器的 `fields` 默认为空；后续字段反馈必须从受控字段错误码映射固定消息，禁止直接转发异常中的字段值或任意消息。受信任调用方通过 `toErrorResponse` 构造的安全字段反馈仍予保留。
