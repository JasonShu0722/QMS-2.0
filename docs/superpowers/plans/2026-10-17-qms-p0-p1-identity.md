# QMS C/D 账号交付、会话与 MFA 实施计划

> 执行代理依项目 `qms-superpowers-zh` 使用独立实现上下文、TDD、规格/质量审查和主代理验证。C、D 保留各自 Issue/PR；方法步骤不扩大动作授权。

**目标：** C 提供可维护的批量账号交付和首登改密；D 在该安全状态之上提供 8 小时/7 天/30 天会话与管理员本人 MFA 开关。

**架构：** 复用现有 PasswordService、SessionService、AdminMutationService、keyring、CSRF、近期认证和审计；只为批量断点结果及有效临时密码增加必要状态。先 C 再 D，所有签发及鉴权路径使用同一策略。

**技术栈：** Nest/Prisma/PostgreSQL、现有 Argon2id/AES-GCM、React/Ant Design/ExcelJS、生成 contracts。

## 当前摘要（2026-10-17，Asia/Taipei）

基线、授权、REQ/record_id、版本与外部状态见[实施总计划](2026-10-17-qms-p0-p1-implementation.md)。C 已通过 PR #34 纳入主分支并部署至 `22c7dd457058487b164f177a107d920a6c46e4a1`；D 当前在独立分支实现，尚未提交/上线。D1 会话与 D2 本人 MFA 偏好均已有源码及定向自动/真实 PG 证据，近期认证后一次性因子重复提交的问题已通过新增红绿灯测试修正并独立复审；最终完整 Web 复验及 PR CI 仍需核对，不宣称完整 D 已交付。

负责人本轮另明确：本批所有浏览器验收统一在推送部署后人工确认，有问题按修复或新需求接收。下文涉及真实浏览器的任务保留业务场景，但其执行方式改为最终部署版本人工清单；不作为提交/部署前置，不降低 API/Web 自动测试、真实 PG、契约和 CI 门禁。反馈前不勾选浏览器通过。

## 1. 文件结构与公开入口

以下路径均相对 `qms-2.0/`；新增项是实施时创建，不声称已经存在。

| 任务 | 修改位置 | 新增位置及职责 |
| --- | --- | --- |
| C1 受限改密 | `apps/api/src/modules/identity/{identity.service.ts,session.service.ts,auth.controller.ts,mfa.service.ts,password-reset.service.ts,email-recovery.service.ts}`、`common/guards/authenticated.guard.ts`、`common/security/session-security.ts`、`dto/login.dto.ts`、`apps/web/src/{App.tsx,api/client.ts}`、`features/auth/AuthenticatedRoute.tsx` | `apps/api/src/modules/identity/password-change-challenge.service.ts`、`dto/password-change-challenge.dto.ts`；`apps/web/src/features/auth/RequiredPasswordChangePage.tsx`；`apps/api/test/identity/required-password-schema.integration-spec.ts`、Web 同名 `.test.tsx` |
| C2 临时密码 | `identity/admin-user.service.ts`、`admin-user.controller.ts`、`dto/admin-user.dto.ts`、`identity.module.ts`、`apps/api/prisma/schema.prisma`、`apps/api/src/rotate-security-keys.ts`、`apps/api/src/worker.ts` 现有 maintenance 回调 | `apps/api/src/modules/identity/temporary-password.service.ts`、`test/identity/temporary-password-schema.integration-spec.ts`；一条兼容旧数据的增量迁移 |
| C3 批量及 Web | `apps/web/src/features/admin/{UserAdministration.tsx,admin.ts}`、`api/client.ts`、`i18n/Language.tsx` | API `identity/admin-user-batch.service.ts`、`dto/admin-user-batch.dto.ts`、`test/identity/admin-user-batch-schema.integration-spec.ts`；Web `features/admin/{UserBatchCreate.tsx,UserBatchCreate.test.tsx}`；`playwright/account-batch.spec.ts` |
| D1 生命周期 | `identity/{session.service.ts,auth.controller.ts,mfa.service.ts,mfa.controller.ts,identity.service.ts}`、登录/会话 DTO、`prisma/schema.prisma`、`features/auth/LoginPage.tsx` | `identity/session-policy.ts`、`test/identity/session-policy.spec.ts`、`test/identity/remember-login-schema.integration-spec.ts`、`playwright/remember-login.spec.ts` |
| D2 MFA 开关 | `common/security/session-security.ts`、`identity/{mfa.service.ts,mfa.controller.ts,dto/mfa.dto.ts}`、`features/auth/{SecurityPage.tsx,ReauthenticationProvider.tsx}`、`features/account/AccountCenterPage.tsx` | `test/identity/mfa-preference-schema.integration-spec.ts`、`features/auth/SecurityPage.test.tsx` |

