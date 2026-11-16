# V0.0.54 表格顶部分页与工具栏留白计划

## 当前摘要

| 项目 | 当前事实 |
| --- | --- |
| 授权 | 用户已明确“按这个方案统一落地”：以接收记录为样板，桌面单行紧凑工具栏/窄屏自然换行；沿用PR/合并部署授权，不改生产业务或飞书 |
| 映射 | Issue126，V0.0.54-fix1，codex/table-toolbar-compact，已部署基线d2f094b355efe9e2e5725c56f4c4b1c09f95c2cf；旧本地发布归档f402957与$null保留 |
| 状态 | 本地收口：共享50集合及caller7文件162完整集合PASS、原77无变证据复用；组件1PASS、生产preview业务11场景组合PASS，SPEC/最终QUALITY通过，Weblint/build/治理/归档通过，资源已精确清理 |
| 下一步 | 提交V0.0.54-fix1及一个PR，核精确head CI/Review后同树合并、mainCI、部署日志与公网；不改飞书或代写人工验收，Issue保持开放 |

规格见[本轮设计](../specs/2026-11-16-qms-table-top-pagination-design.md)。父独占Git/文档/公共注册/资源/整合；共享组件与独立页面分派互不覆盖，heavy测试串行单worker。每shell先加载D:/WorkSpace/QMS-2.0-local/Enter-Qms.ps1，Git外证据D:/WorkSpace/QMS-2.0-local/table-top-pagination-20261116/，不连接55440。

- [x] 核用户范围、源码/线上基线、Issue126及隔离分支/版本登记。
- [x] 共享LedgerTable及CSS：TDD顶部位置/留白，保原分页/排序/筛选和非分页行为，避免重复分页。
- [x] 全面清单调用方调查，直接Table与外置分页按实际支持路径迁移；记录候选分页等非主清单例外。
- [x] 集中相关完整测试、Web类型/构建/治理、真实浏览器桌面/窄屏及独立SPEC→QUALITY。
- [ ] PR/精确head CI+Review、合并树、主干CI、部署快照/156迁移/同SHA健康及公网更新。
- [ ] Issue最小发布回写保持开放，本地归档/自有资源清理；业务人工/物理手机未执行如实记录。

沉淀：更新前端统一规格和FRONTEND-DESIGN的顶部工具区/分页默认要求及有效来源摘要；不另建表格框架、依赖或API上限开关。

## fix1 实施任务

- [x] 用户批准视觉方案，复用Issue126，从已部署main建立隔离功能分支，保旧分支归档及$null。
- [x] 全新共享实现代理：LedgerTable/index、ledger.css、对应完整测试；保原生状态，补桌面单行、非分页/加载/隐藏分页边界。
- [x] 全新调用方代理：按原主清单调查将外置分页并入同一工具区，保原请求/页长/游标/保护，直接Table只调布局需要的最小范围。
- [x] 全新浏览器实现代理：在原真实验收文件追加同排/总高度/间距及规则/任务真实路径；一次性PG/API/浏览器串行，不连接55440。
- [x] 受影响完整文件回归、Web类型/构建/契约/治理及SPEC→QUALITY；有效未变证据复用，原FAIL不抹去。
- [ ] 版本查重、提交推送一个fix1 PR；精确CI/Review、同树合并、mainCI、部署日志与公网核验。
- [ ] Issue最小结果回写保持开放；清理本轮自有资源、本地发布归档，人工/物理设备另记。

父独占Git、公共注册、文档、索引与资源。共享/调用方/浏览器文件所有权分离，heavy窗口始终只有一个；Node24.21.0/pnpm11.19.0，每shell先Enter-Qms，证据目录D:/WorkSpace/QMS-2.0-local/table-toolbar-compact-20261116。共享方案优先最小布局而非重写分页状态；跨Spin布局如不能通过真实加载/窄屏验收即换现有可靠接缝，不长期堆补丁。

### fix1 当前实际证据

toolbar_shared_impl：最小原生subgrid跨wrapper/Spin/container共享首行，不复制AntD状态，早版2项预期RED后完整48/48PASS90.07秒；随后补clearfix、自定义slot、48px、原生跳转默认等边界，最终完整集合仍NOT_RUN，不能复用48作为新全部通过。主题背景及局部治理padding重置沿共享CSS，所有调用方覆盖可保留。

