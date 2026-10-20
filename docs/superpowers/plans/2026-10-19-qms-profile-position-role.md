# REQ-0022／REQ-0023 联合实施计划

> 面向执行代理：进入实现后使用项目 QMS Superpowers 和 subagent-driven-development 逐任务分派；共享 Git／契约／语言／文档由主代理管理，不相交写集才并行。[联合规格](../specs/2026-10-19-qms-profile-position-role-design.md)定义范围。

## 当前摘要（2026-10-20，Asia/Taipei）

- 来源：2026-10-20 按实际 record_id 回读 revision262，REQ-0022 `reczz28PGTTvAPTd`、REQ-0023 `reczz28PGW7hLyL5` 均 P0／开发中，has_more=false，目标、初稿与验收无变更；负责人确认自动生效、多来源保留与后续请求使用新授权。
- 执行范围：U1 本地实现、两阶段审查和 Web 门禁通过（`a29abed`），真实业务浏览器待验收；U2-A `bea5caf` 模型及解析器已通过检查。U2-B消费者和1000人成员更新超时返修均已完成，主代理重新确认API600/600及A/B合计52/52、契约生成／检查、Web lint通过；规格和完整质量复审PASS。C1/B2后端已提交25bb154；C2管理界面及U3资料接口正在实现，U2／U3整体尚未完成。REQ-0023 关联 [Issue #55](https://github.com/JasonShu0722/QMS-2.0/issues/55)，REQ-0022 关联 [Issue #56](https://github.com/JasonShu0722/QMS-2.0/issues/56)。未创建 PR、未部署，不关闭 Issue 或写飞书。
- 基线：沿用根 AGENTS 指定的活动 checkout，唯一实现目录为 `qms-2.0/`。规划分支 `codex/req-0022-0023-planning` 从 `e834892` 起步，保留展示卡片修复及原收尾文档。上次已核验生产 `ecf7224`，不是本次实时生产检查。每个新 shell 先加载 `D:/WorkSpace/QMS-2.0-local/Enter-Qms.ps1`，禁止预览数据库55440。
- 状态：U1 已实现权限摘要、只读分组详情、搜索和焦点恢复；组织切换待定／失败期间旧角色残留已按规格审查返修。岗位关联、统一继承鉴权及受控写入已本地实现，仍缺管理界面和个人资料／概览最终整合。不把签名指纹模块写成可视图片或带有效期的签名功能。
- 映射：REQ-0023→U1→Issue #55→V0.0.22→独立分支 `codex/req-0023-role-details`（`a29abed`）；REQ-0022→U2／U3→Issue #56→V0.0.23；当前执行分支继续使用 `codex/req-0022-0023-planning`，最终 PR 前按差异核对独立 base／head。2026-10-20 已 fetch、核对本地与远端提交及开放 PR（为空），最高已有策划号 V0.0.22；实际推送前再次查重。展示卡片 fix3／fix4 仍在独立分支 `codex/display-card-spacing`，PR 应先交付该基线，再接 U1，不能将未上线基线写为生产。
- 下一动作：C1/B2后端已经提交 `25bb154`；正在接续 C2 岗位角色管理界面及 U3 资料后端，写集不重叠，均未完成。前代理失效后保留已有 C2 测试，由 Dewey／Mencius 接续；实际活动目录以 Enter-Qms.ps1 执行后的 Get-Location 和根 AGENTS 指定 checkout 为准，不使用误传的 workspace 路径。U2整体不可单独发布。进入C前按record_id回读REQ-0022仍revision262／开发中／has_more=false，目标、背景、方案及验收无变化。仓库最近核对仍私有，遵循负责人先本地、需要 Actions 前告知的限制，暂不推送触发云端 CI；合并、部署另核对授权。
- 证据：Git外 `D:/WorkSpace/QMS-2.0-local/req22-23-readback-20261020.json`、`req23-main-web-tests.log`（26/26）、`req23-matrix-regression.log`（29/29）、`req23-main-lint.log`、`req23-main-build.log`、`req23-contracts-check.log`、`req23-governance-final.log`，U1 审查与门禁详见末节。没有本次真实业务浏览器、生产部署或人工 PASS。

**目标：** 完整实现个人资料、岗位角色自动授权与来源追溯，以及紧凑的角色摘要／只读权限详情。

**架构：** 最小岗位角色关联加统一有效授权读取，保留直接角色和任职来源，所有Guard与安全策略使用同一口径。个人资料与本人摘要分离，集中设置编辑；REQ-0023独立且不改变后台授权。

**技术栈：** 现有React／TypeScript／Ant Design、NestJS Swagger／生成contracts、Prisma／PostgreSQL、Jest／Vitest；不引入第二套组件／权限框架。

## 1. 文件责任与调用方清单

下列路径相对 `qms-2.0/`；拟建路径是规划，不表示文件已存在。

| 责任 | 文件／范围 | 目的 |
| --- | --- | --- |
| U1 | `apps/web/src/features/admin/RoleAdministration.tsx`、拟建 `RolePermissionDetails.tsx`、必要局部CSS及邻近测试 | 摘要、搜索／只读详情、焦点及组织切换 |
| U2 数据与计算 | `apps/api/prisma/schema.prisma`、新增迁移、拟建 `apps/api/src/common/security/effective-role-grants.ts` | 同组织关联／并发、事务内有效角色／权限／来源读取 |
| U2 权限与安全 | `common/security/admin-mutation.service.ts`、`session-security.ts`，`modules/authorization/authorization.service.ts`、`admin-role.service.ts`、`supplier-account-authorization.ts` | Guard、授权上限／自锁、MFA、使用检查及供应商边界 |
| U2 组织 | `modules/organization/organization.service.ts`、`organization-scope.service.ts`、`organization-governance.controller.ts`、`organization.dto.ts` | 映射配置、任职／启停、安全版本及组织范围 |
| U2 身份消费者 | `modules/identity/admin-organization.controller.ts`、`session.service.ts`及有关身份安全调用 | 管理组织目录、记住登录管理员判定及会话策略 |
| U2 管理页面 | `features/governance/StructureAdministration.tsx`、`features/admin/UserAdministration.tsx`及角色分配入口 | 人员选择、岗位角色、任职维护，直接／继承语义分离 |
| U3 API | `modules/identity/identity.service.ts`、`account.controller.ts`、`dto/account.dto.ts`、`dto/admin-user.dto.ts`、`admin-user.service.ts`及必要本人摘要服务 | 姓名电话、CAS／幂等／审计、本人与管理员投影 |
| U3 签名 | `modules/e-signature/e-signature.dto.ts`、`controller.ts`、`service.ts`的必要摘要接入 | 不破坏既有契约的本人真实状态摘要 |
| U3 Web | `features/account/AccountCenterPage.tsx`、`AvatarEditor.tsx`、`account.css`、拟建 `AccountSettingsDialog.tsx`、必要API client | 两区概览、设置、草稿与安全生命周期 |
| 主代理独占 | `packages/contracts/src/generated/api.ts`、`apps/web/src/i18n/Language.tsx`、模块边界／文档索引 | 契约生成、语言、依赖批准及证据整合 |

U2／U3均触及schema，迁移与契约串行整合。公开服务接缝与模块依赖先固定，不能直接跨模块读私有表绕过边界；公共事务读取不产生循环模块导入。

## 2. 开工与Issue草案

- [x] 按 record_id 回读目标／初稿／验收／状态，复用聊天确认；revision 262、has_more=false，发现撤回或实质改稿暂停受影响部分，不覆盖飞书原文。
- [x] 查同目标 Issue／PR 并建立关联：U1（REQ-0023）→ Issue #55，U2／U3（REQ-0022）→ Issue #56；Issue 已写入目标、边界、验收、回退及依赖，PR 尚未创建。
- [ ] 确认展示卡片fix3／fix4的交付顺序和每个PR的base／head，不能把本地已测视为生产基线；不因共享文件混入未验证成果。
- [ ] 每单元新实现者先TDD，之后独立规格审查再质量审查；失败回原实现者修复复审。主代理验证期间冻结源码，Git串行。

U1先独立交付；U2必须从配置到Guard／MFA／撤权完整上线。U3纯资料部分可与U2不重叠部分并行，但最终REQ-0022必须联合验收。

## 3. U1：角色清单

- [x] 在 `apps/web/src/features/admin/admin-interactions.test.tsx` 先写行为红灯：旧实现3项新增行为失败，原15项通过；补组织切换待定／失败残留用例后另有有效红灯。
- [x] 执行红灯后改最小表格和只读详情组件；复用目录名称／分组逻辑，不渲染全目录未选项。沿用共享 Table 密度及局部横向滚动，未新增 API／权限／库。
- [x] 定向管理交互20项、语言6项通过；组织隔离缺口返修后规格复审及独立质量审查通过。真实业务浏览器中的创建／复制／删除、矩阵保存及409草稿联合回归仍待验收，不将单测替代该证据。

工作目录 `apps/web`：

```powershell
node node_modules/vitest/vitest.mjs run src/features/admin/admin-interactions.test.tsx src/features/admin/admin-language.test.tsx --maxWorkers=1 --minWorkers=1
```

旧Tag铺满／缺少详情是预期红灯；导入错误或前置故障不是有效红灯。若另建测试，同步精确文件命令，不省略验证。

## 4. U2：岗位自动授权

### 4.1 模型与有效来源

- [x] `apps/api/test/authorization/effective-role-grants.spec.ts`：直接R＋岗位P继承R＋岗位Q继承R，结果一个R三来源；结束P、撤直接仍保留Q，最后结束Q才撤权。
- [x] A/B回归覆盖结束任职／停用岗位或部门／外组织关联／供应商白名单／空映射。迁移后空映射对原直接授权无变化；配置写入口的联合撤权仍在C验证。
- [x] 实现最小PositionRole、独立roleVersion和索引；同组织引用及唯一性、空映射旧授权不变由真实PG升级链验证。不得用内存Map冒充持久关系。

拟建解析器目标类型：

```ts
type GrantSource =
  | { kind: 'DIRECT' }
  | { kind: 'POSITION'; positionId: string; assignmentId: string };
```

解析器接收Prisma读取／事务客户端和确定的userId、organizationId，返回稳定排序的角色、来源、权限及MFA事实；不把结果写回UserRole，不接受客户端伪造身份。

### 4.2 全链路消费者

- [x] `AuthorizationService.assertFeature/permissionsForContext`、`adminPermissions/assertAdminAccess`、`AdminRoleService.effectivePermissions/assignments` 改为统一有效来源。
- [x] 接入OrganizationScopeService、组织树、管理员组织目录；保留内部原跨组织直接管理授权，不因只查归属组织丢失合法角色。
- [x] 接入mfaPolicy、记住登录管理员判定；角色权限／MFA更新的受影响用户集合包含继承人员。
- [x] 接入角色删除使用检查、自锁、可授予上限和供应商白名单。只替换直接角色的接口不能把有效角色全部存回直接分配。
- [x] 改动前后搜索 `userRole.find/count`、`userRoles.some`、`role.permissions` 的每个调用，按4.4记录“已统一／直接维护专用”，未粗暴全局替换。

### 4.3 写入、撤权与管理UI

- [ ] 岗位映射配置包含权限组合、近期验证、CAS、Idempotency-Key及事务审计；同key同payload复用响应，异payload冲突。
- [ ] 映射保存立即影响已有在岗人员；任职变化／岗位部门启停／角色权限修改自动影响后续请求，不建异步追赶任务、不设二次批准。
- [ ] 固定安全版本及锁顺序，授权变化／审计／安全失效同事务；旧会话不能继续操作，敏感在途写入事务内复验，操作者自身撤权不重复写。
- [ ] 管理页面提供可识别用户入口、岗位角色与来源；展示自动生效说明及影响范围。预览不构成审批闸门，本人页没有授权编辑入口。

### 4.4 实际消费者审计与执行切片（2026-10-20）

主代理已搜索 `apps/api/src` 全部 `userRole.find/count`、`userRoles` 条件和 `role.permissions` 消费者；下表是本次实现范围，不代表已经替换完成。U2 内部按 A→B→C 接续，整个 U2 仍同批发布。

| 切片 | 实际调用方 | 改动口径 |
| --- | --- | --- |
| U2-A | schema、新迁移、`common/security/effective-role-grants.ts` | 同组织模型与统一读取，独立角色来源，禁止单独发布 |
| U2-B | `AuthorizationService`、`adminPermissions`、`mfaPolicy` | Guard／事务内权限与全部组织的 MFA 同用有效角色 |
| U2-B | `OrganizationScopeService`、`OrganizationService.tree`、`AdminOrganizationController` | 继承人员能进入其有权主组织，保留内部跨组织直接治理与受控停用读取 |
| U2-B | `SessionService.createWithMetadata`、`AdminUserService.assertTarget`、`assertSupplierAccountTarget` | 记住登录管理员判定、目标权限上限与供应商白名单含岗位来源 |
| U2-B | `AdminRoleService` 更新／删除／assignments／自锁 | 继承人员纳入安全版本与重置凭证失效；岗位引用阻止删角色；保留旧 `roles` 的直接分配语义，新增有效角色及来源投影，不能把继承角色永久写回 `UserRole` |
| U2-B2 | `workflow/workflow-access-policy.ts` 的原生SQL `featurePredicate`／`assignmentPredicate`，公共SQL读取模型 | 补齐流程／附件等SQL中的岗位权限及roleCode资格，保留参数化SQL、节点办理人／权限合取及原跨组织边界，并与Prisma helper作真实PG逐状态对照 |
| U2-C | `OrganizationService` 的岗位映射／任职／岗位与部门启停、对应DTO／Controller | CAS、幂等、权限组合与可授予上限、受影响用户锁和安全失效、审计同事务，无二次审批 |
| U2-C | `StructureAdministration`、`UserAdministration`／角色分配入口 | 可识别人员选择、岗位角色配置、直接／继承来源分开显示，组织切换及草稿保护 |

直接授权维护专用的写入继续保留：`AdminRoleService.assign` 只替换直接集合；组织子节点治理授权、供应商边界 caretaker／portal 角色创建、身份迁移清理仍各自维护真实 `UserRole`，不据其写接口反向推导有效权限。角色序列化读取 `role.permissions` 仅展示角色定义，无须替换为用户授权计算。

U2-A 主代理已独立运行单测10项＋真实PG18项（28/28）及正式API lint；规格审查 McClintock（`01a15526-5bbf-7081-a357-006ff792a9bc`）及质量审查 Schrodinger（`01a15528-c3f4-79c1-bae3-8f0ec542f6ba`）均 PASS。实现者 Rawls（`01a1551b-19cf-7843-8d6a-e36160ae3874`）先在最小空函数下取得9失败／1通过，随后实现；真实PG初次夹具触发旧有同岗活跃任职唯一索引，修正夹具时间后18/18通过，没有弱化旧约束。辅助服务使用本次独立容器，配置在 Git 外 `req22-23-test-env.json`；PG端口57544，RustFS健康200／版本控制已开启、ClamAV PONG，Mailpit已启动。原始迁移、红绿灯、主代理独立测试与lint日志均在 `D:/WorkSpace/QMS-2.0-local/req22-u2a-*`。U2-B由新实现者 Boyle（`01a1552b-b1b7-7f03-8531-731abbe3f084`）接续；尚无完整消费者／全套集成／Worker／业务浏览器证据，不把本检查点当完整U2或REQ-0022完成。

补充审计：B首轮主要检索Prisma读取，主代理随后搜索所有源码中的 `user_roles`／`role_permissions`，发现 `workflow-access-policy.ts` 两处原生SQL只认直接角色；其调用覆盖workflow能力、运行时、升级及多个附件适配器。历史迁移中的同名表引用仅DDL／一次性回填，未作为运行时修改。新增B2由Singer（`01a1563a-f777-7ec2-a784-0d67a10b2a2f`）独占workflow policy／新SQL模型／定向测试，C1由Darwin（`01a15634-33f9-77a3-9579-0850fd2777e5`）独占组织写入及position-role-policy。两者不并行运行会扫描对方源码的AppModule／全套检查／生成工具，冻结后由主代理串行整合验证；B2不得逐行异步鉴权或先分页再过滤，必须保留SQL嵌入的正确性。

工作目录 `apps/api`，generate／单测串行：

```powershell
node node_modules/prisma/build/index.js generate
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand test/authorization/effective-role-grants.spec.ts test/authorization/admin-role.service.spec.ts test/authorization/policy.spec.ts test/authorization/permission-matrix.spec.ts test/identity/session-policy.spec.ts
```

拟建真实场景文件 `test/authorization/position-role-schema.integration-spec.ts`，保留组织／直接角色／MFA／供应商回归。先创建获准一次性资源并确认 `QMS_DISPOSABLE_TEST_DB=true`，禁止55440；按当前真实服务入口配置存储、扫描、邮件等前置，缺失必须FAIL，不Mock／SQLite／Skip。

```powershell
# 实现根；资源前置具备后运行，Worker命令要求本轮API已经build。
corepack pnpm --filter @qms/api test:integration
corepack pnpm --filter @qms/api test:worker-process:built
```

## 5. U3：资料与账号中心

- [ ] 先补本人／管理员合法非法资料、profileVersion冲突、幂等重放、审计失败回滚；新增可空姓名电话和独立版本，保留旧空值。混入组织／岗位／角色等字段的个人PATCH按严格DTO拒绝，不能增权。
- [ ] 本人摘要通过组织／授权／签名公开边界读取当前有效任职和来源，不借管理员任意用户接口；签名单个请求失败不阻断资料编辑。
- [ ] 签名投影只输出真实标签／状态／时间，不含指纹原文、不造到期时间；既有注册／撤销保持。图片签名范围若未确认，显式记差距，不按指纹功能验收图片能力。
- [ ] 账号概览两区对齐，设置集中资料／头像／任职／签名；保护草稿、409／重试、账号切换、迟到响应与原安全弹窗／改密／会话行为。
- [ ] 管理员用户页接入姓名电话和任职入口；批量建号模板不自动加列，供应商治理与字段权限不扩张。
- [ ] 主代理串行生成／检查contracts，Web只引用生成类型；必要模块依赖先评审再登记，不手工修改生成文件。

```powershell
# 实现根执行，Prisma／契约／类型／测试／构建串行。
corepack pnpm contracts:generate
corepack pnpm contracts:check
corepack pnpm --filter @qms/api lint
corepack pnpm --filter @qms/web lint
corepack pnpm --filter @qms/web test src/features/account/account-center.test.tsx src/features/account/AvatarEditor.test.tsx src/features/account/AccountMenu.test.tsx src/features/account/PasswordChangeDialog.test.tsx --maxWorkers=1 --minWorkers=1
```

### U3 接缝核对（2026-10-20，源码调查结论）

现有 `AuthorizationModule` 已导入 `IdentityModule` 和 `OrganizationModule`；不能为账号聚合反向给 `IdentityModule` 加入 `AuthorizationModule`，造成新的 Nest 模块循环。本人资料仍由既有 `/api/v1/me` 负责；任职／有效角色的本人只读聚合可以由授权模块内的本人 Controller 提供独立 `/api/v1/me/overview`，复用已导出的 OrganizationService 公开任职读取及 AuthorizationService 公开有效角色读取。身份来自完整会话，不接受目标 userId／organizationId，普通本人不需管理员角色读取权限；具体 DTO 随实现生成，不能手写前端契约。

签名摘要在现有电子签名模块提供专用投影，与资料／任职摘要分请求加载，单个签名失败不阻断资料编辑；保持既有内部账号及签名权限边界，供应商无能力时明确不可用，不自动授予签名权限。返回真实标签／状态／时间，不包含 fingerprint 或虚构 expiresAt；既有登记／撤销契约保持，不伪造签名图片预览。

资料字段扩展必须同时更新 `authorization/permission-catalog.ts` 的 `userUpdatePermissions`：现逻辑只识别 email，若新增姓名／电话后仅改DTO，姓名＋停用的混合PATCH会只要求status权限而漏掉users:update。实现时补姓名／电话＋status／transfer的组合拒绝测试，保持混合变更整体原子校验。邮箱验证失效已经由旧迁移 `20260919170000_email_recovery` 的数据库触发器负责，修改邮箱会清空验证时间及消费旧验证凭证；复用并用真实PG回归，不另写第二套失效规则。个人资料版本与头像／安全版本独立，管理员和本人同时编辑资料须共享资料CAS。

U3给User增列后，A的历史升级测试仍必须保留“旧迁移链→插入旧数据→应用岗位关联迁移→比较原授权”的真实证据。该用例自建历史库可能与最新生成Prisma的默认全部字段返回不一致；通过明确所需select或在升级断言后应用后续迁移适配，不能删掉升级断言或改成先迁移全链再假装旧数据升级。

这些是同范围技术接缝选择，不表示接口或页面已实现；不引入新的业务能力或二次审批。

## 6. 联合验收矩阵

| 场景 | 必须观察结果 | 证据 |
| --- | --- | --- |
| 映射保存、已有在岗人员旧会话 | 自动生效，后续鉴权采用新结果或受控重新认证 | PG／API／登录浏览器 |
| 撤映射／结束任职／停用岗位 | 独占权限立即失效，旧会话不能继续；操作者自撤权无重复写 | PG／并发／浏览器 |
| 直接＋P＋Q三来源 | 角色去重且来源完整；逐个撤来源不误删，最后来源撤后才失权 | 单测／PG／Web |
| 角色权限或MFA改变 | 直接及继承人员均受影响，未完成MFA不能用新敏感权限 | PG／身份回归 |
| 越组织、供应商治理角色、低权限人分配高权限岗位 | 拒绝、数据不变、拒绝审计符合原规则 | PG／API |
| CAS／同异payload幂等／审计故障／并发 | 冲突保草稿、重放正确、失败回滚无半授权 | PG／Web |
| 岗位使用角色删除、自锁、仅编辑直接角色 | 拒误删、不自锁、继承不误存直接角色 | PG／角色回归 |
| 本人／管理员资料及篡改治理字段 | 资料版本正确、拒越权，审计不记电话原文 | PG／API／Web |
| 签名无权限／错误 | 区分不可用／无签名／失败，不含指纹原文，不阻断资料 | API／浏览器 |
| 多权限角色详情／组织切换／失权 | 摘要有限，实际权限全可查，旧详情清除，关闭焦点恢复 | Web／浏览器 |
| 双门户、三宽、六主题、中英、长姓名／多岗位／错误草稿 | 两区对齐或叠放、局部滚动、键盘、36／44目标及真实空态 | 浏览器／人工 |

## 7. 交付、回退及关闭

- [ ] 各单元完成红绿灯、规格后质量审查、主代理适用门禁，登记实际版本／Issue／分支／PR；按持续授权接续常规PR，明确仅本地或CI条件限制时到真实边界报告，不重复触发。
- [ ] 基础授权变更至少完成归档隔离、契约、Web/API、真实PG、构建和Compose；完整阶段验收依权威流程。U1用前端影响门禁，不伪造新数据库结果。
- [ ] 最新PR head／base检查通过且集成发布获准后依赖合并，核验main CI、完整SHA／镜像、迁移前加密快照／迁移、API／Worker／Web健康及线上目标。失败接续原目标，不用旧PASS放行。
- [ ] 岗位映射和全部鉴权消费者同批上线，不能先存映射后补Guard。增量迁移保留资料和关联；回退到旧授权前须按批准流程处理继承来源及会话，不能清库或把继承批量复制成永久直接角色。
- [ ] 最终生产版逐需求及联合回归；机器、CI、部署、人工分别记录。REQ-0022自动授权未完成不能整体关闭，REQ-0023可独立验收。
- [ ] 有关闭／回填授权且验收成立后才关闭Issue、最小写飞书并回读；READONLY不绕过。规则沉淀到ACCOUNT-ADMINISTRATION／SECURITY／OPENAPI／FRONTEND-DESIGN，不新建平行规范。

## 8. 本次策划自检与验证

本轮仅文档，不启动数据库、Worker、业务浏览器、云端CI或部署，不把历史PASS计入新功能。完成后运行 `corepack pnpm check:governance` 和 `git diff --check`，记录实际结果；实现任务仍未执行，机器人初稿与聊天确认的差异未写回台账。

### 策划自检实际结果

- 台账 revision261回读：两条仍为P0／开发中，record_id、目标、初稿、验收与上一轮评审一致，has_more=false；后续自动生效决定来自本聊天，不伪装为机器人原稿。
- 规格逐项覆盖U1/U2/U3及验收矩阵，重点包含多来源保留、角色/MFA变化、旧会话、角色删除、自锁、组织/供应商、资料并发和签名契约差距。所有实现任务仍未执行。
- 本轮 `corepack pnpm check:governance` exit0：36文档／289本地链接／20来源复核／123依赖对及阶段覆盖1项通过；原始日志 `D:/WorkSpace/QMS-2.0-local/req22-23-planning-governance.log`。新增根目录规格／计划作为复核来源登记，不错误注册为实现根内的权威工程文档。
- 本地保存规格、计划、README及索引，未改业务代码、权限/迁移、飞书记录、Issue或PR，未推送、部署、触发Actions或连接数据库；业务测试不适用本次文本策划，不虚构TDD/业务PASS。

### U1 本地实现与复审（2026-10-20）

- 初次实现者 Mendel（`01a154a5-61d8-7bb1-9e3a-74dc72aa5a4f`）完成三文件；规格审查 Lovelace 发现组织切换请求期间旧角色可重新打开详情，未判 PASS。中断后原实现者不可用，Kepler（`01a154d5-044c-7de1-8a80-9ea985b36354`）仅补该缺口，先红灯后在加载 Effect 清空 roles／catalog，原请求清理标记保留；定向20/20通过。
- Mencius（`01a15512-0f58-7183-bcb4-de3452eab114`）只读规格复审 PASS；Pascal（`01a15513-b261-78b2-859e-1ee9763ee0f0`）独立质量审查 PASS。两者均仅静态审查，未伪称运行测试或浏览器。
- 主代理冻结源码后，从 `apps/web` 执行第3节两文件命令，实际26/26通过；Web lint及生产build exit0，仅既有useForm与大包警告。初次误从实现根调用Vitest的 MODULE_NOT_FOUND不算测试红灯，已使用正确路径独立验证。
- 治理初次发现本计划更新后的来源摘要未同步，已复核文档语义后更新索引再检查；原始失败与最终结果保留在 Git 外日志，不删改失败记录。
- 主代理另跑 `permission-matrix.test.tsx`，29/29通过，包含角色创建／复制、权限基线冲突草稿、权限矩阵保存及失权卸载导航保护；加上管理交互与语言共55项通过。`contracts:check` PASS、契约无变更；治理最终36文档／291链接／20来源复核／123依赖对及阶段覆盖通过。复核日期索引按检查器的UTC日期登记，正文工作日期仍使用Asia/Taipei；未修改检查规则。
- 真实业务人工清单：部署包含本次U1的版本后，用持 `account:roles:read` 的内部管理员，在角色清单验证多权限摘要最多两个模块、详情完整且可搜索、Enter／关闭焦点、组织切换加载及失败不残留、失权清理；另验创建／复制／编辑／删除、矩阵409草稿、六主题及1440/1024/390表内滚动。无读取权限账号不见清单／详情，接口拒绝沿既有后台授权。本清单全部待真实执行，不能依据代码审查批量勾选。

### U2-B 首轮与规模返修（2026-10-20，复审已通过）

- Boyle完成11生产／14测试文件；有效业务红灯18失败／2通过，初次夹具导入及创建错误不计红灯。全API非integration初跑124失败，逐一补统一读取需要的真实fixture形状后600/600通过，未添加生产fallback；消费者真实PG22/22，正式lint和治理通过。冻结清单、红绿原始失败及最终记录在 `req22-u2b-frozen.json`、`req22-u2b-handoff.md`。
- 主代理冻结后独立运行 `corepack pnpm --filter @qms/api test`（53 suites／600/600）及消费者PG22/22，日志 `req22-u2b-main-unit.log`、`req22-u2b-main-pg.log`。Noether（`01a1553b-ed41-7a01-82da-919c190b6a1a`）规格审查PASS。
- 主代理对新 `affectedUsers` 逐人授权读取追加真实PG规模探针：1000名直接成员引用同一角色，修改mfaRequired在5122ms失败P2028，日志 `req22-u2b-scale-check.log`。该探针自建组织／用户并在finally清理，不是生产压测；没有修改事务超时。Fermat（`01a1553f-28bb-7013-a523-5f6973aea292`）质量审查将此列为P1并判不通过，未声称其它尚未审完项目PASS。
- 原实现者收到反馈后窄范围返修：允许从现有公共helper抽出共享有效任职where谓词，以单次关系查询求受影响用户，保留全部组织／时间／状态边界。须先补规模业务红灯，再通过A原10＋18、B原600＋22及新回归，之后重新规格／质量审查。不得以缓存、增加超时或Skip解决；新helper修改后的证据不能沿用旧快照。U2-B未提交、未生成最终contracts，后续U2-C及U3仍待执行。
- 返修实际：旧代码新增1000人MFA／权限规模用例分别5621／5088ms P2028；新共享谓词＋单次关系查询在实现者最终运行中152／170ms通过，同key重放38／32ms，不重复使新会话和reset失效。没有增大5000ms事务期限或添加缓存。主代理重新执行完整API600/600及A10＋18／B22＋新2共52/52，日志 `req22-u2b-p1-main-unit.log`、`req22-u2b-p1-main-ab.log`；定向测试过滤时出现的skipped不替代这次完整52项结果。
- Noether对26文件冻结版本及共享谓词重新规格复审PASS；Fermat补完全部测试diff和连接调用后完整质量／安全复审PASS，P1消项。主代理运行 `contracts:generate`、`contracts:check` 及Web lint均exit0，生成来源DTO已经纳入本地整合，日志 `req22-u2b-contracts-*`。性能结论仅覆盖这次真实PG1000人场景，不外推更大规模；全套API integration、Worker及业务浏览器仍待最终联合验证。

### U2-C1 后端岗位写入与审查接续（2026-10-20）

- Darwin的C1实现先取得10项真实业务红灯，覆盖接口缺失、权限旁路、未来结束任职、停用后旧会话；随后补齐角色可授予性、锁等待后过期权限复验、操作者自锁、1000人批量失效和审计回滚。一次性 PostgreSQL／Nest HTTP与审计回归最终 `2 suites / 89 tests PASS`，关键日志 `req22-u2c1-main-pg-retry2.log`；1000人单独回归先出现嵌套查询事务超时，改为直接 `UserPosition` 去重查询后通过，原始失败保留。
- C1规格复审 PASS。首轮质量审查发现三个阻断：新增路由尚未生成 contracts、部门／岗位锁顺序可能反向死锁、Int版本上限递增可能500。主代理已重新生成 `packages/contracts/src/generated/api.ts`，`contracts:check` PASS；岗位更新改为组织→部门集合→岗位锁顺序，最大roleVersion写前返回受控409并新增真实PG回归。修复后等待独立质量复审，未把首轮质量结果当最终PASS。
- 整仓非integration门禁完成API侧 `53 suites / 601 tests PASS`；Web全量实际为91文件中4文件失败、658项中11项失败（647通过）：account-center 3项超时、SupplierUsersPanel 5项超时、UserMfaPolicy 2项超时、SupplierQualityTargetsPage 1项找不到“实际与流程”按钮，另有teardown后的MutationObserver异常。此前摘要只提MFA两项且称“既有”的表述不完整；尚未独立隔离复现，不能归因全部为环境或历史问题。完整日志 `req22-u2c-main-workspace-test.log` 保留，最终Web门禁仍未通过。
- C1的89/89在最后锁序与数据库Int最大值修复前执行，不能代替最新源码全部回归。2026-10-20补跑精确最大值2项在恢复后的真实PG上通过（`req22-c1-int-ceiling-restored.log`），覆盖输入越界400及数据库已到上限409；其余受影响并发／锁序仍须在后续最新源码联合回归中重新验证。新生成contracts检查、API lint通过；不以只读审查替代缺失运行证据。

### U3 后端本地检查点（2026-10-20，两阶段审查通过）

- 新实现者 Mencius（`01a15707-7d53-7902-b988-8db480db5225`）在28个API文件中新增资料迁移、本人CAS／HMAC幂等／受控审计、管理员资料维护、仅本人home的概览、独立签名摘要。API回执只存标识和版本，重放读取当前受限投影；不持久化电话／姓名原文到幂等JSON。
- 先有业务红灯，再补管理员提交后目标被并发转移的投影越界红灯、目标锁等待期间岗位授权到期却提交资料的红灯；修复后在目标锁之后、第一次资料写入之前重新验证认证及全部所需权限。日志 `req22-u3-red.log`、`req22-u3-projection-red.log`、`req22-u3-lock-expiry-red.log` 均保留。
- 主代理独立执行U3的33项真实PG／HTTP＋A的18项历史升级（51/51），完整API602/602；生成新contracts并检查PASS，日志 `req22-u3-main-pg.log`、`req22-u3-main-api-unit.log`、`req22-u3-main-contracts-*`。A历史库先保留旧链升级断言，再应用资料迁移，未删除真实升级证据。
- Linnaeus（`01a15721-37d0-7122-80ce-a34e2cdc3958`）规格审查PASS；Maxwell（`01a15724-d970-7a42-8ca5-572c088633e0`）独立质量／安全审查PASS，28/28文件指纹一致。28文件清单 `req22-u3-source-manifest.json`；本人账号Web／管理员资料及来源Web由Gibbs接续，真实业务浏览器和最终联合门禁尚未完成，不将后端检查点当REQ-0022完成。