错误码登记在 `apps/api/src/common/contracts/platform-error.ts`；任何 DTO 修改后 contracts 由主代理生成。新增文件的 Nest provider/controller 和导出只加入所属模块，不复制全站身份服务。定向 PG 命令运行前必须按总计划在隔离目标上先执行 Prisma generate/migrate/seed；Jest exec 命令本身不会代建库或迁移。

### 拟增加的接口（以实施时 Swagger 为最终来源）

| 接口 | 语义与受保护条件 |
| --- | --- |
| `POST /api/v1/auth/password-change/complete` | 仅持有短期改密 challenge 的本人提交新密码；CSRF/限流/单次消费；不是匿名任意 userId 改密 |
| `POST /api/v1/admin/users/batch` | 1～100 行，当前目标组织和 `account:users:create`；幂等、近期认证、逐行事务 |
| `POST /api/v1/admin/users/:id/temporary-password/read` | 返回有效临时密码或明确失效状态；沿 `account:users:reset`、目标用户所有受控组织的授权检查；`Cache-Control:no-store`、CSRF、查询审计；普通 read 不能读取秘密 |
| `POST /api/v1/admin/users/:id/temporary-password/reset` | 生成或接受管理员设定的 12～256 位临时密码，原子重置/撤销会话/写审计；现有凭证签发接口继续存在 |
| `POST /api/v1/me/mfa/preference` | 仅有治理身份的本人修改偏好；近期完整认证、CSRF、幂等，成功清本人会话/challenge |

批量结果接口不缓存秘密；查询/下载可以复用受保护查询并在 Web 内存生成 `.xlsx`，避免增加服务端导出任务或永久口令文件。复制/下载不新设权限或审批；不为每次点击重复触发新审批，近期认证复用现有五分钟机制。

## C1：先实现不可绕过的首次改密状态

- [ ] 写真实库失败用例：临时密码登录返回 `PASSWORD_CHANGE_REQUIRED` 与 `/change-password`，无完整 session；业务 GET/POST、导出、附件和管理入口拒绝；challenge 过期/重放、账号停用、并发 reset 后改密拒绝。
- [ ] 用一次性 PG 执行 `corepack pnpm --dir apps/api exec node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --testPathPatterns=required-password-schema.integration-spec.ts`，确认业务断言红灯。
- [ ] 增量用户字段 `mustChangePassword=false`，旧账号保持现有状态；短期 challenge 只保存 token 摘要、userId、credentialVersion、到期/消费时间。复用 MFA challenge 的组织/密码版本复验思想，不把 challenge 写进普通 session 表绕过 Guard。
- [ ] 定义顺序：密码正确且需改密 → 受限改密 challenge → 成功改密/清临时密码/消费旧 challenge → 如需 MFA 则新发五分钟 MFA challenge → 完整 session。首次改密未完成前不能跳到普通 MFA/业务会话；MFA 恢复码仍不能代替密码改密步骤。
- [ ] 改密提交锁用户并复核账号/组织/credentialVersion；密码哈希更新、`mustChangePassword=false`、临时密文清除、旧会话/challenge/重置凭证失效和审计在同一事务。失败不丢失原状态，不发送事务外副作用。
- [ ] 所有改密入口（个人改密、凭证兑换、自助找回、管理员直接重置）统一调用清理/递增凭据版本方法；不能只在新页面清密文。现有账号管理员重置也进入强制改密状态。
- [ ] 写 Web 测试：只显示新密码/确认、提交失败保留输入、成功按服务端 landingPath 进入 MFA 或工作台；刷新 challenge 页面可恢复有效挑战，退出可取消，业务路由返回 challenge 页面。
- [ ] 运行 `corepack pnpm --filter @qms/web test src/features/auth/RequiredPasswordChangePage.test.tsx src/features/auth/AuthenticatedRoute.test.tsx`，绿灯；API 新用例及旧 account/auth/mfa 回归后生成/检查 contracts。