toolbar_callers_impl：原23文件再核，只有7处需归并（WorkflowList、Outbox、Audit、ApiMonitoring、DataExchange、AdministrativeReconfiguration、AdministrativeProblemReconfiguration）；7项工具栏归属预期RED均FAIL/155诊断过滤，123.74秒，无timeout。7源码已最小移动原节点，5条件表复用同一ReactNode保空态返回，AST核96个on*、173保护属性、19完整effects与基线一致，162项GREEN仍NOT_RUN；原77未变证据复用。未改API/权限/请求/页长范围及409 helper。

toolbar_browser_impl：新一次性PG qms-table-toolbar-pg/TABLE-TOOLBAR/55636/512MiB tmpfs已156迁移与标准seedPASS；API源码/依赖未变，复用上轮build。首focused筛选错误No tests found为NOT_RUN；第二次实际在规则页tab点击30秒超时，未到几何。补无secret真实失败JSON后，低堆API384/Vite512已正常readiness，但启动PW384时系统可用提交内存跌至482MiB，按保护阈值只收自有PW/API/Vite，记INTERRUPTED、未完成case；没有完整DOM/几何证据，不归因产品或权限。原日志和cleanup保留，不改pagefile或杀用户进程。

独立toolbar_compact_spec初审FAIL/P2两处：Audit/Outbox嵌套治理toolbar原padding/border导致常规行约66px；原hideOnSinglePage浏览器测Account直接Table未覆盖共享subgrid。已接受：共享局部去重复padding/border，另用现有playwright/ledger-fixture真实共享组件补动态隐藏→显示→隐藏与Spin几何；该组件证据与真实业务验收分别记账，不以fixture代业务。可用提交内存约1.5～2.2GiB时不重复启动全栈浏览器；先低资源真实组件验证及静态工作，主机资源足够后再业务路径。

共享最终50/50PASS86.07秒（shared-fix1-green-final50），布局/原生状态/真实loader DOM保留；之前48不冒称新增通过。组件browser首轮在已测得desktop48/gap4/center0后因旧AntD blur类断言FAIL，核实际AntD6改为aria-busy/pointer-events/可见indicator；第二轮桌面多页/loading/hide序列已通过，但total0分页预期错误FAIL，核原生Table有total条件后修fixture空态为0组而非改产品。第三轮component-focused-third完整1/1PASS8.6秒：desktop多页及loading48px/gap4/center0/左右12；隐藏→显示→隐藏及空态39px无空行；390/320多页自然101px/gap4/左右12无溢出且Columns可点击。仅桌面动态hide/loading，不能称三宽hide；模拟数据组件无API请求，不代业务。所有原FAIL/中断和自有进程cleanup保留。

SPEC增量两P2关闭；QUALITY独立只读PASS，无新P0–P2，不代运行门禁。caller6完整文件100/100PASS：workflow7/outbox5/audit7/monitor20/exchange23/待配置38（218.92秒），无OOM及新FAIL；剩责任恢复32+30共62暂NOT_RUN，原77未变复用。

Weblint首轮TS2322为新增测试size:'default'不属于当前AntD6 SizeType；改为推荐'medium'，保explicit覆盖和全部断言。第一次定向正则错误导致50诊断过滤NOT_RUN，改准确选择后1PASS/49过滤（shared-size-type-green-exact），其余49由未受影响完整50证据承接，不为字面量再全跑。最终web-fix1-lint-final、web-fix1-build均PASS；产物index-DUMZLuk3.js/index-B6MuhmDV.css。既有大chunk提示保留，不在此做bundle重构。

资源恢复后，真实业务runner改用本次生产vite preview产物以减少开发编译graph内存；API384/preview128/PW384/outer128，先实际校验5186/3136两个OpenAPI均200/JSON且文档一致再进业务。API及依赖/契约未变，复用上轮同源dist/API/契约通过证据，本轮不重复后端构建；最终CI仍完整重验。一次性local.internal仅3个旧测试会话，预估focused+11后17<=20，无清理会话/MFA/权限绕过。当前业务11项包含新增Audit/Outbox实际路由与原真实数据GET，不以裸组件代替。

### fix1 最终本地验收

