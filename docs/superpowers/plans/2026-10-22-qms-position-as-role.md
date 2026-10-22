# REQ-0024 岗位即角色与创建用户授权实施计划

> 执行使用项目 `qms-superpowers-zh`，按 `subagent-driven-development` 分派独立实现任务，先 TDD，再规格与质量审查。共享活动 checkout 的 Git、生成契约和治理索引由主代理串行管理。

## 当前摘要（2026-10-22，Asia/Taipei）

> **已提交 Draft PR：[#63](https://github.com/JasonShu0722/QMS-2.0/pull/63)**，关联 Issue #62。实现提交 `4eae689d56a1d48157c81c19eecae7b8790f7e23` 已推送 `codex/req-0024-position-role`，base 为 main／`5b01f39d0c6ce4cc6210c5a747be2d68aa4b56ab`。当前仅完成草案提交检查点；已知语言切换浏览器失败保留，云端 CI 与审查结论待确认，不合并、不部署、不关闭或回填需求。以下“准备 PR／PR 尚未创建”等描述均为历史检查点。

> **最新接续：准备Draft PR，不合并／部署。** 负责人已明确“开源了，继续”，随后确认按“最后两条复测、整理提交及PR”继续；只读GitHub API确认仓库public，未由代理更改可见性。该授权取代下方历史推送前等待条件，不扩大为部署或历史数据转换。实际活动路径为 `D:/WorkSpace/QMS-2.0/qms-2.0`（Get-Location与根AGENTS一致）；下方历史摘要中C盘实施的描述错误，以本句为准；Git外环境与日志保存在独立local目录。

最终业务代码及契约已本地实现，独立规格／质量审查发现的问题已逐项返修；最后仅旧浏览器治理语言切换仍有未通过项。API单测55文件620项通过；真实PG跨身份/角色/流程/供应商5文件127项通过；含真实Worker8项的联合4文件49项通过。Web新入口3文件19项、旧导航/矩阵2文件62项、管理员相邻3文件30项通过；岗位治理原整组29项中2项超时后只修测试查询/禁动画，失败项定向2项通过，分批证据不称单次全绿。

真实浏览器：新岗位配权→原子建号→撤岗及批量部分成功2项分批通过；迁移后account C／matrix2项同批通过（resume-core-browser.log）；客诉导入/只读/独立复核和真实MFA/SMTP找回4项通过（browser-existing-business-1.log）。最后复测pr-final-two-browser.log为1PASS/1FAIL：兼岗双POSITION来源、逐来源保留、最后撤权旧会话401与任务403通过；治理D/F/H在完成结构及CSV导出后，语言EN单选控件不可见而失败。该失败未跳过、未标PASS，不继续扩大修复；Draft状态提示审查者，合并发布前必须解决或取得明确的替代人工验收证据。旧DIRECT+POSITION同角色链由真实PG消费者/岗位治理测试承担，不冒充现浏览器DIRECT证据。

提交前会同步文档、检查生成契约/类型及治理，不重跑已覆盖且源码未变的整套服务；生产历史授权转换、完整全量阶段验收、云端CI与人工验收尚未完成。飞书按record_id回读仍revision284／开发中，未擅自关闭或回填。此前计划下方未完成标记保留阶段历史，不能据此再重复开工。

提交前最终复核：`contracts:check` 与 `check:governance` 均通过（`pr-contracts-check.log`、`pr-governance.log`），`git diff --check` 通过。仅推送功能分支并创建 Draft PR；已核对生产部署工作流只接续 main 的成功 push，本次不触发生产部署。以下旧检查点与下一动作保留执行历史，由本节最新结果取代。

- 目标：按负责人“岗位就是角色”修正规则，岗位直接维护权限，创建内部用户选岗即任职授权；非目标为全站导航重做和未经批准的历史授权删除。
- 批准：当前会话明确“修正”后“继续”；飞书 `reczz28QHcHW1mL3`／REQ-0024 revision284、P0／开发中。原始业务背景历史“仅登记”不覆盖后续直接授权。2026-10-22负责人追加“准备推PR之前停下跟我说声，我要去开源操作一下的”：本地设计／开发／验证／审查和提交继续，推送分支／创建PR前必须通知并等待负责人完成仓库处理及明确继续；不得自行更改可见性。该具体限制优先于常规PR持续授权。合并发布、破坏性数据转换和关闭回填仍另核对。
- 映射：REQ-0024 → [Issue #62](https://github.com/JasonShu0722/QMS-2.0/issues/62) → `codex/req-0024-position-role` → PR尚未创建。交付版本V0.0.27：已核对origin/main至V0.0.26-fix6、当前提交记录及GitHub Issue/PR搜索无V0.0.27占用；本计划登记，首次提交为规格／计划，不表示功能完成。
- 基线：最新 `origin/main`／`5b01f39d0c6ce4cc6210c5a747be2d68aa4b56ab`；原分支 `171ca28` 与其内容无差异但不是同一祖先链，故从 origin/main 新建功能分支，未合并旧分支。Git切换前工作区、索引干净，无进行中合并／cherry-pick；唯一实现位置为 `D:/WorkSpace/QMS-2.0/qms-2.0`，环境与证据在Git外独立目录。
- 工具：加载 Git 外 Enter-Qms.ps1 后 Node24.21.0、pnpm11.19.0。当前 shell 无 gh，使用已连接 GitHub 工具真实查重／建立 Issue，不为此安装额外工具。
- 当前检查点：A岗位自有权限、B单号/批量原子任职及完整预览、有界任职摘要、C3旧HTTP冻结/流程完整岗位名已实现；C2用户界面已冻结供独立审查，C1结构页旧任职入口补预览中。尚未完成联合Web回归、构建、真实浏览器/Worker和最终审查，不称整个需求工程完成。PR／部署／人工验收／历史迁移均未执行。
- 本地资源／证据：Git外 `D:/WorkSpace/QMS-2.0-local/req24-20261022/` 保存批准快照、安全测试环境与原日志；仅新建一次性PG容器 `qms-req24-pg-20261022`，loopback57624、384MiB／1CPU，未连接55440。基线迁移成功；首次seed因缺development与种子密码安全拒绝，补仅进程随机测试密码后seed成功，原失败保留。无浏览器／Worker／生产服务启动。
- 文档门禁：原始把根spec/plan列为工程内documents触发路径越界FAIL，已按既有索引机制改为README链接及review source；未修改验证器。修正后check:governance通过（36文档／305链接／123依赖对），git diff --check通过；这些仅为治理证据，非业务PASS。
- 下一动作：主代理串行接续C1旧任职预览红绿、C2独立审查与整组稳定性，再运行联合契约/构建/治理及真实浏览器/受影响Worker回归；验证审查通过后仅本地提交，在推送/PR前按负责人新限制通知等待。生产历史迁移停在逐ID差异报告及独立授权检查点。

### 本地执行检查点

| 单元／责任 | 实际证据与状态 | 限制／接续 |
| --- | --- | --- |
| A `canonical_position_implementation` | canonical schema、局部唯一、岗位GET/PUT、历史只读来源及旧接口canonical回放保护；红4项预期403实际409，PG红接口404；初绿PG14+单测27共41通过。独立静态规格→质量均无P1/P2 | C3随后冻结全部旧HTTP；不把内部Role存储说成已删除历史角色 |
| B `onboarding_implementation` | 新PG红14项；首绿5suites46项，summary红2项→绿2suites29项；P2行超上限误停批新红→修后20项通过，tsc0 | 独立审查发现测试URL query覆盖P1及调岗重放读取P2，由主代理补门禁纯单测11项与回放前资源重验；供应商真实完整链及锁等待仍待联合回归 |
| C3 `legacy_role_write_convergence` | 17项红15FAIL/2PASS，随后主代理5suites88项全过（C3、B、调岗、矩阵、组织schema），日志main-abc-api.log | canonical旧四方法PG直接调用与HTTP全冻结分开记账；内部可信历史方法并未删除 |
| 主代理补调岗安全 | 调岗缺预览、成功/历史/合法重放、部门漂移3项红→绿；撤users:read后回执重放预期403实际200红→补authorizeAdjustment；随后A/调岗/门禁共3suites29项通过 | 回放不比较已消费旧基线、不重新写任职，但必须重验当前资源读取/授予权限 |
| C1 `position_permission_ui` | 岗位权限界面红19项；主代理初复18PASS/1timeout；单例定位全页role查询成本，限定drawer查询后6.823s→4.675s，不加timeout不改生产 | 旧Structure任职tab遗漏新baseline已接单补调用方，未完成不认定全部前端通过 |
| C2 `user_position_ui` | 新tests红10FAIL/1PASS，基本实现后整批11/12；本人保存后额外GET实际缺陷以父级sessionEnding修复，单self8.38s通过；相邻profile/target/batch24项、draft用户/批量3项通过 | 整批self仍10053ms触及默认10秒，保留失败与待优化；未改timeout，未把单例PASS当整组PASS |
| 原API回归 `legacy_api_regression_alignment` | 3suites124项真实PG通过：旧岗位/角色安全领域用可信服务保留原断言；普通旧HTTP另验证403；新增缺岗、重放/并发仅一任职、审计回滚无任职 | 不将可信服务回归谎称旧HTTP仍可写；未执行整套API/Worker/浏览器 |

主代理第一次独立API命令因Enter脚本重置cwd导致Jest路径未找到，保留a-main-independent.log；改正确API目录后89项88通过/1旧empty-canonical授权预期失败，随后精准调整该旧测试为先拒绝、再授必要两项、用独立target保历史断言，main-abc-api88项通过已覆盖。没有通过全局提升fixture权限掩盖拒绝。

测试门禁的URL覆盖问题只在新测试输入校验，未尝试任何危险URL连接；修复的无DB测试包含query host/port与hash拒绝。所有原失败、定向运行及覆盖范围保存在Git外目录，不累计重叠套件制造虚假的单次总数。

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
- [ ] 回读需求范围未变后检查最终diff、分配版本、完成本地提交；在推送分支／创建PR前停下通知负责人，等待其开源操作及明确继续，不能自行变更仓库可见性。恢复授权后推送、建PR并附到本聊天。不得在适用验证未通过时称工程完成。
- [ ] 获合并／发布授权才集成；核对最终SHA、迁移、备份、镜像、健康、HTTP及目标行为，再作最终版本回归。
- [ ] 负责人手工验收与关闭／台账写入授权成立后逐项关闭并最小回填回读；未完成保留检查点，不用本地PASS代替上线。
- [ ] 沉淀至 `docs/PLATFORM-HANDOFF.md`、`docs/FRONTEND-DESIGN.md`、`docs/CAPABILITY-STATUS.md` 及本规格的唯一授权语义和迁移边界；索引同步，仅加入实际验证可复用的规则，不复制治理全文。

## 失败与回滚

新增归属标记默认false，不自动改历史授权。代码回退前若已产生canonical岗位，须保护其引用，禁止简单删除角色/标记后让旧写接口随意改权。正式回退演练在一次性真实数据库进行，生产回退另授权。任何失败保留原日志和实际部分提交事实；未执行、CI、部署、历史迁移、人工验收各自单列。