状态预期是可执行验收数据，不依赖测试 helper 命名：

```json
[
  {"passwordValid":true,"mustChangePassword":true,"mfaRequired":true,"expected":"PASSWORD_CHANGE_REQUIRED","ordinarySession":false},
  {"passwordChanged":true,"mfaRequired":true,"expected":"MFA_REQUIRED","ordinarySession":false},
  {"passwordChanged":true,"mfaRequired":false,"expected":"AUTHENTICATED","ordinarySession":true}
]
```

## C2：临时密码的保存、读取、重置和失效

- [ ] 真实库测试覆盖：重复读取返回当前有效临时密码；普通列表无秘密；跨用户组织拒绝；过期不可读/不可登录；本人改密后旧批次读取不返回明文；审计失败重置回滚；并发两次重置只有当前版本可用。
- [ ] 定向运行临时密码用例确认红灯；创建 `UserTemporaryPassword` 一对一记录（userId、credentialVersion、encryptedValue、expiresAt），用户只增加凭据版本及首次改密标记。旧长期哈希不转存可解密数据。
- [ ] 使用 `encryptSecret/decryptSecret` 和 AAD `temporary-password:<userId>:<credentialVersion>`；复用 keyring 轮换/备份流程，修改 `rotate-security-keys.ts` 覆盖新密文。缺 key 返回受控 503，不退回明文。
- [ ] 随机密码在服务端用 `randomBytes(18).toString('base64url')` 生成 24 位，符合现有 12～256 限制；管理员自行设置的临时密码仍按原强度校验。固定有效期由总计划推荐值决定。
- [ ] 重置同事务更新 hash/credentialVersion/强制改密/密文、撤销 session/MFA 与改密 challenge/旧凭证，写审计。适用当前 `assertTarget` 的所有组织和权限包含检查，不能只检查目标主组织。
- [ ] 关键修正：`AdminMutationService.run` 会把返回值持久保存到 `AdminMutation.response`。新密码动作在事务中只返回 `userId/credentialVersion/status`，事务后重新鉴权并按当前版本投影明文；绝不把明文作为 run 的 Result。重放旧 reset/key 不能恢复已使用/过期或被新 reset 替换的密文。
- [ ] 到期读/登录立即按时间拒绝；在 `worker.ts` 现有每分钟 maintenance 回调调用 `TemporaryPasswordService.purgeExpired`，只清已到期密文、任务重复运行幂等，不新增调度系统。以真实 Worker 进程覆盖服务重启后的清理；Worker 延迟不使临时密码继续有效，已改密密文在改密事务即时删除。
- [ ] 运行真实 PG 用例和 `corepack pnpm --filter @qms/api test test/identity/security-keyring.spec.ts test/identity/account.service.spec.ts`；检查审计/响应回执/Outbox 无明文。已有浏览器已经取得的下载文件无法撤回，这一点由导出说明陈述，不伪称改密能删除本机文件。

## C3：批量部分成功与中断接续

