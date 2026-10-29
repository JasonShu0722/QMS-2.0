# 组织直属岗位与兼容授权迁移实施计划

> 面向执行代理：使用qms-superpowers-zh、TDD及subagent-driven-development；每单元先SPEC再独立QUALITY，共享schema、生成、注册、Git与索引由父串行维护。

**目标：** 让系统管理员可直接任职于组织，并在同一组织岗位入口完成旧角色迁入、解除及清理，不再留下只读死角。

**架构：** 复用Position/UserPosition及canonical Role/RolePermission；部门空值仅表示组织直属。受控迁移预览和提交在所有者公开事务端口中处理，不恢复旧通用角色写接口、不新增权限引擎。

**技术栈：** NestJS、Prisma/PostgreSQL、React/Ant Design、Swagger生成契约，现有工具和依赖不变。

## 当前摘要

| 项目 | 当前事实 |
| --- | --- |
| 设计 | [已确认设计](../specs/2026-10-29-qms-organization-direct-position-legacy-authorization-design.md)，负责人回复“方案没问题” |
| 本次工作 | 文档固化及执行拆解，不开始运行代码/迁移开发，不替用户操作生产角色 |
| 源码 | 运行7fc80d4 / V0.0.35，保留本地发布归档cb182b4；规划分支codex/org-direct-admin-planning |
| 跟踪 | 新功能范围不以REQ-0031已部署代替；正式启动时先回读需求/查重关联Issue并按实际已预留版本登记，不在纯文档阶段虚报ID/版本 |
| 顺序 | A直属岗位基础→B受控迁移/清理→C正式UI；共享验证/发布检查点串行，不把仅前端取消必填或只复制权限视作完成 |
| 停止 | 书面设计/计划验证归档后交负责人审阅；开始运行代码、合并部署与生产迁移分别按有效授权推进 |

## 1. 写集与复用接缝

| 单元 | 写集 | 完整职责 |
| --- | --- | --- |
| A 岗位归属 | apps/api/prisma/schema.prisma及追加迁移、common/security/effective-role-grants.ts、effective-role-membership.sql.ts、organization.service.ts/organization.dto.ts、position-onboarding.service.ts、organization-responsibility.service.ts、必要领域候选消费者 | nullable部门、直属有效性、统一授权/任职预览/目录/删除补配和真实业务候选边界 |
| B 迁移清理 | organization新专用兼容授权服务/DTO/controller、authorization公开角色读取/受控变更端口、身份所有者撤权端口、模块注册及只在确有必要时依赖清单 | 精确来源预览、稳定roleCode、same-tx迁移/清理/归档、审计/幂等/CAS及自锁保护 |
| C 正式页面 | apps/web/src/features/admin/AdminPage.tsx、governance/OrganizationWorkspace.tsx/StructureAdministration.tsx/PositionRolesDrawer.tsx、admin/RoleAdministration.tsx既有只读详情的复用与兼容迁移面板 | 组织直属选择、统一兼容入口/授权来源、去顶层历史页、实际来源操作及未知/失权/窄屏保护 |
| 父共享 | Swagger生成packages/contracts/src/generated/api.ts、根设计/计划及运行交接/索引、最终整合与Git | 不并行生成，不改旧迁移或越界写生产资料 |

开始每个单元前列出上述修改的全部调用者、fixture与导出；未触及的历史大模块不为了统一风格重构。

## 2. A：直属岗位与有效任职

- [ ] 先新增真实`test/organization/organization-direct-position.integration-spec.ts`：departmentId=null创建/更新/赋权/任职可用；非本组织部门拒绝；待配置部门不能借null静默复活；删除业务部门不影响直属岗；修改岗位归属须版本确认。
- [ ] 对有效授权ORM和SQL分别添加同一fixture的允许/拒绝：组织/岗位停用、用户停用、任职未来/到期、直属平台marker及普通同名岗位、供应商拒绝，先真实RED后实现。
- [ ] 最小追加迁移仅允许新模型，不批量改旧岗位部门；保同组织复合外键。DTO明确null/undefined语义并同步序列化，不引入与departmentId重复的scope字段。
- [ ] 修改有效任职、授予预览、岗位目录和公共结构投影的空部门分支；业务工作流责任候选仍要求实际科室/管理绑定/部长分管。
- [ ] 跑直属新文件、`position-permissions.integration-spec.ts`、`position-onboarding.integration-spec.ts`、`workflow-effective-role-sql.integration-spec.ts`与责任恢复相关完整文件；冻结后SPEC、独立QUALITY，父复核真实结果。

## 3. B：角色受控迁入与清理

