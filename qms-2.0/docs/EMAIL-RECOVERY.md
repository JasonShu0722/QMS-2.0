# 邮箱确认与密码找回

所有写接口使用已有 CSRF Cookie/header 校验。请求与完成接口均返回 `Cache-Control: no-store`，凭证由用户在页面中输入，不放入 URL。

| 接口 | 请求 | 成功 |
| --- | --- | --- |
| POST `/api/v1/me/email-verification` | 当前完整会话，最近 5 分钟重新认证 | 202，空响应 |
| POST `/api/v1/auth/email-verification/complete` | `{ token }` | 204 |
| POST `/api/v1/auth/password-recovery` | `{ identifier, organizationCode? }` | 202，空响应 |
| POST `/api/v1/auth/password-recovery/complete` | `{ token, newPassword }` | 204 |

`GET /api/v1/me/security` 的 `emailVerifiedAt` 为已确认时间或 null。账号必须先确认当前邮箱，才能接收自助找回邮件。账号不存在、邮箱未确认、账号/组织停用、组织代码不匹配均返回相同 202。SMTP 或加密密钥缺失则统一 503。

凭证为 32 字节随机数，有效期 15 分钟；数据库只保存 SHA-256 摘要，绑定用途、当前邮箱和 securityVersion。任何邮箱修改经数据库触发器清除确认状态并消费相关凭证。兑换密码复用 Argon2id，要求 12–128 字符；成功后撤销全部会话、MFA 登录挑战、管理员重置和邮件凭证，保留 MFA 绑定。用户行锁与事务防止并发二次消费，审计与状态同事务提交；拒绝另行记录安全审计。

投递通过内部 `RecoveryMailService.dispatchPending()` 执行，无公开发送或重试接口。`RecoveryDelivery.encryptedPayload` 使用安全 keyring 的 AES-GCM envelope，AAD 为 `recovery-mail:${delivery.id}`；独立 keyId 字段与 envelope 保持一致。SMTP 成功、失效取消或重试耗尽后清空密文。每次失败只记录 `MAIL_DELIVERY_FAILED`，最多 5 次，间隔指数增加。

发送前先独立提交 `PROCESSING` 状态、随机 claimId、processingAt 与 attempts 增量；worker 崩溃或发送事务回滚不会撤回尝试次数。60 秒过期租约可以回收，达到 5 次直接终止，旧 claimId 不能发送或覆盖新 worker 状态。候选账号使用 PostgreSQL `FOR UPDATE SKIP LOCKED`，随后固定按用户→组织→投递→凭证顺序加锁并重读；实际 SMTP 期间保持这些锁，使邮箱修改、停用与密码重置和发送之间有明确先后顺序。

每次 SMTP 发送使用独立、调用方持有的 TCP socket，Nodemailer 在其上完成 implicit TLS 或 STARTTLS。发送总时限最多 7 秒，且不超过当前事务剩余安全预算；到期销毁实际 socket 并等待关闭，随后记录失败，15 秒数据库事务保留更新余量。SMTP 已接收而事务提交前进程崩溃时仍可能重投同一封邮件，但总尝试次数持久保留，凭证只能兑换一次。

配置：`SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE=true|false`、`SMTP_FROM`，认证场景额外设置成对的 `SMTP_USER`/`SMTP_PASS`。生产连接强制 TLS、TLS 1.2 及以上和证书验证；开发测试使用隔离 Mailpit。队列仅在已配置 SMTP/安全 keyring 时签发，202 代表已接收申请，不代表投递完成。

还须在 Worker 环境显式设置 `QMS_RECOVERY_MAIL_ENABLED=true`（默认 false），并从已构建的 `apps/api` 运行 `node dist/worker.js`，或使用 foundation Compose 的 worker 服务。API 与 Worker 必须连接同一数据库并共享安全 keyring/SMTP 配置。Worker 每60秒执行一次邮件维护，批次受 `QMS_WORKER_BATCH_SIZE` 控制；`node dist/worker.js --once` 执行包含邮件维护的一轮后退出。非法开关或启用后缺配置会非零失败。只配置 SMTP 而不启用并运行 Worker 不会发送邮件。

请求限制包括共享的每 IP 限流、跨 IP 标识符限流，以及持久化的每账号每用途 60 秒发送间隔。请求速率计数与现有身份模块一致保存在进程内，多 API 副本仍需入口共享限流；持久化发送间隔跨副本有效。

## 本地验证记录（2026-09-19）

- RED：新接口缺 SMTP 预期 503，旧实现实际 404，验证失败符合预期。
- 临时 PostgreSQL：owned `qms2-platform-remaining-postgres`，端口 55446，独立 `qms_governance_mail55446`，迁移部署成功。
- 真 SMTP：owned Mailpit v1.27.8，SMTP 51026/HTTP 51027；测试只使用 `@example.test` 地址，检查接收邮件中的实际凭证。
- `node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand test/identity/email-recovery-schema.integration-spec.ts test/identity/mfa-security-schema.integration-spec.ts test/identity/password-reset-rate-limit.spec.ts test/identity/security-policy.spec.ts`：31/31 PASS。
- `node node_modules/typescript/bin/tsc --noEmit` 与 Nest build：PASS。
- 原始测试日志位于 Git 外 `D:/WorkSpace/QMS-2.0-local/e2-email-recovery-validation.log`。
- 此记录覆盖后端切片；生产 SMTP/TLS 接收端及完整浏览器、聚合验收由集成阶段另行验证。

## 投递并发修订

- RED：已发送流程中修改邮箱提前提交；多阶段慢 SMTP 在缺少绝对截止时间时仍标记 SENT，两条回归均验证失败。
- 新迁移 `20260919175000_email_delivery_leases` 添加租约字段及 PROCESSING 状态，不修改已应用迁移。
- 新增真实 TCP SMTP 测试覆盖邮箱/账号停用/securityVersion/组织停用与发送的线性化、发送事务外可见的已提交尝试、慢 SMTP socket 实际关闭、并发最多 5 次、过期租约恢复与 TLS 失败拒绝。
- 邮件投递/邮件恢复/MFA/密码重置限流/安全策略五套合计 39/39 PASS；Prisma generate、临时库迁移、TypeScript 检查和 Nest build PASS。
- 原始回归日志保存在 Git 外 `D:/WorkSpace/QMS-2.0-local/e2-email-delivery-lease-validation.log`。
