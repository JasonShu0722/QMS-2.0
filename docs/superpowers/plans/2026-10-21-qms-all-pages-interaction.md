# QMS 全部现有页面交互规范展开计划

> 使用项目级 QMS Superpowers、writing-plans、分文件所有权子代理、TDD、先规格后质量审查和主代理串行验证。沿用已确认设计与样例，不重复请求开工确认。

## 当前摘要

| 项目 | 当前事实 |
| --- | --- |
| 时间／批准 | 2026-10-21（Asia/Taipei）；负责人明确“继续在本地将规范展开到全部现有页面，完成各批验证和审查，并纳入规范与样例” |
| 执行与推送边界 | 负责人于2026-10-21明确“已开源，继续”，推送前置已解除；沿用“本地代码改完后统一重新推PR以及代码合并”，统一更新PR #59，检查通过后接续合并。main成功构建会触发既有部署链，逐步核对实际结果，不改可见性／计费或绕过门禁 |
| 基线 | `codex/qms-interaction-foundation`，本地全页提交 `61ae1a4`；本轮刷新origin/main仍为`fd1e6b9`。沿现有PR #59分支`codex/qms-interaction-preview-pr`快进推送，不混入旧归档提交；第一批共享基线见[第一批计划](2026-10-21-qms-interaction-foundation.md) |
| 范围 | 所有现有正式路由、页面、子面板、编辑弹层、共享入口及实际调用方；必须登记已改、符合保留、业务例外、占位和待真实业务验收，不能只列36个Page文件 |
| 关联与版本 | 复用整体方向与现有Issue #58／#60；后续统一PR映射在本地归档。全页面展开候选V0.0.26，最终提交前再核对版本，不据本地预留声明发布 |
| 非目标 | 不新增未来业务字段／接口／状态机；不改变领域审批／权限／MFA／附件扫描／幂等规则；不引入新组件库，不机械替换语义正确的控件，不改归档或历史记录 |
| 当前检查点 | 102个正式TSX逐文件实现／保留依据已归入第7节，内部／供应商34个登录后入口已完成三档几何巡检。A/B/C/D/E及Shared源码和样例已收口；全部117个测试文件的最新完整记录共898项通过、0失败、0未运行。没有把源码清单、样例认可或空台账巡检当作真实业务验收。 |
| 已完成验证 | Node 24.21.0下最终分批回归，逐文件取最后完整运行结果。返修38/38，最后账号／认证／导航及受影响调用方22文件200/200，指标自动改选及审核邻近30/30；总账898/898。最终类型／构建／治理／阶段五覆盖／文档／归档隔离全部退出0，diff无空白错误；既有Ant Design弃用及chunk体积提示保留。原始输出在Git外保留。 |
| 当前限制 | 仓库public，`fce3be7`的运行39590244350中API、治理／契约、真实集成和Web第1／2／4分片通过；第1分片回执可见性修正已通过。第3分片30文件217断言全部通过，但首次改密测试环境销毁后出现2条`window is not defined`未捕获异常，栈为Ant Design表单反馈`useDelayState`延迟更新。针对测试定时器生命周期修复，不屏蔽异常、不修改业务源码；最新SHA须重新通过门禁。 |
| 下一动作 | 统一PR #59已更新为全页范围；锚点与回执等待已闭合。首次改密测试定时器清理已通过相邻3文件16/16、每例零残留断言和独立规格／质量审查；主代理完整第3分片217/217、未运行0、Vitest及类型检查退出0。推送V0.0.26-fix3后核对最新SHA门禁，通过再接续已批准合并并核验部署。34路由102次几何检查仅覆盖一次性55467及真实API种子台账，不替代真实业务人工验收；Issue和台账关闭仍待接续。 |

## 1. 规范依据和覆盖标准

依据[确认设计](../specs/2026-10-21-qms-interaction-system-design.md)、[统一规范](../specs/2026-09-21-qms-frontend-design-standard.md)、[实施指南](../../../qms-2.0/docs/FRONTEND-DESIGN.md)。覆盖分“源码已审查”“必要修改完成”“测试实际通过”“真实业务待验收”，没有截图／登录资源时不编造审美或业务PASS。

每个正式TSX都需登记：真实路径、所属批次、交互职责、修改／保留／例外依据、相关回归与未覆盖边界；辅助组件也需核对，非用户界面Provider记录其状态保护职责。不从文件名推断发布状态；正式占位页面保留占位，不因规范展开新建业务。

## 2. 分批及独立文件所有权

