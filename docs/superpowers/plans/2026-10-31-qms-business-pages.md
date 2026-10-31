# REQ-0034 统一业务页面实施计划

> 面向执行代理：使用项目qms-superpowers-zh路由逐任务TDD、规格审查、质量审查与主代理独立验证。共享checkout所有Git操作由主代理串行执行，任务只写分配文件。

## 当前摘要

| 项目 | 当前事实 |
| --- | --- |
| 核对时间与范围 | 2026-11-01 Asia/Taipei；台账/对象表单/编辑明细/检查清单及列操作和分页，不改业务模型 |
| 授权 | 负责人恢复同一REQ-0034后又明确夜间连续开发、失败修复后继续、PR检查通过无需停顿即可合并部署，并要求20分钟heartbeat确保接续。当前授权覆盖本需求开发/验证/PR/精确CI检查/合并部署与发布核验，不扩为生产赋权、业务删除/外发、Issue关闭、Base回填或人工业务验收；不代设Base状态 |
| 需求 | [REQ-0034](https://larkcommunity.feishu.cn/record/FSsRrSqvieF2wBcPm5lcHM6Lngf)，`reczz28TwMc1lDEg`；首次user九业务字段回读rev344，当时待评估；恢复实时user回读rev348已为开发中，业务范围与Issue89未变，本轮未写Base状态，源码依据仍为负责人直接授权 |
| 映射 | [Issue89](https://github.com/JasonShu0722/QMS-2.0/issues/89) → [PR90](https://github.com/JasonShu0722/QMS-2.0/pull/90)已合并V0.0.39/6041d80（正文保fix1）→ `codex/req0034-ci-fix2` / V0.0.39-fix2，待新修复PR |
| 基线与隔离 | 活动`D:/WorkSpace/QMS-2.0/qms-2.0`；初轮478c325→候选9b29ce7与squash6041d80整树相同，旧功能分支保留；现从main6041d80新建fix2隔离分支。旧`06b5fff`关闭归档保留，不混入 |
| 运行时 | 加载Git外Enter-Qms.ps1：Node v24.21.0 / pnpm11.19.0；不是业务验证 |
| 状态 | PR90精确9b29ce7全16CI/231文件3261项成功后合并6041d80，main唯一组件项目例超原30秒、部署正确skipped，未发布。fix2已最小限定实际toolbar/dialog，原例7.420秒、完整42项exit0（该例7.354秒），独立SPEC后QUALITY及父类型通过；收尾治理并提新修复PR，原FAIL/阶段前置FAIL保留 |
| 工程证据 | 独立HTML样例只证明样例；后续正式React/AntD组件已取得指针拖宽/拖列/缓存/键盘/窄屏分页浏览器模拟数据证据，仍非真实API/角色业务验收。日志与截图位于Git外`D:/WorkSpace/QMS-2.0-local/unified-business-pages-20261031-01/` |
| 下一动作 | 最终来源/治理/diff门禁后提交V0.0.39-fix2，关联Issue89建立新修复PR；不向已合并PR90推送充交付，不重复42项或未变运行构建/API/PG，不恢复本地全量或放宽预算/motion/断言。精确新PR及main全门禁成功后继续自动部署核验 |

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
- [ ] 等精确head的全部CI与审查；合并/发布另核授权，未获准不推main。获准后逐版本核对迁移前快照、同SHA镜像/启动/健康/HTTP/目标变化。
- [ ] 最终部署版逐需求及联合验收，用户认可样式不代替正式业务/拖拽验收；获准后先记录证据，再关闭Issue/最小回填Base并回读。
- [ ] 按负责人追加要求逐条核对规范同步：统一规范7.3、专项设计/计划、FRONTEND-DESIGN、CAPABILITY-STATUS、README和来源索引与最终实现一致；未交付项保留真实状态，不能只改样例或仅刷新来源摘要。
- [ ] 回收本任务一次性容器/服务/浏览器，不删共享或保留预览资源；归档实际Git/外部完成状态，不建定时接单。

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
