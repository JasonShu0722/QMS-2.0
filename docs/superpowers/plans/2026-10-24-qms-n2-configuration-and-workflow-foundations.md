# N2 组件项目映射、组织职责与流程基础实施计划

> 面向实现者：使用项目 qms-superpowers-zh 路由，按 subagent-driven-development 逐任务 TDD、先规格后质量复核；公共契约、权限目录、模块注册、索引和 Git 由主代理串行整合。

## 当前摘要

| 项目 | 当前事实 |
| --- | --- |
| 目标 | 接续既定 N2，复用 N1 真实组织岗位，交付组件项目映射、管理职责 / 分管及动态流程基础；不启用新问题业务 |
| 批准来源 | 原讨论 / 路线已批准开发；2026-10-25负责人“已开源，继续”接续推PR，随后对明确“合并PR #67并执行生产部署核验”请求回复“继续”，已授权N2-A合并及自动部署；不扩为生产岗位配权 / 业务数据维护 / 关闭回填 |
| 基线 | N1生产此前为`b4e51150e934314889287980d062fe389a89561b`；N2-A PR #67已squash合并至main `70fdbabb1a5394c2cbbd5896a4e3068f4452e6bf`，其源码树与受检head e5b1465一致。活动分支保留本地PR证据归档5bfd7a7，未额外推送 |
| 映射 | [Issue #66](https://github.com/JasonShu0722/QMS-2.0/issues/66)；REQ-0025 / reczz28RDS4BlbBs、REQ-0026 / reczz28RDS4BnuCp；V0.0.29用于N2-A，[PR #67](https://github.com/JasonShu0722/QMS-2.0/pull/67)，head `e5b1465a5e65c5183ff8888d7dbcb57046e9b4d8`，base `b4e51150e934314889287980d062fe389a89561b` |
| 需求核对 | 启动时user身份revision298、has_more=false，分别开发中/P1及开发中/P2；提交前两实际record_id回读revision300、has_more=false，REQ-0025状态现为“上线验收完成”，REQ-0026仍“开发中”，原范围字段未变。此状态变动不代表尚未部署的N2-A已验收，也不反向改表；本轮组件新要求有直接会话授权。CLI旧版复用已验证token，不更新CLI或改表 |
| 本地基线 | 治理通过：37文档 / 324链接 / 20来源 / 125模块依赖；根工具71项通过。N2一次性PG仅回环55473、任务标签，原104迁移；不连接55440 |
| 公开边界 | 负责人已公开且实时核对public，O2满足；合并 / 发布已获本轮后续明确授权并执行检查点。代理未改可见性，等待main完整检查及自动部署逐层核验后才提示可闭源 |
| 生产边界 | N1正式页面人工验收尚待完成；真实公司结构由获准人员维护。N2本地测试可用隔离fixture，不依赖或修改生产结构；D2/配置/绑定/试点开通分别受控 |
| 当前进度 | N2-A生产保持70fdbab。负责人“继续开发”后N2-B/B1真实关闭职责解析、只读配置预览及纯策略已本地完成，独立规格 / 质量返修关闭；最终流程 / 组织邻接312项、API unit744及构建 / 契约 / 治理通过。分支codex/qms-n2-workflow-foundations、V0.0.30预留，同Issue #66；B2轮次 / B3待办 / B4设计器仍待实现，不发B1为完整N2-B PR，不放行新schema / 新8D |

## 1. 范围与结构

依据[整体路线N2](2026-10-24-qms-problem-management-delivery-roadmap.md)、[需求清单006～010/029～030](../specs/2026-10-24-qms-problem-management-requirements-list.md)与[原研讨规则D61～D65](../specs/2026-10-23-qms-domain-problem-management-discussion-draft.md)。原话确认不重开；技术实现不新增审批路线或强制字段。

- 组件编码唯一映射到本组织项目及产品大类/细分。项目集中保存新品/量产状态和两类可空质量工程师，同项目不同组件共用；不拿失效物料码替代组件键，不按编码猜阶段。
- 项目映射主数据与既有新品阶段门分清事实拥有者：映射状态不能自动通过阶段评审、量产移交或改写历史已发问题。既有项目标识能复用时复用，不为页面强迫新建阶段门项目。
- 维护使用一项可配置权限，不依岗位名硬编码管理员/项目质量室经理；读取和选人仍校验组织/有效用户及岗位。人工工程师优先，空值可补入；公共解析输出缺映射/差异提示，不在N2偷偷改写各域台账/审批快照。
- 职责绑定已有科室/部门、岗位和有效任职。经理按科室，部长分管关联具体任职；同科室同期唯一部长，支持同账号经理/部长双职责。历史保留、跨组织/失效/多候选不能任取一人。
- 流程配置复用这些动态职责：模板草稿不带开发UUID、不自动发布绑定；旧已发布版本兼容。专业/管理并行、管理侧分级、同人确认/跳过与整轮退回重审按既定规则各自表达，不建设通用BPMN。

### 1.1 2026-10-25 负责人直接补充

以下为本会话新直接要求，覆盖此前双页签样例的呈现，不是机器人改稿；飞书原十字段未擅自覆盖，工程记录在Issue #66及本计划接续。

1. 映射页面只保留**一张组件清单，一行一个组件**；项目资料通过选中/编辑弹窗集中维护，不再单列“项目资料/组件映射”两张表。共享项目状态/工程师仍由同一项目记录拥有，不因一张UI表扁平复制数据库字段。
2. 增加基础清单批量导入：`PROD_ID / 成品编码 / 组件号` 对应componentCode，`MTRL_NAME / 物料名称 / 组件名称` 对应componentName。支持截图的英文/中文表头及双行显示，不把此数据写入“不良物料”主数据。编码前导0、点、横线以及名称中的逗号/括号/标记按文本保留，不猜项目/产品类型或AI改名。
3. 基础导入只新增组件号/名称；重复组件号跳过并报告，不覆盖已维护名称或项目关系。项目/大类未配置的基础行也允许先入表，显示未映射小感叹号，后续补齐恢复；不编造名称或默认量产。原未发布映射表追加component_name、允许project/category未配置，旧已应用迁移不改，新迁移另追加。
4. 支持跨页点选本组织组件，批量设置项目号、新品/量产、两类质量工程师及分类。只写明确勾选字段，不以未填写当作清空；不批量覆盖唯一组件号或名称。共享项目stage/人员变化先预览所涉项目及未选同项目组件的影响数量，再确认提交。
5. 批量维护每次最多100选中行，服务端预览与提交绑定同选择、字段、版本和影响范围指纹；变更过期409要求重新预览，单事务执行不部分成功，幂等重复不重复落账。权限仍component-project:manage，不增加隐式管理员或对外操作。

导入界面复用既有MasterDataImport、read-xlsx与import-batches，沿用已安装ExcelJS，不新增依赖。导入与批量维护由不同实现者持有分离文件，迁移/真实PG验证串行或在明确隔离的55473/55474执行；生成契约在每次字段冻结后统一更新，不将旧生成文件审查误作最新版本。

## 2. 文件所有权与依赖

| 写集 | 所有者与职责 |
| --- | --- |
| 组件/项目映射领域服务、DTO/控制器、定向测试 | 独立实现者；具体挂接复用现有主数据/组织模块，先核对源码后固定文件；不改权限目录、AppModule、生成契约或别的任务文件 |
| 组织职责/分管领域服务、DTO/控制器、定向测试 | 独立实现者；复用Organization/Department/Position/UserPosition公开能力；与映射写集分离 |
| 迁移、权限目录/seed、模块注册、组织依赖投影、生成契约 | 主代理串行；检查新增数据对N1删除/停用、任职撤换、审计标签和管理员授予上限的影响，不漏调用者/fixture |
| Web映射维护、职责维护/预览 | 契约冻结后独立实现；仅用生成类型，复用AdminPage/OrganizationWorkspace与既有Form/表格/草稿保护，不导入原型业务模型 |
| workflow定义/版本/运行时/任务与草稿模板 | 配置接缝稳定后串行推进；先有旧版本兼容与新行为失败测试，再实现最小动态分派/并行/轮次能力 |
| 计划、交接、能力/验收、索引、Issue/PR/版本 | 主代理；工程/CI/部署/人工分别记账，更新已有事实不覆盖历史 |

N2源码规模若需拆成配置与运行基础两个可独立验收/回滚单元，可按整体路线保持同N2追踪并分别建PR/部署门禁；不能因此省略运行基础或把半链宣称完整8D可用。

经实际源码影响分析采用两段技术交付：**N2-A（V0.0.29）**交付映射、组织职责/分管及真实预览、维护界面与生命周期守卫；**N2-B**接续动态流程/独立审批轮次、兼容授权与任务投影、候选草稿及发布绑定控制，版本在该单元开工时重新查重分配。二者均挂Issue #66和既定N2，不减少原范围；每段PR分别O2、合并授权与部署核验。原因是旧runtime、唯一任务和单currentNode/版本耦合，强行与主数据配置一次上线增加回滚风险。N2-A不改workflow assignment schema，不提交会被旧授权忽略的新字段，也不显示新8D已可办理。

配置任务具体落点已固定：平台配置模块新增 `component-project.dto/controller/service.ts`，组织模块新增 `organization-responsibility.dto/controller/service.ts`；对应迁移分别 `20261024100000_component_project_mapping`、`20261024110000_organization_management_responsibilities`。数据采用迁移owned表，不为映射强制新增Prisma业务模型。

映射技术值冻结：stage为NEW_PRODUCT / MASS_PRODUCTION，新增项目必须明确选择；project code和component_code分别本组织trim后唯一，原大小写精确保留。productCategory为文本，productSubcategory可空，不擅自预设全公司分类清单；两类工程师可空并引用有效具体UserPosition。维护权限component-project:manage（共享映射和项目资料/状态），读取component-project:read，不加入ADMIN_PERMISSIONS或附赠configuration全权。工程师人工清空后为空，符合既定空人员可补入规则；非空MANUAL人员不覆盖。

职责技术值冻结：SECTION_MANAGER / MINISTER；科室经理绑定该科室岗位，部长绑定所属部门岗位，具体分管引用部长任职。有效区间使用左闭右开，分管不得超出任职有效期，同科室ACTIVE区间数据库排斥约束拒绝重叠；配置/预览未齐返回明确缺项，不增加登记必填。

### 主代理权限入口红绿记录（2026-10-24～25）

`component-project-permission-catalog.spec.ts` 先在新模块不存在处1项红灯，加入独立read/manage目录后绿灯；不扩ADMIN_PERMISSIONS。`component-project-directory.spec.ts` 先在只持新权限的内部账号目录为空处2项红灯，补内部身份+内部组织受限可见条件后，合计2 suites / 3项通过。供应商身份不因新mapping权限进入内部目录；这是纯控制器/目录unit证据，不能算真实PG或HTTP鉴权验收。新增实际路径分别在API `test/authorization/` 与 `test/identity/`，命令为直接Node Jest定向两文件。

## 3. 实施与验证顺序

### A. 配置数据与公共解析

- [x] 核对实际基线、私有状态、两条批准记录及原字段；创建Issue #66、隔离功能分支并保留N1归档。
- [x] 运行治理及根工具基线，准备独立PostgreSQL，所有秘密/原始证据在Git外。
- [x] 组件/项目服务先测试多组件共阶段、重复键/冲突、空工程师、无映射可查询、人工不覆盖与差异提示，再实现最少数据/API；映射维护拒绝未授权/跨组织和无效人员，结果不得泄露其他组织。
- [x] 职责服务先测试经理/分管部长/同人双任职、无配置/失效/多候选、同科室重叠并发，再实现有效任职解析与配置；查询结果带明确职责来源，不伪造签批。
- [x] 主代理审核迁移和权限/审计/生命周期影响，新增迁移只追加，不修改104份既有迁移。使用真实PG执行从旧库升级及事务失败/幂等/CAS回归。
- [x] DTO冻结后 `corepack pnpm contracts:generate`、`corepack pnpm contracts:check`；生成文件待本单元提交，不手写客户端DTO。

### B. 配置界面

- [x] 同既有视觉模式提供可点击样例/状态展示；正式界面接API，字段/组件来源明确，不用样例认可替代真实服务证据。
- [x] 项目/组件表单与人员选择实现可空、加载/空态/错误/权限、长编码、409留输入、未保存/忙时保护；感叹号支持hover/focus/click。unit与源码审查通过，真实键盘 / 触屏 / 窄屏视觉验收仍在发布清单，不自动转派。
- [x] 在组织与岗位中配置职责和部长分管，候选按有效科室任职收敛；预览缺项逐点说明，不以管理员兜底。全量权限目录只提供实际可授予项。

### C. 动态流程与模板

- [ ] 固定现有定义/版本schema和调用者，先写已发布旧版本及固定分派回归；动态分派只对新受控schema启用，不修改旧定义语义。
- [ ] 先真实测试专业/管理并行汇聚、风险管理分级、同人一次确认双职责与内部经理跳过的不同记录、退回新轮双方重审，再扩最小运行时/任务；权限、版本/轮次、审批准入统一后端校验。
- [ ] 候选模板仅草稿幂等初始化，不覆盖生产现有配置、不带开发用户/岗位UUID。预览人员、发布/业务绑定分别检查组织职责、有效权限和适用流程，不因部署即开单。
- [ ] 未配置允许草稿/登记，必要发单/审批动作失败并提示；N3完整业务表单未接通前不将新8D入口放行。

## 4. 命令与真实证据

每个shell先 `. D:/WorkSpace/QMS-2.0-local/Enter-Qms.ps1`；该脚本会回到qms根，定向API命令后续明确进入 `apps/api`。真实数据库加载Git外 `D:/WorkSpace/QMS-2.0-local/n2-environment.json`，不打印密码或连保留库。

```powershell
corepack pnpm check:governance
node --test test/*.test.mjs
corepack pnpm contracts:generate
corepack pnpm contracts:check
corepack pnpm --filter @qms/api test
corepack pnpm --filter @qms/api build
corepack pnpm --filter @qms/api lint
corepack pnpm --filter @qms/web test
corepack pnpm --filter @qms/web build
corepack pnpm --filter @qms/web lint
```

新增集成测试从API目录用直接Node运行，避免Windows旧shim：`node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand <已创建的定向文件>`；用例创建时把实际路径/红绿/退出码补入任务记录。源码冻结期间不并行写入被验文件；最终适用真实Worker/存储/扫描与Foundation阶段门禁按影响执行，缺前置如实失败，不能mock/skip代替。

自动浏览器既有信任桥故障不反复绕过；有新诊断依据才处理工具，正式页面按最终SHA、角色/范围、步骤/预期交人工清单。界面测试、静态审查、真实PG、CI、部署和人工验收不得互换。

## 5. PR、发布与收尾

- [x] N2-A每任务先规格复核、再质量/安全复核，全部有效问题返修后再定向复验；最终主代理独立检查覆盖文件与快照。N2-B后续仍须同样执行。
- [x] N2-A提交前复核main、Issue/PR及版本预留，只提交本Issue写集；首次推送前O2提醒，负责人确认已公开且实时核对public后推分支，创建PR #67并附当前聊天，不自行更改可见性。
- [ ] CI以最终PR head及实际base为准，修复更新同PR；不自动关闭Issue，合并/发布另核授权。每次合并立即D2核对main/镜像/备份/健康/HTTP/目标行为。
- [ ] 生产职责/分管/映射数据维护与候选模板发布绑定单独批准；不开新问题业务。N1+N2最终联合验收后REQ-0025可独立闭环，REQ-0026仍有后续域链，不能整体关闭。
- [ ] 实际关闭/飞书最小回填须获授权并回读；沉淀于ACCOUNT-ADMINISTRATION、WORKFLOW-DESIGNER、OPENAPI、CAPABILITY-STATUS及对应验收，不另造第二权威。仅精确标签清理本任务一次性资源，不使用全局prune。

## 6. N2-A 已有实现与分层证据（2026-10-25）

### 6.1 写集与独立审查

- Pauli组件映射、Hypatia组织职责、Cicero基础导入、Bacon批量维护、Singer正式组件页面、Lovelace职责页面分别实施分离写集；Franklin修复样例明确阶段及缺分类提醒。主代理统一模块 / 权限 / 审计 / 生命周期 / 共享导入 / 生成契约 / 文档 / Git；Arendt按真实锁等待复现修复职责预览锁倒置，不以重试吞掉未知错误。
- 后端规格独立核对过批量实际影响去重、导入HTTP合法上限与原子 / 幂等边界。修复：只对新导入路径采用512kb；混合真修改 / no-op仅计实际受影响组件；列表批量投影两类工程师，不N+1；审查发现旧精确Summary断言遗漏新人员字段，真实红灯后补身份不变断言。
- 职责规格发现旧预览可在刷新 / 保存后回填、同名任职无法辨认、离开页签未卸载。子组件代次 / 同名修复和主代理仅新页签条件挂载分别TDD；主代理离开中止 / 迟到拒绝测试先 `aborted=false` 红灯，后1项通过，首次绿灯因10000ms超时保留，按邻近页面用例30000ms重跑。组件人员同名展示同步横展，不改变任职ID。
- 隔离样例最终规格与Hooke质量静态复核无P1/P2；worker最终18项，主代理此前独立16项，不将二者相加。正式组件 / 职责及共享导入双审和最终联合回归仍以当前后续输出为准，不用样例结论替代。
- 正式组件页经Copernicus最终规格及Hooke独立质量复核通过，已关闭只读工程师选择、挂起CSRF后旧scope派发写入两P2；同名任职label与独立缺分类提示已横展。主代理3份组件 / 导入 / AdminPage文件合计104项通过，包含实际新增映射41、导入22及父入口41。原四文件联合134项中Workspace入口一项在10000ms预算超时、另133项通过；该新增多层UI用例按本文件邻近用例统一显式30000ms，仅改等待上限不改断言，整份Workspace重新验证接续。不得将首轮四文件记作全绿。

### 6.2 资源、命令与已有输出

一次性PostgreSQL仅`qms-n2-20261024-postgres:55473`及`qms-n2-review-20261025-postgres:55474`，任务标签及disposable标记；不连接55440。两库从原104迁移升级到108，追加映射 / 职责 / 权限目录 / nullable基础组件4迁移，不改历史迁移。秘密与完整快照位于Git外`D:/WorkSpace/QMS-2.0-local/n2-evidence/`及两个环境文件，不提交。最终API验证结束后再次精确核对名称、任务 / disposable标签、loopback端口及仅匿名volume无bind，删除仅这两个容器及匿名卷，并按解析绝对路径删除其两份环境文件；任务标签容器列表已空，无prune / 保留预览 / 生产操作。内存样例Vite保留供负责人继续查看。

| 层级 | 已执行输出及适用范围 |
| --- | --- |
| 较早API联合基线 | 20 suites / 329项组织、配置、身份schema及邻接通过；65 suites / 673 API unit通过，build/lint通过，605文件前后hash一致。此后有parser / 计数 / 人员投影增量，不当最终全量证据 |
| 导入 / parser红绿 | 合法Unicode100行真实413两项红灯；新导入512kb后2 suites / 22项通过，其他普通路径和超限仍413 |
| 批量实际影响红绿 | 新计数3单测先1红，修复后5 suites / 39项通过，含混合真修改与no-op HTTP/PG、原子回滚及冲突 |
| 映射人员投影及重复导入 | 新分页人员投影测试先undefined红灯；最终导入 / core / DTO三文件40项通过，包含审查旧断言红灯后的身份不被覆盖验证 |
| 权限 / 目录 / 审计 | 四文件22项通过，保持独立read/manage，无存量角色自动授权，前后值审计字段有界 |
| 职责并发 | 原24及真实并发6项30通过；新测试先5红1绿，锁顺序修复后绿，后续两位只读复审未发现P1/P2。外部事务调用顺序协议见PLATFORM-HANDOFF |
| shared import 401 | 可选callback的2项先红后绿；通知当前host并停止批次，无旧scope刷新，既有无callback导入邻接最终回归接续 |
| 正式父入口 | AdminPage新权限入口及选中部门职责入口2项通过；新增离开中止职责预览1项通过。定向运行不代表整份旧用例已跑 |

主代理最终API联合回归已执行，退出码0：21 suites / 335项组织、配置及身份schema邻接通过（PG与unit混合）；完整API unit为66 suites / 677项，build/lint通过，686份源码 / 测试 / 迁移前后hash一致，证据为Git外`api-final-before.json` / `api-final-after.json`。新增工程师Summary后旧导入断言已真实红绿修正，Gibbs最终质量复核无未关闭P1/P2。

职责正式页经Poincare最终规格及Gibbs独立质量复核无未关闭P1/P2；主代理冻结源码独立运行 `DepartmentResponsibilities.test.tsx` / `StructureAdministration.test.tsx` / `StructureAssignments.test.tsx` / `governance-draft-guards.test.tsx`，4 suites / 67项通过，退出0，前后hash一致。新增职责27项包含旧预览、同名具体任职和挂起CSRF期间scope失效回归；原岗位配权24、任职13及草稿保护3项同时回归。

shared import旧包装器 / Excel读取 / 分批等8 suites / 41项通过；补认证边界后三条新覆盖与原两条合计5项通过，物料正式页额外16项通过。shared client新增可选AbortSignal，CSRF挂起取消先1红后绿；API客户端目录2 suites / 6项通过，含已发写取消后新signal原key重试及recent-auth期间取消不重放，Hooke静态规格 / 安全复核无P1/P2。取消只停止客户端等待 / 后续dispatch，不能回滚已到达服务端的事务。隔离组件样例最终18项由主代理整份独立复跑通过，前后文件hash一致；不将此前16项或worker18项重复累计。

根工具71项、contracts:check、archive isolation、Compose foundation / production / scanning静态config通过。Compose使用仅验证占位参数且未启动服务。治理曾因本次文档 / reviewed source增量失败，逐项复核后通过37文档 / 331链接 / 20来源、126模块依赖及阶段五覆盖1项；维护3项仍开放、未修改日期。Web正式页面返修后最终整合仍待追加，不能将定向unit或静态审查称真实浏览器PASS。

最终Workspace整文件30项复跑通过、退出0，冻结hash一致，职责入口实际10402ms，验证原10000ms预算确实不足；该测试与邻近多层UI用例采用显式30000ms，不改业务实现或断言。与未变化的另外3文件104项构成4文件134项最终分组证据，首轮联合超时保留，不改写为一次全绿。加上组织岗位4文件67、shared import最终8文件44（认证旧2项由最新5项替代）、物料16、API客户端6、隔离样例18，受影响Web测试按文件去重合计20文件285项；不是全站Web完整套件。

主代理最终Web build/lint退出0，生产dist默认入口不含隔离样例HTML；React flushSync、AntD Spin tip弃用及chunk体积警告保留，不通过屏蔽警告宣称浏览器无问题。真实浏览器 / 完整阶段验收与N2云端CI仍待后续节点。对应SOURCE快照及完整原始日志在Git外，不提交秘密或测试资源。

### 6.3 发布 / 回滚与人工确认清单

首次推送前O2重新核对仓库可见性并提醒负责人；候选V0.0.29查重后提交，不擅自公开、合并或发布。新权限只写目录不自动配权；生产具体管理员岗位的首次授权上限初始化必须单独批准、预览和审计，不能在部署中隐藏赠权或重跑seed。

N2-A迁移为追加配置表 / nullable字段及唯一约束，不自动生成生产项目、职责或流程。上线前按交付流程核对备份；代码回滚保留新增表 / 数据，不做自动向下迁移或删数据。回滚到旧API后不会看到新增职责配置，因此如已维护生产职责，必须冻结相关结构停用 / 任职变更并先评估旧守卫缺口，不能把旧版重新启用当作无条件安全回退。

正式页面人工验收待最终部署SHA后按以下路径，不能以unit / PG / 样例代替：

1. 获准内部映射管理员：导入真实脱敏两列清单，核对前导0、中文名称 / 标记、重复跳过及未映射提示；补项目 / 分类后恢复。
2. 跨页选择同 / 不同项目组件，只启用目标字段，确认共享未选组件影响；验证冲突后重预览、未知结果原请求重试，其他字段未改。
3. 只读与不同组织账号：无写入口 / 选择，切组织 / 会话不出现旧草稿或迟到人员；失效工程师保留可辨认身份及小感叹号，键盘 / 窄屏 / 深浅色实际检查。
4. 结构管理员：选科室绑定经理，双部长按具体任职分管不重叠；预览缺项 / 同人双职责、保存刷新后的有效结果、离开页签中止请求；不得自动签批或指给管理员。
5. 在非生产一次性结构中验证先释放职责 / 分管再停用或结束任职，历史仍可查；生产误建对象不用于测试删除。

本次未运行完整phase-1/2验收，浏览器信任桥旧故障未绕过；Worker / 对象存储 / 扫描无新增业务改动，不冒充已做全系统验收。N2-B、域台账回补、IMS / AI和新问题流程均不在N2-A可用声明中。

## 7. N2-A PR完整云端检查（2026-10-25）

负责人直接“已开源，继续”接续上一明确推PR / 云端检查点，实时GitHub核对public；main仍为`b4e51150e934314889287980d062fe389a89561b`，工作区干净且实现head为`e5b1465a5e65c5183ff8888d7dbcb57046e9b4d8`，重新治理及diff检查通过后推送`codex/qms-n2-foundations`。创建并附加[PR #67](https://github.com/JasonShu0722/QMS-2.0/pull/67)，Issue #66回写关联，不使用自动关闭词、不改飞书或生产。

[Foundation run 40145157194](https://github.com/JasonShu0722/QMS-2.0/actions/runs/40145157194)在该head与上述base完整九项成功：scope、checks、api-unit、integration、Web四分片及foundation汇总。已读取实际job日志，不仅看总绿色：

| Job / ID | 实际结果 |
| --- | --- |
| checks / 121024832440 | 治理126模块依赖、契约同步、根工具71项等通过 |
| api-unit / 121024832430 | 66 suites / 677项通过 |
| integration / 121024832421 | 98 suites / 1251项真实集成通过；独立编译Worker进程1 suite / 8项通过；Compose与一次性资源清理步骤完成 |
| web-tests (1) / 121024832426 | 32文件 / 255项通过 |
| web-tests (2) / 121024832418 | 32文件 / 386项通过 |
| web-tests (3) / 121024832482 | 32文件 / 245项通过 |
| web-tests (4) / 121024832477 | 32文件 / 256项通过 |
| foundation / 121028705044 | 完整聚合门禁成功 |

Web合计128文件 / 1142项，非本地285范围的简单重复累计。GitHub同head代码审查完成、无发现 / 无未解决项；未请求或声称独立云端安全审查。PR最终open / 非draft / mergeable clean，head和base未变，没有自动合并、发布、生产初始化或需求关闭。

当时真实停止点是N2-A合并 / 自动生产部署需明确授权，后续批准及实际发布见第8节；此前N1发布授权未扩大复用。此归档与索引作为后续本地文档提交保留，不推送引发已全绿PR重新跑全量CI；受检实现与PR head保持e5b1465，归档不是新的已发布版本。

## 8. N2-A 合并与生产发布核验（2026-10-25）

### 8.1 授权、源码与云端检查

负责人对明确“是否继续合并PR #67并执行随后生产部署核验”请求回复“继续”。合并前重新读取PR / main / 精确head检查 / reviews / inline comments及云端审查摘要：head e5b1465、base b4e5115不变，完整9项成功、无要求变更或inline finding、mergeable clean。使用带期望head SHA的squash合并，未推本地文档归档5bfd7a7；合并提交标题为`V0.0.29 交付组件项目映射与组织职责配置`。

PR #67确认merged，main / merge commit均为`70fdbabb1a5394c2cbbd5896a4e3068f4452e6bf`；拉取origin/main后与e5b1465比较无源码树差异。新的[main Foundation40149137790](https://github.com/JasonShu0722/QMS-2.0/actions/runs/40149137790)完整9项全部成功，非复用PR绿色代替main。实际main integration日志再次确认98 suites / 1251项、独立Worker进程8项成功，全部迁移成功；API与Web四分片和汇总门禁亦全部成功。

### 8.2 部署日志与公开可观察变化

[deploy40150563126](https://github.com/JasonShu0722/QMS-2.0/actions/runs/40150563126)成功，job121041065405各步骤完成。已读取实际SSH部署日志，核对其完整source-run校验而非只看绿色：

- `Pre-migration encrypted database snapshot verified: 70fdbabb1a5394c2cbbd5896a4e3068f4452e6bf`，随后才执行Prisma migrate；不将本机迁移前快照称为异地完整灾备。
- 四份迁移分别实际Applying：`20261024100000_component_project_mapping`、`20261024110000_organization_management_responsibilities`、`20261024120000_component_project_permissions`、`20261025010000_component_catalog_import`；随后`All migrations have been successfully applied.`。
- `qms2-foundation-api-1`与`worker-1`使用`qms2-foundation-api:70fdbabb1a5394c2cbbd5896a4e3068f4452e6bf`，`web-1`使用同SHA web镜像；up --wait日志确认API / Worker / Web及PG / RustFS / ClamAV Healthy。Worker本次启动检查完成后才写部署标记，未单独冒充人工角色验证。
- 实际`Deployment successful: 70fdbabb1a5394c2cbbd5896a4e3068f4452e6bf`标记存在，未出现superseded skip。
- 外网`/login`及`/api/v1/openapi.json`均200，新增组件 / import / bulk / 职责 / 分管 / 预览15条路径已出现；未登录GET映射清单401，不泄露资料。首轮检查脚本把path参数错写为`{orgId}`而失败，读取Controller确认真实为`{organizationId}`后按准确契约复核通过；这是核验脚本命名错误，不是生产缺接口。
- 发布前main JS为`/assets/index-XlfA8kUd.js`，发布后变为`/assets/index-CIKtTNNC.js`且实际可取200，内容包含组件、职责、分管新路径；AntD资源更新为`antd-CC7TE26p.js`。共享CSS仍为`index-DOcry2yZ.css`，未修改的CSS不要求伪造指纹变化。

09:35 Asia/Taipei再次读取main / PR / 最新100条Actions，main与merge SHA一致，没有运行 / 排队工作，已向负责人明确本轮可闭源；代理未更改可见性。Git外保存合并JSON、main检查JSON、部署日志与公开前后快照，秘密不入Git。

### 8.3 已发布但尚未完成的事项

机器发布核验通过不等于正式业务人工验收。第6.3节清单以最终70fdbab执行；仍未运行真实登录浏览器矩阵或独立phase-1/2完整脚本，没有替其写PASS。新权限迁移只登记目录，生产管理员岗位的首次read/manage配权及授予上限初始化尚未获准 / 执行；若新入口不可见，不能靠前端刷新或重复seed当作已激活，需按具体组织 / 岗位另作受控初始化。

经理 / 部长职责及映射内容由获准维护者配置；自动部署不填真实组织、分管、项目或业务资料。N2-B动态流程 / 并行轮次 / 模板绑定及新8D未因此启用。Issue #66仍有N2-B及联合验收，保持开放；未关闭REQ / 回填飞书 / 修改用户自行设置的状态。

本轮发布状态沉淀于FOUNDATION / CAPABILITY-STATUS及相关交接，作为本地文档归档，不向main推送制造第二轮未经必要的部署；本地分支保留原实现及PR归档，后续N2-B必须从最新main接续，不能把squash前历史重复合入。

## 9. N2-B 开发接续与小单元计划（2026-10-25）

### 9.1 当前批准与基线

负责人直接“继续开发”，接续已批准N2-B而非重新讨论业务；REQ-0026实际record_id只读回读revision300、has_more=false、仍开发中，全部字段与前次快照一致。Issue #66保持开放并复用，候选V0.0.30远端Issue / PR及本地提交核对无占用。仓库已恢复private；本轮先本地实现，下一推PR检查点先提醒负责人，不自行更改可见性，也不把N2-A发布授权扩用到N2-B。

从最新origin/main70fdbab建立codex/qms-n2-workflow-foundations，原N2-A分支 / 实现提交及本地归档保留；仅cherry-pick5bfd7a7及6bfa72c的纯文档内容，未重复引入squash前实现。活动D盘checkout不另建C/E盘worktree，初始工作区干净，治理37文档 / 334链接 / 20来源 / 126模块依赖通过。当前Prisma单currentNode、任务(instance,entryVersion)唯一及旧SQL授权消费者必须逐项改造，不直接在assignment中加入会被旧代码忽略的键。

### 9.2 实施选择与范围

沿原批准的“领域拥有事实 / 设计器配策略 / 运行时统一强制”方案。相比直接给旧单节点塞并行标志，采用有限的审批职责 / 提交轮次模型；相比另建通用BPMN，不增加无需求的网关 / 任意脚本。按依赖串行：

1. **B1 真实关闭职责解析与纯策略**：复用OrganizationResponsibilityService，内部低中风险专业+经理并行（负责人同经理仅管理侧留痕跳过），高重大专业+分管部长并行；供应商先SQE专业，再低中经理或高重大经理+部长。供应商双管理同人仍保留两份待确认职责，返回可一次确认的职责组，不跳过，不合并专业职责。无效 / 缺少 / 多人不兜底管理员。新增只读配置预览，使用真实岗位 / 任职；输入用于配置测试，不是运行中的发单 / 审批授权，后续实际入口从领域事实取owner / issuer，不能信客户端这些身份。
2. **B2 固定版本提交轮次与审批记录**：追加受控表和约束，同版本内容锁定，职责逐项记录，通过条件为本轮全部有效职责；任一退回 / 审批人变更取消本轮，旧结果仅历史，重新提交两侧重新解析。真实并发 / 幂等 / 审计失败回滚先红再绿，不自动扩展闭后重开规则。
3. **B3 待办 / 通知 / workspace**：同问题多职责待办但问题索引一行，读取 / claim / act / transfer / 提醒 / late worker均校验当前轮次及实时资格；修改旧唯一约束时保留旧实例兼容，禁止新结果落入旧消费者。
4. **B4 设计器 / 候选模板 / 发布绑定**：新受控schema仅在B2/B3实际支持后允许保存 / 发布 / 启动；现有schema / 发布版本不改解释。模板仅草稿、无开发UUID、不自动绑定 / 开通新8D；预览配置 / 真实启动资格与最终发布分别验证，UI先样例再正式页面。

本节是原批准方案的工程细化，不删减N2-B；B1完成不得宣称N2-B或新流程已可用。B1可独立本地验证，最终提交PR必须记录真实覆盖，按需要拆分技术交付仍挂Issue #66。

### 9.3 B1 文件、接口与测试边界

- 新增workflow-closure-policy.ts与对应unit：无数据库纯策略，输入policy / severity / professional / owner / 已解析经理部长身份；输出执行模式、职责列表、同人组。实现者独占该两文件；不编辑runtime/schema/旧assignment。
- 主代理新增workflow-closure-preview.dto/controller/service.ts及真实PG / HTTP测试，模块注册 / 依赖索引 / generated契约 / 文档由主代理串行。`POST /api/v1/workflows/closure-preview`返回200，只读、workflow:manage、内部当前组织 / 会话，body禁止organizationId或额外字段。INTERNAL必须明确owner；SUPPLIER不收owner（避免以外部账号扩大查询）。专业人员仅作为配置测试身份，必须为本组织有效内部账号及有效任职，当前workflow:act资格不足返回明确缺项。原科室预览不得因只要求部长而缺经理阻塞高风险内部预览。
- 响应明确`previewOnly: true`、`configurationReady`、scope / 时间 / duty sources / issues / executionMode / samePersonGroups；不返回approve capability、不生成问题 / 待办 / 审计通过、不写审批快照。B2实际消费同一纯策略，身份从受控服务取。
- 先真实HTTP测试无会话 / 缺权限 / 外部身份 / 跨组织人 / 失效任职 / 多人 / 双部长分管 / 同人 / 中低与高重大四等级，校验无写入；再最小实现。职责resolver在用户 / 结构锁前调用，事务调用者协调actor锁并处理提交并发，不用有锁SQL拼第二组织树。
- PostgreSQL仅新建本任务disposable loopback资源，不连接55440或生产；先108迁移基线，旧workflow核心unit / 真实schema邻接和治理基线通过后实施。新DTO运行contracts:generate/check，文档状态区分B1本地、N2-B整体和生产70fdbab。

- [x] B1纯策略真实红绿、预览HTTP / PG红绿、独立规格再质量复核与主代理回归；仅该小单元本地完成，不代表N2-B整体或发布。
- [ ] B2逐项固定受控schema / 表 / 服务接口与实际调用者后执行TDD，不混入领域8D表单。
- [ ] B3与B4接续，最终完整门禁与O2提醒 / PR / 获准部署分别记录，不关闭Issue #66。

### 9.4 B1实施、返修与证据归属

纯策略由McClintock仅持workflow-closure-policy.ts及unit实现，63项先函数桩Not implemented全红后全绿；追加内部专业不同仍可owner-manager跳过、供应商低中owner-manager不跳过4用例，最终67项。Sagan先规格、Kepler后质量静态核对无P1/P2；输入身份有效性属于解析服务前提，纯输出透传参与人引用，不宣称其为深冻结历史快照。

主代理持preview DTO / Controller / Service、AppModule实际注册邻接测试、模块依赖及契约。首个真实HTTP测试404红灯，最小实现后13项中的两个高风险fixture因部长未在责任科室任职而正确报owner缺项；补真实兼岗fixture，不放宽责任科室边界，13项通过。进一步增加真实组织 / 会话及并发边界。

独立规格Popper发现末尾MFA政策遗漏：通过Guard后，未来有效任职要求MFA在请求期间生效，securityVersion无需变化，原服务200。真实PG / 实时时钟 / 原resolver接缝测试先1红1绿，复用现有无锁mfaPolicy并读取mfaVerifiedAt后两项绿；未接入actor FOR UPDATE，不改变resolver用户先于结构的锁序。真实候选用户FOR UPDATE与pg_blocking_pids确认等待后撤销会话得到401；原resolver返回后撤session / 权限分别401 / 403；不是仅测请求前Guard拒绝，也没有模拟替代实际职责解析。

独立质量Pascal指出并修正两项P2：配置解析误给经理 / 部长附加workflow:act门槛（专业人员仍按原要求检查，管理配置有效不等于其可执行）；合法大写ownerUUID经数据库确认却原样比较导致同人漏跳过。经理 / 部长无act及大写owner三个真实HTTP先全红，分别以专业显式requireWorkflowAct、管理保有效身份来源及数据库规范ownerUserId修复。实际审批时每职责执行资格将在B2/B3重验，不能拿configurationReady授权。

Swagger布尔enum[true]被当前Nest生成器标为number，新增OpenAPI test真实红灯；即便显式type:Boolean与enum并用仍失败，最终采用标准boolean类型、readOnly及example:true说明，runtime仍固定literal true。生成类型由contracts工具更新，不手改或输出错误numeric enum。最后补内部账号误置供应商组织的拒绝，真实200红灯后复用session查询的组织类型明确403，无额外行锁。

扩大workflow邻接时首轮12 suites / 301项有1项因缺QMS_OBJECT_STORAGE_ENDPOINT失败，其余300项通过；未Mock / Skip或归因业务失败。随后为本任务建立真实RustFS与固定digest ClamAV、版本化隔离桶，复验含附件上传 / 真实扫描 / 固定版本保留的旧升级用例。仅PG108迁移，不新增B1数据库迁移，不连接生产或55440。第一次冻结扩大回归12 suites / 308项及API全部67 suites / 744项、API build / tsc通过，610源 / 测试 / 迁移hash一致；此后质量delta需最终第二次冻结重跑，不沿用旧PASS冒称最终。

未实测主动制造死锁 / 序列化失败返回409；已有concurrency映射是防御代码，真实锁等待后401测试不能替代此项证据。B1无并行实际任务，不运行完整phase-1/2或声称B2 / 新schema / 新8D交付。下一动作仍按第9.2节B2→B3→B4，不因B1独立可测就自动提前发PR或部署。

### 9.5 B1最终本地门禁及接续

最终第二次冻结验证退出0：workflow全目录 + organization-responsibility及concurrency两文件 **12 suites / 312项**全部通过，包含B1纯策略67及preview真实HTTP / PG24项，保留旧版本 / 运行时 / 升级 / 固定附件证据兼容。API全部unit **67 suites / 744项**通过，API build及tsc通过；610份API源 / 测试 / 迁移前后SHA-256一致。API源码/测试外未新增迁移，也未修改既有108迁移。

`contracts:generate/check`通过且预览标识schema为标准boolean/readOnly；Web无界面行为改动，build/lint通过，未把编译或旧样例当浏览器验证。根工具71项、归档隔离、治理37文档 / 337链接 / 20来源 / 127模块依赖通过；文档追加链接后最终再复跑治理，不通过改维护日期免检，3项仍开放。实际源码冻结及前后证据位于Git外`n2-evidence/n2b-b1-final2-before.json`，原始失败输出不改写。

Sagan / Popper规格、Kepler / Pascal独立质量分别完成，MFA、配置vs执行权限、UUID规范身份及Swagger返修均已复核，无未关闭确定P1/P2。纯策略的补4矩阵也已在主代理最终67项重跑，worker早期63项不重复累计。B1并未承诺可执行审批；管理侧未获workflow:act不会抹掉有效配置来源，实际操作仍须B2/B3实时校验。

本任务仅使用qms-n2b-20261025-postgres:55475、rustfs:59075、clamav:59375，均有codex.task=qms-n2-workflow及disposable标签。验证结束后精确核对名称 / 标签 / loopback端口 / mounts，删除仅这三个容器及匿名卷；ClamAV只读绑定配置文件保留未删，Git外n2b-environment.json按解析绝对路径删除，任务标签资源已空；没有prune / 55440 / 生产操作。下一单元需新建独立资源，不复用过期秘密文件或依赖本次fixture数据。

本地提交仅保存B1可验证成果，未推送 / 建PR / 触发CI / 部署 / 修改生产权限或飞书状态。候选V0.0.30继续由同N2-B范围使用，B2开工保持本分支并先补实际轮次 / 身份事实接口及受影响调用者，不重做B1或直接向旧单节点塞并行字段。最终B2～B4闭合后再做整体门禁与O2提醒，不以本地小单元完成提前关闭Issue #66。