| 批次 | 目录写入范围（相对 `qms-2.0/apps/web/src/`） | 核验重点 |
| --- | --- | --- |
| A 管理与横向业务 | `features/admin`、`governance`、`imports`、`material-master`、`announcements`、`tasks`、`site-scanning`、`coordinate-inspection` | 主次动作、删除确认、批量范围／部分结果、配置保存、提交已存版本、忙时保护、现有权限／秘密边界 |
| B 供应商协作 | 所有 `features/supplier-*` | 草稿／正式发单、供应商身份隔离、资料包／审批互锁、抽屉未保存保护、正常关闭与危险作废、门户动作及导出 |
| C 领域质量与分析 | `features/process-quality`、`customer-quality`、`new-product-quality`、`audit-management`、`audit-standards`、`quality-data` | 领域审批／验证／关闭差异、表单／弹窗动作、部分导入、离线边界、指标缺失／零／NA与单位／范围 |
| D 问题与流程／共享证据 | 主代理：`features/problem-center`、`problem-workspace`、`workflows`、`attachments`、`feedback`、`layouts`、`work-tabs`、`workbench` | 内容Tabs与写入动作分离、流程保存／发布／版本、未保存、附件／报告权限、导航焦点、共享样式最小修复 |
| E 账号底座／规范样例／整合 | 主代理：`features/account`、`auth`、`theme`、`i18n`、`interaction-preview`、`App.tsx`／`main.tsx`、文档及索引 | 复用第一批，审查所有剩余状态和入口；样例覆盖本轮真实发现的模式并保持示例标识；不复制专业表单或泄露秘密 |

子代理不写公共主题、i18n字典、生成契约、规范／索引、不执行Git操作；只写自己的批次源码和测试。先提交需要验证的行为测试并告知主代理，主代理观察红灯后才授权该行为实现。纯局部呈现调整不制造镜像实现的测试，但其既有交互回归必须执行。主代理安排单worker、各批串行测试，写入冻结覆盖范围；测试失败先定位，不重跑无关全套。

## 3. 审查及实现步骤

- [x] 盘点真实路由和全部正式TSX，排除 `prototypes`、样例及测试文件；每个路径分配批次，既有认证／数据基础不漏记。
- [x] 各批阅读实际代码与调用方，形成具体差异；以同一意图使用同一规则，正常完成／关闭不能一律标danger，选择状态不能冒充提交成功。
- [x] 需要改行为的项目先写最小测试，执行并确认针对症状失败；再进行最小修复和邻近回归。可保留原来正确的实现，不能为了“覆盖”改所有行。
- [x] 台账／表单／页脚优先复用Ant Design和 `.qms-dialog-actions`，只在有明确独立职责时保留局部样式；不抽全功能包装器。
- [x] 所有打开／关闭／取消／遮罩／Esc／导航路径按对象草稿、busy与秘密实际处理；不丢输入，不绕过服务端授权／幂等／版本校验。
- [x] 原有主按钮、Tabs、Switch等选择按业务意图逐项判断；同步真实可访问名称和全部调用方测试，不以修改测试规避真实行为。
- [x] 更新全量覆盖表，逐批列具体证据和例外；占位／未启用／未来模式明确列边界。
- [x] 独立规格审查通过后质量审查；主代理实际核验报告、修正与交叉影响。

## 4. 测试和真实资源

本地工程及组件回归已完成。下方浏览器完整状态／真实业务项按第6.1节保留待验收，已经完成的34路由102次几何检查另列证据，不把整项勾选为全角色业务通过。

加载 `D:/WorkSpace/QMS-2.0-local/Enter-Qms.ps1`，再切到 `apps/web`；定向入口为 `node node_modules/vitest/vitest.mjs run <实际测试文件...> --maxWorkers=1`，JSON／原始输出保存在Git外 `D:/WorkSpace/QMS-2.0-local/all-pages-interaction-review/`。每批从少量最相关测试开始，通过后覆盖实际受影响文件；共享基线如未变不重复执行已有效的无关证据。

- [x] 各批新行为红灯／绿灯和相邻回归。
- [x] 最终全Web回归按文件分组串行，每组记录实际结果；有失败必须修复或明确阻塞，不能使用skip替代通过。
- [x] Web类型检查和生产构建；样例不入生产，不新增非预期请求／依赖。
- [x] 治理／文档／归档隔离／diff检查；规范来源哈希同步。
- [ ] 浏览器实际可覆盖的组件／页面检查主题、语言、长内容、三档尺寸、焦点及恢复；模拟输入、鼠标和真实设备分开。
- [ ] 受保护页面使用一次性真实服务／角色验证；没有认证环境时提供逐页／角色／步骤／预期／实际结果栏，保留待验收。不连接保留55440、不擅自启用旧资源或用Mock补真实业务结论。

## 5. 规范与样例回收

- [x] 归纳跨领域可复用规则进入统一规范，专项计划只记录本轮实际事实；不建立第二个权威设计源。
- [x] 8组样例补齐本轮发现的典型冲突：内容导航／主动作、危险确认、版本提交前置、草稿关闭／busy、批量部分结果和字段／统计语义。沿用真实Ant Design与共享主题，示例仍无业务写入。
- [x] 新增样例行为留下最小可运行测试；真实业务验收不因样例认可而省略。
- [ ] 完整覆盖、分批验证、独立审查及联合检查结束后，才整理统一推送范围并通知负责人处理仓库；实际确认后再推送、云端检查与获准合并。不以本地批次完成作为提前通知开源的理由。

## 6. 文件覆盖台账

盘点与审查结果执行后追加；每个正式文件都需要实际结论，不用“全站已覆盖”的笼统标记替代路径与证据。

### 6.1 真实业务验收接续