caller7文件162完整集合PASS：workflow7/outbox5/audit7/monitor20/exchange23/待配置38/责任恢复62；最后62按原32纯校验与30交互互斥并集完整执行，30项144秒PASS、409用例9178ms，未改helper/预算/motion，不承诺稳定提速。原77无源码变化证据复用，未将212受影响集合冒称全项目全量。

生产preview先focused规则1/1PASS18.1秒，再完整11为9PASS/2FAIL；9项含真实规则、任务、加载、Audit/Outbox、通知、供应商、物料及接收。两个FAIL分别是窄屏空态误用桌面高度上限、固定表头/表体双Table严格定位歧义；未改产品，改为实际Columns高度+上下12px（desktop39、mobile56且触控44）及唯一wrapper/真实thead后，仅两项复验2/2PASS20秒，保同排/高度/gap/无空行/真实API与会话≤20断言。最终为11场景组合PASS，不是单次重跑11/11。两轮preview代理前置实际文档一致525路径。所有原FAIL/INTERRUPTED及日志/cleanup保留。

完整11失败时worker重启额外产生会话，事后实际19而非原正常估17；两项复验需新增3会超20，故本run API登录前仅清一次性qms_table_toolbar/LOCAL-INTERNAL/local.internal且创建时间早于本run的19旧sessions，审计JSON保留，结束3新session/MFA保留。独立QUALITY核Schema与loopback/55440拒绝、专属DB/容器完整ID/标签/55636边界通过，无token/MFA/密码读取，不影响其他user或生产；真实≤20未放宽。

原view_image仍unsupported，但文件PNG头验证正常；父通过Node只读emitImage实际规则页截图已成功显示并核对桌面单行及大空白消除，未编辑图像，不把代理截图审阅写成人工批准。真实物理手机、其他浏览器与生产账号人工验收仍NOT_RUN。

治理最终PASS（38文档/520链接/20来源、3open维护、165依赖及阶段覆盖），归档隔离PASS；API源码、依赖及contracts与已部署基线比较为零差异，对应后端/契约/Compose有效基线证据复用，完整新CI仍重验。最终SPEC增量与QUALITY增量PASS无未解决P0–P2。API/preview/PW已全收；专属PG按完整ID/标签/tmpfs与端口验证精确清理PASS，未碰预览55440/用户应用。最终提交与PR/上线状态见后续。

## 实施与验证接续

正式features/console的JSX AST调查：LedgerTable共49调用/43文件，共享默认覆盖；直接Ant Table共34调用/25文件，其中11分页表/8文件迁移，23个pagination=false明细保留。外置Pagination共25声明/21文件，9个主清单文件的9个声明（含复用helper）覆盖12实际区；其余16声明为人员、科室、来源等选择器，保持候选语义。cursor累积扫描保留加载更多与真实游标，不伪造total。

外置迁移：ProblemCenterPage、MyTasksPage、ClosureTaskInbox、ProcessEightDTaskInbox、SupplierNotificationsPage、AdministrativeReconfiguration、AuditManagementPage、AuditStandardsPage、AnnouncementsPage。直接分页迁移：AccountSessionHistory、UserPositionsEditor、MasterDataImport、customer-ledger-import-panel、CustomerLegacyQualityPage、customer-ledger-detail、QualityDataPage、SupplierUsersPanel。所有原current/pageSize/total/onChange、过滤/排序复位及忙态/离开保护继续沿用；AntD6采用placement:['topStart']。接收记录已有自定义顶部工具栏，补padding并避免重复分页。

独立SPEC发现初查漏掉手写Button/Select/Space的分页，首次审查FAIL：WorkflowListPage、OutboxAdministration、ApiMonitoringPage、DataExchangePage、AuditAdministration共5处仍在表体后。AuditAdministration的cursor为替换当前页，须上移，不能错归为累计加载。已追加5个真实位置/请求回归，待RED后迁移原控件；最终独立修改生产范围为22文件。其余来源/人员候选、业务历史明细及累积读取保持原行为。

SPEC继续补查确认AdministrativeProblemReconfiguration主表是替换扫描窗口，原“上一扫描页/下一扫描页”也需前移；仅内部任职候选仍为候选例外。最终生产范围更正为23文件；AuthorizationSources是账号/岗位详情授权来源，非主清单。ProblemAuditPanel/EightDHistory追加cursor详情轨迹、SupplierControlledReport历史版本候选、SupplierResponseHistory单对象提交历史等例外已读源码确认，无其他主表漏项发现。

