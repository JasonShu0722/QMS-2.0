# REQ-0024 岗位即角色与创建用户授权实施计划

> 执行使用项目 `qms-superpowers-zh`，按 `subagent-driven-development` 分派独立实现任务，先 TDD，再规格与质量审查。共享活动 checkout 的 Git、生成契约和治理索引由主代理串行管理。

## 当前摘要（2026-10-22，Asia/Taipei）

- 目标：按负责人“岗位就是角色”修正规则，岗位直接维护权限，创建内部用户选岗即任职授权；非目标为全站导航重做和未经批准的历史授权删除。
- 批准：当前会话明确“修正”后“继续”；飞书 `reczz28QHcHW1mL3`／REQ-0024 revision284、P0／开发中。原始业务背景历史“仅登记”不覆盖后续直接授权。允许本地设计／开发／验证及常规 Issue／PR；合并发布、破坏性数据转换和关闭回填另核对。
- 映射：REQ-0024 → [Issue #62](https://github.com/JasonShu0722/QMS-2.0/issues/62) → `codex/req-0024-position-role` → PR尚未创建。交付版本V0.0.27：已核对origin/main至V0.0.26-fix6、当前提交记录及GitHub Issue/PR搜索无V0.0.27占用；本计划登记，首次提交为规格／计划，不表示功能完成。
- 基线：最新 `origin/main`／`5b01f39d0c6ce4cc6210c5a747be2d68aa4b56ab`；原分支 `171ca28` 与其内容无差异但不是同一祖先链，故从 origin/main 新建功能分支，未合并旧分支。Git切换前工作区、索引干净，无进行中合并／cherry-pick；唯一实现位置仍为 D 盘活动 checkout。
- 工具：加载 Git 外 Enter-Qms.ps1 后 Node24.21.0、pnpm11.19.0。当前 shell 无 gh，使用已连接 GitHub 工具真实查重／建立 Issue，不为此安装额外工具。
- 当前检查点：规格／计划独立复核已闭环；实现子代理 `canonical_position_implementation` 正按A首批编写红灯，尚无业务实现PASS。只读独立盘点 `authorization_design_review` 与 `onboarding_surface_review` 已发现 canonical API旁路／回放与批量独立路径风险，尚非实现审查PASS。
- 本地资源／证据：Git外 `D:/WorkSpace/QMS-2.0-local/req24-20261022/` 保存批准快照、安全测试环境与原日志；仅新建一次性PG容器 `qms-req24-pg-20261022`，loopback57624、384MiB／1CPU，未连接55440。基线迁移成功；首次seed因缺development与种子密码安全拒绝，补仅进程随机测试密码后seed成功，原失败保留。无浏览器／Worker／生产服务启动。
- 文档门禁：原始把根spec/plan列为工程内documents触发路径越界FAIL，已按既有索引机制改为README链接及review source；未修改验证器。修正后check:governance通过（36文档／305链接／123依赖对），git diff --check通过；这些仅为治理证据，非业务PASS。
- 下一动作：规格／计划独立复核，先实现岗位权限唯一归属与旧API资源封禁；再基于稳定契约打通单个／批量用户入口。未完成单元不冒充需求整体完成；生产历史迁移停在逐ID差异报告及独立授权检查点。

**目标：** 一份岗位业务配置、同一有效授权链、创建账号和任职原子提交。

**架构：** 复用 Role／RolePermission 与 PositionRole，新增可约束的 canonical 归属标记，不增设平行 PositionPermission。公共事务接缝服务账号创建与批量逐行写入，守住权限上限、会话、CAS、审计与幂等重放。

**技术栈：** NestJS、Prisma/PostgreSQL、Swagger生成契约、React/Ant Design，现有 Jest/Vitest/Playwright。

规格见[设计](../specs/2026-10-22-qms-position-as-role-design.md)。当前问题结论为“优化后开工”：原双对象模型已由负责人明确否定；使用内部唯一归属保留运行时引用，不能仅改文案隐藏旧API。

## 单元与文件所有权

| 单元 | 主要文件 | 责任与验收 |
| --- | --- | --- |
| A 唯一岗位授权 | `apps/api/prisma/schema.prisma`、新增迁移、`modules/organization/organization.service.ts`／dto／controller、`modules/authorization/admin-role.service.ts`、`common/security/position-role-policy.ts` | 自动canonical归属、直接编辑岗位权限、旧API及重放保护、历史来源只读 |
| B 创建与批量 | `modules/identity/admin-user.service.ts`／`admin-user-batch.service.ts`／dto、`identity.module.ts`、组织公开事务服务、`governance/module-boundaries.json` | 单／批共享岗位校验与原子任职、预览基线、逐行错误、供应商不受内部必填影响 |
| C 管理界面 | `features/governance/StructureAdministration.tsx`／`PositionRolesDrawer.tsx`、`features/admin/AdminPage.tsx`／`UserAdministration.tsx`／`UserBatchCreate.tsx`／`PermissionMatrix.tsx`、流程角色选择与本人摘要受影响处、中英字典 | 岗位直接选权限、无新独立角色步骤、建号／调岗／批量、历史兼容分区 |
| D 合同与联合证据 | `packages/contracts/src/generated/api.ts`、API/Web测试、`apps/web/playwright/profile-position-role.spec.ts`或独立新文件、交接／能力／规则文档 | 生成契约、真实PG／Worker／浏览器、最终回归及授权交付闭环 |

共享权限目录／错误码／生成契约／治理和Git由主代理维护。前端以B稳定契约为前置，不能与其并行猜接口；A和B对组织服务的修改串行。

## 任务 1：规格、基线与Issue

- [x] 按 record_id 回读当前字段、确认修正方向与授权，无需重复请求批准同一岗位即角色方向。
- [x] 核对活动位置、Node/pnpm、Git工作区、origin/main和旧分支差异；创建专用功能分支。
- [x] 查重REQ-0024后创建Issue#62，固定需求、范围、A～D与验收。
- [x] 独立只读规格审查提出三项：岗位200与内部角色150字符边界、遗留只读旧API完整清单、批量历史摘要重放；主代理补齐后原审查代理回读确认无新增阻断，不等于实现审查通过。
- [x] 运行 `corepack pnpm check:governance` 和 `git diff --check`；原索引失败及修复如顶部记录。仅提交规格／计划及导航索引，业务单元仍未完成。

## 任务 2：岗位权限唯一归属（A）

文件：A单元所列，测试新增 `apps/api/test/organization/position-permissions.integration-spec.ts` 和对应轻量单测。实现代理只改分配文件；主代理生成契约。

- [ ] 红灯：canonical岗位自动建角色并只对应一个岗位；非canonical再绑定该角色／UserRole分配／角色独立更新、复制、删除与旧幂等重放拒绝；无权仅凭结构维护配置权限被拒。
- [ ] 增量迁移：`PositionRole.isCanonical Boolean @default(false)`，每组织的position／role局部唯一索引，原记录不变。新内部岗位自动生成canonical角色；不在GET里写入。
- [ ] 岗位权限GET/PUT：返回自有权限／MFA／授权基线、历史只读来源、有效人数及selfSessionRevoked；PUT锁后CAS、目录／上限／审计／防自锁。旧岗位显式初始化，不复制历史权限。
- [ ] 共用canonical资源封禁覆盖事务执行与`AdminMutationService`的authorizeResource回放前；同role任意canonical归属均检查，不能只查当前岗位。
- [ ] C收敛门禁必须覆盖无canonical的普通历史角色：通用create/copy/update/delete、UserRole.assign、旧replacePositionRoles停止普通写入；新执行与旧key回放逐项拒绝。只保留受控内部供应商/组织引导路径，不能留下客户端运维豁免开关；未完成此项不能声称一体化已交付。
- [ ] 岗位名150/151/200字符及Unicode码点边界创建/改名通过真实PG；完整岗位名不截断，内部角色名不越150，roleCode稳定，流程选项显示真实岗位名。
- [ ] 真实PG：创建、局部唯一、跨组织、回滚、历史权限保留、空自有权限、MFA、旧会话与actor自锁；流程roleCode资格不变。
- [ ] 规格审查→修复→质量审查→主代理独立验证，通过后按查重版本提交A，完整需求保持进行中。

示例接口输入（最终字段由Swagger固定，不手写前端DTO）：

```json
{"permissionCodes":["workbench:read"],"expectedPermissionCodes":[],"mfaRequired":false,"expectedMfaRequired":false,"expectedRoleVersion":1}
```

真实PG定向命令（运行前必须明确本任务一次性连接并验证非55440）：

```powershell
corepack pnpm --filter @qms/api test:integration --runTestsByPath test/organization/position-permissions.integration-spec.ts
```

若现有script不转发定向参数，使用相同Jest入口显式`--runTestsByPath`，先按原入口完成generate/migrate/seed并记录实际命令，不把默认整套测试误记为定向运行。

## 任务 3：授权预览及建号同事务（B）

文件：B单元及组织公开服务，测试 `test/identity/admin-user.e2e-spec.ts`、`account-batch-schema.integration-spec.ts` 与新增岗位建号集成文件。

- [ ] 红灯：内部建号缺岗拒绝、空权限岗允许且无默认权限、同组织多岗一次成功；任职／审计失败不留账号；供应商专用开通不要求岗位。
- [ ] 公开预览服务返回完整有界基线，基线包括所有相关角色权限／MFA而不只映射版本；用现有keyring/HMAC或显式版本值防止伪造，不建异步Worker。
- [ ] 锁后重新核验预览与操作者，调用组织公开事务任职入口；不另起事务，不放大模块依赖循环。DTO按账号类型区分内部岗位必填，contracts由主代理生成。
- [ ] 批量raw row增加岗位代码／基线并纳入归一化和摘要；逐行权限/引用错误回滚为行错误，认证/组织拒绝整批停止。旧无岗位输入返回明确错误；历史幂等回执不回写。
- [ ] 已存在旧batch仅接受精确历史摘要对应的旧无岗payload读取旧结果；旧未完成行按新缺岗规则记错，不补任职；新batch摘要完整覆盖岗位。同key改变岗位必须拒绝，升级前部分成功/全部成功batch真实PG重放保持原事实。
- [ ] 红绿覆盖重复请求、网络未知、跨组织、撤权、并发映射/角色权限变化、行号重复、临时密码安全、遗留三列表格和供应商链路。
- [ ] 按A相同两阶段独立审查和主代理验证，再进入C。

## 任务 4：一体化管理界面（C）

- [ ] 红灯：创建时岗位必填、组织切换清空、空权限提示、预览迟到丢弃／409保草稿；不出现新独立角色分配步骤。
- [ ] 在既有创建表单加入分部门岗位选择和只读权限预览；不新增向导框架。列表读取任职摘要，用户入口提供调岗及来源，避免逐行N+1。
- [ ] 岗位抽屉改为自有权限／MFA编辑，历史兼容来源只读并明确仍保留；同一配置无平行矩阵写入；角色入口收敛不影响供应商恢复与历史查看。
- [ ] 新批量模板明确岗位代码列及分隔，旧模板清晰报错；重试不生成新幂等键，保存结果未知保留原键和请求。
- [ ] 中英、深浅、390/1024/1440、键盘焦点、未保存保护、StrictMode、退出／失权与自改后401全链验证。
- [ ] 定向Vitest、lint/build、独立规格/质量审查，记录运行范围，不把mock组件测试当真实业务通过。

## 任务 5：联合门禁、历史盘点与交付闭环（D）

- [ ] 运行契约generate/check、归档隔离、governance、API/Web受影响单测和构建；PG真实允许/拒绝/回滚/CAS链串行运行。
- [ ] 流程/通知有效角色SQL与应用计算一致，真实Worker和固定roleCode候选/节点资格回归；附件授权若受统一权限变更影响按影响矩阵补真实对象边界。
- [ ] 在一次性环境完成真实浏览器单建号、批量、岗位权限变更、调岗、多来源及旧会话链。工具不可用保留具体失败，按已批准人工交接机制继续其他工作，不重试安全拒绝。
- [ ] 生成只读历史授权及流程引用差异盘点方案；生产盘点／转换需相应资源授权，不读取生产秘密或猜测现场数据。未获迁移授权只交付方案及测试样本，不称已清理历史授权。
- [ ] 回读需求范围未变后检查最终diff、分配版本、提交/推送功能分支并主动建立PR、附到本聊天。不得在适用验证未通过时称工程完成。
- [ ] 获合并／发布授权才集成；核对最终SHA、迁移、备份、镜像、健康、HTTP及目标行为，再作最终版本回归。
- [ ] 负责人手工验收与关闭／台账写入授权成立后逐项关闭并最小回填回读；未完成保留检查点，不用本地PASS代替上线。
- [ ] 沉淀至 `docs/PLATFORM-HANDOFF.md`、`docs/FRONTEND-DESIGN.md`、`docs/CAPABILITY-STATUS.md` 及本规格的唯一授权语义和迁移边界；索引同步，仅加入实际验证可复用的规则，不复制治理全文。

## 失败与回滚

新增归属标记默认false，不自动改历史授权。代码回退前若已产生canonical岗位，须保护其引用，禁止简单删除角色/标记后让旧写接口随意改权。正式回退演练在一次性真实数据库进行，生产回退另授权。任何失败保留原日志和实际部分提交事实；未执行、CI、部署、历史迁移、人工验收各自单列。