- [ ] 在`test/organization/legacy-authorization-migration.integration-spec.ts`先写：QMS_ADMIN直接来源→直属岗位后有效权限/MFA/roleCode/platformScope不变且无重复来源；有其他成员的目标岗位必须显示扩散影响；共享来源只变确认子集。
- [ ] 预览固定roleId、organizationId、目标岗位/归属、原canonical及直接/映射来源、任职有效期、MFA、权限、流程roleCode和相关版本；摘要绑定真实actor与scope，不以同计数代替来源一致。
- [ ] 单次事务先验证真实功能权限/近期认证、精确范围、授予上限和替代资格，再锁后重采、转自有权限/任职、解除确认旧来源、归档事实并撤旧会话；存续账号保留MFA和封锁，不走永久删除清理目的。
- [ ] 一对一迁入优先承接原稳定角色为canonical；复杂共享场景预览明确各来源去向与旧code资格，不重写已发布流程。现有canonical角色不能被通用角色HTTP更改/直接分配。
- [ ] 加真实清理回归：空角色、仍有用户/岗位但同次明确转岗/解除、固定流程/历史保留、初始化来源可处置且旧创建回执不复活；不凭ORGANIZATION_GOVERNOR或test字符串批量清理。
- [ ] 加真实并发/安全回归：最后平台管理员原子替代、两管理员并发操作、到期等待、同数来源替换、同key回放撤权、审计失败全回滚；先业务RED后最小实现。
- [ ] 完整运行新迁移文件及既有`legacy-role-http.integration-spec.ts`、`position-role-governance.integration-spec.ts`、`admin-user-reconfiguration-mfa.integration-spec.ts`等实际受影响完整文件，SPEC后独立QUALITY；父验证实际补配/登录链和固定roleCode资格，不只比权限数组。

## 4. C：契约与正式界面

- [ ] A/B DTO及服务装配冻结后父串行运行`corepack pnpm contracts:generate`和`corepack pnpm contracts:check`，只提交实际生成契约。
- [ ] 用既有独立样例展示组织直属选择、旧角色三种处置及前后来源影响，明确本地演示；样例确认不冒充业务验收，正式页面不导入样例实现。
- [ ] 正式“组织与岗位”提供直属岗位及兼容迁移/清理入口；移除独立“历史授权”顶层页，旧定位链接可引导新只读详情，但不恢复旧独立写接口。
- [ ] 先组件RED覆盖迁移/清理预览确认、取消不写、共享岗位影响、稳定目标、401403清敏、409保原草稿并重预览、未知原body/key重试、切组织旧响应、键盘/375宽度；最小正式实现后完整文件默认预算GREEN。
- [ ] 独立SPEC后QUALITY及父真实浏览器按实际组织/用户/任职验证：管理员迁移前后重新登录均有平台入口，旧直接来源消失，新岗位生效；清理test/治理来源不误删历史/其他scope。仅用一次性环境，生产迁移不在测试中执行。

## 5. 统一验证和交付检查点

所有实现/验证shell先加载`D:/WorkSpace/QMS-2.0-local/Enter-Qms.ps1`。测试使用标记的一次性资源，禁止55440，不清历史预览/上传，不改旧134份迁移。密码安全、默认测试预算/动效、真实PG/Worker/对象扫描/browser前置不能为提速弱化。

```powershell
corepack pnpm check:archive-isolation
corepack pnpm contracts:check
corepack pnpm --filter @qms/api lint
corepack pnpm --filter @qms/api build
corepack pnpm --filter @qms/web lint
corepack pnpm --filter @qms/web build
corepack pnpm check:governance
git diff --check
```

测试清单按A/B/C实际改动冻结后串行运行完整文件，JSON断言全绿仍要退出0且无未捕获异常；多轮失败保留，完整文件组合必须有唯一清单/源码依赖证明，不拼同文件case。Compose配置校验和独立compiled Worker按实际Foundation影响执行，缺前置明确FAIL，不用Mock/Skip代替。

| 检查点 | 进入条件与动作 | 不代表 |
| --- | --- | --- |
| 正式启动 | 回读需求/人工批准、复用或建聚合Issue并登记版本；已批准设计不再重问同一业务规则 | 方案确认不是已执行生产迁移或已上线 |
| 本地整体完成 | A/B/C打通、各自SPEC→QUALITY、父统一真实验收/治理；所有失败和未覆盖明确 | 只改nullable、只迁一条来源或只隐藏旧页不是交付 |
| PR | 当前单元已覆盖后同一功能分支提交推送一个PR，回写实际Issue链接；确认可见性再触发CI | 不因上次公开过就假设仓库仍公开，不含自动合并部署 |
| 发布 | 新head完整CI/审查与有效发布授权后合并→mainCI→快照/迁移/同SHA运行/公网新契约 | 生产岗位/任职自动迁移或人工验收 |
| 生产转换 | 按精确来源生成迁移预览，负责人确认指定批次后执行，重新登录并回读授权来源 | 不按角色名批量赋权/删授权，不静默代办其他账号 |
| 关闭归档 | 逐需求/联合回归验收、获授权才关闭回填并回读；记录无新增规则或沉淀防复发 | 代码合并不是整包业务闭环 |

本次文档固化到此停止，不创建假Issue/REQ、不修改飞书状态、不恢复heartbeat。后续开工使用本计划直接接续，不重新盘问已确认方案。
