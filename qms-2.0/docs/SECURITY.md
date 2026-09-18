# 底座安全边界

本文记录阶段 1 的实际能力和限制，不是生产就绪证明。验证入口与证据层级见 [FOUNDATION](FOUNDATION.md)。

## 身份、Cookie 与请求保护

密码使用 Argon2id；服务端生成 32 字节随机 Session，数据库仅保存 SHA-256 摘要。会话有效期 8 小时；撤销、过期或账号禁用后不能继续解析。登录仅由账号的服务端类型决定内部或供应商入口，不接受客户端选择身份。

`qms_session` 使用 HttpOnly、SameSite=Lax、Path=/；生产模式始终 Secure。CSRF Cookie 可由脚本读取；写请求必须同时提供匹配的 `x-csrf-token`，缺失或不匹配返回 403。浏览器不得把 Session、JWT 或刷新令牌放到 localStorage/sessionStorage。开发模式非 Secure Cookie 只用于本机 HTTP；生产必须配置 HTTPS，不能为了登录方便关闭 Secure。

登录和退出使用账号/会话与客户端 IP 的 HMAC 组合限流键；生产缺 `QMS_RATE_LIMIT_SECRET` 时启动失败。每键 60 秒内最多 30 次请求，连续五次登录失败后从 1 秒开始指数等待、上限 30 秒，成功后清理该键。状态目前只在单 API 进程内存中保存，重启后重置，不提供多副本统一限流。当前没有验证码、MFA 管理、密码重置全流程或外部身份平台集成，不能声称已满足完整生产安全基线。

## 代理与供应商隔离

直接启动 API 默认忽略客户端 forwarded 头。只有 `QMS_TRUST_PROXY_HOPS=1` 启用一跳信任，其他值（包括 `true`）不启用。Compose API 无公开宿主端口，只允许 Nginx 网关访问；Nginx 将 `X-Forwarded-For` 覆写为其连接的 `$remote_addr`，不能追加客户端自报链路。新加上游入口需要单独评审真实 IP 信任范围，不能无限信任代理头。

功能权限首先按会话用户的归属组织（home organization）校验，随后独立校验目标组织数据范围。客户端 `organizationId` 不能补充归属组织中缺失的功能权限；即使目标组织有授权，也不能绕过前一步检查。供应商组织来自服务端会话，只允许本企业；请求 query 中的其他企业 ID 返回 `ORGANIZATION_SCOPE_DENIED`，重复参数返回 `ORGANIZATION_SCOPE_AMBIGUOUS`。内部用户只能在服务端 `userRole` 已分配的组织中选择目标；缺少归属组织功能权限先返回 `FEATURE_PERMISSION_DENIED`。流程权限保留拒绝边界，当前没有流程节点授权运行时。新增接口必须同时补供应商允许与拒绝测试。

## 审计、附件与异步恢复

`AuditLogService.record()` 支持在调用方事务中写入 actor、组织、动作、资源、结果、trace 和数据库时间。元数据仅允许白名单基本值，避免 Cookie、口令、签名 URL、密钥、任意嵌套对象进入审计。附件初始化将元数据与审计写入同一事务。

登录凭据错误会产生 `LOGIN_FAILED`，未知账号的 actor/组织为空，不保存提交的账号或密码。已认证请求因功能权限、组织范围或流程边界拒绝时产生 `ACTION_REJECTED`。这两类错误的响应 traceId 与审计一致，由服务端在 request 内生成，不采信客户端 trace 头。会话撤销与 `SESSION_REVOKED` 审计同事务，审计失败时撤销回滚；重复撤销不重复记成功事件。审计写入失败对外只返回受控 500，不泄露数据库诊断。CSRF/限流拒绝、未认证访问，以及尚未实现的密码重置、权限修改、MFA 流程不在本次自动事件覆盖范围；对应动作常量不代表业务接口已经完成。

文件策略默认允许 PDF、JPEG、PNG、TXT、XLSX、DOCX，单文件最多 25 MiB、批量最多 10 个。对象键使用随机 UUID，记录 SHA-256、版本、组织和上传人。供应商附件从 QUARANTINED 开始，只有受控干净扫描结果才能 AVAILABLE，逻辑删除后拒绝下载。当前适配器仅构造对象存储地址，没有签名上传、真实病毒扫描服务、对象字节上传下载、存储版本保护或公开附件 API；服务级隔离不等于完整生产附件防护。

Outbox 使用 PostgreSQL `FOR UPDATE SKIP LOCKED` 领取和五分钟租约；失败最多五次，前四次间隔 1/2/4/8 秒，再失败进入 FAILED。服务级人工重试只接受 FAILED，重置计数后重新排队。租约恢复可能重新执行 handler，因此未来业务 handler 必须幂等；不能把并发领取保护描述为端到端 exactly-once。当前 Worker 单次运行，无业务 handler 时不领取事件并正常退出；没有常驻轮询或通知业务实现。

## 部署与秘密

本机演示 seed 只允许 development 和 loopback PostgreSQL，要求两类账号使用不同且至少 16 字符的环境口令，已有密码保持不变。Compose 不自动建立演示账号。验收数据库和容器必须可销毁，不连接生产资源。

秘密、`.env`、上传、原始日志、数据库备份不入 Git。需要提交的仅环境变量名称、模板和脱敏验证摘要。Docker 上下文排除上述资源，归档不进入活跃构建、测试、安装、容器或部署。测试结束使用对应临时 Compose 项目的 `down --volumes --remove-orphans` 清理。

正式部署前仍需具备 TLS、管理员 MFA、其余安全事件审计、真实对象存储保护、备份与恢复演练以及业务级授权验收。阶段 1 本机测试不证明这些能力。
