# REQ-0022／REQ-0023 联合实施计划

> 面向执行代理：进入实现后使用项目 QMS Superpowers 和 subagent-driven-development 逐任务分派；共享 Git／契约／语言／文档由主代理管理，不相交写集才并行。[联合规格](../specs/2026-10-19-qms-profile-position-role-design.md)定义范围。

## 当前摘要（2026-10-19，Asia/Taipei）

- 来源：revision261，REQ-0022 `reczz28PGTTvAPTd`、REQ-0023 `reczz28PGW7hLyL5` 均 P0／开发中，回读目标、初稿与验收无变更；负责人确认自动生效、多来源保留与后续请求使用新授权。
- 执行范围：规格与实施策划已完成；REQ-0023 关联 [Issue #55](https://github.com/JasonShu0722/QMS-2.0/issues/55)，REQ-0022 关联 [Issue #56](https://github.com/JasonShu0722/QMS-2.0/issues/56)。实现步骤即将开始，未创建 PR；Issue 建单不代表合并、部署或关闭授权。
- 基线：沿用根AGENTS指定的活动checkout，唯一实现目录为 `qms-2.0/`。规划分支 `codex/req-0022-0023-planning` 从 `e834892` 起步，保留展示卡片修复及原收尾文档。上次已核验生产 `ecf7224`，不是本次实时生产检查。每个新shell先加载 `D:/WorkSpace/QMS-2.0-local/Enter-Qms.ps1`，禁止预览数据库55440。
- 状态：只读调查完成；已有部门／岗位／任职和直接角色，缺少岗位关联及统一继承鉴权。不把签名指纹模块写成可视图片或带有效期的签名功能。
- 映射：REQ-0023→U1→Issue #55；REQ-0022→U2／U3→Issue #56；当前分支 `codex/req-0022-0023-planning`。产品版本在实际 PR 前查重分配，本次不占用发布号。
- 下一动作：先完成 U1 角色清单；随后重新核对 REQ-0022 状态与授权，接续 U2 有效授权链路和 U3 资料中心。不重复确认已定的自动生效规则。外部写入、CI、合并、部署各核对届时授权和仓库状态。
- 证据：Git外 `D:/WorkSpace/QMS-2.0-local/req22-23-planning-readback.json`、需求完整快照、实际源码。没有新业务红绿灯、真实资源、CI、部署或人工PASS；本次文档检查在末节记录。

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

- [ ] 按record_id回读目标／初稿／验收／状态，复用聊天确认；发现撤回或实质改稿暂停受影响部分，不覆盖飞书原文。
- [ ] 查同目标Issue／PR，分别关联U1（REQ-0023）、U2（REQ-0022自动授权）、U3（REQ-0022资料概览），写目标、边界、验收、回退及依赖。本次没有实际编号。
- [ ] 确认展示卡片fix3／fix4的交付顺序和每个PR的base／head，不能把本地已测视为生产基线；不因共享文件混入未验证成果。
- [ ] 每单元新实现者先TDD，之后独立规格审查再质量审查；失败回原实现者修复复审。主代理验证期间冻结源码，Git串行。

U1先独立交付；U2必须从配置到Guard／MFA／撤权完整上线。U3纯资料部分可与U2不重叠部分并行，但最终REQ-0022必须联合验收。

## 3. U1：角色清单

- [ ] 在 `apps/web/src/features/admin/admin-interactions.test.tsx` 或新同目录定向测试先写行为红灯：多权限角色只显示数量和两个模块摘要；Enter打开实际权限详情，搜索／关闭焦点／切组织有效，全局角色仍只读。
- [ ] 执行红灯后改最小表格和只读详情组件；复用目录名称／分组逻辑，不渲染全目录未选项。使用原Table上下4px，不固定裁切行高，局部横向滚动。
- [ ] 回归创建／复制／删除、矩阵保存和409草稿；规格后质量审查。

工作目录 `apps/web`：

```powershell
node node_modules/vitest/vitest.mjs run src/features/admin/admin-interactions.test.tsx src/features/admin/admin-language.test.tsx --maxWorkers=1 --minWorkers=1
```

旧Tag铺满／缺少详情是预期红灯；导入错误或前置故障不是有效红灯。若另建测试，同步精确文件命令，不省略验证。

## 4. U2：岗位自动授权

### 4.1 模型与有效来源

- [ ] 拟建 `apps/api/test/authorization/effective-role-grants.spec.ts`：直接R＋岗位P继承R＋岗位Q继承R，结果一个R三来源；结束P、撤直接仍保留Q，最后结束Q才撤权。
- [ ] 覆盖结束任职／停用岗位或部门／外组织关联／供应商白名单／空映射。迁移后空映射对原直接授权无变化。
- [ ] 实现最小PositionRole、版本和索引；同组织引用及唯一性由真实PG验证。不得用内存Map冒充持久关系。

拟建解析器目标类型：

```ts
type GrantSource =
  | { kind: 'DIRECT' }
  | { kind: 'POSITION'; positionId: string; assignmentId: string };
```

解析器接收Prisma读取／事务客户端和确定的userId、organizationId，返回稳定排序的角色、来源、权限及MFA事实；不把结果写回UserRole，不接受客户端伪造身份。

### 4.2 全链路消费者

- [ ] `AuthorizationService.assertFeature/permissionsForContext`、`adminPermissions/assertAdminAccess`、`AdminRoleService.effectivePermissions/assignments` 改为统一有效来源。
- [ ] 接入OrganizationScopeService、组织树、管理员组织目录；保留内部原跨组织直接管理授权，不因只查归属组织丢失合法角色。
- [ ] 接入mfaPolicy、记住登录管理员判定；角色权限／MFA更新的受影响用户集合包含继承人员。
- [ ] 接入角色删除使用检查、自锁、可授予上限和供应商白名单。只替换直接角色的接口不能把有效角色全部存回直接分配。
- [ ] 改动前后搜索 `userRole.find/count`、`userRoles.some`、`role.permissions` 的每个调用，记录“已统一／直接维护专用”的归属，不能粗暴全局替换。

### 4.3 写入、撤权与管理UI

- [ ] 岗位映射配置包含权限组合、近期验证、CAS、Idempotency-Key及事务审计；同key同payload复用响应，异payload冲突。
- [ ] 映射保存立即影响已有在岗人员；任职变化／岗位部门启停／角色权限修改自动影响后续请求，不建异步追赶任务、不设二次批准。
- [ ] 固定安全版本及锁顺序，授权变化／审计／安全失效同事务；旧会话不能继续操作，敏感在途写入事务内复验，操作者自身撤权不重复写。
- [ ] 管理页面提供可识别用户入口、岗位角色与来源；展示自动生效说明及影响范围。预览不构成审批闸门，本人页没有授权编辑入口。

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