共享TDD：shared-red-focused为4项预期FAIL；第一次GREEN的menuitem定位错误已修。shared-green-full为45PASS/1旧拖动10s超时；限定真实thead后该拖动通过，下一次完整运行37PASS/9后半段超时且onTaskUpdate RPC超时。9项全部pagination=false，不能归因为新增分页DOM或直接宣称环境问题；保留全部FAIL，下一步阶段测量与完整复验，不改预算、motion或断言。

调用方TDD：caller-red为10项位置预期FAIL、1PASS，其余104仅该次诊断过滤未执行；共5完整文件115用例的GREEN待回读。真实浏览器准备供应商服务端分页、物料本地分页、接收自定义导航和业务通知外置分页四路径，1440/390/320几何及真实请求/页长切换目前NOT_RUN。

调用方首组完整44项为43PASS/1FAIL，remaining19与imports10完整通过；problem14/15的失败是旧helper假设工具区首按钮，新增分页后命中left，已改按真实工具区role/name定位，待完整复验。第二组待配置完整38项37PASS/1FAIL，跨组织POSITION三次Select交互10498ms超10000预算；同进程account未完成，runner终止保留FAIL/INTERRUPTED，不计通过。下一步限定对应浮层前先测量，保原断言与预算。追加5文件后最终调用方完整清单为10文件177用例，不能沿用原115全绿结论。

共享单次原生CPU profile完整运行102.13秒：45PASS/1FAIL，数值列宽/固定/移动/恢复用例10105ms超预算。首个旧43秒失败用例本次各query约0.3～1.3秒，样式计算占其中大部分；cleanup3.6ms，body归零、style42回36，没有该处残留证据。其余9项本次通过不代表已确认原慢根因；正在按CPU与真实控件拥有者定位最后超时，不修改产品或超时预算。临时插桩必须移除后再完整复验。

共享最终shared-green-owner-scoped-run.log完整46/46PASS/exit0，80.39秒，无RPC异常；只将设置按钮查找限定真实工具区，将旧首慢用例限定设置弹层/table、numeric限定设置弹层/单列行/thead，保全部role/name、断言、交互与原预算。numeric4.759秒、旧首慢2.860秒、header-drag2.022秒；历史9超时均通过，不能据单次推断全部慢化根因。CPU文件实际只有父进程约101.9秒idle，没有worker热点证据；临时样式计数/cleanup/写日志全部移除。前次错误路径导致Vitest未加载保留为工具前置FAIL，非测试失败。

独立table_spec_review增量复核23生产调用方及共享/测试/浏览器源码，SPEC PASS；6处初查缺口已全部最小前移，保原total、offset/page/cursor、页长、禁用/忙态和离开保护，无新增正式主表漏项。table_quality_review正在独立质量审查。caller-green-problem-final.log完整15/15PASS，40.27秒；其余继续串行，未完成项不提前算绿。浏览器runner只读preflight已父实跑PASS，真实活动根/容器ID/标签/DB/端口核实，未启动服务。

table_quality_review静态QUALITY PASS，无P0–P2；AST对比23调用方加共享组件共24TSX的on*属性集合保持，手工核禁用、身份/范围、CAS与离开保护未改。caller-green-account-final.log完整33/33PASS，160.38秒。Admin helper最终采用现有aria-controls对应dropdown与局部观察模式，保可见、pointerEvents、收起和真实请求断言；单例阶段测量为三次选择分别约1.1/1.8/1.7秒，6743ms/1PASS（37诊断过滤），不能作为完整38PASS或旧超时全部根因。首条testName正则未匹配导致38过滤，保留NOT_RUN；计时console必须移除后完整复验。

6处手写分页RED为6文件6个预期位置FAIL、118诊断过滤；含问题责任恢复62项后，调用方最终完整清单11文件239项（不是177），连同共享46项共285项的最终结果待汇总。

Web lint及生产build均PASS，contracts:check连同本次API build与生成类型比对PASS，无API契约改动。治理首轮FAIL在MAINT-001的审核标准来源摘要未更新；实际定向复核只有原Pagination节点上移，List/Space/Drawer弃用事实未解决，保持open与原reviewDue，不据分页改动关闭维护项，更新对应规范化摘要后复验。