版本为当前本地 `codex/qms-interaction-foundation` 工作树，最终提交SHA在提交后补录。环境仅一次性PostgreSQL `55467`、真实API及生产Web构建；不连接保留预览 `55440`。已完成的34路由巡检只证明seed空台账／当前权限页面的几何和脚本状态；下列有业务数据的写入、资格、扫描与恢复路径不能用单元测试替代，实际结果保持待验收。

| 页面／角色 | 操作 | 预期 | 实际结果／证据 |
| --- | --- | --- | --- |
| 管理／有编辑权限的管理员 | 修改角色、用户、参数、通知规则，分别取消、Esc和关闭；在保存中尝试离开 | 继续编辑保留输入；确认放弃才清理；在途不丢反馈；无权限不可写 | 待真实业务验收；组件回归单列 |
| 三坐标／申请人和审批人 | 修改四字段后提交、恢复原值、保存；编辑意见和排单后关闭 | 未保存不能提交旧版本；各动作草稿同等保护，失败保留 | 待真实业务验收 |
| PPAP／资料处理人 | 两项各选附件，只绑定第一项，延迟刷新后再绑定第二项 | 第一项成功只清其草稿；第二项保留选择，提交使用最新版本 | 待真实附件扫描／服务端版本验收 |
| ASN／内部提交人 | 选扫描证据，刷新、取消关闭、绑定后正式提交 | 未绑定或已变更选择不可提交；刷新保留草稿；权限失效清理 | 待真实业务验收 |
| 审核／导入处理人 | 导入多行，部分成功、其余失败；台账后台重读后重试 | 未完成行及原请求键保留，成功行不重导；明确拒权清理 | 待真实导入API验收；父子生命周期和工作簿回归单列 |
| 移动审核／审核执行人 | 离线记录；恢复后部分同步失败、再编辑已成功行；提交中离开 | 成功行即时使用返回版本；未完成行保留原请求；在途保护离开 | 待真实弱网／设备／同步验收 |
| 客诉／处理人与独立审批人 | 保留旧客诉说明后登记新客诉；8D恢复证据并审批；制造409 | 新建成功后仍保护旧草稿；审批意见可输入；冲突保留并显式恢复 | 待真实权限／8D审批验收 |
| 问题／任务处理人 | 升级原因未保存时切Tab、刷新、领取失败；升级提交在途离开 | 取消保留原因；确认放弃才卸载；任务状态、幂等和业务资格保持 | 待真实流程升级验收 |
| 数据／指标查看者 | 手动换指标与刷新目录自动改选，使新趋势请求失败 | 旧事实不显示在新口径下；错误与空数据、零值可区分 | 待真实统计口径／权限验收 |
| 失败队列与公告／审计查看者 | A读取中关闭，再打开B，使A最后返回 | 关闭不重开，旧结果或错误不污染B | 待真实延迟网络验收 |

六种主题组合、键盘焦点、弹层触屏目标和长内容应沿前端实施指南继续按实际页面检查；本轮没有将空台账截图或代理源码审查写成全面可访问性认证。人工验收、浏览器自动检查、组件回归与源码审查分别记录。

<!-- ALL_PAGES_COVERAGE -->

### 6.2 独立审查与返修记录

首次C/D独立审查确认R1～R6（均P2，无P1）；A/B/E/Shared审查确认F1～F6（均P2，无P1）。F3供应商回复证据选择在当前实现的独立回归中已通过，保留测试但未增加无必要源码修改。其余发现均按真实调用方修复，不以扩大超时或改断言替代业务修复。

- C/D最终定向复核：R1～R6原触发路径全部关闭；指标自动改选遗漏经过新增红灯再次确认后，将清facts统一到趋势读取入口，手动／目录自动改选同等隔离。报告 `review-CD-final.md`。
- A/B/E/Shared最终定向复核：F1、F2、F4、F5、F6原触发路径均关闭，未确认新增必要P1/P2；F3沿独立回归保留当前实现。报告 `review-ABES-final.md`。
- 报告均为独立源码／测试断言审查，未由审查代理运行测试；主代理的实际回归另外记录。关键返修6文件38项全部通过；账号等22文件200项全部通过；最后质量数据／审核30项全部通过。
- 供应商长交互曾因10秒默认上限失败；在不改变输入、可见性、版本及请求断言的条件下，30秒诊断运行33/33通过，随后仅对应4个测试文件登记30秒上限。无skip、force点击或关闭指针可达检查；历史失败输出保留。

上述报告与原始日志均保存在Git外 `D:/WorkSpace/QMS-2.0-local/all-pages-interaction-review/`。它们不代表人工验收、生产部署或云端CI通过。

## 7. 正式源码覆盖记录

覆盖102个正式TSX（36个Page文件）；34个路由含现有占位入口。下表记录源码改动／保留依据，不能据此推导业务验收通过。正式控件继续复用Ant Design、共享主题和现有权限／契约，不新增第二套组件库。完整逐文件测试入口、源码摘要及原始结果保存在Git外 `D:/WorkSpace/QMS-2.0-local/all-pages-interaction-review/final-evidence.json`，各批结果以下节实际汇总为准。

