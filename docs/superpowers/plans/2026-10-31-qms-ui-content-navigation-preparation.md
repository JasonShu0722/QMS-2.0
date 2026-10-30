# REQ-0033 需求提交与开发启动准备

> 当前已正式启动。负责人2026-10-31明确授权本轮策划、开发、PR检查点及合并部署；本文件接续原准备记录维护实施计划。按qms-superpowers-zh执行子代理TDD、先SPEC后独立QUALITY，不以计划或样例替代验收。后文第1～5节保留准备时点，最新状态以顶部和第6节为准。

## 当前摘要

| 项目 | 事实 |
| --- | --- |
| 核对范围 | 2026-10-31（Asia/Taipei），内部业务和管理前端文案、标题、导航与图标 |
| 授权 | 负责人本次明确正式启动策划/开发，自主推进PR检查点及合并部署；覆盖之前仅准备限制。生产业务赋权、数据操作、业务验收和关闭回填仍须各自事实与授权 |
| 需求 | [REQ-0033](https://larkcommunity.feishu.cn/record/MjtHrS3UkeoKx0cCIWAcutIinKg)，record_id=`reczz28ThBJRByiI`；P1／开发中，user回读rev335；直接会话授权覆盖本范围 |
| 设计 | [专项设计](../specs/2026-10-31-qms-ui-content-navigation-design.md)进入实施；统一规范1.4已纳入文案/标题/单列导航规则，规则生效不等于实现验收通过 |
| 基线 | 活动checkout `D:/WorkSpace/QMS-2.0`；准备时分支`codex/management-console-release`、HEAD `7f8039224366d61fec0e2b2aad21a29d69f131d9`；当前功能分支见映射行，不代表生产版本 |
| 运行时 | 加载Git外Enter-Qms.ps1后Node v24.21.0、pnpm 11.19.0；不是业务测试 |
| 映射 | REQ-0033→[Issue86](https://github.com/JasonShu0722/QMS-2.0/issues/86)→codex/req0033-ui-content-navigation→[PR87](https://github.com/JasonShu0722/QMS-2.0/pull/87)；V0.0.38，head `017c5d722358bc232306dceaa24b6a6a57f09310`，base main89c2ddd |
| 分别状态 | PR87与main e37504e各16项CI成功，各225文件3153项Web全绿；已合并并由[部署41117896707](https://github.com/JasonShu0722/QMS-2.0/actions/runs/41117896707)成功发布；机器发布核验成立，视觉/角色/尺寸/对比度人工验收仍待办，Issue86保持open，不写需求已结束 |
| 工程证据 | API162文件2356项、真实PG54项、API构建、契约/归档/Compose、治理及根工具71项通过；最终Web lint/build退出0。本地12文件245项为组合通过、原中断不计PASS；PR/main准确版本全225文件CI通过、生产快照/无待迁移/同SHA服务及公网新资源均有独立日志 |
| 证据限制 | 分项测试为完整文件组合证据；无改后真实截图、可点击样例、浏览器尺寸/对比度和业务人工验收。各批次版本与原失败保留，第6节维护实际过程 |
| 下一动作 | 归档发布证据与本地文档检查后交付6.2人工清单；负责人反馈真实界面问题时沿本需求接续，不以机器健康关闭业务验收 |
| 持续开发 | heartbeat req-0033曾每20分钟静默守护；机器工程及发布完成后已由automation_update回读PAUSED，避免仅人工待验期间循环唤醒；未打断在途开发/测试/CI/部署 |

## 1. 已完成与开工前置

- [x] 汇总三类问题及业务折叠导航方向，明确保留主题、业务和安全边界。
- [x] 两次云端完整查重；REQ-0021不重开，REQ-0032不重复建设。
- [x] 读取真实字段/选项，以user提交九业务字段并逐项回读一致，不设置开发中或优先级。
- [x] 上传三张参考截图并取得真实需求链接。
- [x] 保存设计、静态代码影响清单及启动清单，加入既有实施指南入口。
- [ ] 正式批准、独立样例、逐路由处理表、详细实现计划、Issue、实现、业务门禁和PR。

## 2. 静态评审与初始影响清单

结论：目标可行，能复用现有数据与公共外壳；当前只准备，不开工。路径相对`qms-2.0/`，正式启动还须grep调用者、测试、fixture、导出与配置。

| 范围 | 文件或目录 | 关键事实与要求 |
| --- | --- | --- |
| 菜单数据 | apps/web/src/features/navigation/navigation.ts | internalDomains已有children和真实path，不新建后端菜单或平行事实源 |
| 业务外壳 | apps/web/src/layouts/InternalLayout.tsx、shell.css | 现桌面双栏、移动details/Drawer；统一单列两级，保留工作台/标签/专注/移动 |
| 标签和离开 | apps/web/src/work-tabs/WorkTabs.tsx、workTabsStore.ts、layouts/UnsavedChanges.tsx | 复用标签身份、会话隔离与requestLeave，不旁路dirty/busy |
| 管理菜单 | apps/web/src/console/ConsoleLayout.tsx、console-navigation.ts、console.css | 多数module回退Settings；改语义图标，保持真实能力/组织过滤 |
| 管理页头 | apps/web/src/console/ConsoleLayout.tsx、ConsoleHome.tsx、ConsoleHome.css | heading参与焦点恢复；精简路径不丢焦点、范围及组织切换保护 |
| 账号与全页 | apps/web/src/features/account/AccountCenterPage.tsx及同目录；workbench/、features/、console/正式路由 | 先盘点公共来源与逐页清单，保留对象标题、安全/会话及独立保存边界 |
| 主题/语言 | apps/web/src/theme/、console/ConsoleTheme.tsx、i18n/ | 业务蓝青紫和控制台中性色独立保持，不新增偏好来源 |
| 规则 | 根前端统一规格、docs/FRONTEND-DESIGN.md、apps/web/AGENTS.md | 正式开发同步生效规则；本轮仅审阅稿入口 |

当前无新增API、契约、数据库、迁移、Worker依据。发现必须跨越这些边界时记录原因并重新评审，不静默扩范围。

## 3. 分组与执行接续

建议一个综合需求、两个可验收执行单元；正式开工按实际依赖确定Issue/PR数量，不按截图或类别机械拆单。

| 单元 | 范围 | 验收/依赖与回滚 |
| --- | --- | --- |
| UI-A | 公共业务折叠导航、管理分组与图标 | C04/C05及主题/保护；回滚限导航代码与规则，不回滚业务数据 |
| UI-B | 两类页头、逐页文案、关联排版与规范沉淀 | C01～C03/C06；公共导航/页头稳定后展开，最终联合回归UI-A，保留逐页可回滚差异 |

正式启动顺序：

1. 按record_id回读REQ及负责人批准来源，核对批准范围与机器人后续变化；本次准备及待评估状态不代批准。
2. 核对最新Git、暂存/未提交和并发文件所有权，协调现管理分支；不直接混入旧交付、不默认切共享分支或新增worktree。
3. 查重关联/创建Issue，固定交付映射；按交付流程主动查重分配版本，本次不预占。
4. 制作隔离样例核对业务菜单、管理分组、个人账号和管理首页，覆盖主题/长菜单/键盘/窄屏；正式组件不导入原型代码或CSS。冻结宽度、行高、默认展开、整栏收起及记忆策略。
5. 按真实路由建立页面处理表：位置、公共来源、处理理由、保留口径、布局影响、证据。编写逐任务计划及文件所有权。
6. 按qms-superpowers-zh执行实现；导航状态/保护按TDD，纯文字不写镜像测试。每项先SPEC后独立QUALITY，共享外壳/接线/Git/整合验证由主代理串行协调。
7. 通过适用门禁后按持续授权提交功能分支与PR；合并发布、生产、关闭回填分别核对授权。获准发布后核对准确版本与联合回归，再关闭/回填并回读，完成规则沉淀和一次性资源清理。

## 4. 验证准备

现有回归入口：features/navigation/navigation.test.tsx、navigation-access.test.tsx、layouts/InternalLayout.route-boundary.test.tsx、UnsavedChanges.test.tsx、work-tabs/work-tabs.test.tsx、console/ConsoleLayout.test.tsx、console-navigation.test.ts、ConsoleTheme.test.tsx、ConsoleHome.test.tsx及账号同目录测试。正式开工核对最终写集，不删除安全断言来迁就样式。

从活动工程目录执行，先核对运行时、分支与源码冻结：

```powershell
. 'D:/WorkSpace/QMS-2.0-local/Enter-Qms.ps1'
git diff --check
corepack pnpm check:governance
corepack pnpm --filter @qms/web lint
corepack pnpm --filter @qms/web test
corepack pnpm --filter @qms/web build
```

先定向、再按影响完成Web覆盖；无变化不反复扩大。Foundation影响按根规则增加归档隔离、契约、Web/API、真实PostgreSQL、构建与Compose；阶段整合用对应acceptance入口。无关项说明不适用，不伪造已执行。

真实浏览器使用一次性资源，禁止保留预览库55440。覆盖各宿主实际主题、中英、1440/1024/390与760断点、长内容、键盘/触控、角色/组织、401/403、dirty/busy、标签和专注。浏览器不可用时按项目人工路径列页面、角色、步骤和预期，保持未验收；不得用Mock、旧截图或参考源码冒充真实业务通过。

证据记HEAD、来源、命令/步骤、结果和限制；样例/单测/真实浏览器/人工/生产分别记录。验收完成后同步前端权威规格、实施指南及规则入口，提供清单、前后截图、未覆盖项和回滚。

## 5. 本次准备检查

- rev330：九业务字段逐项比对一致，无ignored_fields；待评估、优先级空。
- rev331最终回读：record_id匹配、has_more=false；三附件名/大小分别为01-copy-before-after.png（298700字节）、02-console-navigation-icons.png（123147字节）、03-business-duplicate-titles.png（161893字节），与上传前本地文件一致；状态仍为待评估、优先级空。
- Git外证据：`D:/WorkSpace/QMS-2.0-local/ui-optimization-prep-20261031/`。
- `corepack pnpm check:governance`退出0：37份登记文档、451本地链接、20份来源复核、157模块依赖对通过；阶段五覆盖追踪测试1通过/0失败。原始输出为Git外`governance.log`。此结果仅证明现有治理门禁，不代表业务实现或验收。
- 根设计/启动文档补查退出0：2份文件、5个本地链接存在，REQ-0033及实际record_id一致。首次补查因Enter-Qms.ps1切换到工程子目录而路径错误，显式回到仓库根后重跑通过；不修改脚本或目录规则来消除失败。
- `git diff --check`退出0；最终范围仅本设计稿、启动清单及实施指南入口。第4节Web类型、业务测试、构建、真实浏览器和业务验收未执行。
- 当前文档仅本地保存，未提交/推送，无本次实施Issue/PR或运行代码差异。

## 6. 正式实施计划（2026-10-31接续）

**目标：** 在不改变主题、业务、权限和数据的前提下完成设计C01～C12。
**架构：** 现有静态导航事实源、React Router Link、WorkTabs与UnsavedChanges继续拥有原行为；仅公共外壳承载折叠菜单，页面保留语义标题并移除可见重复；控制台继续独立context和主题。一个Issue/PR共同验收和回滚，内部写集独立。
**技术栈：** React 19、TypeScript、Ant Design、lucide-react、现有CSS与Vitest，不新增依赖。

### T1 业务导航（全新实现子代理）

写集：InternalLayout.tsx、layouts/shell.css、features/navigation/navigation.test.tsx、navigation-access.test.tsx、InternalLayout.route-boundary.test.tsx及只由导航结构变化影响的测试；不改领域数据、ShellHeader、UnsavedChanges或供应商外壳。

- [ ] 红灯：以按钮expanded状态断言一级领域，click/Enter/Space折叠不改变URL，叶子真实href保持；深链接和标签切换展开当前父级，移动抽屉可用，原管理隔离断言保持。
- [ ] 最小实现：复用internalDomains，用受控details/summary或原生button展开；桌面与移动复用同一菜单构造。单列宽240px、收起保留64px图标及明确展开入口，760px切抽屉；展开记忆仅会话内，路由变化补当前父级、不强制关闭其他领域。
- [ ] 绿灯：直接vitest文件过滤执行完整受影响文件；保留基线失败与实际命令。父代理再审SPEC→QUALITY。

### T2 管理侧栏、管理页头与账号（全新实现子代理）

写集：console目录正式布局/导航/首页及测试和样式，features/account/AccountCenterPage.tsx及同目录受影响测试/样式；不改认证/context业务、主题或全局翻译机制。

- [ ] 红灯：个人账号正文无可见重复页面名/概览标题但仍有可访问标题；控制台首页不展示重复breadcrumb/kicker，组织目标与heading焦点可达；各导航真实路径保持且业务图标不是通用齿轮。
- [ ] 最小实现：页头缩紧、分类字重/组间分隔、显式语义图标映射；账号操作并入信息区，语义标题sr-only；控制台原身份/资源范围压缩到可发现详情，保留数据来源、失败与范围口径，不删除事实。
- [ ] 绿灯：ConsoleLayout/ConsoleHome/console-navigation/账号相关完整测试文件，先SPEC后QUALITY；不改API或权限读取路径。

### T3 内部业务全页文案与标题（盘点后全新实现子代理）

写集：workbench及features内部正式页面，排除navigation、account、认证、供应商门户与console；不改公共布局和i18n文件，可在语言已支持范围内使用现有文案。先建立路由/处理清单再改动，保留对象标题、统计口径、错误/权限/风险和所有动作。

- [ ] 逐正式入口检查说明与标题，分别记录删除/压缩/保留/详情及依据；无说明页面也列为检查保留，不以关键词命中代表完整覆盖。
- [ ] 删除导航已有的重复可见页面名，保留h1语义（sr-only）与有价值对象/分区，收拢空标题容器/间距；不采用全局隐藏全部h1的CSS捷径。
- [ ] 运行受影响完整Web测试文件；纯文案不写逐句镜像测试，必要语义/交互变化增加有效检查；SPEC后QUALITY。

### T4 父代理集成与交付

- [ ] 核验全页清单覆盖正式路由，检查中英、六种业务主题和控制台主题、1440/1024/390及760断点；隔离原型不得成为正式依赖。
- [ ] 更新统一规格与FRONTEND-DESIGN、Web AGENTS及documentation-index来源，保持一个权威来源；记录实际来源复核，不仅刷新hash。
- [ ] 冻结写集，git diff --check、归档隔离、契约检查、Web lint/完整回归/build、治理；Foundation实际影响按上层额外门禁执行。
- [ ] 真实浏览器若被信任/工具拒绝，不绕过安全，按既定人工清单列角色/版本/步骤/预期；不以样例/单测宣称真实用户验收通过，继续独立工程与CI。
- [x] 最终独立SPEC后QUALITY，回读REQ，核对版本占用与base/head，提交推送一个V0.0.38 PR并关联Issue86。所有必需CI覆盖最新head后按授权合并。
- [x] 核验main检查、自动部署、快照/迁移链（本轮预期无新增迁移）、三服务同SHA/健康、公网资源/接口；不改生产业务权限或真实业务数据。按现有发布手册清理明确归属的一次性资源。
- [ ] 更新证据与人工验收清单，交付实际链接和未覆盖项；验收不成立不关闭Issue或写“已结束”；全部完成后停用heartbeat。

### 6.1 启动与基线实测

- 当前远端main为`89c2ddde71b97683805487729f230b357aef63f6`；本地起点`7f80392`另含两次已存在的交付记录提交。本次功能分支直接承接该活动checkout，原准备文档保留；未创建C/E盘worktree，未混入其他运行代码。
- 实际基线：在`apps/web/`直接运行`node node_modules/vitest/vitest.mjs run src/features/navigation/navigation.test.tsx src/features/navigation/navigation-access.test.tsx src/layouts/InternalLayout.route-boundary.test.tsx src/layouts/UnsavedChanges.test.tsx src/work-tabs/work-tabs.test.tsx src/console/ConsoleLayout.test.tsx src/console/console-navigation.test.ts src/console/ConsoleHome.test.tsx --maxWorkers=1`，退出0，8文件111项通过，耗时113.15秒。原Ant Design弃用/未连接form告警仍存在，不作为本轮无关修复。
- 首次`pnpm test --`参数转发未形成可靠定向范围，主动中断，保留为未完成运行，不计PASS；后续使用上述直接入口。
- 实现分工：T1 Goodall（`01a18de7-2114-7cf2-88ea-2e3729cfe605`）拥有业务布局/导航及其测试；T2 Pasteur（`01a18de7-9e8a-7f71-930e-4cec466e6390`）拥有console/account；T3 Peirce（`01a18dea-e50f-7d23-adbf-7e7ca5978a70`）拥有其余内部业务正式页面。只读盘点Pauli（`01a18de0-46e9-7eb0-8d99-391f10878221`）已交付，不进入实现。父代理拥有文档、全局翻译接线、索引、Git和最终冻结验证。独立写集并行，受影响测试不在覆盖源码写入中运行。
- 独立提交/回读证据目录`D:/WorkSpace/QMS-2.0-local/req0033-development-20261031/`；已保存需求批准快照与main只读查询，现有受控GitHub REST helper使用Git凭据仅在内存认证，不输出秘密；连接器用于可用的Issue/PR读取，缺少PR创建/合并能力时用该既有helper。
- T4a补充：单工作页时WorkTabs只展示管理入口，正文标题去重后需当前页名。Wegener（`01a18dee-ccb8-7d43-9562-7bfe3ab152e1`）仅修改ShellHeader.tsx及其测试，内部单页显示紧凑当前名，多标签/工作台/供应商不新增；红2失败8通过，完整绿10通过。Parfit规格通过当前源码，基线旧断言由后续Boole质量轴核对；质量和父独验尚未完成。
- 归档隔离与OpenAPI contracts:check均退出0，后端及生成契约未修改。
- 真实PG：本任务独占`qms-req0033-pg-20261031`（loopback62958，非55440），完整迁移成功。首次漏执行标准seed，platform-administrator因基础权限目录缺失5失败，console-context通过；保留`pg-console-authorization.log`。补标准seed后同两份完整文件54项通过/退出0（25.34秒），不改生产权限或测试断言，日志`pg-console-authorization-seeded.log`。测试完成后核实任务标签及临时归属，删除容器及其匿名卷，见`pg-cleanup.json`。
- 发布前公网只读快照：根200，主资源`index-v5CJ-axp.js`，匿名console context401；仅证明当前连通/拒绝与资产指纹，不代表生产视觉或业务验收，详见`public-before.json`。
- T1：Goodall完成单列导航，Linnaeus规格通过、Halley质量通过并提出P3语义标题测试补强；已补回标题存在断言，完整导航文件12项通过，质量窄复核中。此前自有3文件25通过，跨控制台中间失败不计整体PASS。
- T4a：Parfit规格、Boole独立质量均通过；质量轴已用git show核实原6项参数化测试与基线文本一致，新增4例，不把红灯证明范围扩大到所有新增断言。真实窄屏仍待验。
- T2：Pasteur完成19文件，组合12文件219通过，最后控制台批次9文件146通过；Cicero规格发现P2共享供应商账号窄屏页名遗漏，返回原实现者最小修复，规格未通过前不进入质量轴。原告警与中途失败保留。
- T5补漏：ConsoleManagementPage实际挂载的管理子页也属于文案/标题范围。Chandrasekhar（`01a18dff-9c12-79f2-b743-b4bbb2995b77`）独占MaterialMasterPage、CustomerMasterSection、AdminSupplierAccounts、AdministrativeProblemReconfiguration及其测试，仅处理固定重复标题及“第一期”开发措辞，不删除对象名、补配/强删/权限风险。其余管理入口只读核对并返回保留结论，写集与T3不重叠。
- Compose：foundation+scanning+production三个文件使用非生产校验值执行config --quiet退出0，无启动资源；`compose-config.log`保存实际结果。API完整非集成单测运行中，不改后端源码。
- T2最终：Cicero复核供应商P2已关闭并规格通过；Meitner独立质量通过，19文件真实context/会话/组织/dirty/busy及原安全断言保留。控制台最后9文件146通过、账号返修2文件56通过、导航元数据1文件18通过，合计12文件220为组合证据。
- T3最终规格：Schrodinger发现审核/新品无对象时空header，原实现者将h1移出并仅plan/project存在才渲染操作header，补两页初始/加载后断言；37文件冻结后原SPEC复核通过，Boyle质量审查中。旧29文件327组合结果不能覆盖随后两页返修，父完整Web将覆盖。
- T5/T6：Jason规格、Kuhn独立质量均通过；客户embedded仅两处真实宿主传入、历史默认可见，物料说明翻译已接。T5父隔离完整责任恢复62通过，结合未变三文件46为108组合通过；T6由父完整导航覆盖，仍不借源码断言测试PASS。
- API完整非集成回归162文件2356项通过、API构建退出0。首轮Web lint及build退出0、保留现有大chunk告警；随后两页空header返修使其Web证据需最终复验，不据先前成功跳过覆盖变化。
- 治理复核：先遇MAINT001来源变化，实际读取账号/审核标准/新品标题差异与既有Card/List/Space用法，补维护事实保持open及原2026-11-23期限；前端规则来源、六业务/一物料翻译来源等同步文档索引，不改其他维护事项结论。最终治理37登记文档/452本地链接/20来源复核/157依赖对及覆盖追踪1项通过。
- 父已冻结523份Web源码指纹（`web-frozen-before.json`），完整Web单worker运行中，期间其他实现代理停止写入。原AntD弃用、超时及中途失败分别保留，不调timeout、不降低guard。真实浏览器因本会话已记录的信任拒绝不走其他通道绕过；本轮未生成可点击样例/改后截图/尺寸对比度测量，按6.2人工清单保持待验，不将代码或单测标作视觉验收。
- T3质量Boyle发现返回工作台仍保留标签但无activeTab时，正文sr-only与顶栏条件组合导致窄屏无可见页名。父停止完整Web（已完成8文件，整次为INTERRUPTED_NOT_PASS）再返修，避免测试中改覆盖源码；日志/中断原因保留。新实现Dewey（`01a18e24-d02a-7aa2-8466-aab11142d5a7`）仅拥有ShellHeader两文件，按真实内部工作台路由补紧凑标识，不扩大供应商或其他业务页行为；独立SPEC后原Boyle窄QUALITY复核。最终采用受影响完整文件组合及最新PR的225文件完整Web分片CI证明覆盖，不将中断本地全跑写成PASS。
- 根工作区/契约/治理工具71项退出0；来源事实及索引更新后的check:governance通过，原失败不抹除。Web类型/构建在两页空header返修前已通过，最终接缝回归与构建仍须覆盖新ShellHeader及两页变化。
- T7：Dewey实现、Copernicus规格、Boyle质量窄复核通过，原T3工作台页名P2关闭；顶栏原guard测试块与基线文本一致，新增两工作台/其他业务/供应商拒绝断言，红2失败13通过，完整绿15通过。T3原37文件hash未变，质量最终通过。Lagrange文档SPEC原4项P2已关闭；Gibbs最终整合/文档质量在审。
- 分支继承说明：相对远端main89c2ddd，起点7f80392已含bffe34c/7f80392两份V0.0.37发布与回填归档提交，11个文档/治理文件125增17删，无运行代码。最终PR会包含这些原有记录，不能将其作为REQ0033新代码或新发布证据；本轮源码差异以7f80392核对，PR检查使用真实main/head完整差异。
- 父最终联合：12文件自然结束为11文件通过、navigation-access两项对象标题等待失败（243通过2失败），原始`web-final-joint.log/json`保留；无源码/测试/超时变更后隔离复跑该完整文件15项全通过（27.30秒），包含两失败用例。组合为12唯一完整文件245通过，不作单次全绿或已确认环境根因；`web-joint-combined-summary.json`与523文件指纹核对0漂移。后续最新head八分片全Web CI是合并前额外硬门禁。
- 最终Web类型及构建均退出0，实际资源为`index-CDeTdDu7.js`、`index-wm1Lcuwi.css`（后续CI构建指纹另核），保留900kB大chunk告警；`web-types-final.log`、`web-build-final.log`。提交前再回读REQ rev335仍P1/开发中，名称/方案/子任务/验收与原提交范围一致。
- Gibbs最终整合/文档质量窄复核通过，已独立重算523指纹与15项隔离日志；允许PR检查点，原联合FAIL根因未知而非默认环境问题，最新PR八分片225文件完整覆盖仍是合并前硬门禁。审查基线7f80392、工作区83路径（含4新增）完整盘点，无删除/重命名/二进制；相对main继承后共90路径，运行变动仅Web。
- V0.0.38提交`017c5d7`已推送PR87并附当前聊天，Issue86元数据登记版本/PR/CI，未关闭。准确head的run41113542364当前四真实集成分片、API、基础检查及部分Web已成功，13项通过；剩余Web4/5与汇总未完成前不执行合并。发布前公网资产仍为V0.0.37，不预写部署结果。本段为CI期间本地接续记录，不推送文档触发重复检查；部署后归档本地文档状态单列。
- PR检查点完成：run41113542364对应准确head017c5d7，16/16检查success。逐八Web日志核对文件数29/29/29/29/29/29/29/22合225，测试370/492/312/669/357/345/332/276合3153，均全绿，无failed/cancelled；四真实集成分片及foundation均success。原本地失败不抹除。完整原始log与`pr87-full-ci-summary.json`保留Git外。
- 合并检查点完成：PR实际base89c2ddd/head017c5d7、mergeable、状态及16门禁复核后，按本轮明确授权squash合并为e37504e；远端main运行源码与已验证PR head树一致。main run41115996885已启动，未在主分支检查完成前触发手工发布；生产运行仍待核验。合并响应`pr87-merged.json`与main运行只读快照留Git外。
- main检查点完成：run41115996885对应e37504e，16/16检查success，逐八Web日志合225文件3153项全绿，与PR计数相同。读取check-runs时自动deploy已加入同SHA，汇总明确过滤deploy再断言16基础检查，不将运行中的第17项误算失败/已通过；`main-ci-summary.json`保留分片结果。workflow_run自动启动deploy41117896707，目标同e37504e，当前尚无生产成功结论。
- 发布检查点完成：deploy41117896707/job124276771138最终success；2026-10-31 03:51:47（Asia/Taipei）先验证e37504e迁移前加密数据库快照，03:51:50显示141迁移且无待执行项，随后三服务同e37504e镜像启动，脚本Worker READY校验及服务健康通过，03:52:09记录Deployment successful并保留deployed SHA；默认builder dangling cache回收1.517GB。`deploy.log`证明顺序，不单以Action绿灯推断。
- 公网独立核验：/login、/app/account、/console及OpenAPI均200；auth/session、console context/home/api-observations/data-exchanges/services六匿名401；新资源index-DtXrh8DW.js和index-DxN1gHYv.css及依赖200，JS含qms-navigation-domain/qms-console-scope-details、CSS含internal-shell。`public-after.json`保留资源sha256和browserVisual=false。不读取/修改生产业务数据，不把SPA路径200作为已登录业务验收。
- 仍未完成：真实登录后的逐页视觉/主题/尺寸/触控/对比度/角色人工检查（6.2），无改后真实截图或可点击样例。工具信任拒绝未绕过；用户尚未确认效果。Issue86不关闭、REQ0033不标已结束；本轮不代设进度/优先级/验收字段。发布后归档仅本地提交，不推送触发重复部署，文档Git状态与生产运行代码分开记录。
- 发布证据已最小同步Issue86并回读state=open；需求进度/优先级未代设。heartbeat req-0033已PAUSED（automation_update成功回执），保留20分钟与不抢占规则供后续明确恢复，不配置额外定时器。归档的治理、链接和Git差异检查完成后本地提交，不推送触发二次部署；实际归档SHA由Git记录，不把归档SHA当运行SHA。
- 发布后独立核验Anscombe（`01a18e64-6acd-7100-b602-f78e6b03f6fe`）通过，实际重算PR/main分片、读取部署顺序/同SHA服务/公网与清理证据；READY表述限定脚本控制流校验，不虚构直接输出，真实页面验收仍未覆盖。最终deploy job回读success。归档治理37文档/456本地链接/20来源复核/157依赖对及覆盖追踪1项通过，diff --check退出0；不运行额外生产服务或整阶段验收。

### 6.2 正式页面验收操作表

目标版本按最终PR/head及部署SHA记录，不使用原始截图版本代替。自动浏览器若因信任/连接前置拒绝，沿既有人工验收路径保留本表，不能把源码存在或单测通过写成人工PASS。

| 项目 | 角色/入口 | 操作 | 可观察预期 | 当前证据 |
| --- | --- | --- | --- | --- |
| N1 | 内部账号，/app/workbench | 展开供应商质量，再展开系统服务，折叠任一父级 | 地址/正文未因折叠改变，两领域可同时开，无丢失入口 | 待正式实现验证 |
| N2 | 同上，PCN或条码入口 | 从叶菜单进入，切换已有个人账号标签，再返回，刷新深链接 | 真实地址、单一当前叶选中、当前祖先展开；无重复工作标签 | 待正式实现验证 |
| N3 | 同上，任一业务页 | 整栏收起、选领域图标、再次收起/展开 | 可发现文字提示，展开目标领域，不意外跳默认业务页；键盘焦点仍可达 | 待正式实现验证 |
| N4 | 内部账号，390宽 | 打开业务导航、展开、进入叶页，Esc/关闭 | 覆盖层不永久挤正文，选页后关闭，44px目标和焦点合理 | 待正式实现验证 |
| T1 | 内部账号，/app/account | 查看顶部/资料/登录会话，打开资料与安全弹窗 | 正文无个人账号/账号概览重复大标题，操作与分区仍清楚，邮箱和安全事实完整 | 待正式实现验证 |
| T2 | 具备控制台读取资格，/console | 检查页头、展开范围详情，切换获准目标组织 | 首页不重复路径和面包屑，组织选择与标题紧凑；身份/会话/资源范围仍可查 | 待正式实现验证 |
| T3 | 具备对应模块资格，/console/users及子页 | 对照分类与图标，进入深层对象后返回 | 分类与菜单主次明确，账号/档案/物料/映射/恢复语义不都是齿轮；深层路径可用 | 待正式实现验证 |
| G1 | 可编辑账号，任一草稿页 | 修改未保存后点菜单/标签/返回，先取消，再确认放弃 | 取消保留原值和当前位置，确认后一次完成离开；在途写入不被放行 | 待正式实现验证 |
| G2 | 对应管理会话 | 撤权/失效或切组织后观察旧页面与返回 | 旧内容不留敏感投影，不因菜单样式恢复权限；错误/重试/草稿按原机制 | 待正式实现验证 |
| V1 | 两类宿主 | 中英、1440/1024/390、业务浅深蓝青紫及跟随系统、管理浅深/跟随系统 | 现主题保持，长标签不遮挡，焦点和对比度可测，无整页横向溢出 | 待正式实现验证 |
| V2 | 两类宿主 | 分别在759、760、761宽检查业务导航和管理导航，打开/关闭抽屉并切换页面 | 760及以下覆盖层、761常驻导航；正文宽度与关闭/焦点正确，无整页溢出 | 待人工验收 |
| V3 | 内部问题对象页 | 进入专注、操作内容导航、退出专注，再返回保留标签的综合工作台 | 专注释放导航宽度且退出可达，恢复导航/标签状态；窄屏仍有当前页标识 | 待人工验收 |
| V4 | 两类宿主、各现有主题 | 用浏览器对比度工具测正文/次要文字与背景，以及选中/边框/焦点等必要非文本；逐项保存前景/背景色与比值 | 正文至少4.5:1，必要非文本至少3:1；不只凭截图或“可测”判断通过 | 待人工验收 |
| F1 | 内部正式路由逐页 | 检查处理清单对应位置、失败/空/未接入等状态 | 无泛化介绍或开发术语，必要口径/警告/恢复仍可发现，对象标题完整 | 待正式实现验证 |

验收反馈逐项写“版本、角色/宽度/主题、实际结果、证据或异常”，未观察即保持待验收。正常工程/CI仍主动继续，不因工具专项故障无限重试或中断已获准独立工作。

### 6.3 正式业务入口文案处理表（源码处理，不是运行态验收）

T3按InternalLayout实际分派盘点，固定页名去重均保留语义标题；对象名、编号、报告版本和新建/修订/审批弹窗不删除。源码清单及原始逐页理由在Git外`t3-route-content-handoff.md`，最终以独立审查及整合版本核对。

| 入口 | 处理 | 必须保留 |
| --- | --- | --- |
| /app、/app/workbench | 重复页头和空容器、三个入口泛化介绍删除，aria名称改入口名 | 真实链接与质量统计未接入，不显示假零 |
| /app/problem-center | 普通页名视觉去重、删除检索/个人视图泛化介绍 | 组织、筛选口径、逾期基准和错误 |
| /app/my-tasks | 页名去重，去“独立真实投影”实现术语 | 待办/通知/动作、旧任务动作不支持与正确关闭审核入口 |
| /app/problem-workspace、/:id | 通用页名去重 | 编号、对象名、来源、历史只读、选择问题恢复、专注与保护 |
| /app/account | T2账号整合，内部去重，供应商共享宿主须保可见页名 | 资料、邮箱、安全、任职、登录会话及独立保存 |
| /app/supplier-quality及详情 | 只对内部页名去重并移除空头部 | 门户页头、问题名/单号/报告/版本和签发验证关闭资格 |
| /app/supplier-incoming | 删除领域/IQC眉题、页名去重 | 人工登记、IQC完成口径、MES未开放、零/缺失 |
| /app/supplier-concession | 领域眉题和页名去重 | NG资格、数量/有效期、批次放行、MES/库存未联调 |
| /app/supplier-admission | 仅内部眉题/页名去重 | 门户分支、附件及扫描后才可提交审核 |
| /app/supplier-pcn | 仅内部眉题/页名去重 | 门户标题、变更范围、证据、审批及对象/版本 |
| /app/supplier-performance | 固定眉题/页名去重 | 月度已完成IQC合格率、人工配合度、版本及权重 |
| /app/supplier-audit | 固定眉题/页名和泛化介绍删除 | 审核对象、检查项证据、版本、提交关闭 |
| /app/supplier-quality-targets | 固定眉题/页名和泛化介绍删除 | 指标、周期、对象状态、审批发布及实际偏差 |
| /app/supplier-ppap | 固定眉题/页名去重 | Level、清单、扫描和提交审核资格/版本 |
| /app/supplier-asn | 固定眉题/页名去重 | 当前单物料范围、检验规范/PPAP/扫描校验 |
| /app/process-quality | 固定眉题/页名和泛化来源介绍删除；附件说明压缩 | 来源、发单、历史BRIEF/正式8D区别、先保存再上传 |
| /app/process-quality/problems | 共用问题中心去重及泛化点击介绍删除 | 一张正式8D一行、阶段期限不参与截止筛选、逾期口径 |
| /app/process-quality/shipment-reports | 外层页名去重，内层同名标题删除、工具栏保留 | 期间、报告号/版本、批次良率、证据及客户关联 |
| /app/customer-quality | 固定眉题/页名去重，历史提示去N4/旧契约，移除过期开发进度 | 同源视图、数量归口、台账/收件/解析/8D独立与历史返回 |
| /app/customer-quality/problems | 共用问题中心去重 | 客户来源、一行正式8D、期限筛选/逾期口径 |
| /app/audits | 固定眉题/页名及泛化查询介绍删除 | plan.title、状态时间、执行/不符合项、逐行导入及版本 |
| /app/audit-standards | 固定眉题/页名去重 | 发布版本不可改、执行留存固定版本 |
| /app/new-product-quality | 固定眉题/页名及接口原理删除，selection改业务表达 | 项目/阶段门、经验试产、映射/纳入资格、原事实与归档风险 |
| /app/new-product-quality/problems | 共用问题中心去重 | 新品来源、正式8D一行、期限/逾期口径 |
| /app/quality-data | 固定眉题/页名去重 | 来源/期间/配置阈值，未配置不判红绿、未接入/失败/权限 |
| /app/task-statistics | 页名与泛化介绍去重 | 可见运行中任务、失败待恢复独立、今日到期和单位 |
| /app/announcements | 页名去重 | 作用范围、必读确认、对象标题、版本与发布撤回影响 |
| /app/coordinate-inspection | 固定页名及泛化介绍删除 | 零件、申请审批排单进度、保存版本后提交 |
| /app/site-scanning | 页名去重 | 发布规则、物料/条码/批次、稳定失败重试及在途防重 |
| /app/documents、/app/risk-dashboard | 隐藏历史深链占位由T6处理，不新增入口 | 明确待接入，不表示有真实业务统计 |

受影响的供应商共用页面只改内部宿主；不从这份内部清单推导供应商门户已全量整改。控制台12管理section及流程两入口由T5另核，观测页/账号由T2审查，避免将外壳修改冒充全管理页面覆盖。

### 6.4 管理入口处理表（源码处理，不是人工验收）

| /console入口 | 处理与保留结论 |
| --- | --- |
| 首页 | 去重复路径/首页面包屑，保一处h1、组织选择；身份与范围可展开，完整性/非实时及来源时间保留 |
| users | 无重复固定页标题；目标账号、编辑/凭证对象上下文保留 |
| organizations | 无重复固定页标题；组织架构、详情、岗位/兼容授权分区及职责风险保留 |
| master-data/suppliers | 无重复固定页标题；反馈、错误恢复、登记编辑弹窗保留 |
| master-data/customers | embedded隐藏重复子标题；默认历史或独立调用仍可见，字段/关系/导入约束不变 |
| master-data/materials | 固定子标题语义保留并视觉隐藏，去“一期”；编码/名称能力、大小写/前导0保留 |
| master-data/component-projects | 无重复页标题；业务阶段、共享项目影响、不转派/不改历史等保留 |
| configuration | 无重复页标题；系统参数、通知规则、岗位类别、模板字段帮助保留 |
| audit-log | 无重复页标题；查询组织、真实名称/代码和范围保留 |
| outbox | 无重复页标题；总数、失败原因、重试确认与后台重处理口径保留 |
| reconfiguration | 无重复页标题；删除不可逆、仅补当前配置及对象标题保留 |
| problem-reconfiguration | 重复固定标题sr-only；恢复责任·报告号、有效任职和原归属/历史保留 |
| supplier-accounts | 重复固定标题sr-only；全平台范围、不授业务访问、不删企业/历史及删除风险保留 |
| workflows | 受控流程列表是有效列表标题，保留；模板初始化资格和版本不变 |
| workflows/:definitionId/:versionId | 流程真实名称/版本/修订/未保存与返回保留，不以页面名去重删对象标题 |
| api-monitoring | 外壳页名与正文去重，关键观测口径可见、长帮助可展开，真实权限/未知/来源保留 |
| data-exchanges | 页名去重、详细口径展开；未接入/四阶段事实/批次记录区别及失败恢复保留 |
| services | 页名去重、详细口径展开；配置不等于在线、Worker/PDF回执时间/计数/来源与未知保留 |

本轮不将流程或管理子页的有效业务分区标题删除。此表覆盖正式Console分派组件；旧/app/admin重定向路径维持原兼容，未重新开发旧聚合管理页。