真实浏览器首轮4项为2PASS/2FAIL：供应商服务端与物料本地分页已完整验证1440/390/320几何/页长/数据换页；通知页未找到tab超30秒需定位，接收记录在loading空数组被notEqual(first)过早放行后长度断言FAIL，需等待真实页响应/非空条数再断言，无产品几何失败证据。保原30秒预算、motion和原FAIL，修测试等待后完整复验；自有API/Vite已结束且3136/5186空闲，资源隔离保持。

浏览器接续final2为通知/供应商/接收完整PASS、物料worker3221226505异常；同刻PowerShell OutOfMemoryException。final3为通知/物料/接收完整PASS，供应商在登录账号框前30秒超时；期间Windows1455页面文件不足。不能写单次4/4；同产品源码四路径跨运行均实际完整PASS，1440/390/320几何和真实翻页/页长均有持久JSON与截图。通知首超时根因未知，后续真实DOM第8tab桌面可见/无pageerror/session200，不能倒推冷编译或溢出；末次登录初始化也未完整归因。收件等待修为十行且不同，保完整响应ID断言，两次通过；独立QUALITY窄审通过，无秘密日志。未改系统pagefile或杀用户进程；停止第四次无变化重跑，全部自有API/Vite清理和端口空闲核实。截图view_image返回unsupported，未作人工式像素批准；物理设备/人工验收NOT_RUN。

治理最终governance-final3 PASS（38文档/519链接/20来源、3open维护、165模块依赖及阶段覆盖），MAINT来源变化连锁摘要已按sourceDigest更新；原两次来源FAIL保留。归档隔离与Compose配置均PASS，无新增服务启动。原caller5文件115/115完整PASS；新增workflow7/outbox5/audit7/monitoring20完整PASS，exchange及责任恢复62合集继续串行。Git fetch通过原代理报连接中断，保持证书验证和全局配置，若正常push仍失败使用已校验同SHA的GitHub对象API，不强推或改变历史。

exchange完整23/23PASS（89.47秒）；责任恢复62分成互斥32纯校验+30交互（AST清单并集62、无重叠）。32已PASS，30两次29PASS/1FAIL，均409显式重读/重选用例10.34/10.727秒触原10秒预算；定向两次9868/9937msPASS不冒称完整30。阶段测量显示四次Select查找/可见性检查累计约7秒，确认键盘约421ms；仅限定实际owner/control等待并保可见/pointer/收起/版本9与旧输入卸载断言。独立QUALITY确认该409用例是冲突恢复而非指针验收，正常focus+Enter可保其意图（需明确焦点断言），不得宣称与完整鼠标事件序列等价。当前仍待移除计时后最终集合，不把微调单例绿当完整通过。

本轮一次性PG已按完整ID/标签/tmpfs验证精确清理（cleanup.json PASS），API/Vite已回收，避免继续占用本机内存；未改生产或预览数据库。

最终责任恢复30交互完整PASS（caller-green-problem-reconfiguration-ui-keyboard-final.log，152.03秒），与32纯校验互斥并集62；所有调用方11文件239项加共享46项共285完整集合有效PASS。409最终9878ms接近10000ms，不承诺提速或掩盖原FAIL；真实键盘确认及同act按原顺序事件、Form.Item控件定位不删验证，临时计时全部移除，最终独立QUALITY PASS无未修P0–P2。原第3次局部event-scoped仅调整但仍有超时的记录及定向观察也保留，最终以该完整30为准。

交付前远端main再次回读仍b955308、无开放PR且V0.0.54无冲突；所有新源码/设计/计划明确暂存，排除既有$null与Git外环境/日志。未改API/DTO/迁移/授权/生产配置；本地全量Web/API不重复运行，由既有精确PR24项门禁承担，不能把285受影响集合称为全项目全量。

一次性PG qms-table-pagination-pg，标签TABLE-TOP-PAGINATION，55636/tmpfs，156迁移通过。标准seed首次FAIL未打印根因；Git外诊断保留同seed逻辑并补异常类别，重跑成功未复现，不补造根因。诊断首次模块解析前置错误保留；不改项目依赖或连接55440。最终资源清理与浏览器结果待后续补记。