| 批次 | 正式文件（相对apps/web/src） | 实现状态 | 核对依据与边界 |
| --- | --- | --- | --- |
| A | `features/admin/AdminPage.tsx` | 符合保留 | 源码已审查。真实业务按角色／对象待验收 |
| A | `features/admin/GroupedPermissionSelector.tsx` | 符合保留 | 源码与 RoleAdministration、PermissionMatrix 调用方已审查。真实业务按角色／对象待验收 |
| A | `features/admin/PermissionMatrix.tsx` | 符合保留 | 源码已审查。真实业务按角色／对象待验收 |
| A | `features/admin/RoleAdministration.tsx` | 已改 | 主代理反馈 a-layout-red.json 删除直写及 ab-guards-red.json 角色编辑关闭用例已实跑红灯并授权。真实业务按角色／对象待验收 |
| A | `features/admin/RolePermissionDetails.tsx` | 符合保留 | 源码与角色详情调用方已审查。真实业务按角色／对象待验收 |
| A | `features/admin/UserAdministration.tsx` | 已改 | audit-config-final-red.json 已确认 direct role assignment 未保存关闭无 guard、batch pending 关闭导致 dialog 从 document 消失，现已授权并修复。真实业务按角色／对象待验收 |
| A | `features/admin/UserBatchCreate.tsx` | 已改 | audit-config-final-red.json 已确认 pending 关闭实际卸载弹窗。真实业务按角色／对象待验收 |
| A | `features/admin/UserMfaPolicy.tsx` | 符合保留 | 源码与用户管理调用方已审查。真实业务按角色／对象待验收 |
| A | `features/admin/UserTemporaryPassword.tsx` | 符合保留 | 源码及 UserAdministration、SupplierUsersPanel 实际调用方已审查。真实业务按角色／对象待验收 |
| A | `features/announcements/AnnouncementsPage.tsx` | 已改 | 公告编辑dirty/busy及统一操作区；阅读审计绑定请求代际，关闭与换对象拒绝迟到结果。真实业务按角色／对象待验收 |
| A | `features/coordinate-inspection/CoordinateInspectionPage.tsx` | 已改 | 新建及动作编辑器登记dirty/busy并统一关闭保护；四字段变更时禁止提交旧版本，恢复原值重新允许提交。真实业务按角色／对象待验收 |
| A | `features/governance/AuditAdministration.tsx` | 已改 | 源码与管理入口已审查。真实业务按角色／对象待验收 |
| A | `features/governance/ConfigurationAdministration.tsx` | 已改 | 系统参数、通知规则、类别分别登记草稿；错误重试与刷新共用受保护读取，保存失败保留输入。真实业务按角色／对象待验收 |
| A | `features/governance/GovernanceFeedback.tsx` | 符合保留 | 源码及治理、账号、认证调用方已审查。真实业务按角色／对象待验收 |
| A | `features/governance/OrganizationAdministration.tsx` | 已改 | 主代理反馈 ab-guards-red.json 组织编辑缺 guard 已实跑红灯并授权。真实业务按角色／对象待验收 |
| A | `features/governance/OutboxAdministration.tsx` | 已改 | 回执请求用代际隔离，关闭、换组织、卸载使旧请求失效；旧结果和错误不能重开弹窗或覆盖新对象。真实业务按角色／对象待验收 |
| A | `features/governance/PositionRolesDrawer.tsx` | 符合保留 | 源码及 StructureAdministration 调用方已审查。真实业务按角色／对象待验收 |
| A | `features/governance/StructureAdministration.tsx` | 已改 | 主代理反馈 ab-guards-red.json 部门与岗位编辑缺 guard 两项已实跑红灯并授权。真实业务按角色／对象待验收 |
| A | `features/imports/MasterDataImport.tsx` | 符合保留 | 源码、分批辅助代码及客户/供应商/物料实际调用方已审查。真实业务按角色／对象待验收 |
| A | `features/material-master/MaterialMasterImport.tsx` | 符合保留 | 源码与 MaterialMasterPage 调用方已审查。真实业务按角色／对象待验收 |
| A | `features/material-master/MaterialMasterPage.tsx` | 已改 | 源码与管理入口已审查。真实业务按角色／对象待验收 |
| A | `features/site-scanning/SiteScanningPage.tsx` | 已改 | 回车和点击共用同步锁；写入在途冻结规则、条码和批次，失败沿原请求重试，成功后释放。真实业务按角色／对象待验收 |
| A | `features/tasks/MyTasksPage.tsx` | 符合保留 | 源码、task-inbox 辅助请求及内部路由已审查。真实业务按角色／对象待验收 |
| A | `features/tasks/TaskStatisticsPage.tsx` | 符合保留 | 源码与内部路由已审查。真实业务按角色／对象待验收 |
| B | `features/supplier-admission/SupplierAdmissionPage.tsx` | 已改 | 资料标题与待提交附件ID登记dirty，写入登记busy并共用同步锁，成功只清对应草稿，失败保留，busy禁编辑附件ID；内部/门户API分流、扫描校验与版本协议保留。真实业务按角色／对象待验收 |
| B | `features/supplier-asn/SupplierAsnPage.tsx` | 已改 | 创建／详情关闭使用共享保护；同对象刷新保留证据选择，绑定与正式提交按服务端版本互锁。真实业务按角色／对象待验收 |
| B | `features/supplier-audit/AuditPlanSelect.tsx` | 符合保留 | 选择已提交/已关闭计划，显示加载数量、200 条上限、年度缩小范围及错误重试；选择不产生业务写入。真实业务按角色／对象待验收 |
| B | `features/supplier-audit/SupplierAuditPage.tsx` | 已改 | 已改关闭说明/结论dirty、详情mutation同步锁/shared busy/关闭回调阻止及禁Close/Esc/遮罩；请求中检查项与附件只读。真实业务按角色／对象待验收 |
| B | `features/supplier-concession/SupplierConcessionPage.tsx` | 已改 | 创建、处理意见取消、父详情关闭均走shared guard；继续编辑保留、放弃清理草稿/错误/重试key，shared busy与同步锁禁请求中编辑/关闭。真实业务按角色／对象待验收 |
| B | `features/supplier-incoming/SupplierIncomingPage.tsx` | 已改 | 保留既有新建/更正/关联问题的 dirty、取消 guard 和 busy 保护，父详情保护待归档照片，串行锁协调完成/照片/问题写入。真实业务按角色／对象待验收 |
| B | `features/supplier-notifications/SupplierNotificationsPage.tsx` | 符合保留 | 关联问题使用 Link；标为已读有同步请求锁、版本和并发禁用，失败与重新读取分开；通知已读不等同业务任务完成。真实业务按角色／对象待验收 |
| B | `features/supplier-pcn/SupplierPcnPage.tsx` | 已改 | bc-red-fixed已命中的证据、审批意见、流程定义/版本及pending误offer discard已修：补完整dirty，shared busy替代saving冒充dirty，关闭检查同步lock/保存状态，放弃清理对应字段，切记录重置处理输入，busy禁附件/意见/启动字段/关闭。真实业务按角色／对象待验收 |
| B | `features/supplier-performance/SupplierPerformancePage.tsx` | 已改 | 内部复核说明纳入dirty，取消guard确认保留/放弃，放弃清理说明/错误/重试key；登记已有建卡/发布/复核busy，复核忙时禁关闭/Esc/遮罩。真实业务按角色／对象待验收 |
| B | `features/supplier-performance/SupplierPerformancePortalPage.tsx` | 已改 | 申诉取消shared guard，取消放弃确认保留原因，确认放弃清原因/错误/重试key；shared busy和禁Close/Esc/遮罩。真实业务按角色／对象待验收 |
| B | `features/supplier-ppap/SupplierPpapPage.tsx` | 已改 | 同对象刷新保留详情及兄弟检查项草稿；每项选择／已保存基线分离，成功只清本项；明确拒权清理。真实业务按角色／对象待验收 |
| B | `features/supplier-quality-targets/SupplierQualityTargetsPage.tsx` | 已改 | 详情实际值/状态转换shared busy及同步锁，关闭回调busy/锁复验、禁Close/Esc/遮罩、忙时冻结对应输入/修订入口；创建/修订沿同机制补busy防离开并复用qms-dialog-actions取消/保存顺序。真实业务按角色／对象待验收 |
| B | `features/supplier-quality/SupplierMasterImport.tsx` | 符合保留 | 复用 MasterDataImport，严格四列表头并拒绝公式及额外列；重复跳过、不覆盖、不创建账号。真实业务按角色／对象待验收 |
| B | `features/supplier-quality/SupplierProfilesPage.tsx` | 符合保留 | 新增/编辑已有局部 dirty 确认、busy 禁止关闭、失败保留及请求锁；冲突重载保留填写，导出明确当前页，组织和权限范围明确。真实业务按角色／对象待验收 |
| B | `features/supplier-quality/SupplierQualityPage.tsx` | 已改 | 问题事实和回复编辑dirty，shared busy保护导航，回复保存成功才清内容dirty，正式提交成功清选中证据，失败保留；已选未提交附件保留dirty。真实业务按角色／对象待验收 |
| B | `features/supplier-quality/SupplierReferenceSelect.tsx` | 符合保留 | 服务端搜索、分页、选中项单独解析、失效原选择提示及失败重试分开，选择不产生保存写入。真实业务按角色／对象待验收 |
| B | `features/supplier-quality/SupplierResponseHistory.tsx` | 符合保留 | 历史修订与当前验证状态分开，附件扫描、可下载和已删除保留历史明确；附件只读，分页不产生业务写入。真实业务按角色／对象待验收 |
| B | `features/supplier-quality/SupplierUsersPanel.tsx` | 符合保留 | 已有局部 dirty 确认、busy 禁止关闭、同步请求锁、失权秘密清理及停用撤会话确认；复用 UserTemporaryPassword，受控企业绑定由服务端复验。真实业务按角色／对象待验收 |
| B | `features/supplier-quality/SupplierWorkflowActions.tsx` | 符合保留 | 仅呈现服务端允许动作，已有确认、busy 和版本前置；关闭结束受控流程并要求当前修订独立验证，另有关闭后附件写入限制，现有 danger 有实际影响依据，保留而不机械统一。真实业务按角色／对象待验收 |
| C | `features/audit-management/AuditExcelImport.tsx` | 已改 | 主代理c-data-red.json已确认重试disabled红灯并授权；现已删除重置active入口，按钮busy/loading禁用，active只在submit开始/finally改变；原行key与逐行API不变，待主代理绿灯。真实业务按角色／对象待验收 |
| C | `features/audit-management/AuditManagementPage.tsx` | 已改 | 导入器在同组织后台刷新和临时错误时保留实例；明确拒权清理，组织变化隔离原重试行；发单dirty/busy及受控错误保留。真实业务按角色／对象待验收 |
| C | `features/audit-management/AuditMobileExecution.tsx` | 已改 | 同步锁覆盖整个同步／提交周期；在途登记共享busy，成功行即时合并返回事实和版本，未完成行保留原请求键；读取以代际隔离。真实业务按角色／对象待验收 |
| C | `features/audit-management/AuditNcClosurePanel.tsx` | 已改 | 整改和独立验证使用共享关闭保护；409保留编辑对象和输入，禁止旧版本重提，确认放弃后才刷新。真实业务按角色／对象待验收 |
| C | `features/audit-standards/AuditStandardsPage.tsx` | 已改 | 实际依赖@rc-component/drawer DrawerPanel.js明确class前缀-section、role=dialog，测试异步等待真实.ant-drawer-title后closest([role=dialog])，输入/保存限同dialog；waitFor确认POST进入待决Promise，断言表单disabled，act内触发离页再检。真实业务按角色／对象待验收 |
| C | `features/customer-quality/CustomerComplaintEightDPanel.tsx` | 已改 | 8D内容、审批与附件状态分开保护；恢复已保存证据ID，移除明确失效证据；审批不继承草稿字段禁用，写入同步锁。真实业务按角色／对象待验收 |
| C | `features/customer-quality/CustomerComplaintEntry.tsx` | 已改 | 登记表单真实dirty、busy独立登记；取消/X/遮罩/Esc同一guard，busy冻结Form及关闭，成功登记resetFields并清dirty；未建确认层。真实业务按角色／对象待验收 |
| C | `features/customer-quality/CustomerComplaintProcessing.tsx` | 已改 | 分类/部门/负责人相对已保存基线、处理说明和选证据登记dirty；busy冻结编辑，用户错误刷新走guard。真实业务按角色／对象待验收 |
| C | `features/customer-quality/CustomerMasterImport.tsx` | 符合保留 | 逐路径核查：本文件不拥有弹窗、按钮、busy或关闭状态，仅委托共享MasterDataImport；只读两字段解析保留，关闭/取消/换文件/部分导入必须由主代理在共享imports实现和验证，C不复制确认层。真实业务按角色／对象待验收 |
| C | `features/customer-quality/CustomerMasterSection.tsx` | 已改 | 新建/关系/编辑分别dirty，busy独立登记；移除局部Modal.confirm层，全部复用guard。真实业务按角色／对象待验收 |
| C | `features/customer-quality/CustomerQualityPage.tsx` | 已改 | 详情按对象切换；新登记成功刷新台账后经共享guard处理旧草稿，确认放弃时先卸载旧详情，再读取新对象。真实业务按角色／对象待验收 |
| C | `features/new-product-quality/NewProductIssueClosurePanel.tsx` | 已改 | 分派相对初始责任人及措施/验证/关闭说明登记dirty；busy独立登记；取消/X/遮罩/Esc及更换动作走guard；成功关闭action即清真实dirty，正常关闭仍非danger。真实业务按角色／对象待验收 |
| C | `features/new-product-quality/NewProductQualityPage.tsx` | 已改 | 移交风险、方案、总结、审批/放行意见和证据分别登记dirty，写入busy独立登记；取消/X/遮罩/Esc、项目lookup/Enter/刷新、换批次走guard。真实业务按角色／对象待验收 |
| C | `features/process-quality/ProcessDefectLedgerPage.tsx` | 已改 | 发单Form变化登记真实dirty；提交busy独立登记并冻结Form/来源选择；X/遮罩/Esc走closeIssue和guard，确认放弃清表单，成功清dirty；保留台账读取不清草稿。真实业务按角色／对象待验收 |
| C | `features/process-quality/ProcessShipmentReportPanel.tsx` | 已改 | 创建Form真实dirty和busy；X/遮罩/Esc统一guard；详情文件/客户/问题/版本待提交值登记dirty，父关闭/换报告/用户刷新走guard。真实业务按角色／对象待验收 |
| C | `features/quality-data/QualityDataPage.tsx` | 已改 | 主代理c-data-red.json已确认缺失空文本变零并授权；formatMetric在Number前排除null/undefined/空白文本，定义单位和数值单位缺失显示未配置单位，真实零和原百分比换算不变；待主代理绿灯，i18n主代理处理。真实业务按角色／对象待验收 |
| D | `features/attachments/AttachmentPanel.tsx` | 符合保留 | 资源key隔离、请求/上传卸载abort、upload attempt重试、同步操作锁、扫描中轮询、AVAILABLE且CLEAN才下载、只读隐藏写入、删除确认及历史保留说明原样保留。真实业务按角色／对象待验收 |
| D | `features/feedback/FeedbackButton.tsx` | 符合保留 | 原生button有type与可访问名称，保留主指针/五像素阈值、拖动防误触、cancel/capture处理及键盘点击；有界位置记忆和resize修正。真实业务按角色／对象待验收 |
| D | `features/problem-center/ProblemCenterPage.tsx` | 已改 | 保存视图读取、CAS冲突和组织隔离保留；本轮补充最小真实组件测试，要求删除前点名个人视图并说明不删除问题，取消不得发DELETE。真实业务按角色／对象待验收 |
| D | `features/problem-workspace/problem-read.tsx` | 已改 | 同身份刷新保留已加载内容，身份变化清理；卸载abort，明确读取失败不当作空态。真实业务按角色／对象待验收 |
| D | `features/problem-workspace/problem-ui.tsx` | 领域例外保留 | 只按领域注册表和Object.hasOwn解析实际组件，无独立控件、写入、表单或可加动作区；不造假领域面板。真实业务按角色／对象待验收 |
| D | `features/problem-workspace/ProblemAuditPanel.tsx` | 领域例外保留 | 刷新和加载更多是次要动作，加载时禁用；cursor组织范围、追加去重、请求清理abort保留。真实业务按角色／对象待验收 |
| D | `features/problem-workspace/ProblemReportPanel.tsx` | 领域例外保留 | 报告读取带组织与实例范围；刷新加载时禁用，历史不可用字段明确显示，不以当前摘要替代历史。真实业务按角色／对象待验收 |
| D | `features/problem-workspace/ProblemUpgradePanel.tsx` | 已改 | 升级请求体、幂等attempt、冲突和结果未知重试边界保留；本轮测试覆盖原因草稿登记与pending导航保护所需的调用边界。真实业务按角色／对象待验收 |
| D | `features/problem-workspace/ProblemWorkspacePage.tsx` | 已改 | 内容Tabs按需挂载并保护父级切换、关闭、刷新；同对象领取后的读取不卸载未保存升级原因。真实业务按角色／对象待验收 |
| D | `features/workflows/WorkflowCanvas.tsx` | 领域例外保留 | ReactFlow专业图编辑器继续使用：readOnly阻止拖动和连线，禁止自连，动作按源节点类型产生，deleteKeyCode关闭快捷删除。真实业务按角色／对象待验收 |
| D | `features/workflows/WorkflowDesignerPage.tsx` | 已改 | 重新加载使用现有useNavigationGuard，busy通过useNavigationBusy登记。真实业务按角色／对象待验收 |
| D | `features/workflows/WorkflowListPage.tsx` | 已改 | 新建代码／名称登记草稿，成功清理后等busy解除再跳转设计器；取消放弃和失败保留。真实业务按角色／对象待验收 |
| D | `features/workflows/WorkflowProperties.tsx` | 领域例外保留 | 节点类型/处理范围/条件使用Select、Checkbox及有边界数值输入，父fieldset负责readOnly；CLOSE/CC合法动作、独立验证、分支null/数组语义保留。真实业务按角色／对象待验收 |
| E | `features/account/AccountAvatar.tsx` | 符合保留 | 保留下载中止、对象URL回收、账号epoch隔离及失败重试；本轮无必要源码改动，未据既有测试文件宣称当前验证通过。真实业务按角色／对象待验收 |
| E | `features/account/AccountCenterPage.tsx` | 符合保留 | 保留概览与编辑分工、安全刷新不覆盖资料草稿、账号切换旧响应隔离及afterClose焦点恢复；本轮无必要改动。真实业务按角色／对象待验收 |
| E | `features/account/AccountMenu.tsx` | 符合保留 | 退出保留同步锁、未保存保护及会话完成导航；个人设置、改密、安全入口与关闭焦点恢复沿用既有职责。真实业务按角色／对象待验收 |
| E | `features/account/AccountSessionHistory.tsx` | 符合保留 | 只对有效且非当前会话提供撤销，保留跨请求刷新期间同步锁、分页互锁、旧响应隔离及加载/错误/空状态区分。真实业务按角色／对象待验收 |
| E | `features/account/AccountSettingsDialog.tsx` | 符合保留 | 不重改第一批qms-dialog-actions；资料保留独立primary/Form提交、头像与签名互锁、dirty保护、409基线合并、幂等及afterClose，不迁移为总保存。真实业务按角色／对象待验收 |
| E | `features/account/AvatarEditor.tsx` | 领域例外保留 | 上传、扫描与设为头像属于不同完成阶段；保留文件限制、安全扫描隔离、重试/放弃、头像版本冲突、幂等及账号隔离，不合并为资料总保存。真实业务按角色／对象待验收 |
| E | `features/account/PasswordChangeDialog.tsx` | 符合保留 | 保留同步提交锁、busy输入与关闭禁用、失败保留秘密、放弃清理、卸载清理及afterClose焦点恢复；不重改已完成footer。真实业务按角色／对象待验收 |
| E | `features/account/SignatureSettings.tsx` | 领域例外保留 | 签名独立登记/撤销，保留读写权限、busy/dirty反馈、同步锁、409版本冲突、幂等、成功清理及卸载清理；不并入资料保存，不记录签名原文。真实业务按角色／对象待验收 |
| E | `features/auth/AuthenticatedRoute.tsx` | 符合保留 | 保留服务端会话校验、身份/组织绑定、首次改密挑战、门户分流、错误重试及旧响应保护，不推断或改写认证落点。真实业务按角色／对象待验收 |
| E | `features/auth/AuthToolbar.tsx` | 符合保留 | 复用语言与外观共享入口；受保护门户隐藏认证工具栏，无需增加局部主题、样式或重复入口。真实业务按角色／对象待验收 |
| E | `features/auth/LoginPage.tsx` | 已改 | 主代理login-required-red.json先复现输入未禁用及重复POST为2；授权后增加submit同步pending锁/finally释放及Form disabled=loading。真实业务按角色／对象待验收 |
| E | `features/auth/PasswordRecoveryPage.tsx` | 已改 | 主代理de-red.json先复现申请找回/邮件凭证完成重复POST为2；授权后共享submit增加同步pending锁/finally释放。真实业务按角色／对象待验收 |
| E | `features/auth/ReauthenticationProvider.tsx` | 已改 | 主代理router-reauth-red.json先复现重复POST为2，busy输入/失败保留与取消/Esc两项已过，先前Esc风险已撤销；授权后仅加submit独立submitting ref锁/finally释放。真实业务按角色／对象待验收 |
| E | `features/auth/RequiredPasswordChangePage.tsx` | 已改 | 主代理login-required-red.json先复现两项密码字段未禁用；授权后仅为Form加disabled=busy，沿用既有pending/退出互锁。真实业务按角色／对象待验收 |
| E | `features/auth/ResetPasswordPage.tsx` | 已改 | 主代理de-red.json先复现输入未禁用及重复POST为2；授权后加同步pending锁/finally释放及Form disabled=busy。真实业务按角色／对象待验收 |
| E | `features/auth/SecurityDialog.tsx` | 符合保留 | 保留busy阻止关闭、绑定秘密/恢复码关闭确认、只在open挂载安全内容、关闭卸载及afterClose焦点恢复；不重改第一批footer或清理顺序。真实业务按角色／对象待验收 |
| E | `features/auth/SecurityPage.tsx` | 符合保留 | 已有perform同步锁及表单busy禁用；保留管理员集中MFA策略、独立登录挑战、恢复码一次性展示与关闭清理、邮箱确认及服务端落点。真实业务按角色／对象待验收 |
| Shared | `App.tsx` | 符合保留 | 现有Language/Theme与data-router认证宿主；门户由真实AuthenticatedRoute分流，不新增样例或业务路由。真实业务按角色／对象待验收 |
| Shared | `i18n/Language.tsx` | 已改 | 补充全量盘点发现的公告计数及缺失单位文案，保留单一locale持久化、菜单焦点和业务值原文。真实业务按角色／对象待验收 |
| Shared | `i18n/TopbarLanguageSwitcher.tsx` | 符合保留 | 真实Radio双语言互斥与方向键，使用共享主题CSS，不因外形替换语义正确控件。真实业务按角色／对象待验收 |
| Shared | `layouts/AnnouncementReminder.tsx` | 已改 | 本次红灯确认英文仍为中文，改消费同一LanguageProvider，计数刷新/卸载中止/内部门户范围保留。真实业务按角色／对象待验收 |
| Shared | `layouts/InternalLayout.tsx` | 已改 | 真实领域/组织/权限导航及占位状态区分，Drawer导航/WorkTabs共享，现有数据隔离与失效反馈不改。真实业务按角色／对象待验收 |
| Shared | `layouts/ShellHeader.tsx` | 符合保留 | 双门户共享唯一语言/外观/个人菜单入口，保留内部公告和现有WorkTabs/路由职责。真实业务按角色／对象待验收 |
| Shared | `layouts/SupplierLayout.tsx` | 符合保留 | 供应商授权菜单/账户/PCN/绩效/待办路由分开；资料占位保持占位，不开放内部域。真实业务按角色／对象待验收 |
| Shared | `layouts/UnsavedChanges.tsx` | 已改 | 红灯确认clean-but-busy刷新未保护，beforeunload同时检查dirty/busy；保留blocker排队和成功导航机制。真实业务按角色／对象待验收 |
| Shared | `main.tsx` | 符合保留 | StrictMode、QueryClient、AntD重置和单一正式App入口；生产不导入独立样例。真实业务按角色／对象待验收 |
| Shared | `theme/AppearanceButton.tsx` | 符合保留 | 两组唯一name Radio，checked/键盘/系统跟随/偏好独立与Drawer焦点已验证；全页无需重建。真实业务按角色／对象待验收 |
| Shared | `theme/ThemeProvider.tsx` | 符合保留 | 六主题/共享Button token同源，36px和既定密度/语义色保留，不复制局部主题。真实业务按角色／对象待验收 |
| Shared | `work-tabs/WorkTabs.tsx` | 已改 | 红灯确认全部标签入口缺状态语义，补dialog-haspopup/expanded；保留URL/去重/非活动关闭/guard/新窗口安全。真实业务按角色／对象待验收 |
| Shared | `workbench/Workbench.tsx` | 符合保留 | 真实Link而非写入按钮，指标未接入明确不显示假零，展示密度/宽窄布局消费共享变量。真实业务按角色／对象待验收 |