- [ ] 写 3 行真实测试：合法 Alice、用户名重复、非法邮箱 → 1 成功/2 错误；中途断连重放无二次建号；相同 batch key 不同内容 409；第 101 行/跨组织整批拒绝；用户创建或审计失败不留半成品。
- [ ] 采用业务专属批次/行结果记录，唯一 `(actorId,organizationId,key)` 和 `(batchId,rowNumber)`，保存规范化请求 HMAC、无秘密的用户名/结果/userId/credentialVersion；不建设通用批处理平台。整批总结果不套一个包住全部行的事务。
- [ ] 同一批次的每行结果与该行用户创建同事务提交；合法行生成密码，失败行保存错误码，未完成行可在相同 key 中断重放后接续；已终态行重放复用状态。记录唯一键/行锁避免并发同批重复执行，发生数据库异常只回滚当前行。
- [ ] 返回结果时实时判断对应用户当前 credentialVersion/临时密码有效性，过期或已改密只返回状态；禁止从历史批次回执反序列化秘密。内容修正使用新批次 key，成功账号由现有唯一约束防重复。
- [ ] 新 `UserBatchCreate` 页面通过已有安全 Excel 读取模块解析首表；仅抽取真正共用的 ZIP/大小/单元格读取至 `apps/web/src/features/imports/read-xlsx.ts` 并对 D4/F4 原测试回归，账号字段映射独立，不复制客诉字段或 DTO。
- [ ] 模板包含账号、邮箱（可选）、账号类型及当前受控组织选择；供应商人员账号在 F1 按档案入口创建，不能让导入任意指定企业以绕过绑定。单条原创建保持兼容，新增批量/直接重置明确首登改密。
- [ ] Web 结果显示原行号、成功/错误、有效临时密码状态；支持单项复制及两个独立下载按钮，账号清单不含密码，密码清单只含成功且仍有效的对应账号。下载字符串以 Excel 字符串单元格写入，`= + - @` 等前缀不得被当作公式执行。
- [ ] 运行 `corepack pnpm --filter @qms/web test src/features/admin/UserBatchCreate.test.tsx src/features/admin/admin-interactions.test.tsx src/features/customer-quality/customer-quality-import.test.tsx`；测试混合结果、重复点击、网络未知重试、权限撤回、账号切换和二次下载。运行真实 `account-batch.spec.ts` 完成创建→复制/下载→首登→管理员重置→强制改密。
- [ ] C 的契约、全 API/Web/PG、Foundation/Compose 门禁通过后按总计划 S3～S8 单独审查和提 PR；C 内部子步骤不以半成品最终 PR 代替完整交付。

## D1：统一 lifetime 与所有认证签发路径

- [ ] 新 `session-policy.spec.ts` 先断言未记住 8 小时、管理员记住 7 天、普通记住 30 天，关闭 MFA 的管理员仍 7 天；角色跨组织或权限变化重新按当前治理权限判定。
- [ ] `corepack pnpm --filter @qms/api test test/identity/session-policy.spec.ts` 红灯后实现最小纯函数，不依赖浏览器标记身份：

```ts
export function sessionLifetimeMs(rememberMe: boolean, administrator: boolean): number {
  const hours = rememberMe ? (administrator ? 7 : 30) * 24 : 8;
  return hours * 60 * 60 * 1000;
}
```

- [ ] 登录及 C 的改密/MFA challenge 在服务端保存 `rememberMe` 意图，challenge 固定五分钟；最终 session 只在所有关卡完成时按当前权限计算 `expiresAt`。`SessionService.create` 返回 session metadata 供两个 controller 设置 Cookie，禁止仅修改 auth/login 这一处。
- [ ] 数据库存会话类型与期限，旧会话不延长；当前会话查询返回 server `landingPath/securityState`，有效长期会话访问登录页由服务端判定门户并 redirect，网络失败显示重试，不以本地账号类型绕过验证。
- [ ] 测试 login→改密→MFA→7 天 Cookie 一致、浏览器关闭重开仍可用、普通 30 天、未勾选 8 小时、不滑动续期、到期拒绝、账号停用/重置立即失效；用时钟与 DB 时间边界，不实际等待七天。
- [ ] 定向 `remember-login-schema.integration-spec.ts`、旧 `session.cookie.spec.ts` 和 `mfa-security-schema.integration-spec.ts` 全通过；运行 `remember-login.spec.ts`，再做契约生成/检查和全门禁。

## D2：管理员自主 MFA 的一致策略

- [ ] `mfa-preference-schema.integration-spec.ts` 测本人开关、非管理员拒绝、不能指定他人、关闭不删密钥/恢复码、开启必须验证已有因子、失败不改状态、角色要求下管理员显式关闭可登录，普通账号角色要求仍生效。
- [ ] 新 nullable/枚举偏好 DEFAULT/ENABLED/DISABLED，迁移全部 DEFAULT 保留现状；`isAdministrator` 仅由治理权限判定，与 mfaRequired/mfaEnabled 分开。纯策略期望：

```ts
type Preference = 'DEFAULT' | 'ENABLED' | 'DISABLED';
export function effectiveMfa(administrator: boolean, preference: Preference,
  roleRequired: boolean, bound: boolean): boolean {
  if (administrator && preference !== 'DEFAULT') return preference === 'ENABLED';
  return administrator || roleRequired || bound;
}
```

