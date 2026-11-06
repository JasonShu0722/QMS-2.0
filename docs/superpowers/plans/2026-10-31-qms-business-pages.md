# REQ-0034 统一业务页面实施计划

> 面向执行代理：使用项目qms-superpowers-zh路由逐任务TDD、规格审查、质量审查与主代理独立验证。共享checkout所有Git操作由主代理串行执行，任务只写分配文件。

## 当前摘要

| 项目 | 当前事实 |
| --- | --- |
| fix8门禁接续（2026-11-06） | PR96/670c41e首CI42186914067 attempt1真实整体FAIL：integration2的旧legacy-role快照嵌套permissions无序，foundation派生失败；其余22job成功，16Web234文件3296项全PASS不代PR通过。负责人反馈“PR没通过”后接续仅测试快照显式排序、真实一次性PG与独立双审，保持完整权限断言/原门禁，继续同PR96，不rerun旧run刷绿；见9.4。当前尚未合并发布 |
| fix8当前进展 | 一行测试快照排序完成，真实PG18/55517完整17/17、0skip，原代表1PASS/16过滤非红；独立SPEC后QUALITY、配置API lint与治理通过，任务容器核ID/label清理为空。额外全spec类型检查既有346诊断前后完全相同并保留，不修无关测试或冒称PASS。暂存源核验后提交fix8更新同PR96，新HEAD/run结果在Git外fix7-checkpoint.json接续，旧首FAIL不抹去 |
| 2026-11-06 Logo追加接续 | 负责人反馈滚动不含顶部Logo/管理Logo应可回首页，明确在当前需求追加并“继续调整”。已先user补REQ0035五字段并回读rev358、14无关字段不变，开发中/P0；Issue93同样追加，不新建。基于8c90c84与本地发布归档6b055d6建`codex/req0035-logo-fix7`，预留V0.0.39-fix7，方案/验收见9.3；本追加未发布，不以fix6已发布代通过 |
| fix7实际进展 | 固定品牌/菜单分区和管理Logo链接本地完成，准确3FAIL/7filtered→最终4完整45项分次PASS，首新英文fixture15/16失败保留。8个模拟外壳浏览器场景、父类型/build27.37秒与治理通过，最终独立SPEC后QUALITY限定PASS；暂存源核验后主动同分支PR，实时HEAD/PR/CI记Git外fix7-checkpoint.json，不为进度反复推送；本追加尚未发布，不重跑已过文件或旧版全量 |
| 核对时间与范围 | 2026-11-06 Asia/Taipei；REQ0035治理页面撑宽/双端侧栏回顶已机器发布，真实角色页面待负责人复验，不改业务模型 |
| 当前版本与映射 | REQ-0035 / `reczz28W1w4YTodF` → [Issue93](https://github.com/JasonShu0722/QMS-2.0/issues/93) → [PR94](https://github.com/JasonShu0722/QMS-2.0/pull/94) / [PR95](https://github.com/JasonShu0722/QMS-2.0/pull/95) → V0.0.39-fix6 / `8c90c84cc52dce85d2c1ed98e44996dcbbe170d2` |
| 授权与外部状态 | 负责人更新开发中/P0并继续开发，后在全绿PR/待合并发布上下文明确继续，已执行本次合并发布。最近user需求回读rev357仍开发中/P0，未代写Base或关闭Issue；不含生产赋权/业务删除、关闭回填或代人工验收，旧heartbeat不恢复 |
| 本地与审查 | 最小布局/会话内侧栏UI，8完整63项分次及正式组件/外壳浏览器通过，逐单元最终SPEC后QUALITY；后续fix6仅原测试等待可见态，完整12项、独立SPEC后QUALITY、父类型/治理及暂存192来源通过，运行源未变证据复用，原FAIL/filtered保留 |
| 精确CI与合并 | PR95 b4044e0 / run42077424051 attempt1与main8c90c84 / run42080092505 attempt1各24同源job success，各16JSON234文件3290项全PASS，无漏重/skip/pending/runtimeErrors；合并整树与审候选相同。旧PR94的main单例FAIL及正确跳过deploy见9.1，不rerun刷绿 |
| 发布事实 | [deploy42082353182](https://github.com/JasonShu0722/QMS-2.0/actions/runs/42082353182)完整日志核快照725行先141链731行/无待迁移734行；API/Worker/Web同SHA健康、788行强制成功出口与1.524GB builder回收。公网新JS/CSS及sidebar-session/minmax标识、登录/契约200和四匿名401均实际核验，见9.2 |
| 文档与Git状态 | 规范1.7、实现及fix6指南/测试约定已远端main实际git show复核。本次最新发布事实集中本地归档于`codex/req0035-release-record`，不推来源索引JSON触发无运行变化full CI/重复部署；本地归档提交SHA见Git外checkpoint，区分远端规范与本地发布记录 |
| 基线与隔离 | 活动`D:/WorkSpace/QMS-2.0/qms-2.0`；本地归档基于正式发布8c90c84，用户CodeGraph四项dirty保留并排除暂存，不重写diverged本地main/历史分支 |
| 运行时 | 加载Git外Enter-Qms.ps1：Node v24.21.0 / pnpm11.19.0；不是业务验证 |
| 历史关联 | 原REQ0034/Issue89已验收关闭，不因旧未勾选项重开。初始补登顺序漏项、原main失败、模拟输入错误、未复现持续增长均保留，不改写成全程首轮通过 |
| 工程证据 | Git外`D:/WorkSpace/QMS-2.0-local/layout-sidebar-20261105/`含本次原视频抽帧、红绿/单例失败、作者/审查/父验证、PR/main完整jobs与16JSON、发布日志/公网/当前checkpoint；旧REQ0034两证据目录仍保留。模拟数据/机器发布不代生产角色或物理设备验收 |
| 下一动作 | 负责人刷新真实组织与岗位/平台配置和两端侧栏，复验持续拉伸及点击后滚动；失败同Issue93接续，确认后按另获授权关闭/回填。当前不重复开发/CI/部署、不新建heartbeat或自动接其他需求 |

**目标：** 将已认可样式及列/分页体验落到真实正式页面，保持现有业务和安全边界。

**架构：** 现有Ant Design之上增加小型受控台账列壳、独立配置/分页偏好hook及必要布局CSS。请求、选择、草稿、业务保存和错误恢复由现有拥有者维护；不建第二套数据层。

**技术栈：** React19、TypeScript、Ant Design6、现有语言/主题/Router/lucide与Vitest；不新增运行依赖。

设计：[统一设计](../specs/2026-10-31-qms-business-pages-design.md)。流程以`DELIVERY-MAINTENANCE-PROCESS.md`为准。

## 1. 影响分析与独立评审

结论：优化后开工。两名独立只读代理分别盘点台账与表单/清单；未运行业务测试，不把源代码存在当可用证据。正式74处AntD Table/50文件、原生5表/4文件及19处AntD List/10文件按设计第6节分组。

- 业务事实/API/数据库/权限/Worker/附件：无新增模型/DTO/权限或迁移；仍回归原有允许/拒绝、未知结果和草稿保护。API参数只使用现有契约已支持的分页字段。
- Web：主台账受控列和真实分页、身份/目标组织/门户隔离、本地存储防故障、保存视图优先级；表单密度/标签/操作区，专业检查矩阵符合保留。
- 风险：前端双分页、首屏截断、观察响应limit写死50、管理home与target串配置、调列重挂丢草稿、视图被旧缓存反向覆盖。
- 简化：不引入ProComponents beta/新主题/全局Form状态机；共享布局而不是共享写入模型。不用未知API替代真实契约。

## 2. 公共接口与文件所有权

- 新增`apps/web/src/ui/ledger/`：`LedgerTable`、列/偏好纯模型、页长hook、作用域Provider、同目录CSS与测试；只管理呈现配置，不接管业务请求。
- `LedgerTable`沿用`TableProps<T>`，附稳定`ledgerId`、可选明确`organizationId`/视图标识、必要列key、受控列序/显隐回调。权限先生成可用列；受控视图优先于缓存；无可信身份不持久化。
- `useLedgerPageSize`提供默认20与10/20/50/100，按用户/目标组织/门户/台账存页长；调用方将值带入真实请求，修改时回page1/offset0/cursor起点。
- `LedgerScopeProvider`允许经验证的控制台范围传入target organization及portal，不让共享组件自行查询权限或推断角色。
- 表单任务独占`theme/theme.css`、`ThemeProvider.tsx`、`ConsoleTheme.tsx`及其测试，8D/客户/制程/IQC/三坐标CSS、`AuditStandardsPage.tsx`标签与对应测试；不改领域保存逻辑。
- 核心台账任务独占ProblemCenter、CustomerQuality、ProcessDefectLedger、ProcessShipmentReport正式TSX与其测试；其他台账任务不得同时写这些文件。
- 其余正式台账/列表任务按文件组分派；主代理独占文档、索引、公共布局Provider接缝和Git。文件重叠先停并协调，不并发覆盖。

## 3. 可验证任务

### T0 需求与交付定位（主代理）

- [x] 活动规则、运行时、干净Git、远端主线及既有事项查重。
- [x] user提交九字段、回读REQ-0034 rev344，取得实际链接，不写系统/状态字段。
- [x] 创建Issue89；核对远端/本地/计划无V0.0.39占用并预留。
- [x] 从主线建立独立功能分支，保留旧关闭归档。
- [x] 设计/计划/清单入导航与索引，执行治理基线；后续源码与计划变化后须最终复验。

### T1 共享台账底座（全新实现代理）

- [x] 先写纯配置、身份/target组织/portal、坏存储、未知列、合法页长、权限列过滤测试，运行看到缺失行为红灯。
- [x] 只在新`ui/ledger`内实现受控列与指针/键盘操作、设置与恢复、局部滚动、宽度约束；不复制独立HTML模型。
- [x] 最小组件测试覆盖单列恢复/取消、顺序/固定/显隐、受控视图优先、无身份/失权/范围切换不串写；页长与列重置分开。
- [x] 最初29项、Checkbox返修30项、移动分页返修32项分别完整通过，Web lint退出0；主代理最新共享+剩余新增4完整文件52项独验通过。实际定向用`corepack pnpm --filter @qms/web exec node node_modules/vitest/vitest.mjs run src/ui/ledger --maxWorkers=1`。
- [x] 独立SPEC → 返修 → 独立QUALITY → 返修，主代理核对实际diff/证据；各返修均保留原FAIL及窄复核范围。

### T2 核心台账（全新实现代理）

- [x] 针对`problem-center.test.tsx`、`customer-ledger-page.test.tsx`、`process-formal-ledger.test.tsx`、`process-shipment-report.test.tsx`增加实际UI/请求红灯：默认20、size变化、稳定key、原视图/选择保留。
- [x] ProblemCenter把已有保存视图映射为共享受控列，宽/固定本地补充，默认25改20；不改DTO或保存视图版本逻辑。
- [x] 客诉/制程按真实组织和当前视图传key，pageSize进入请求，页长变更经原leave/busy保护；发单来源及版本不因调列清空。
- [x] 出货报告从只取page1/50改现有API真实分页，total与请求一致；详情和证据保持原拥有者。
- [ ] 上述完整测试文件及相邻scope/write/layout用例逐组复验，独立SPEC后QUALITY，再主代理复验。

### T3 其他正式台账与列表（按不重叠组分派全新代理）

- [ ] 供应商质量/档案/来料/让步/PCN/绩效/目标/审核、三坐标、物料、ASN/PPAP/准入：主列表接共享列，逐接口改真实pageSize/total/重置；相关测试先红后绿。
- [ ] 管理用户/供应商账号、部门岗位/配置、组件映射、控制台观测：使用实际target范围；观测请求与响应limit校验一起改，原资格/unknown保护不变。
- [ ] 工作流原生主表、公告/任务/通知/审核标准目录：按真实数组/page/offset/cursor/scan拥有者接入；cursor/scan不造total。详情小表/导入结果/安全会话专属上限逐项符合保留。
- [ ] 每个文件组记录改造/符合保留/领域例外，跑对应完整测试文件；不得只改分页器、只测新共享组件或只扫Page遗漏弹层。
- [ ] 各实现组独立SPEC后QUALITY，主代理串行接公共Provider及语言映射。

### T4 表单、明细与检查清单呈现（全新实现代理）

- [x] 共享主题/容器密度和标签红灯；窄Drawer不以页面宽度强制多列，原字段/错误自然撑高。
- [x] 统一轻边界、字段组与操作间距；8D和客户/制程等局部CSS消费共享变量，不改专业数据、判定、逐项/整单保存。
- [x] 审核标准动态条目增加显式行身份/字段标签；PPAP、离线审核、8D矩阵及质量目标JSON协议按设计例外保留。
- [x] 表单呈现冻结快照SPEC后QUALITY通过，主代理6完整文件35项PASS；后续审核标准目录新增分页属于T3，不能套用该快照通过结论。

### T5 冻结源码整合验证（主代理）

- [x] `git diff --check`、`corepack pnpm check:governance`；未变来源指纹核对后复用`check:archive-isolation`、`contracts:check`。
- [x] 本地Web lint、必要受影响完整文件与已知失败闭环、最终Web构建；原型代表/Closure代表及旧全量FAIL边界依7.1保留。API/真实PG/构建/Compose证据按未变来源复用，不以样例替代。
- [x] 真实组件浏览器：1440/1024/390/320、六业务主题/控制台主题、中英文、指针拖动与键盘/触控替代、刷新/目标组织隔离与合法分页；坏存储/会话/受控视图/真实请求参数有单元与调用方测试，组件夹具不充真实业务链。
- [ ] 需要业务后端的链使用一次性资源；缺角色/会话/真实设备提供版本/步骤/预期清单，保持待验，不把几何或合成数据写成业务PASS。
- [x] 总体有限SPEC后QUALITY及各返修窄复核；保存实际失败/修复/重跑，更新能力/指南/规范/索引及当前摘要；全量仍待PR CI。

### T6 PR、发布及闭环（主代理）

- [x] 按record_id回查范围未撤回，核对远端main/相关事项版本与分支差异，排除旧线程归档及秘密；同范围V0.0.39复用，不重复消费版本。
- [x] 验证/双审通过后提交、推送并创建关联Issue89的PR90，不用自动关闭关键字；正文列范围/例外/实际命令/回滚/限制，首轮失败继续原PR。
- [x] 精确PR及main各24CI/16JSON和独立审查已核，按本需求夜间授权合并；自动发布核前置快照、同SHA镜像/健康/Worker/公网产物，见7.6。
- [ ] 最终部署版逐需求及联合验收，用户认可样式不代替正式业务/拖拽验收；获准后先记录证据，再关闭Issue/最小回填Base并回读。
- [x] 统一规范1.5/7.3及实施来源已进远端main，实际git show复核；发布状态/指南/能力/验收及来源索引最终本地归档保持人工待验边界，不把本地commit写成远端同步。
- [x] 任务PG资源、Vite/浏览器模拟及测试进程已清理/恢复，不删共享或保留预览资源；机器发布完成后保存交接、删除本需求heartbeat，不建定时接单。

## 4. 回滚与完成边界

回滚仅本轮Web/样式/布局接缝，服务器业务数据和保存视图不变；坏本地配置可恢复默认。未通过独立审查/实际门禁不提“工程完成”，PR/部署/验收/关闭各自未完成不能合并报“落地完成”。

## 5. 实际过程与证据（持续更新）

- 需求九字段回读rev344；只追加Issue89链接后回读rev345，状态仍待评估。建Issue前查本轮标题/列宽未发现同目标需求，相关已结束或已验旧需求不重开。
- 首轮索引把根设计/计划直接加入documents，治理真实FAIL“路径越界”；已按现有边界改为FRONTEND-DESIGN的review.sources登记并保留导航链接，不修改检查器放宽边界。最终治理待源码/文档冻结后复验。
- 本机pnpm11的`test -- <files>`把`--`传到Vitest导致定向失效；误全量会话由各作者核对所属PID后终止，记中断不计PASS。`exec vitest`的Windows shim报错也不计产品红灯，改用`exec node node_modules/vitest/vitest.mjs run <精确文件>`。
- API原pnpm入口退出1未取得套件结果，保留`api-unit.log`；使用直接exec node Jest入口得到完整162文件2356项PASS、退出0，`api-unit-direct.log`/`api-unit-result.json`。API源码未在本轮改变，不据此宣称Web或真实PG验证通过。
- 正式T1先stub后的13个行为红灯、T2四个行为红灯及T4主题/标签准确红灯分别由作者记录，当前正在实现和定向回归；双审、完整整合与真实业务验收尚未完成。
- 控制台偏好范围新增两项准确红灯，证实未接Provider时误用home/business；按真实resourceOrganization/console接线后完整`ConsoleLayout.test.tsx`20项PASS，见`console-ledger-scope-red.log`及`console-ledger-scope-green.log`。只证明该组件范围，不代表全部调用方/真实业务通过。
- 负责人追加要求同步规范约定；已提升统一规范至1.5并纳入第7.3节，设计/计划/指南/能力/导航及索引形成同一来源链。文档治理与最终代码验证分别记录，不将文档通过当成实现完成。
- T1先后查出并修复required固定绕过、会话A→B→A旧setter和旧指针ABA；29项完整回归与lint通过后，窄QUALITY又查出coarse通配input扩大AntD Checkbox透明热区的P2。原29项不覆盖该缺陷，新增真实CSS选择器回归返修，不以原PASS覆盖新发现。
- 新共享表头显式可访问名与IQC输入字段同名，旧`getByLabelText`同时命中th和input；保留合法列标题名称，后续将字段查询限定实际textbox，不删除业务保护断言。换成`aria-labelledby`同样会命中，不能当作根因修复。
- T2四文件父批次有制程3项超时并异常退出3221226505，无完整summary；管理13页仅新增行为的组合覆盖及局部独立诊断通过，均尚非全部旧回归PASS。单独进程逐完整文件接续，不增加原预算，不以重复刷绿替代定位。
- 供应商独立完整已通过准入8、PPAP12、ASN8、让步5、质量11项；物料18项中16过2超时，IQC10项中7过2查询重复与1超时，PCN11项中8过3超时；Coordinate/Profiles/Performance/Audit/Targets/Portal完整回归待接续。原14文件批次100/119通过及19失败保留，不计总体PASS。
- 剩余列表实际11个主文件已完成首轮候选：Legacy、公告、供应商通知、六任务页、审核管理及审核标准；新增14例先得到13准确缺失FAIL/1既有默认20PASS。审核目录改现有契约支持的真实分页，来源协作保留scan25；绿灯和完整回归待独占窗口，不与共享/供应商重测并跑。
- 共享Checkbox返修作者`ledger_review_fixes`：真实CSSOM新增回归准确红29PASS/1FAIL、最小收窄数值输入选择器后完整30PASS/退出0；`quality_shared_forms`窄SPEC、`quality_ledger_remaining`独立QUALITY均通过。原表头命名保持，IQC字段测试精确改textbox查询但尚未复验。
- `quality_shared_forms`对T2+管理17文件静态QUALITY、剩余11文件静态SPEC通过；`quality_ledger_remaining`对供应商14文件静态SPEC有限通过，均不等于完整回归。剩余列表新14项目前由green-2、green-focused、green-size分组逐项覆盖，最后4项原10秒预算内PASS，仍无当前单次整14及全部旧回归证据。
- 本检查点文档治理PASS：37文档/464本地链接/20来源复核、维护open3/closed0、157依赖及阶段覆盖1项；归档隔离PASS。`governance-sync-checkpoint.log`首轮因维护来源摘要未接续真实失败，已复核维护事实并更新依赖后`governance-sync-checkpoint-final.log`通过；本段及后续规范变化后仍须重新检查，不把旧PASS当最终冻结证据。
- 主代理独立复验共享完整30项PASS、退出0，`ledger-parent-final.log`。正式React/AntD组件夹具在真实浏览器验证1440指针拖宽320→400、拖列后行/表头一致与草稿保持、刷新恢复、键盘宽410/移列、目标B默认320与A恢复410；选择10条实际显示10行/2页，1024刷新保宽300/页长10。390页面宽390、设置左右5/363.4不撑开页面；coarse模拟中透明Checkbox约18.4×18.4、外label高44，输入宽300后仍选中，已恢复模拟与viewport并关闭本任务Vite。证据`ledger-browser-component.json`及四张PNG。夹具仅12行模拟数据/模拟会话、默认蓝色中文，不代表真实API/保存视图/六主题/英文/物理触控或业务验收。
- 剩余列表独立QUALITY另查出Closure/Process实际home请求却按URL目标写偏好、Supplier8D英文批次标签缺失两项P2；原作者新增6例准确RED→GREEN，原审者复核SPEC及另一审者独立窄QUALITY均通过，API与业务写入保护未变。规范、专项设计和指南同步“组织必须与实际请求拥有者一致”，不只改当前两个调用方。
- 剩余列表原新增pagination14最新完整运行仍FAIL：9PASS/5FAIL，两个10秒超时及三个下拉可见性失败；原先分批逐项通过不替代该失败，`remaining-lists-pagination-complete.log`保留。后续先阶段计时/实际popup归属诊断，不放宽预算或跳过；本轮修复后Web lint退出0不证明这些测试通过。
- 精确性能诊断：同依赖同环境取HEAD旧Table及原Coordinate7例，完整PASS（31.66秒测试）；候选3例阶段诊断2PASS/1超时，render37～215ms而全页`getByRole`单次约3.9～4.4秒，不能归因网络或无限渲染。两个临时诊断模块已核对路径后删除，日志保留且仅诊断不计候选PASS。原Coordinate查询已限定真实dialog，待完整复验。
- 剩余列表阶段诊断证实Legacy首次全页角色查询9.005秒而mount80.75ms；按真实控件定位并保留可访问名/20行/可见断言后2.113秒。Audit使用同编辑器label约6.7秒。依赖`@rc-component/util`在test模式生成重复test-id的事实已核实，新增fixture沿既有模式改development并恢复环境后完整14/14 PASS，返修6/6再次完整PASS、lint0。未复现错误popup归属或断连，不声称重复ID解释全部历史可见性FAIL。
- 移动端另发现Ant Design在<=576默认隐藏页长入口P2；作者新增双宿主CSSOM准确红2FAIL/30filtered→完整32PASS、lint0，独立SPEC后QUALITY通过。root真实390核对business/console宿主的Table内置和独立Pagination均可见可操作（内20/10实际行数12/10、外50/100实际页数3/2），页面宽与scrollWidth均390；1440入口仍在。样例使用真实组件但模拟数据/宿主，不是ConsoleTheme或API业务验收。
- 全workspace构建退出0（保留大chunk警告），`contracts:check`退出0，产物搜索未发现fixture-target-a/browser-verification等模拟入口标识；未改生成契约。Compose foundation+scanning使用本进程随机配置`config --quiet`退出0，不等于部署。完整phase1/2实际前置失败分别缺DATABASE_URL/显式disposable配置，未执行项不得写PASS，Foundation记录已同步。
- 核心四页由`core_regression_finish`串行完整复验：Shipment4、Problem11、Process37、Customer62，共114项，各独立Node进程退出0，日志分别`core-final-shipment.log`、`core-final-problem-verified.log`、`core-final-process-verified.log`、`core-final-customer-final.log`。此前body字段重名、中文选项、全页角色耗时、Customer固定ID标题碰撞和页长跨例泄漏FAIL均保留；只精确适配真实控件/fixture并恢复原可见等待，未改生产/业务断言/预算/motion。测试适配经`quality_shared_forms`独立SPEC、`quality_ledger_remaining`独立QUALITY通过；相邻及全量回归仍另列。
- 主代理最新正式共享与剩余新增组合独验：`src/ui/ledger`、`remaining-lists-pagination.test.tsx`、`remaining-lists-quality.test.tsx`共4完整文件52项PASS、退出0，无跳过，`shared-and-lists-parent.log`；治理测试48项PASS、退出0，`governance-tests.log`。文档检查点`governance-norms-current.log`为37文档/465本地链接/20来源复核/157依赖，后续本文变化仍须最后复验。
- 实际新建本任务PG18容器`qms-req0034-pg-20261031`，loopback55491、tmpfs且无宿主挂载/卷，完成141链迁移与独立seed。8完整集成文件首批115/116，未改的task-inbox真实110事件backlog用例触原5000ms；未增加预算或改API，再以独立Node完整运行该40项文件40/40通过。其余7完整文件76项加该40项构成8文件116项组合证据，不声称首批全绿或完整阶段通过。真实结果与JSON为`pg-integration.log`/`pg-result.json`及`pg-task-isolated.log`/`pg-task-isolated-result.json`；容器核对标签/无挂载后stop+rm已完成，`pg-cleanup.log`。未连接55440，未用Mock/Skip替代PG。

## 6. 负责人要求的暂停交接（2026-10-31）

- 暂停来源：负责人“进展咋样了，我准备下班了，能到一个节点先暂停么”。当前单个Material完整测试自然结束后停止，不启动后续队列，不自动恢复；保留本地未提交差异与全部Git外证据，未commit/push/创建PR/合并/部署或关闭需求。
- 当前最后结果：`supplier-ledgers-final-MaterialMasterPage.log`，18项17PASS/1FAIL、退出1；原CAS重读与英文导入预算用例本轮通过，剩`getByLabelText('物料编码')`命中input与合法th，遵暂停要求未继续修改或复验。没有把该文件计PASS。
- 供应商完整已通过6文件51项：Admission8、PPAP12、ASN8、Concession5、Quality11、Coordinate7；不要无故重复。待完整绿8文件：Material；PCN原8/11后按阶段证据收窄；IQC原7/10后输入与照片查询适配；Profiles原9/12后字段查询适配；Audit原4/7后输入与固定ID fixture适配；Performance原4/5后确认scope；Targets原3/4后证实固定ID并局部fixture适配；Portal原1/2后discard/reopen查询收窄。
- 六文件`SUPPLIER_STAGE`、Audit/Targets ID诊断、`startedAt`及临时trace均已移除，未放宽预算/motion/业务断言；供应商最后修正尚未独立复审和完整再验。核心114项测试适配已独立SPEC后QUALITY通过，不能套用到供应商后改测试。
- 恢复顺序：核对分支`codex/unified-business-pages`与基线478c325；修物料精确字段查询；8文件逐完整进程验证/返修复审；其他调用方完整回归及按既有CI八片串行完成全量Web并核对覆盖；最终lint/build/契约/治理与来源摘要、总体双审；再核有效需求/版本/base-head并进入PR。原phase1/2前置FAIL、未验证主题/语言/真实业务角色与人工验收仍分别列明。
- 资源：任务Vite与浏览器标签已关闭；PG任务容器按标签/无挂载核对后清理，无保留预览数据库使用。暂停时无本任务Vitest/tinypool运行进程；没有恢复heartbeat或新建自动化。所有实现子代理停止，不在后台继续开发。

## 7. 恢复接续（2026-10-31）

- 负责人明确“继续推进，还有开发任务么”，恢复同一范围，不新建需求或重复实现已完成事项。user重新按record_id读取REQ-0034成功，rev348已为开发中，原目标/方案/验收及Issue89链接保持，证据`req-resume-readback.json`；本轮不修改Base状态，不从最后编辑者推断谁修改了状态。
- 恢复核对HEAD仍478c325、分支`codex/unified-business-pages`，本地差异与暂停交接一致，Node24.21.0/pnpm11.19.0，无遗留测试/Vite。当前工作为测试接缝修正、8文件完整复验、全范围缺口审计及全量整合门禁；并非再次新增业务能力。
- `supplier_resume`独占8测试文件和Web验证窗口，保留所有业务断言/原预算/motion；`completion_audit`独立只读核对规格及遗漏，Git/规范/最终来源摘要仍由主代理串行维护。
- `completion_audit`规格审计确认1项P2：ProblemCenter默认视图始终受控，父组件只维护内存列序/显隐，共享受控分支不写偏好，导致默认调列卸载/刷新后丢失。创建/更新服务器视图body仍由父布局构成，不能仅删受控props。`problem_preferences_fix`按既有偏好模型区分默认本地layout与显式服务器配置，先准确红灯再最小实现，保命名视图优先和保存body一致；修复与复核完成前总体规格轴不通过。
- 恢复供应商完整结果已取得Material18、PCN11、IQC10、Profiles12，各独立Node退出0。Material只将原创建字段查询限定真实input，未改业务；原近预算用例和全部失败历史保留。其余4文件继续串行完整复验，不能将当前51项推算为8文件全通过。
- 供应商最终8文件完整69项均退出0：Material18/PCN11/IQC10/Profiles12/Audit7/Performance5/Targets4/Portal2，`resume2-supplier-*.log`，Audit使用最后`audit-final`而非旧两次6/7；后5文件附JSON。Audit原pending关闭单阶段6.36秒、全局否定4.85秒，按准确日志限定原named Drawer及全局真实button可访问名断言；另一失败是未等实际记录加载，已等待真实summary并同一行操作。原预算/motion/业务断言未降，临时trace清零。`supplier_test_spec`独立SPEC及`completion_audit`独立QUALITY通过；与原6完整文件51项形成14文件120项组合，不声称首轮全绿。
- 问题中心作者复用现有`usePreference/preferenceKey/normalizePreferences`，单独`default-layout`只拥有order/visible，Ledger原key独占width/fixed，避免两hook写过期全快照；命名server布局临时受控，显式应用才覆盖，取消回本地，保存body与显示一致。新增3例准确缺失RED，完整14PASS及ProcessFollowup29/API3相邻完整32PASS，lint0，`resume2-problem-{red,green,neighbor,lint}.log`；待独立P2规格复核和质量审查，不以46PASS自动关闭审查。
- 主代理通过实际Vitest `globTestSpecifications`与官方`BaseSequencer.shard`取得231文件（前7片各29、末片28），并集无重叠且完整；冻结`src`及Vite共534来源SHA-256，`web-freeze-manifest.json`。以原10000ms默认预算、每片单worker独立进程串行执行，JSON/default报告置Git外`web-full-shard-N`；这只是正在执行清单，不预写全量PASS。
- `completion_audit`实际复核问题中心P2返修SPEC通过，原默认布局缺口关闭，总有限规格轴转PASS；`supplier_test_spec`独立QUALITY复核Page、共享偏好接缝、reset双回调、服务器显式应用/取消/保存body及原scope/CAS通过。静态双审不放行全量门禁：第1片已观察相邻DirectPositions/SupplierWorkspace具名dialog及原型category提示FAIL，主代理保原断言/预算，待完整报告后精准判断关联与根因，不预先归因环境/固定ID。
- 全Web第1片完整结果为29文件381项374PASS/7FAIL、1102.10秒。相邻DirectPositions3/SupplierWorkspace2具名dialog失败已用两个代表例准确记录同`test-id`首label为空后局部fixture恢复真实React ID；Direct原部门输入重名限定input，Supplier JOINT审核动作实测全页查询3.76秒改原具名region，完整7+59=66PASS。StructureAssignments原30秒并发基线用例自身trace显示全局reload/cell/preview各约5秒，限定真实任职tabpanel/稳定preview控件后完整15PASS，原全局消失否定/CAS body/预算/motion保留。两组适配分别经独立SPEC后QUALITY通过，原片7FAIL保持不变，修后81项为完整文件组合。
- 第1片剩原型失败不是category业务断言，而是`ComponentProjectPreview.test.tsx`的`confirmBulk`默认等待Modal卸载时仍busy/appear-prepare；原型源码和测试本轮未改，`commitLocal`原350ms，需同环境准确基线/阶段诊断，不盲修无关业务。第2片完整29文件499项488PASS/11FAIL、1370.34秒；7项集中`admin-interactions.test.tsx`的邮箱/角色名称（及后续用户名）与新增合法th同名，应限定真实input保业务断言；另4项为`UserMfaPolicy.test.tsx`挂载UserAdministration的全页查询/幂等重试超原预算，需自身阶段证据，不从未改MFA源码猜测产品故障。
- 源码冻结v2只允许并实际记录首片后3份已独立完整复验的测试变化（DirectPositions/StructureAssignments/SupplierWorkspace），没有生产变化；`web-freeze-manifest-v2.json`保原231清单及534来源hash与前后SHA。第2～8片loop独占串行，日志/JSON为`web-full-shard-N`、每片结束码累计`web-shard-exits.json`；当前session44402仍运行，不能另外启动重型验证或修改其覆盖源码。
- 负责人追加夜间授权后已实际创建20分钟thread heartbeat `req-0034`，状态ACTIVE，专用于本REQ。同主会话/子代理/测试/部署活动时不抢资源，无变化保持安静，停滞才按本摘要继续；完成机器发布或遇需用户输入的安全阻塞后保存交接并暂停heartbeat。它不是周期重跑测试或自动接其他需求。
- 负责人询问单次二十多分钟是否正常：已如实说明22分50秒仅第2/8片（499项），本地单worker串行及新列工具后旧全页角色查询单次3～6秒使耗时偏慢，当前有持续CPU/完整文件输出，不是卡死；该效率问题需要精确定位并保全部业务断言，不以增加timeout/skip换绿。
- 负责人随后问“怎么又停了”：实时核对后台未停，第3片已完整29文件316项PASS、804.50秒，主进程已进入第4片，Vitest/tinypool仍存在；上条结束回复造成界面误解，不能把聊天回复结束等同任务进程暂停。已继续在当前会话跟进，heartbeat仍ACTIVE且不抢活动验证；分片完成/修复结果作为实质进展汇报。
- 负责人再次明确“这个测试太慢了啊，明显不正常吧”。已停止机械等待：session44402中断，第4片及后续未完整执行不计PASS；确认无遗留Vitest。机器实查为6核12线程、约21.84GB内存/9.64GB可用，无证据表明内存耗尽；不将慢笼统归环境。`test_performance_diagnosis`仅短真实Table/Ledger对照及CPU profile，不改生产/预算/motion/断言。
- 验证策略纠正：权威交付流程2.4要求本地最小足够受影响门禁，3.2要求本地定向和审查后集中推送；既有Foundation全Web在八独立VM并行。原计划把CI八片照搬本地单worker串行，使首3片分别1102/1370/804秒，是执行策略额外放大等待，不应继续当正常开销。现在保留本地真实PG/API/build/契约/治理及受影响完整文件/已知FAIL闭环，全量231覆盖由既有PR精确HEAD八VM门禁执行，不减少测试/跳过/加超时，也不在CI通过前合并部署。此调整由独立审者核对根规则，不更改CI配置或扩大业务范围。
- `completion_audit`独立确认上述验证分工可采用：交付流程2.4/3.2与根规则未要求本地/CI两遍全量；原API2356/PG116/契约/归档/Compose只有相应源码/依赖/配置未变时按指纹复用，Problem返修后的最终Web构建必须重做。已知admin/MFA失败须本地准确闭环；原型若经基线确认无关仍保残余交CI严格判断，不能称本地全绿；精确HEAD同run/attempt的完整16项门禁成功后才集成。完整phase1/2前置FAIL不被CI分项升级为阶段PASS。
- 短性能诊断已完成，两轮11.31/10.84秒，临时test已核路径删除，未改正式生产/测试配置。相同20行8列Theme/Language：原AntD挂载468ms、Ledger312ms；cold全页角色49/183ms，限定编辑区2.08/1.43ms；节点253/456、按钮3/20。证明增加控件放大全页可访问树查询，但不支持产品render秒级。worker8.516秒CPU采样中internalModuleStat自耗4.385秒（51.5%），模块加载栈累计6.758秒（79.4%），动态UI import7.133秒，与每隔离文件collect约7.55秒对应；GC1.1%、idle2.3%，不支持卡死或GC主导。未验证磁盘/杀软影响，不继续猜机器故障。证据`perf-contrast.json`、`perf-worker.cpuprofile`及summary，首主进程idle89%不冒称worker空闲。
- `admin_test_finish`仅拥有admin-interactions/UserMfaPolicy两个测试文件和当前独占验证窗口，按已有失败精确限定输入查询、为MFA先取自身stage再最小修复，不改生产/预算/motion/幂等与全局否定语义。heartbeat已更新为“本地受影响收口→PR既有并行CI”，明确禁止旧本地八片队列自动恢复。

### 7.1 本地最小门禁收口（2026-11-01）

- 管理已知失败两个完整文件最终32项通过：`admin-resume-final-interactions-complete`为22项/143.19秒，`admin-resume-final-mfa`为10项/66.40秒；全页查询3～6秒而API几十毫秒，精确限定真实input/编辑器/按钮，幂等、securityVersion、dirty和迟到秘密全局不重显断言保留，SPEC后独立QUALITY通过。
- 审者要求的高风险最低补集已完成：DataExchange完整23项、ProcessEightDTaskInbox完整25项，`boundary-resume-exchange`与`boundary-resume-process-tasks-verified`；后者只在原401 router用例等待真实8D-123后继续原POST401/导航清敏断言。Closure局部development fixture修真实固定ID碰撞，中英2代表通过/56 filtered；不是58完整通过。两项测试适配先SPEC后独立QUALITY通过。
- 未改的ComponentProjectPreview原失败是Modal卸载等待；同环境同一原case用HEAD旧主题20.474秒PASS、候选20.800秒PASS，各17 filtered。`preview-head-theme-baseline`和`preview-current-isolated`保留，不把单次对照当主题因果或整18通过；三个临时基线文件已删除，原全量FAIL继续交PR CI严格判定。
- 最新列设置浮层在390/client375出现left=-10.2真实截断；仅CSS视口预留32→64px，保桌面580px上限和原高度滚动。准确RED 1FAIL/27 filtered→完整共享33PASS/18秒，独立SPEC与QUALITY均通过。实际390 left21.8/right348.2、320/client305 left21.8/right277.8，16控件横向全在视口；Reset正常纵滚可达，桌面实际intrinsic379.25不变。证据`console-popover-clipped-red.json`、`popup-viewport-browser-green.json`及`popup-viewport-{red,green}.log`。
- 真实组件夹具补齐六业务配色、公共控件中英、Console light/dark/system与两Provider系统偏好dark→light；`themes-and-language-browser.json`。模拟会话/数据不充真实业务认证、保存视图端到端或物理设备验收；截图落盘被本机文档加密策略处理，保DOM几何与原生浏览器现场观察，不尝试绕过。viewport/media已恢复，任务tab/Vite已关闭，无遗留测试进程。
- 最新Web lint/build均exit0，`final-web-lint.log`/`final-web-build.log`；build23.27秒，最新CSS进入`index-BWUV8tEP.css`，脚本`index-CzJEdrry.js`，fixture标识未进生产产物，大chunk警告保留。`evidence-reuse-scope.json`核API/契约/lock/依赖/部署相对478c325无变化，复用2356API/116PG/契约/归档/Compose分项而不重跑。
- 提PR前再次user回读REQ-0034 rev348仍开发中/范围与Issue不变，未写表；fetch的origin/main仍478c325，最近远端PR和本地计划无其他V0.0.39占用。文档事实同步与最终治理后主动提同一联合PR，全量231仅交既有八独立VM；精确HEAD全部16门禁与审查通过再按授权合并部署。phase1/2前置FAIL、filtered/中断与人工待验边界不变。
- 最终来源逐项实际复核后治理通过：37文档/466本地链接/20来源复核、维护open3/closed0、157依赖、阶段覆盖1项；`pre-pr-governance-verified.log`及`git diff --check`。首轮`pre-pr-governance.log`因UTC检查把本地11-01复核日判未来而FAIL，按实际UTC10-31登记复核日期后通过，未修改检查器/时钟；文字时间保持Asia/Taipei。后续仅同步本行与勾选，计划摘要须据此重新计算。

### 7.2 PR90首轮CI失败闭环（2026-11-01）

- 已提交推送`7e34a92e9cb08040401f106d126f42f0be03b3c5`并建立PR90，Issue89实际追加交付链接评论；未关闭/回填。运行`41224780227` attempt1精确该HEAD，16jobs中scope/checks/API及四真实资源分片、Web1/2/3成功；其余Web和严格foundation汇总失败，不能合并。
- 八片artifact和全部六失败job日志已下载Git外，`pr90-failure-inventory.json`记录完整清单。Web1为29文件381PASS、Web2为29文件499PASS、Web3为29文件316PASS；Web4为29文件618/624、Web5为29文件400/402、Web6为29文件326/330、Web7为29文件311/314。第8片只有21完整文件记录，已观察Binding1/AuditAdministration2失败，尚7文件未完成，20分钟step timeout无最终JSON，不把部分日志累加成全量结果。
- 完整15失败覆盖console-migration1、LegacyAuthorizationEntries2、governance-draft-guards2、SupplierAdmission1、ConsoleLayout2、announcements-audit3、SupplierEvidenceRefresh1、admin-draft-guards2、process-local-boundaries1。已有同名th/input、缺named dialog、同步focus及原预算timeout各类明确错误；不能统一归环境或盲改fixture。第8片新增观察失败与耗时另外闭环，不遗漏取消前失败。
- 新实现代理`ci_admin_guards_fix`拥有admin/governance guards及Legacy三个测试、当前唯一验证窗口；`ci_console_audit_fix`拥有ConsoleLayout/migration/announcement三个测试，`ci_supplier_boundary_fix`拥有Admission/Evidence/Process local三个测试，只读定位并排队取得准确red窗口。每组保原业务/权限/dirty/晚到响应/焦点语义，不改生产ARIA/预算/motion；生产缺陷先回报协调，完成后分别SPEC再独立QUALITY，不通过就继续原PR。
- 第8片已完成记录中Closure58耗239秒、Structure27耗246秒、Configuration guard8耗172秒；前者58断言已由CI完整执行，但分片整体不通过，不能将超时解释为无断言失败。将对真实查询耗时精确收窄，不增CI step/job预算、分片数或降低覆盖。
- 管理组已闭环：两个guard各只限定重开后的真实input；Legacy先等实际entry-user/直属岗行再行内点原具名动作，保原403和晚到响应保护。准确admin role RED1FAIL/3 filtered及Legacy自身阶段失败保留，完整admin4/governance3/Legacy14三个独立文件21项PASS，`ci1-admin-*-green.log`；supplier代理独立SPEC有限PASS后console代理独立QUALITY PASS。写集已冻结，不重复测试。
- Console组已得两个准确named dialog红灯及实际`test-id`标签顺序空标签在标题前的证据；仅对应fixture局部development/恢复。focus两例CI准确FAIL、本地未改2代表PASS/18 filtered，不能把名为red的日志写红；最小等待原effect焦点断言，永久body仍失败。三个完整文件验证进行中，尚不写PASS。连续唯一Web窗口授权console结束直接交supplier，supplier结束直接唤醒新实现代理`ci_shard8_finish`处理Audit/Binding及Structure/Configuration四测试；不得并跑，不等待定时器再交接。各组完成后独立SPEC再QUALITY、root集中Git/文档/最终推送。
- Console组后续完整migration66/Layout20/announcements3共89项分别exit0，实际24.85/13.31/25.08秒；supplier审者独立SPEC后completion审者独立QUALITY通过。只有局部fixture真实ID和原焦点effect等待适配，没有生产改动；原CI失败及focus本地非红灯边界保留。
- 供应商边界组三原例准确RED：Admission1FAIL/7 filtered、Process1FAIL/4 filtered、Evidence F2原预算timeout1FAIL/1 filtered。F2自身mount186ms、全页查询2.47/4.53/2.62/2.69秒而reload78ms；按真实当前证据行查询后4.583秒。完整Admission8/Evidence2/Process5共15项分别exit0，三规范化SHA及日志见`ci1-boundary-result.json`；completion独立SPEC后console独立QUALITY通过。保兄弟选择/独立saved baseline/expectedVersion2/dirty/body，重载后重取行，无生产/预算/motion/fixture变化。
- 第8片准确原RED为Audit2+Binding1共3FAIL/39 filtered。Audit首次完整6/7 FAIL保留；自身mount1268ms、累计ready4389ms/展开7532ms/输入8070ms后原预算超时，收窄真实query form后完整7PASS且导出例3.176秒。Binding全页角色查询有一次1899ms阻塞帧，确认Modal仍appear-prepare；改真实标题所属dialog内原role/可见断言后完整35PASS。Structure仅共用helper按真实岗位td所属行查原role，完整27PASS/214.86秒；不把运行完毕前的Configuration8计PASS。四文件静态SPEC后独立QUALITY有限通过，原预算/motion/全局安全及业务断言保持。
- 返修运行源码不变：`ci1-runtime-unchanged.json`实际核相对7e34a92只改测试/文档，无未跟踪源码，API/DTO/迁移/依赖/CI/部署与生产Web源码均无变化；复用既有构建/浏览器/API/PG，不启动无关业务资源。最后Configuration完整/类型及治理完成后集中推一个fix1，不重跑本地八片或通过项。
- Configuration最后完整8PASS/133.86秒，测试124.39秒；与Audit7/Binding35/Structure27组成四独立完整文件77项，作者释放唯一Web窗口，四source hash与静态独立SPEC/QUALITY快照一致。规则代表诊断23.812秒与修后完整中的16.061秒是同机不同次分项对比，不冒称CI加速实测。四组总13个不同完整文件202项组合通过，未改变测试数量/预算/环境/motion或生产逻辑；最新精确云端全量仍须另验。
- root实际核对最终四source blob与独立双审快照一致，核读完整Configuration8项日志后接过唯一窗口；`corepack pnpm --filter @qms/web lint`退出0，`ci1-parent-lint.log`。不重复202项或未变生产build/API/PG；最终治理输出统一保存`ci1-parent-governance.log`，提交前以其实际退出码及diff检查为门禁，不能据本段预判成功。

### 7.3 PR90通过与main单例返修（2026-11-01）

- fix1已提交9b29ce7并更新原PR90，父类型、最终治理37文档/466链接/20复核/157依赖和diff均实际通过。PR CI41230729259 attempt1精确HEAD全16jobs成功，八artifact实际解析231文件/3261项全PASS，无漏/重/pending/runtimeErrors；与官方冻结231一致，`pr90-fix1-coverage-verified.json`。原超时第8片这轮约11.43分钟，非本地样例或缩减清单。
- 独立release gate复核后，按交付流程首次交付PR/squash使用基础V0.0.39，正文保fix1，不重写其历史；实际合并6041d80023fd02c7fe6784ca7fbbbc0cff7e89a1，整树83ddf539与已审9b候选完全一致。合并前公网基线200，旧主JS为index-CxMsz3IP.js、CSS为index-DxN1gHYv.css，`public-predeploy-baseline.json`。
- main CI41233552342 attempt1实际FAIL：231完整文件3261项中3260PASS/1FAIL，唯一失败`ComponentProjectAdministration.test.tsx`的`protects a refresh and completes only the confirmed discard in the single-table workspace`，30452ms超原30000ms；其余7Web分片/API/四真实资源/checks/scope全部成功，foundation严格汇总失败。部署41235023043正确skipped，不能称已上线。
- 已保存全部失败job日志、八artifact及`main-6041d80-failure-inventory.json`；不是分片20分钟取消，也没有其他取消前失败。该文件此前PR完整42项耗433秒，此例29552ms边缘通过，不能以“之前绿过”忽略或直接整片重跑刷绿。
- 从main6041d80建立`codex/req0034-ci-fix2`，复用Issue89与V0.0.39-fix2；新实现代理`fix2_component_query`只拥有此测试文件及唯一Web验证窗口，先原例/自身阶段证据再最小真实region/row/form/dialog查询，完整42项及独立SPEC后QUALITY后新修复PR。既有development/motion/预算/业务安全断言保持，生产源码未授权随意改动；不再向已合并PR90推送充新交付。
- fix2原例本地未改27.286秒PASS/41 filtered，诊断26.54秒PASS/41 filtered，均不是本地红灯，准确红来自main CI。自身累计入口7.826秒、刷新12.190秒、继续16.619秒、再次刷新21.116秒、放弃25.647秒、完成26.522秒，阶段包含查询/点击/更新，不充单次纯query或网络/机器归因。只限定实际组件toolbar、项目dialog及确认标题所属dialog内原role/name/visible，保末尾global dialog/tab/table及全文件原业务/安全断言。
- 修后同原代表7.420秒PASS/41 filtered；随后完整42/42 PASS、exit0，总390.61秒，目标例7.354秒，`fix2-component-full.log/json`及`fix2-component-author-evidence.json`。原30000ms/async5000ms、development及motion保持，无生产变化，临时trace清零；没有同机未改完整文件基线，不宣称整文件加速比例。作者释放窗口，blob`fda8d5baaad4e30c0f0231f766f6fa0356647dfb`与completion独立SPEC后console独立QUALITY快照一致。
- 父核冻结hash后运行Web lint/typecheck退出0（`fix2-parent-lint.log`），fetch main仍6041d80，fix2未被其他提交占用，user回读REQ仍rev348同实际record。最后来源逐项复核/治理和diff门禁输出保存`fix2-parent-governance.log`；运行源码/依赖/CI未变据指纹复用已过构建，不重复本地全量。

### 7.4 PR91首轮断言与关键路径闭环（2026-11-01）

- fix2父类型、治理37文档/466链接/20复核/157依赖及diff实际通过后提交1ec394d510412becbdc343ab236b89a67e2788a2，建立独立PR91并实际评论回Issue89。生产/API/依赖/CI不变指纹见`fix2-runtime-unchanged.json`；未向已合并PR90推送。
- PR91运行41236645520 attempt1精确1ec实际FAIL：scope/checks/API及四真实资源分片、Web2/3/4/5/6/7成功；Web1仅`StructureAssignments.test.tsx`内部tab继续/丢弃基线保护例31.409秒超原30秒，Web8在20分钟step timeout前22完整文件记录、无观察断言失败、6文件未完成，无完整JSON。全部三失败job日志/八artifact及`pr91-failure-inventory.json`已取证，不遗漏取消前失败，不把22局部记录冒称整片通过。
- Web8真实关键路径：Closure58项261.371秒、Structure27项209.979秒、ConfigGuard8项128.422秒；这三文件原断言全部通过，但消耗大部分step预算。以自身阶段证据最小收窄正向真实控件查询，而非增加step/job timeout、分片数/并发或跳过后6文件；全局权限/敏感否定断言保持。
- 三个新实现代理独占写集：`fix3_assignment_guard`仅StructureAssignments15例，当前唯一Web窗口；`fix3_closure_queries`仅Closure58例；`fix3_admin_hotqueries`仅Structure27/ConfigGuard8例。后两仅只读定位，取得明确交接才测试/编辑，按此顺序各独立完整文件验证；无功能红的性能组不得伪称功能RED，准确失败是整片超时，各组最终SPEC后独立QUALITY、root集中Git/文档。
- A任职例本地准确RED1FAIL/14 filtered、31.01秒，诊断23.329秒PASS不是红；最终仅该例真实任职tabpanel/admin-form-stack内原role，末尾重新从当前body取active panel后查combobox仍等于原selector，避免旧panel自证不重挂。完整15项PASS/199.97秒，目标14.312秒；B独立SPEC后C独立QUALITY通过，原globaltab/权限预览消失/beforeunload/零写及budget保持，`fix3-assignment-author-evidence.json`。
- B Closure原2代表4.032/9.714秒PASS非红，累计stage含查询/事件/等待不充纯query；第一次c7快照完整58PASS后独立SPEC发现native trigger缺原hidden:false的aria-hidden祖先排除，仅补既有waitFor中closest-null，SPEC复核后独立QUALITY通过。最终e5快照重新完整58PASS/263.35秒，测试251.13秒；旧c7/226.21秒结果保留不代最终，不宣称整文件加速比。所有58业务和32条global否定逐行保留，最终证据`fix3-closure-full-verified.log/json`及更新作者证据。
- C自身stage证实全页dialog阶段仅约0.2秒，放弃无证据的批量helper替换；只量化MFA/transport实际Drawer、英文岗位行、Config通知行/类别Card/settings form/error Alert和已验证按钮范围，原global安全/dirty/CAS/body/晚到隔离/读次数/预算/motion/fixture保持。完整27+8共35项PASS，各独立Node191.27/92.93秒；代表transport21.491→6.851、Config15.790→13.361是不同次分项，完整Config代表17.528秒不抹去，不能称CI收益。A独立SPEC后completion独立QUALITY通过，`fix3-admin-author-evidence.json`。
- root核四最终JSON及源blob与独立审查一致，108项是15/58/27/8四独立完整文件组合，零failed/pending，`fix3-parent-web-evidence.json`；未减少case或改变预算/motion。Web窗口已交容量代理完整root suite及官方枚举，不重跑本地Web全量。

### 7.5 验证容量策略修订（2026-11-01）

- 前一检查点选择只优化查询、不改八片；后续完整记录已证明Web8两次触及20分钟step边界，另Web5约17分钟。既有单片曾11.43分钟通过并不证明当前容量余量足够。只读代理`ci_capacity_assessment`逐源码确认现有官方分片扩容是原生能力，继续追逐所有未失败测试热点未必是最小完整解；本次在已获夜间连续排障交付授权内修订工程实现策略，先同步计划及Issue，不冒称负责人另逐条批准了16片。
- 保留正在闭环的单例/可访问性修复；并采用有界16个Web VM、每片仍单worker、step仍20分钟/job仍30分钟、原case预算/motion/全部覆盖不变。四套真实PG及Worker/构建/清理不变。完整放行由严格16个job升为严格24个同run/attempt/SHA成功job，旧16、缺项、重复、旧SHA/attempt、非完成、失败或混合布局全部拒绝；纯文档仍严格6-job布局，不借此部署。
- 最小功能面仅`.github/workflows/qms-2-foundation.yml`矩阵/分母、`scripts/ci-validation-scope.mjs`精确job集合及其root单测，deploy SSH/密钥/权限/资源隔离不改。先真实TDD验证24布局/拒绝旧16，再实现并用官方Vitest sequencer证明16片无重叠且并集全量。新精确PR/main必须实际24门禁及16份JSON核验，不能拿旧8份或旧16job成功代替。
- 峰值scope后并发14→22，额外8次安装/启动/artifact可能增加runner分钟和队列等待；未取得账户并发/计费实证，不承诺免费、总分钟减少或墙钟减半，不改仓库可见性/账单/额度。更新`ENGINEERING-TOOLS`和来源索引，历史16-job记录保留原事实。独立实现代理只拥有上述3文件，纯布局定向Node单测可独立轻量执行；官方Vitest清单/完整root工具套件等到现有Web窗口释放后，避免争用。
- 已先实际评论回Issue89登记有界策略及未知成本，read-only核仓库仍public，不改可见性/计费。新实现代理`fix3_ci_capacity`仅3文件，准确纯布局RED3FAIL→GREEN3PASS，另纯安全/接线6PASS，独立SPEC后QUALITY静态通过；24新布局可接受、旧16及所有来源/缺失/重复/混合失败严格拒绝、docs6不部署。当前接过释放窗口跑完整`ci-validation-scope.test.mjs`含真实Vitest16片/Jest4片覆盖，结果完成前不计完整PASS。
- 容量完整`node --test test/ci-validation-scope.test.mjs`实际19/19 PASS、exit0/16.58秒，无skip/cancel，包含真实temp Git/HTTP来源分页与严格24/doc6、Jest4及官方Vitest16片覆盖；231文件前15片各15、最后6，非空无漏/重，逐源规范化SHA见`fix3-capacity-web-manifest.json`。实际源blob与静态独立双审一致，容量作者释放窗口；不把本地19项当真实新24-job云端通过。
- root最后核四Web JSON108项及容量3source hash、Web typecheck/lint退出0（`fix3-parent-lint.log`），fetch main仍6041d80，user需求回读同record rev348，fix3序号无冲突。生产Web/API/契约/迁移/依赖/部署脚本未变，复用对应构建/浏览器/API/PG，CI仅原生布局及严格集合改变；最终逐来源复核及治理/diff输出`fix3-parent-governance.log`后集中推同PR91，不重启已过完整文件或本地全量。

### 7.6 最终机器发布与归档边界（2026-11-01）

- PR91最终17724805072f51691907871fbf93470384afd0bb运行41242774079 attempt1，实际24个同源job全部success；root下载16份artifact逐项核官方16片manifest，231文件/3261项全PASS，无漏/重/skip/pending/runtimeErrors。独立release gate通过后squash588089438d1eb2017a938e7844b747faddfb883f，整树64ce3400e85800f289c720910829e88cccb72543与已审候选完全一致。旧FAIL不抹去，PR最长Web约12.23分钟是本次实测不代表费用下降。
- main运行41244879460 attempt1也实际24同源success，16份JSON再次231文件/3261项全PASS，`main-5880894-coverage-verified.json`。不是复用PR结果冒充main，不拿旧8片代16片。自动部署41245832801的来源完整attempt校验和SSH步骤均success，没有手动重复部署或跳过门禁。
- 完整部署job124668943410日志：第648行前置加密数据库snapshot verified早于654行141 migrations及657行no pending，696/700/701行API/Web/Worker镜像标签均5880894，689–694行服务健康，711行`Deployment successful`，builder清理Total1.502GB。Worker READY及原子deployed-sha由同版deploy.sh在成功出口前强制检查/写入支持；没有另取原始Worker stdout或SSH marker读回，不补称独立读取。此快照不是对象存储/异地灾备或恢复演练。
- 独立公网HTTP：`/login`、`/api/v1/openapi.json`及问题台账/console SPA入口200；管理用户、console context、关闭职责、制程缺陷四真实契约路径匿名401。新`index-KJw082o1.js`与`index-CBVgIpis.css`均200，区别旧baseline；实取生产bundle核qms-ledger、页长、settings视口64px与移动分页样式，fixture标识排除。`production-public-verification.json`及`machine-release-verification.json`分层记录；匿名SPA200不证明真实角色流程或保存成功。
- 权威规范1.5第7.3节、专项设计、实际共享实现、ENGINEERING的16Web/严格24及索引均已随5880894进远端main，root实际`git show origin/main:...`复核。最终发布事实更新计划/指南/能力/Foundation/索引后本地单独提交不推：当前纯文档分流仅`.md`，来源索引JSON仍走full并触发无运行变化重复部署，不能伪称该归档已远端同步。后续适合的治理同步检查点接续，而非削弱分流规则。
- 本地main有既存历史分歧，尝试ff-only失败未改历史/源码；返回原功能分支后从已验证origin/main5880894新建`codex/req0034-release-record`归档，未reset/rebase/混入旧提交。运行发布与规范远端状态不受该历史分歧影响。秘密/日志/快照仍Git外，未连接55440，无本任务测试/Vite存活；旧PG任务容器及模拟资源已清理。
- 负责人待验清单：真实内部/供应商/控制台角色与资源组织、服务器命名视图、生产草稿/冲突/未知结果、真实分页接口与业务选择、键盘/触控及物理手机/多窗/六配色对比度；现有组件夹具和CI仅按实际覆盖支持，不代这些人工验收。完整phase1/2原前置FAIL继续保留；Issue89开放、Base本轮未写关闭/PR/完成字段，机器发布核验后删除本REQ heartbeat，不自动接其他需求。
- 最终本地归档治理先因运维手册新增事实触发MAINT-003来源变化而实际FAIL（`final-release-governance.log`），再因维护说明索引的连带来源变化FAIL（`final-release-governance-verified.log`）；均保留。已实际复核本次快照/健康/builder非持续告警闭环，维护说明与对应事实接续，保持open/原reviewDue2026-11-23。最终`final-release-governance-frozen.log`实际PASS：37文档/467链接/20复核、open3/closed0、157依赖与阶段1项；本条文字收口仅重新计算计划摘要再门禁，不重跑业务测试。

## 8. 人工截图反馈横展：列边界及空展开列（V0.0.39-fix4）

负责人报告制程首列空白、各列表头出现两竖线且真正拖宽入口内移，并明确要求两问题全面横展。不是重做原设计，而是恢复既定“真实列边界、独立拖宽/换列、必要明细入口”约定。复用REQ0034/Issue89，实际评论登记修复范围；不重建需求或更改Base状态。原机器发布/CI仍是旧版本事实，不能作为本轮人工验收通过。

### 8.1 根因与完整范围

- 唯一正式resize实现是`ui/ledger`。`.qms-ledger__heading`在th padding内创建relative含块，绝对handle依据内容盒`-8px`定位，自绘2px伪元素与真实cell边框/AntD `th::before`标准短线叠加。root用真实生产组件旧夹具实测三列handle命中中心均距实际th边界约13.8px，`header-geometry-red.json`。sorter title额外relative、ellipsis裁剪及固定列sticky须一并覆盖，不能仅改padding常数或强写inline relative破坏sticky。
- 静态正式清点：42处Ledger/37文件由公共修复自动覆盖；33处非Ledger AntD Table/24文件和4处原生表/3文件无另一套resize，不为横展强行迁移或新增工具栏。原生表是8D编辑/日期专业矩阵，保留。合计79业务表，排除原型/interaction-preview/测试/共享壳自身。
- 所有展开入口仅4处：制程Ledger（materials）、供应商绩效内部/门户Ledger（非空每行均有计分/配合度/来源说明）、普通Table的WorkflowClosurePreview（participant）。AntD只要expandedRowRender便插expand列，rowExpandable只逐行决定图标，故当前全false仍空首列。共享处修制程及绩效，普通职责预览独立补同类判定，不遗漏非Ledger链。
- 选择列、必需编号/操作、树表TableProps和真实有明细的展开不能删除；空数据/全false不生成无用途占位，有明细保明确列头与紧凑入口、原详情/控制回调。尊重调用方显式展开列设置/标题/宽度，不动API/缓存schema/业务保存器/专业判定。

### 8.2 实施与验证计划

- `fix4_shared_headers`独占公共index/CSS/组件测试及必要制程接缝测试：先DOM/CSSOM/展开矩阵准确RED，再实际th直接子handle、去重复短线/自绘常驻线，合并caller header attrs/style/events/components，保sort/keyboard/pointer/required/缓存/会话保护。新逻辑不依标题布局，固定sticky保持。
- `fix4_workflow_expand`独占职责预览TSX及测试：先全participant空/空duties/混合或全有人准确RED，最小控制showExpandColumn及明确明细头/宽度，验证原8追溯字段及所有旧权限/草稿/预览断言。两组按单一Web窗口串行，不改budget/motion/skip。
- `fix4_table_inventory`独立只读完整盘点及依赖源码审计已完成；各实现完成先独立SPEC再独立QUALITY。主代理核最终源码/hash/完整日志及真实浏览器th右边界与命中几何、无双线、拖宽后行列一致、排序不误触、ellipsis/固定横滚、窄屏与有/无明细。合成数据只证组件，不充真实业务角色验收。
- 最终本地只跑共享/制程/职责及两绩效实际受影响完整文件、类型/构建/治理/契约与归档适用项；未变API/PG/依赖/部署按来源指纹复用，不重跑本地全站。提一个fix4 PR关联Issue89，精确24-job CI与16片实际清单另验；未满足不得合并发布。日志/截图/JSON Git外`D:/WorkSpace/QMS-2.0-local/unified-business-pages-20261101-fix4/`，已尝试的browser-client不可信桥不可用后使用现有浏览器接口，不绕浏览器安全策略。

### 8.3 实际红绿与复验（接续）

- 公共作者首轮新增9例准确7FAIL/2PASS/33 filtered，独立纯CSS及sticky回归各有实际失败；首候选CSS relative覆盖fixed由root真实browser发现后准确测试RED并修正，不能用单测原33项掩盖。首次完整41/42的失败是新增测试数到AntD隐藏Grip副本，改为查询真实可访问独立Grip，未删原断言。最终2完整文件45/45 PASS/exit0，新增12例含caller组件/style/class/ARIA/events、sorter/group/ellipsis、展开矩阵及中英，独立inventory SPEC后completion QUALITY通过。原FAIL及filtered分层保留。
- Workflow准确RED4FAIL/26 filtered（首轮Descriptions误选失败另保留非产品证据）；原生Table仅加实际participant判定、明细/Details与56宽，原8字段/业务保护保持。完整30/30 PASS/exit0/120.69秒，独立SPEC通过，QUALITY待实际结论。共享默认64宽与专业56均为合理紧凑宽，非错误机械统一；caller自定优先。
- 浏览器根因旧handle center距th right约13.8px；最终普通列差约0.8px（cell细边框），fixed边界约1.6px，10px命中区覆盖真实边界，边界hit test返回separator、整表头高可命中。旧header before短线已display:none，handle after不再绘线，仅既有细cell border。实际sorter列指针拖180→240不改变aria-sort，键盘说明列460→470、草稿保留/刷新恢复，drag换列后表头/实际首行顺序一致且刷新保持。
- 组合fixture覆盖rowSelection+fixed左右+sorter+filter+ellipsis，1024真实横滚scrollLeft0→212后左右固定header仍sticky；390标准表页面scrollWidth/clientWidth均390，只有局部table横滚，未把视口外列hit不到算失败。空/全不可展开时expandHeader0、真实selection保留；混合时明确明细头、仅1原生展开按钮及实际内容出现。JSON分别保存在fix4 Git外目录，均合成数据正式组件证据，不代真实角色/业务数据人工验收。
- Workflow独立QUALITY亦通过，四处展开入口盘点闭合。制程新增两接缝只插35行/2例，旧37及生产未变，真实AntD/生成DTO验证无物料时首选择列可选、有无料混合时原生明细可展开；首合跑45/46失败来自新断言误把AntD spaced对齐按钮当功能入口，正确区分后Process完整39/39 PASS。该首run两个绩效完整5/2 PASS保留，未重复刷已过文件；后续制程两新增例静态SPEC后QUALITY通过。与共享45/职责30组成6完整文件121项独立日志组合，非一次整包全绿或本地全站回归。
- 父Web lint/type、build22.34秒、contracts:check及归档隔离均exit0；产物index-BrlSWntp.js/index-BEPfk-G2.css有新header/edge样式、无旧resize after，新增边界fixture未进入生产包，原大chunk及AntD弃用告警保留。源hash与审查一致，`parent-verification.json`记录分项与首次FAIL边界，未变后端/契约/依赖/CI/部署来源指纹确认后复用精确5880894真实API/PG/Worker证据，不以Mock代真实服务。浏览器viewport已恢复、任务tab及Vite80934已停止，不触保留55440。
- 规范升1.6，在7.3明确真实th边界/一线/hover命中及无空展开占位；专项设计、指南、能力状态同步人工反馈和例外。Issue89实际登记fix4范围，user需求回读仅确认不改表；最终治理/diff和来源复核日志入Git外，精确fix4 PR/main24检查及部署仍待，旧机器发布和人工认可不代本次验证。

### 8.4 fix4发布核验（2026-11-01）

- PR92实际ac986541c80a865f90ea8f2fc42bccb31c5bf393 / run41263167739 attempt1全24同源job成功，16artifact逐项核官方231文件、3278项全PASS无漏/重/skip/pending/runtimeErrors，本轮新增17例。独立release gate通过后按同需求连续修复授权squash7660314d819b0cdbb1b1fc8dfba5f99c1001b309，整树81f153066d5f7ab991d72e8b5d6d84c23bfe88df与已审候选相同。
- main run41264384940 attempt1也实际24同源success、16JSON231文件3278项再次全PASS，`main-coverage-verified.json`；不是用PR结果代main。自动deploy41265280131成功，来源完整attempt校验/SSH均success，未手动重复触发或绕门禁。
- 部署job124726703309日志1064行前置加密snapshot verified先1070行141链及1073行无待执行；1112/1116/1117行API/Web/Worker镜像同7660314，1105–1110服务健康，1127行成功出口，builder Total1.502GB。READY及原子deployed-sha仍由同版脚本强制成功出口支持，未另SSH读回或取原Worker stdout；不代异地灾备/恢复演练。本次发布等待主要在API安装/构建层（02:27:58Z至约02:44:08Z）及Web重建，不是重复Web回归；仅记录事实，不顺手改镜像/部署策略。
- 独立公网新index-ChZsk5Q2.js/index-FOu2Dq6D.css均200，区别fix4前index-KJw082o1.js/index-CBVgIpis.css；JS有新ledgerResize组件标识，CSS有header-cell及edge -5px、无旧resize after绘线，新增fixture标识排除。login/openapi/三SPA入口200、管理用户/console上下文/关闭职责/制程缺陷四契约路径匿名401；`machine-release-verification.json`准确记录，SPA200/资产变化不代真实登录或业务保存验收。
- 统一规范1.6/7.3、专项设计、42/4横展实现及旧747发布归档已进远端main并实际git show回读；本轮最新发布事实本地记录暂不推以免索引JSON触发无运行变化full CI/重复部署。原FAIL/阶段前置FAIL/独立日志组合与真实角色待验边界不抹去；用户刷新正式页面验收后另核闭环授权，不自动关闭Issue89或写Base，不新建heartbeat。

## 9. fix5 治理撑宽与双端侧栏回顶（2026-11-05）

### 范围、设计与授权

- 流程纠偏：负责人于本轮追问“你直接就开始优化了么，需求清单有提交么”。此前只有Issue93、没有新飞书需求记录，已发生本地实施先于需求登记的漏项，不能把Issue建单或本地计划冒充需求已提交。已冻结新增实施与PR；user读取字段真实报token_missing，没有改用bot绕过。仅请求字段读/记录读/创建的最小重新授权，授权后先查重/字段结构再提交并回读真实编号，不伪造记录或自行设“开发中”。历史漏项保留，不倒写成先登记后开发。
- 补登结果：负责人回复“已授权”后，旧device poll返回invalid，但实际user身份已ready且字段读取成功，未重复发起授权或切bot。按真实字段及选项先用名称关键词/Issue93云端查重，完整返回0条/has_more=false（rev353）；随后user创建`reczz28W1w4YTodF`，系统编号REQ-0035。逐字段回读rev354：12个提交业务字段全部一致（单选及URL按接口表达规范化比较），状态由系统默认为待评估，完成时间/PR链接为空，未写进度状态或完成时间。实际需求、业务背景、方案/子任务/验收及Issue93已一并提交，证据`requirement-{fields,dedup-verified,create-payload,created,readback,verified}.json`在Git外。鉴权与建单真实先后保留，不修饰成实施前已经登记。
- 开工接续：负责人随后明确“状态已更新，继续推进”，user按record_id回读rev357为开发中/P0；12个原业务字段逐项核对，仅提出人从登录显示名改为舒子杰、紧急程度P1改P0，目标/方案/子任务/验收及Issue93保持。该当前直接批准恢复同范围交付，不倒写此前实施合法顺序；不代改表或将继续扩大为合并部署。
- 目标：组织与岗位/平台配置不持续撑宽，表格保持局部横滚；业务/管理端侧栏在同会话导航后保持原滚动与展开折叠。不改页面主题或业务表单。
- 新问题独立Issue93，关联已结束REQ0034而不重开旧Issue89，不自动写Base。预留V0.0.39-fix5；远端main连接器实时回读7660314，本地56094fa额外只有fix4发布归档，保留随修复同步。`git fetch`实际malloc失败不充成功，未改远端引用。
- 使用活动checkout新分支`codex/req0034-layout-sidebar-fix5`，不另建被禁止的开发目录。初始用户四项CodeGraph修改（`.gitignore`、实现AGENTS、ENGINEERING-TOOLS、documentation-index）保留且不混入本次提交；索引若需要共同编辑，最终按已提交来源选择性整合，不凭用户工作区绿色冒充远端一致。
- 当前用户明确报告待修问题，按常规持续授权推进Issue/开发/验证/提交推送PR。原夜间任务已结束，本次合并发布另核；不自动关闭/回填或恢复heartbeat。
- 横向布局首选约束治理grid轨道/实际撑宽项，保表格列宽与内部滚动；拒绝用overflow隐藏裁切、缩小全部业务列或改缓存掩盖。900px最小A/B原Card/Tabs1113px，minmax后900px且列180不变，只证明稳定溢出路径，尚不证明用户连续增长。
- 侧栏首选只保会话内非敏感导航UI（滚动/折叠/展开），仍在每路径/目标组织重验时撤下旧内容与权限菜单。拒绝删除pathname安全scope或持久化旧授权context；不为保滚动保留旧草稿。复用现有会话生命周期，不新增跨会话偏好/持久存储。
- API/DTO/数据/权限/Worker/附件无计划变更，相关真实服务证据只在来源仍有效时复用；本次合成页面仅证明正式组件布局和导航，不代真实登录/生产业务验收。

### 实施与门禁

- [x] 两名独立只读诊断，确认治理grid和安全gate重挂/菜单清空候选；Issue93建立，版本/分支登记。
- [x] `fix5_growth_implementation`：global.css仅一条轨道约束、邻近样式回归及layout-regression-fixture；准确RED1FAIL/1PASS→两个完整文件3PASS。正式Configuration/Structure/OrganizationWorkspace×两宿主6链各181RAF约3秒及刷新/岗位切换均在900px边界；320/390/420共18场景界内且真实局部横滚可用。旧版稳定溢出已复现，持续增长NOT_REPRODUCED。独立`fix5_growth_spec`后`sidebar_scroll_diagnosis` QUALITY均限定范围PASS，4源冻结一致，证据`fix5-growth-report.md`。
- [x] 全新`fix5_sidebar_implementation`：Internal/Console及sidebarState纯内存UI，真实Auth包装准确4FAIL→初7PASS；最终新route7+state3完整10PASS，原Internal9/Console20/session16/console-window5完整分次组合共60PASS。新增dirty首9/10因两个dialog固定test-id碰撞，准确DOM记录后仅局部fixture development/恢复，原预算/断言/安全scope未改。首browser非法模拟landingPath被正式校验拒绝，最终仅fixture改workbench，失败保留。
- [x] 单一Web验证owner串行：growth完成释放后sidebar，最后root lint/build；不增预算/motion、不Skip，不本地全量，8完整63项是分次组合不是同次全量。
- [x] growth独立SPEC后QUALITY及sidebar独立SPEC后QUALITY（包含最终测试与fixture/browser窄补核）均PASS。主代理读取diff、完整日志、退出码与来源。布局900px六链及320/390/420、侧栏1024×420真实wheel：业务862→862、Console642→pending0/links0→642/links17，两端身份切换0；390×780 Console真实DataRouter dirty取消/busy阻离保持Drawer及/users，pageerror0。sessionPending轮询滞后一帧不作pending几何证据，脚本另等DOM撤下。未覆盖真实生产登录/物理设备/业务mobile browser（后者有真Router单测）。
- [x] 父类型/lint/build、契约/归档隔离、治理/diff及适用来源复核均通过，夹具不入生产包。规范1.7/指南/能力/验收记录已同步；治理37文档/474链接/20来源/157依赖及阶段覆盖1项通过。初始用户CodeGraph四项保持，提交时仅暂存本次变更并反向排除原索引hunk，另核暂存来源摘要与实际提交树，不把仅工作区绿色代暂存一致。
- [ ] 验证审查通过后主动提交推送同分支PR关联Issue93，不用自动关闭语句；精确HEAD现有16Web/严格24job CI检查与覆盖清单，普通失败修复继续同PR。
- [ ] 合并发布授权成立才接续同SHA main/自动部署/公网目标核验；最终部署版人工确认后获准关闭回填，清任务资源并归档。缺授权只停对应动作，不阻前面的本地/PR。

父检查已取得：Web lint/type、build39.88秒、contracts:check及归档隔离均exit0；index-BRkCcdoJ.js/index-5BMr-rKx.css含治理轨道且两fixture标识均排除，既有大chunk告警保持。相对7660314的后端/契约/依赖/脚本/部署来源无变化，经`parent-evidence-reuse.json`复用同源API/真实PG/Worker证据。Vite任务session28937已停止，所有作者browser关闭，无后台验证；无新API/数据/权限变更。最终治理与PR/CI按当前快照接续，不重跑这些未变分项。

提交检查点：本次8完整文件63项分次PASS、最终双审及父门禁已就绪，PR创建与精确HEAD CI是下一独立步骤；提交时PR编号/检查结果尚未产生，不预造链接或写已发布。创建后将实时PR/HEAD/run和后续状态写Git外`pr-delivery-checkpoint.json`及Issue93，避免只为进度文档反复推送触发无运行变化CI/部署。REQ0035的开发中/P0来源为负责人，缺合并发布授权只停止对应动作，不自动关闭Issue/写Base完成。

### 9.1 main单例可见态返修 fix6（2026-11-06）

- 授权与真实对象：负责人在PR94全24CI/234文件3290项通过、明确等待合并发布的上下文再次“继续”，接续本需求合并发布，不扩关闭Issue/回填/人工验收。PR94合并fb88779与审候选9475742整树相等；合并前/后源核验、原Git/TLS及连接器传输失败记录保留，原生HTTPS读回后验证成功，不将网络读取失败写成CI或产品FAIL。
- main42064462310 attempt1实际全24job完成，Web4失败及foundation聚合失败；全部16artifact逐项核234文件3290项，其中3289PASS/1FAIL，零漏重/skip/pending/runtimeErrors。唯一失败为`interaction-preview/console/ConsolePreview.test.tsx`的outside pointer/自然输入焦点用例第51行：findByRole找到深色menuitemradio但立即toBeVisible失败。尚未进入后续外部点击/输入/过滤断言，不是这些产品行为已证明失败，不是timeout或容量失败。自动deploy42066685510正确skipped，原7660314线上仍是旧版。
- 本单元复用REQ0035/Issue93；预留V0.0.39-fix6，分支`codex/req0035-ci-fix6`从origin/main fb建立，保用户CodeGraph四dirty。旧PR94已经合并，不向旧PR推送；本次最小返修/门禁/双审后另建关联修复PR，精确新HEAD/main CI及自动部署另核。
- 新实施者`req0035_fix6_preview`只拥有该测试文件。先读取依赖/真实进入态及原精确代表基线：本地PASS不冒称RED，CI真红保留。若证据支持，使用现有waitFor等待原可见性断言满足后再点击外部；不改生产样例/Dropdown、原动效/预算、focus/type/filter、Esc/选择焦点、只读/dirty/错误等断言，不以强制visible或隐藏断言放行。
- [x] 原精确代表1PASS/11filtered（17.16秒、目标1.752）不是本地RED，准确红来自main。唯一一行现waitFor等待同role/name的原toBeVisible后再点击外部，完整12/12 PASS、exit0、41.78秒/目标2.666秒，原默认10秒及等待预算/动效/全部断言不变。未捕获原失败具体动画帧，不虚构诊断或速度收益，证据`fix6-preview-author-evidence.json`。
- [x] 新实现者`req0035_fix6_preview`冻结后独立`fix6_spec` SPEC、独立`fix6_quality` QUALITY均PASS；父Web lint/type exit0。规范化源hash8553ede65db066e009a60a67cb780c2b51dca79c9cf39ea1d1e9549592729e90与证据相同，raw CRLF字节另列不误报源变。运行源码/API/依赖/CI仅该test变化经`fix6-parent-evidence-reuse.json`核实，复用已有效build/API/真实PG/契约/浏览器证据，不重复旧63项/本地全量。
- [x] 独立fix6 PR95 b4044e0，精确run42077424051 attempt1全24/16JSON234文件3290项PASS后按授权squash8c90c84，整树相同；新main42080092505 attempt1也完整24/16JSON同覆盖PASS，不用PR代main。原main失败保留、未重跑旧run刷绿。自动deploy42082353182及公网逐项核验见9.2。
- [x] 机器发布后集中归档指南/能力/Foundation/计划及来源索引，远端规范/实现与本地最终发布归档分别记录；真实角色/物理设备及原持续增长另待人工复验，不自动关闭或写Base完成，不重启heartbeat。

证据继续Git外`layout-sidebar-20261105/`：`main-failure-inventory-verified.json`、main完整24jobs/16artifact、两个失败job完整日志、跳过deploy对象及`fix6-preview-*`。当前生产源码没有返修变化，尚未把候选或绿PR当上线。

### 9.2 fix6最终机器发布核验（2026-11-06）

- PR95 b4044e0a422cfdd98810906a396a243536e49cd5 / run42077424051、main8c90c84cc52dce85d2c1ed98e44996dcbbe170d2 / run42080092505均attempt1、各24同源success；使用现有evaluateDeployJobs核严格full门禁，16份artifact逐一比对当前Git测试清单234文件3290项全PASS，零漏重/skip/pending/runtimeErrors。独立SPEC后QUALITY与已审源一致，GitHub提交式review为0不冒称人工批准；两次squash分别均核同树。
- 自动deploy42082353182 / job127438410440的完整日志已下载；Validate source及pinned SSH均success非skip，RUN_ID为42080092505。725行加密snapshot verified先于731行141迁移链，734行无待迁移，773/777/778行API/Web/Worker镜像同8c90c84，各容器均出现Healthy，788行Deployment successful；builder回收1.524GB，无cleanup失败/superseded。Worker READY及原子deployed-sha由同版deploy.sh强制成功出口支持，未另SSH读取marker或原Worker stdout，不代灾备恢复演练。
- 独立公网login/OpenAPI与新index-CRHXM3Qr.js/index-CEYAWm_B.css均200，区别发布前index-ChZsk5Q2.js/index-FOu2Dq6D.css；JS含sidebar-session、CSS含governance-panel可收缩轨道，两fixture标识排除。console context、organizations/tree、configuration/settings与process defects匿名均401。新资源/拒绝边界是机器事实，不能推成真实角色业务完成或持续增长动态因果已证。
- 证据`fix6-{pr,main}-coverage-verified.json`、`fix6-deploy-log-verified.json`、`fix6-public-verification.json`及合并后的`fix6-machine-release-verification.json`。用户四项CodeGraph原dirty保持；本次最新发布事实仅本地归档提交，不推索引JSON导致无运行变化重复CI/部署。规范1.7和已发布源已实际git show origin/main回读。
- 人工复验聚焦两目标：刷新真实组织与岗位/平台配置，持续操作/页签/刷新观察无拉伸且局部横滚可用；业务与控制台滚至下部点击叶项检查滚动/展开保持。真实角色、物理设备及原持续无界增长未被本地合成验证替代。Issue93开放、Base本轮未写进度/完成/PR字段，等待负责人反馈及单独关闭回填授权；旧REQ0034不重开，其他需求不自动接单。

### 9.3 fix7 固定品牌区与首页链接（2026-11-06）

- 用户两张截图明确固定Logo、只滚菜单，管理Logo可点回首页；随后“直接在当前需求条目中更新即可”“继续调整”。先user读字段与原记录rev357，追加业务背景/期望效果/方案/子任务/验收五字段，再回读rev358全部一致，14其他字段未变，开发中/P0，不新增需求或自行改状态；Issue93追加范围亦回读，录屏/截图不入Git。
- 新分支`codex/req0035-logo-fix7`基于6b055d6（发布8c90c84加纯文档归档），远端main仍8c90c84，保用户CodeGraph四dirty，不混入。预留V0.0.39-fix7，提交前再核冲突；本追加当前授权实现/验证/PR，合并发布按具体后续授权核定，不自动关闭/回填或恢复heartbeat。
- 最小设计：保现有主题、品牌与导航层级；桌面品牌/折叠入口在非滚动区，Flex/Grid父链允许菜单收缩，只有菜单节点overflow-y:auto，并把原scrollTop读写/ref绑定该真实菜单容器。管理品牌区从静态div改现有Router Link回`/console`、沿既有href保目标组织，业务Link仍`/app/workbench`。移动Drawer品牌同样固定/链接可达，不另建滚动缓存、不删安全gate或dirty/busy阻离。
- sticky整个品牌虽然代码少，但仍把品牌留在滚动内容中，不能满足滚动条只属于菜单；因此采用实际分区。只改必要布局调用方，SupplierLayout共用shell样式时核相邻不退化，不新增供应商业务或改变其会话状态语义。
- [x] 新实现代理`fix7_logo_implementation`单一写集：InternalNavigation提取现有品牌Heading至固定区，Console品牌Link与真实menu滚动分离，原ref/scroll绑定menu；CSS只internal/专用Drawer，不改Supplier共用旧规则或sidebarState。准确RED3FAIL/7filtered；新增中英键盘/品牌结构/同目标首页/Logo dirtybusy及原ABA/恢复断言保留。首15/16新英文fixture误写旧locale key，精准改为现有key后未放宽英文名或业务断言。
- [x] 单一窗口4完整文件45项分次PASS：sidebar13+state3为27.47秒，Internal9为21.05秒，Console20为17.34秒。未变session-window16/console-window5与Auth/store及后端来源核对后复用，不重复旧63项/全量。8个浏览器场景：1440/1024/390两端品牌y恒定、菜单滚至末项/Enter回home，管理英文collapsed点击保target，390 Console Logo dirtycancel/busy阻离。旧真实生产登录/物理设备不由合成身份替代；Console390初始x=-276是Drawer进场帧，断言只核y不宣称横向before/after相同，最终x12可达。中断恢复时作者进程已退出，root读取原日志/JSON保留有效证据，未重复跑。
- [x] 最终独立`fix7_final_spec` SPEC后`fix7_final_quality` QUALITY限定PASS，主代理实际读diff/完整日志及浏览器JSON/7源规范化hash吻合。父类型/lint与build27.37秒exit0，新index-JA7UiUCn.js/index-CKKqSqU4.css有独立menu/home标识且fixture排除；治理37文档/474链接/20来源/157依赖及阶段覆盖通过。未变后端/契约/部署/安全源已核，复用有效证据，不重复真实服务/本地全量。新菜单切叶后的像素恢复未另browser复测，原真Auth数值恢复单测完整保留；生产角色/物理设备仍未覆。
- [ ] 规范1.8/指南/能力/本地验收/计划与来源索引已同步，用户原CodeGraph摘要选择性排除，暂存树核验后主动提交推送一个fix7 PR关联Issue93，不向已合并PR95推送冒充交付。精确新CI覆盖按实际清单，不沿旧234/3290冒充新增测试已覆盖。
- [ ] 获准合并发布才接续main/自动deploy/同SHA快照健康公网目标，实际人工反馈再按授权关闭回填；不自动执行生产角色配置、删除/外发。

本次证据继续Git外`layout-sidebar-20261105/`前缀`fix7-logo-*`，需求与Issue追加证据前缀`logo-requirement-*`/`logo-issue-*`。旧fix6发布与失败历史原样保留，不把Logo新增要求追写为原版本已实现。

### 9.4 PR96测试快照排序返修fix8（2026-11-06）

- 首PR已建立96 / HEAD670c41e160503977032a12e100d77d36239e3cac，run42186914067 attempt1全24job结束；integration2(job127789433682)实质FAIL、foundation(job127794812379)派生FAIL，其他22job success。16份Web JSON逐一核234文件3296项全PASS、零漏重/skip/pending/runtimeErrors，不把前端绿色改写为整体PR通过。两个失败job完整日志与全部artifact库存保留，Issue/PR正文实际登记。
- 独立QUALITY只读分类：旧`apps/api/test/authorization/legacy-role-http.integration-spec.ts:153`读取后比较前后完整快照失败；:111外层roles按id排序，`include.permissions:true`无内部顺序。完整两份相同diff显示同roleId的22个permissionId移出/移入集合完全相同且各唯一，另2条原位，无集合增删或其他字段差异。证据仅支持嵌套数组返回顺序不同，不证明执行期绝无同值写入或具体数据库计划原因；严格gate仍FAIL。
- 负责人反馈“PR没通过”，本轮明确接续该CI阻塞，不再仅交付前端通过结果。范围限定测试快照关系显式`orderBy:permissionId asc`，仍比较所有记录/字段/数量，不改生产权限代码、读写规则/DTO/迁移/依赖/CI；不使用弱化集合断言、加超时/motion或Mock/Skip替代真实PG。版本预留V0.0.39-fix8，原分支/PR96继续，不另建需求或PR，不扩大合并发布/关闭回填授权。
- [x] 原`fix8_snapshot_order`代理在工具会话刷新后不再出现在live列表，实际检查无本轮源码/产物/容器，主代理明确交接全新`fix8_snapshot_execute`而非把静默算完成。新作者只改该测试一行include.permissions排序，原完整deepEqual/403/audit/receipt/securityVersion/120000保全。真实PG/HTTP基线1PASS/16按-t过滤，Jest28.207秒/命令32.147秒不是RED；修后完整17/17 PASS、0skip，Jest14.036秒/命令16.164秒，不据分次时长称性能收益。
- [x] `fix8_order_spec` SPEC后独立`fix8_order_quality` QUALITY限定PASS，当前LF SHA13b888baa4ec8de93d598f4e4aa957c6a033763c418051e27f4cbe3661e382e6，内存仅还原该一行即baseline d79c8fe83db9ae2f97068a990e174912164b2436c75f8fe86a7f9837c3435c65。父配置的API lint/type exit0；未改运行源，复用有效Web45/browser/build/其他后端证据。任务PostgreSQL18.6 loopback55517、独立随机label/tmpfs无宿主卷；141迁移/seed0，精确核ID/label stop/rm0及最终空回读，未连55440、不globalprune。
- [ ] 验证后提交fix8推送更新同PR96及Issue93，精确新HEAD的全24门禁/16JSON实际成功才报告PR通过；旧FAIL/未发布事实保留，不重跑旧run刷绿。后续合并发布/人工验收/关闭回填按有效授权分别接续。

证据目录继续Git外`layout-sidebar-20261105/`，首失败`fix7-ci-{integration2,foundation}-failure.log`/`fix7-ci-final-inventory-verified.json`及`fix8-*`。此前“待决定是否处理”是原停点历史，本轮已明确接续最小门禁修复，不扩大业务范围。

额外类型检查边界：主代理尝试`tsc --project tsconfig.spec.json --noEmit`覆盖全API测试，实际FAIL（既有测试类型/@jest/globals解析错误），不是项目已配置lint/CI门禁，不删除日志或顺手修无关测试。正常`@qms/api lint`使用现配置生成/生产tsc实际PASS；该一行通过真实PG/HTTP原完整文件，所有新HEAD严格CI仍需实际成功，不用局部绿抹去失败。全spec前后同配置内存还原该一行的诊断对照证据另存`fix8-parent-test-types-baseline.json`，若未完成不得引用为已确认。

父收口：配置API lint、治理37文档/474链接/20来源/157依赖及阶段覆盖、diff已PASS；正确API cwd/configFilePath下全spec内存还原前后各346条诊断完全相同，目标文件仅既有@jest/globals解析诊断，无新类型回归。初TypeScript API探针曾误用根cwd/漏configFilePath得15946诊断，不当CLI对照，该方法失配事实同证据保留并以正确346对照为准。仅测试排序加文档/索引，无运行源码/依赖/契约/CI变化，旧Web45及首精确3296项、browser/build按源复用，新HEAD完整CI仍实际核验。

证据：Git外`D:/WorkSpace/QMS-2.0-local/layout-sidebar-20261105/`。录屏抽帧、最小grid A/B、准确红绿、六链连续几何及18窄屏场景已保存；旧连续无界增长仍未复现，不把稳定溢出写成增长反馈根因。初次fetch因用户`http.postBuffer=524288000`分配失败保留，后仅该命令临时`-c http.postBuffer=1048576 fetch origin`成功，未改用户配置，远端仍7660314。