- [ ] `mfaPolicy` 输出 administrator、required、policy digest；MfaService 创建/验证/注册/reauth、SessionService.resolve、`assertActiveAuthentication` 都消费同一结果，不再用 `user.mfaEnabled || policy.required` 使 DISABLED 失效。旧 `mfaEnabled` 在新投影中明确代表绑定事实，UI 展示绑定与当前启用状态分开。
- [ ] 切换锁序沿现有身份安全事务；近期认证按切换前策略完成，成功原子变更偏好/securityVersion、撤销本人会话与挑战、审计；重放在撤销后返回已执行或需重新登录，不发第二次变更。不能借新接口改普通账号角色或关闭他人 MFA。
- [ ] Web SecurityPage 显示本人开关和当前状态；ENABLED→DISABLED 二次确认，DISABLED→ENABLED 验证已有因子或完成新绑定后提交。原“停用并删除绑定”的接口不作为新开关，不在静默后台调用。
- [ ] 测试角色/权限变化后策略重新计算、失去管理员身份后普通角色强制恢复、长会话近期认证按有效 MFA 规则执行；本人偏好不提升业务权限。
- [ ] D 全部新/旧身份回归通过，最终与 C/A/B 组成登录→改密→MFA→菜单退出链，再按总计划审查/PR/获准发布，分别记录本地与部署证据。

## 单元回归与回退限制

### D 上线后人工浏览器确认清单

按负责人本轮决定，待 D 的 PR、main Foundation、部署日志和线上 HTTP 核验通过后，再把最终部署 SHA 填入本节执行。仅使用获准的验收账号；暂不关闭 Issue #23。以下均为待人工确认，不代表已经通过：

| 场景 | 操作与可观察预期 |
| --- | --- |
| 普通记住登录 | 普通内部账号或供应商用户勾选“记住登录”；账号会话列表到期约为 30 天。关闭并重开浏览器、访问登录页后进入本人门户，不切错门户。 |
| 管理员期限 | 治理管理员勾选记住登录，完成需要的 MFA；会话到期约为 7 天。未勾选时仍约为 8 小时，反复访问不延长已签发期限。 |
| 首次改密链路 | 管理员为专用测试账号重置临时密码，测试账号勾选记住登录；先强制改密，再按策略完成 MFA，最后进入业务页。不能在关卡完成前进入平台管理。 |
| 关闭登录 MFA | 管理员本人进入账号安全页，关闭前弹窗可取消；确认并验证后退出重新登录。验证器及恢复码仍保留，之后登录无需 MFA，但管理员记住登录仍只为 7 天。 |
| 重新开启 | 已绑定管理员开启开关，必须验证新的验证码或未使用恢复码；重新登录再次要求 MFA。未绑定时先完成绑定并保存恢复码，不以未验证的新密钥直接开启。 |
| 近期认证过期 | 登录超过五分钟后修改偏好；重新认证完成后按提示输入新的验证码或未使用恢复码，原因子不自动重放。不成功时开关、登录状态和标签不误清空。 |
| 普通账号与退出 | 普通账号没有管理员本人偏好开关；原可选绑定的解绑入口按服务端策略保留。菜单退出后回退/刷新不能恢复业务会话。 |

反馈时记录最终 SHA、场景、账号角色、实际结果和必要脱敏截图。发现问题按用户决定修复或作为新需求接收；人工确认不替代契约、迁移及数据库自动证据。

| 失败场景 | 处理与证据 |
| --- | --- |
| 数据迁移遇旧数据冲突 | 停止部署，保留真实冲突，不删除旧用户或重设其长期密码来过门禁 |
| 旧代码不理解首次改密/自主 MFA | 禁止直接回退至可能接受临时密码为普通会话的镜像；使用能识别新状态的兼容修复版本，撤销受影响会话 |
| keyring 缺少旧 key | 读取/轮换失败且记录受控状态，不能生成伪密码或将密文当密码返回 |
| 临时密码操作审计失败 | 同事务不变更密码/会话；读取审计失败不返回秘密 |
| 浏览器失去连接 | 交付本次真实部署 SHA 的人工清单，机器测试照常执行；收到反馈前标未验收 |

最少机器门禁和单元完成出口依总计划矩阵；本文件的例子是计划中的验收，不是已执行证据。
