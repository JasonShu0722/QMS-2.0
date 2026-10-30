# QMS 完整管理控制台实施总计划

> 面向执行代理：先使用 qms-superpowers-zh，再按 subagent-driven-development 执行；每个实现任务使用全新实现子代理，先SPEC再独立QUALITY。共享schema、生成契约、注册、Git索引和验证资源由父代理串行维护。负责人已于2026-10-29正式启动夜间开发，历史策划停止口径以顶部最新授权为准。

**目标：** 交付与业务窗口视觉和导航独立、共用QMS身份权限、完整承接现有管理及流程配置并具有真实观测能力的管理控制台。

**架构：** 同源 /console/* 管理工作空间，独立布局与主题，复用现有请求、领域服务和契约；治理迁移沿既有直属岗位方案。观测由服务端拥有者提供，按权限聚合，不另建权限系统或通用业务同步引擎。

**技术栈：** 现有React/React Router/Ant Design、NestJS、Prisma/PostgreSQL和Worker。UI对照固定提交的shadcn-admin，组件体系变更必须在样例差距评估后另作明确决定。

## 当前摘要

| 摘要项 | 当前事实 |
| --- | --- |
| 最后核对 | 2026-10-30 10:12，Asia/Taipei；HEAD af9f7a4，仍无CP-1提交/PR/部署。heartbeat已删除，不是停工；Web第3片exec94589及真实vitest进程可靠活跃 |
| 授权与跟踪 | 2026-10-30负责人最新明确“开发完了就推进PR部分”：立即提交推送并建立CP-1草稿PR，让精确head CI与审查在PR接续，未完成及失败门禁显式保留，不能标Ready或合并放行。REQ-0032 / reczz28TGUdtjO7t；CP-1 Issue82/V0.0.36；CP-2 Issue83/V0.0.37未启动。仍仅两个常规PR，不自动合并部署；生产来源转换/赋权删除/绑定启用/外发/人工验收/关闭飞书回填未授权 |
| 已封存模块 | 多窗口：两审及父14完整271通过；直属A：两审/父核心144、delta81、HTTP3/lint通过；B命令：两审/fresh父3完整82通过，先前回放ceiling及目标marker缺口均真实RED修复；管理分发器：两审/父3完整85通过；流程迁入：两审/父4完整116通过。均有 Git 外 gate-closure 与源码 hash，不将重叠测试数字相加 |
| 当前整合 | App/legacy/导航两审PASS，最新11完整271；共享context/rootcanonical两生产行两审PASS，最终API48/Web294。父整合五文件146PASS/1FAIL原blocker未复现/原因未知保留，test仅加强真实dirty/blocked语义等待（两审PASS），原五文件完整147/147通过；父最新独立shell/guard/Gate三完整38/38/39.19s通过，生产未保存机制未改，parent-registration-canonical-gate-closure.json封存，不称已证明旧失败根因 |
| 读模型与首页 | legacy读/B命令/HomeAPI均两审与父定向真实PG通过；contracts generate/check exec99500exit0。HomeWeb最终无timer23绿+shell共38绿、两审PASS；父实际indexRED后App两行接真实Home，再App83+Home23完整106/106/25.73s、6hash一致，限定接线双审PASS。整包lint/build/契约已通过；真browser及人工验收未完成，不造CP2指标 |
| 下一动作 | API全unit157/2315、五步lint/build/contracts、父11完整Web264/264、部署含备份11/11、workspace82、governance156均通过。Worker原样恢复后子8/8及父8/8通过，无代码改动，原失败未证实根因。全Web第1片28文件347通过，第2片481/485有4失败；3失败完整文件原样重验144/144通过，不将原2片改为PASS。当前3..8串行exec94589，第3片真实进行。全API第1片因实测内存危险受控中断，后3片未执行，待Web释放后串行续验；浏览器工具信任拒绝、完整阶段未验。继续门禁→CP-1 PR，禁止提前放行 |
| 全量门禁补齐 | API4源微修两审+父157/157 suites、2315/2315/204.717s全绿/source未变，归档gate。Web3testtype微修两审PASS，父三完整146PASS1FAIL根因是C1root规则下旧testfixturedepartment岗隐藏；独立仅fixture改null后完整66/22.15s绿、限定两审PASS，父三文件最终联合仍待后续。全tree该轮另C2非导入新test变如实sourceUnchangedfalse，覆盖生产稳，不冒全树freeze。C2DOMtype已修，最终父入口后API/Web lint/build及契约均exit0；治理来源已实际复核并通过，新增公开认证decorator依赖登记独立SPEC/QUALITY通过 |
| 资源与证据 | Git外 D:/WorkSpace/QMS-2.0-local/management-console-20261029。task PG55582/RustFS55583/ClamAV55585已恢复healthy；重启前tmpfs数据库/对象数据已丢失，原失败日志/hash保留。fresh库同名重建136迁移，无seed；全API片1独立库qms_console_cp1_integration_20261030_s1已136迁移+seed，其余片未建。task Mailpit实际SMTP50930/HTTP50931；固定端口拒绝证据保留。未触碰55440或生产 |
| heartbeat | 应用工具已按负责人明确要求删除qms，不再有20分钟唤醒；不自动重建。取消定时跟进不等于停止当前开发，最新授权仍为正常推进至CP-1 PR |
## 1. 交付分组、映射与检查点

| 单元 | 覆盖任务 | 分组理由 | 跟踪与依赖 |
| --- | --- | --- | --- |
| CP-1 / PR-1 | 1～6 | 外壳、权限、迁入和授权治理必须共同验证，不能单独合入无正式入口的权限改造或只有新壳的旧管理页 | 启动时查重建立/关联聚合Issue；保留子项验收；分支名使用codex/前缀并协调实际checkout，不现在切换 |
| CP-2 / PR-2 | 7～10 | 监控采集、拥有者读接口、面板、首页与保留清理共同形成可用观测链 | 依赖CP-1；前置合入并完成获准部署核验后再确认基线；不得把后置功能分支当主分支发布 |

每个单元一个尚未合并的PR；同范围修复集中更新该PR。内部小任务可以分批提交和审查，但不增加常规PR检查点。不得用两个PR限制省略SPEC/QUALITY、真实测试或部署核验。安全热修复或外部事实引起的额外PR需说明原因并协调，不能为保数量隐瞒缺陷。

实施前回读相关飞书需求及机器人初稿，仅对本范围查重和评审；没有真实记录就保存实际Issue草案/关联，不编造REQ、record_id或版本。台账写入需有效授权，不能因读取或建Issue自动回填。

## 2. 写集、接口与协调规则

下表路径均相对 qms-2.0/；新文件是拟创建路径，不表示已经存在。实现命令从该目录执行。每个任务先grep全部调用者、测试、fixture、导出和配置，冻结所属写集后再交子代理。

| 所有权 | 现有/拟新增文件 | 职责 |
| --- | --- | --- |
| 父代理 | apps/web/src/App.tsx、main.tsx、vite.config.ts；apps/api/src/app.module.ts；apps/api/prisma/schema.prisma及追加迁移；packages/contracts/src/generated/api.ts；governance/module-boundaries.json | 路由/样式接入、模块依赖、schema及契约生成统一串行 |
| 控制台外壳 | 新增apps/web/src/console/ConsoleLayout.tsx、ConsoleTheme.tsx、console.css、console-navigation.ts、ConsoleEntry.tsx；修改features/account/AccountCenterPage.tsx及导航 | 管理入口、布局、能力菜单、目标组织、无障碍、浮层主题，不复制登录 |
| 会话/导航 | features/auth/AuthenticatedRoute.tsx、LoginPage.tsx、SecurityPage.tsx、RequiredPasswordChangePage.tsx、api/client.ts、layouts/UnsavedChanges.tsx、work-tabs/workTabsStore.ts；新增features/auth/session-invalidation.ts及受控returnTo工具 | 共用会话/失效通知、窗口重验、登录/MFA/改密回跳、非敏感会话范围、管理页不污染业务标签 |
| 管理迁入 | features/admin/AdminPage.tsx及其实际子组件；features/governance/OrganizationWorkspace.tsx、ConfigurationAdministration.tsx、AuditAdministration.tsx、OutboxAdministration.tsx等 | 将旧聚合页拆成可定位的正式管理分区，复用原组件及操作保护 |
| 流程迁入 | features/workflows/WorkflowListPage.tsx、WorkflowDesignerPage.tsx、现有绑定面板；layouts/InternalLayout.tsx、features/navigation/navigation.ts | 保留全部定义配置功能与业务执行入口，替换旧路径/标签接缝 |
| 直属/迁移 | 既有[专项计划](2026-10-29-qms-organization-direct-position-legacy-authorization.md)第1～4节全部写集 | 沿A→B→C实现，不重复另造服务或权限模型 |
| 管理读模型/观测 | 新增apps/api/src/modules/system-management/system-management.module.ts、controller.ts、dto.ts、service.ts、api-observation.service.ts、api-observation.interceptor.ts、data-exchange-observation.service.ts；Worker事实入口在src/worker-runner.ts及各任务拥有者 | 真实context/概览、API聚合、交换观测注册与查询；跨模块只用公开读端口 |
| 正式面板 | 新增apps/web/src/console/ConsoleHome.tsx、ApiMonitoringPage.tsx、DataExchangePage.tsx、ServiceOperationsPage.tsx、console-api.ts | 生成契约消费、时间/范围/来源过滤、错误下钻、未接入与采集过期明确展示 |

任务2已采用更小的拥有者实现：console context实际位于identity/console-context.service.ts、console-context.controller.ts、dto/console-context.dto.ts并在identity.module.ts注册，不另建一份身份读取模块；后续system-management仅承接确需新增的观测/聚合。context模块同时声明scope与coverage：流程SESSION_HOME/ORGANIZATION，供应商账号和两类补配目录SESSION_HOME/PLATFORM，其余按真实TARGET资源范围，不伪换actor。

正式控制台路由统一为/console首页、users、organizations、master-data/suppliers|customers|materials|component-projects、configuration、workflows及workflows/:definitionId/:versionId、audit-log、outbox、reconfiguration、problem-reconfiguration、supplier-accounts、api-monitoring、data-exchanges、services。受控回跳保留旧/app/admin、/app/workflow-designer及真实业务动态深链，不随隐藏菜单而删除兼容。

### 2026-10-30 存量迁入核对表

下表来自当前 `AdminPage.tsx`、`WorkflowListPage.tsx`、`WorkflowDesignerPage.tsx` 及导航的静态核对，是后续迁入与回归清单，不表示已经迁入或验收。保留原组件的权限、危险操作、未知结果与未保存保护，不能只把旧聚合页整体嵌入新导航。

| 存量入口 / 组件 | 正式管理位置 | 不得遗漏的边界 |
| --- | --- | --- |
| users / UserAdministration | /console/users | 用户、任职、userId定位、目标组织权限与撤权回调 |
| roles / RoleAdministration readOnly | /console/organizations 内来源详情 | 不保留顶层历史授权页；按直属岗位专项提供兼容来源及迁移治理，不额外赋权 |
| organizations / OrganizationWorkspace | /console/organizations | 组织、部门、岗位、选择目标、目录刷新与失权；直属岗位另按A/B/C落地 |
| supplier-master / SupplierProfilesPage | /console/master-data/suppliers | 内部组织限制、档案读写权限、拒绝后清理 |
| customer-master / CustomerMasterSection | /console/master-data/customers | 客户档案读写权限与真实目标组织 |
| material-master / MaterialMasterPage | /console/master-data/materials | 读取、写入、导入权限分别保留 |
| component-project / ComponentProjectAdministration | /console/master-data/component-projects | 内部组织限制与组件项目映射读写 |
| configuration / ConfigurationAdministration | /console/configuration | 原配置读取和受控修改，不扩展额外生产开关 |
| audit-log / AuditAdministration | /console/audit-log | organizationId、resourceType/resourceId定位；非法或无权链接显式拒绝 |
| failures / OutboxAdministration | /console/outbox | 原失败队列和实际操作边界，旧section名称需兼容映射 |
| reconfiguration / AdministrativeReconfiguration | /console/reconfiguration | SESSION_HOME授权、PLATFORM目录；用户强删、组织/部门强删、目录刷新与拒绝回调 |
| problem-reconfiguration / AdministrativeProblemReconfiguration | /console/problem-reconfiguration | 真实问题责任恢复、平台资源目录及原危险操作保护 |
| supplier-accounts / AdminSupplierAccounts | /console/supplier-accounts | 全平台供应商账号清理，不能随目标组织伪造SESSION_HOME身份 |
| WorkflowListPage | /console/workflows | 搜索、状态、分页、新建、版本历史、初始化关闭审核模板、制程等8D绑定与供应商8D绑定 |
| WorkflowDesignerPage | /console/workflows/:definitionId/:versionId | 画布、节点属性、保存/校验/发布、已发布复制草稿、版本只读、关闭审核预览、冲突/未知结果；管理路由不能写入业务工作标签 |

旧 `/app/admin` 与 `/app/workflow-designer` 的导航隐藏、深链兼容和全部调用者仍需在迁入任务中测试；流程业务待办、审批、签章与绑定生产启用不因本次迁入扩大授权。

共享checkout开始实现前，由父代理与原聊天协调分支、索引、schema、契约和测试端口的所有权；本次策划不创建worktree、不切分支。若有其他来源新增修改，停止覆盖并核对归属；不得reset、批量恢复或混入问题管理提交。不能协调共享资源时暂停冲突写集，继续不冲突的已授权工作。

## 3. PR-1：完整控制台与治理迁入

### 任务1：范围清单、实际跟踪与视觉样例

- [x] 正式启动时读取交付/工具规则，核对HEAD、开放Issue/PR、已用及预留版本；REQ-0032/CP-1 Issue82/V0.0.36、CP-2 Issue83/V0.0.37已登记，一个单元一条尚未合并PR。验证影响规则按实际任务启动时读取。
- [ ] 逐项列出旧AdminPage全部页签、所有流程配置面板、旧深链接和每项实际能力；映射到设计第4节，不因迁移漏掉供应商账号、待配置、责任恢复、三类基础数据或组件映射。
- [ ] 在apps/web/src/interaction-preview/console/新增独立样例和测试入口，样例不接真实写API；以管理首页、组织/用户、流程设计验证外壳与复杂组件，涵盖浮层、中文、375/1024/1440、浅深色和键盘。
- [ ] 先写样例状态断言，运行确认RED；最小实现后完整文件GREEN。按已确认视觉方向完成内部自检和独立审查后迁正式页面，负责人在PR-1集中确认样例和正式效果；不另设逐页审批或第三个常规停点，不写成人工业务验收。
- [ ] 若主题适配需脆弱的大量内部选择器覆盖，记录三类页面的具体差距、替代成本和依赖许可，取得组件选型决定后推进；不静默引入整套shadcn依赖。

### 任务2：控制台能力入口和独立外壳

- [ ] 先新增ConsoleEntry.test.tsx、ConsoleLayout.test.tsx：平台、组织、仅workflow:manage、仅观测读取均可按实际授权进入；普通用户/供应商/过期身份拒绝；专项人员不因无users:read而被挡。
- [ ] 在Identity拥有者内提供GET /api/v1/admin/console/context，返回真实actor、可访问模块和管理目标；不下发令牌/秘密，不以用户名或前端开关授予权限。新专项读取能力由服务端目录受控维护，不自动授给存量账号。
- [ ] 为context新增真实API集成允许/拒绝及组织边界测试，确认RED后实现最小聚合端口；生成Swagger契约并验证，Web只从@qms/contracts取DTO。
- [ ] context为各模块声明TARGET/SESSION_HOME范围；流程定义/发布/绑定保持真实会话组织，UI锁定并显示范围。A/B两组织测试证明显示、读取、创建、发布和绑定一致，不伪换actor或默扩跨组织API。
- [ ] 个人账号加入用户点击的安全原生新窗口链接，浏览器决定窗口或页签；不伪造window.open返回检测，安全隔离优先于命名窗口复用。访问/刷新/复制深链接均重新验证，业务窗口不跳转。
- [ ] 接入独立主题、布局和能力菜单；旧入口及query定位转向新正式位置，保留resourceType/resourceId和目标校验，不把非法链接静默变成其他对象。

### 任务3：窗口会话、主题和未保存安全

- [ ] 新增session-invalidation.test.ts、ConsoleTheme.test.tsx及真实console-multi-window浏览器用例，先RED覆盖退出/账号切换、撤权、焦点重验、网络失败、原请求迟到、未知写入和未保存草稿。
- [ ] 共用Cookie会话与现有CSRF/近期认证机制；通知仅传失效信号，仍由getSession/context实查。不得发送token、表单正文或通过localStorage同步草稿；现有securityVersion撤会话规则保持。
- [ ] 将已知同源应用路径的returnTo及合法query贯穿登录/MFA/强制改密，完成后重验正式路由；拒绝外站/协议相对/非法编码/供应商进入内部控制台。测试无会话审计定位与流程版本深链完整回跳，不只测已有会话刷新。
- [ ] 管理主题覆盖正文/浮层/图表/画布，隔离业务全局样式和主题偏好写入；验证在业务窗口操作外观不把管理端变回业务品牌皮肤。
- [ ] 管理路由不创建业务工作标签；复用未保存/忙态/未知结果保护，退出或失权优先清敏，普通离页需明确放弃。控制台与业务窗口互不清空对方正常草稿。
- [ ] GREEN后做独立SPEC→QUALITY和父真实多窗口验证；窗口/页签由浏览器决定的差异如实记录。

### 任务4：直属岗位与兼容授权全链

- [ ] 完整执行专项计划A/B/C：先真实PG红灯，再nullable模型/DTO、ORM及SQL调用链、授予/目录/删除补配；不只取消部门必填。
- [ ] 真实测试QMS_ADMIN迁移前后平台范围、MFA、稳定roleCode、来源去重、最后管理来源防自锁；共享目标岗位全部人员影响与未确认来源不变。
- [ ] 真实测试锁后漂移、回滚、幂等/CAS、撤会话、审计、初始化来源不复活、历史流程/签章可读和存续账号不清MFA。
- [ ] 在组织岗位内提供迁移/清理和用户/岗位来源详情，移除顶层历史授权；独立SPEC后QUALITY，父完整文件/真实浏览器复验。不得执行生产转换。

### 任务5：所有既有页面与流程配置迁入

- [ ] 为任务1逐项映射清单建立console-navigation.test.tsx、console-migration.test.tsx和workflow-console.test.tsx：所有原功能有可操作入口，能力、深链接和目标范围不丢失。
- [ ] 将管理分区挂载既有真实组件，统一页头/筛选/表单/确认/反馈风格；不iframe嵌旧页，不保留一整排旧页签作为正式导航。
- [ ] 流程列表/画布/复制/校验/发布/内部与供应商绑定及提醒按现有全部功能迁入；保留CAS、未知原body/key、草稿、401403清敏和旧roleCode语义，不新增任意跳步或代审批。
- [ ] 基础数据维护保留实际业务岗位权限及必要业务入口，复用同一组件/服务，禁止复制第二套主数据；个人安全设置仍在账号页。
- [ ] 每个子面完成SPEC→QUALITY后整合；真实PG和浏览器验证编辑/取消/冲突/失权及业务端回归，不用静态截图证明功能迁入。

### 任务6：基础管理首页与PR-1

- [ ] 先写ConsoleHome.test.tsx及system-management.integration-spec.ts，覆盖有权事项/最近审计、无权总量不泄露、部分来源失败和统计时间；RED后实现拥有者公开聚合。
- [ ] 首页只显示真实可取得的事项和范围；无观测源不生成成功率/实时在线，不用浏览器遍历分页计算全局总量。
- [ ] 冻结CP-1源码与完整测试文件清单，运行第6节适用全门禁；专项双审及父独立检查后主动提交/推送并创建PR-1，附真实URL、Issue映射、版本、证据、回滚和剩余CP-2范围。
- [ ] PR-1核验精确head审查和全部CI并报告检查点；按2026-10-30最新正常推进授权到此停止，不自动合并部署或进入CP-2。旧夜间发布授权已撤销；失败或未取得证据不放行，不宣称完整面板交付。

## 4. PR-2：真实观测与整体收口

### 任务7：API观测拥有者、持久化与权限

- [ ] 新增api-observation.service.spec.ts和test/system-management/api-observation.integration-spec.ts：真实HTTP成功/拒绝/失败、标准路由标签、组织过滤、查询限界、采集失败及过期、清理和不记录原文；先RED。
- [ ] 最小追加聚合存储与受控查询DTO；按分钟聚合保留7天，时间/条数/标签基数有界，原URL/query/body/秘密不入库。API监控自身防递归，无无限异步落库，不影响业务事务结果。
- [ ] 外层HTTP完成观测覆盖守卫前401/403/404，interceptor仅补可信路由/范围；未经验证的组织ID不得来自query/body。无可信归属进UNKNOWN/UNSCOPED平台桶，组织读取者不可见；真实HTTP测试伪造目标组织、未知路由、监控自身排除和采集故障不影响成功业务。
- [ ] 以/api/v1/admin/console/api-observations提供只读分页/聚合，按真实能力和组织范围授权后查询；管理观测读权不隐含全平台scope或重放权。
- [ ] 采集失败明确表现监控缺口而非零错误；新增schema由父串行追加、生成和迁移，真实PG验证索引/保留清理与回滚兼容。
- [ ] 独立SPEC→QUALITY，父以真实HTTP/PG重测；没有采集链或只有测试插入数据不得记为完成。

### 任务8：数据交换观测及运行服务事实

- [ ] 新增data-exchange-observation.service.spec.ts及test/system-management/data-exchange-observation.integration-spec.ts，RED覆盖来源注册、跨组织拒绝、批次/记录归属、接收与处理成功分离、重复事件和有界保留。
- [ ] 实现内部注册的观测端口和/api/v1/admin/console/data-exchanges只读查询，记录设计第7节最小元数据，默认保留30天；来源端口不等于开放外部接收API，不建通用Webhook或凭据发放能力。
- [ ] 使用一次性真实HTTP发送/接收和Worker测试观测链，标明技术验证来源；外部业务连接器未接入时正式目录为空、显示未接入，不把fixture注册入生产。
- [ ] 复用task-notification、file-management及PDF任务拥有者的公开读端口，新增受限Worker执行回执；区分配置、最近结果、过期与未知。禁止任意URL/命令/SQL探测，不直接绕过其他模块服务读内部表。
- [ ] 原失败队列受控重试保原权限、幂等和审计；外部交换无已批准连接器就不出现可执行补传。清理观测不清审计、签章、原业务记录或保留上传。
- [ ] SPEC→QUALITY及父真实Worker/对象存储/扫描验证；所需服务缺失阻塞对应项，不能以Mock/Skip替代或宣称实时在线。

### 任务9：监控面板、安全审计与最终首页

- [ ] 先新增ApiMonitoringPage.test.tsx、DataExchangePage.test.tsx、ServiceOperationsPage.test.tsx及console-monitoring浏览器用例；覆盖筛选/分页/批次下钻/错误分类/时区/过期、无权/未接入/失败/未知结果。
- [ ] 消费生成DTO建设正式监控页，技术HTTP成功与业务处理/对账分别显示；审计与失败队列链接定位真实对象，不显示秘密或默认导出报文原文。
- [ ] 将真实观测与管理事项汇总到首页，按调用者能力过滤；来源失败分别显示，不因局部成功显示系统全绿。全局搜索只搜索获授权菜单/对象，不把敏感名称建无范围缓存。
- [ ] 沿三类样例规则横展所有管理分区，补中文长文案、主题、浮层、窄屏、键盘、401403/409/未知及切范围竞态，业务/供应商页面保持原设计。
- [ ] 独立SPEC→QUALITY后冻结整体源码；对CP-1全部功能加本单元观测做联合回归，而非只测新增监控。

### 任务10：PR-2、发布、验收与关闭

- [ ] 第6节全部适用门禁通过、阻断审查项清零后，主动提交推送PR-2；两个单元的实际Issue/REQ、版本、分支、前置PR和证据明确关联，不使用自动关闭业务Issue的关键词。
- [ ] PR-2主动报告检查点；按本次夜间持续授权，精确head审查及全部CI通过后合并部署，逐项核对main CI、迁移前加密快照、追加迁移、同SHA API/Worker/Web、健康、公网新契约/静态资源及管理入口行为。失败或部署不一致不得记为完成。
- [ ] 执行第5节最终矩阵，单列人工视觉及业务验收；负责人实际账号的生产岗位转换仍按指定批次另授权，不把隔离库测试转写为生产已迁移。
- [ ] 逐需求确认关闭/台账写入授权，先写证据再关闭/最小回填并回读；外部未接入系统保留真实缺口，不把整座面板完成写成全部外部联调完成。
- [ ] 同步FRONTEND-DESIGN、WORKFLOW-DESIGNER、SECURITY、OPERATIONS-RUNBOOK、CAPABILITY-STATUS及治理来源索引，依据实际差异沉淀规则；无新增规则记录理由。
- [ ] 核对任务自有容器/端口/标签/挂载后清理一次性资源，保留Git外证据和加密回滚资料；不global prune，不清预览库/保留上传。记录最终HEAD/部署SHA/限制和两个PR实际状态。

## 5. 最终验收矩阵

| 维度 | 必验事实 |
| --- | --- |
| 身份 | 平台、组织、流程专项、监控专项、普通内部、供应商；跨组织/停用/到期任职/MFA与近期认证 |
| 多窗口 | 新开/弹出阻止/重复入口/刷新深链、退出/切账号/撤权、焦点重验、网络失败、原草稿与迟到响应 |
| 视觉 | 首页、组织用户、流程画布及全部迁入分区；浅深色/跟随系统、375/1024/1440、中文长文案、焦点/键盘/浮层 |
| 授权治理 | 专项计划完整安全矩阵、最后平台来源、无重复授权、稳定roleCode/历史签章、原子失败和初始化来源不复活 |
| 现有功能 | 全部旧管理入口逐项迁入；流程定义/发布/绑定完整；业务待办/审批/附件/门户及基础数据维护不退化 |
| 观测 | 实际HTTP/PG/Worker数据、技术与业务成功区分、权限过滤、分页/时间/基数上限、缺口/过期/未接入、保留清理 |
| 发布 | 精确PR head/main/部署SHA及三服务/契约/资源一致；机器结果与人工验收分层，不假写PASS |

## 6. 验证命令与执行前置

所有新PowerShell先加载D:/WorkSpace/QMS-2.0-local/Enter-Qms.ps1；实现命令从qms-2.0/执行。真实集成前必须验证DATABASE_URL及依赖确属当前任务的一次性资源，显式拒绝55440；这些命令不是现在执行的授权。

修改级与PR冻结门禁：

```powershell
corepack pnpm check:archive-isolation
corepack pnpm contracts:generate
corepack pnpm contracts:check
corepack pnpm --filter @qms/api lint
corepack pnpm --filter @qms/web lint
corepack pnpm --filter @qms/api test
corepack pnpm --filter @qms/web test
corepack pnpm --filter @qms/api test:integration
corepack pnpm build
corepack pnpm --filter @qms/api test:worker-process:built
corepack pnpm --filter @qms/web exec playwright test
corepack pnpm check:governance
git diff --check
```

contracts:generate只在DTO变化后由父执行，提交生成api.ts；仅文档策划不运行上列业务命令。真实PG/Worker/浏览器先按任务完整文件RED/GREEN，PR阶段按工程工具冻结完整文件组合；不拆case拼通过，不擅改默认timeout/动效/全局预算。两个PR均触及平台边界，追加执行acceptance:phase-1及acceptance:phase-2，记录在FOUNDATION.md；Compose校验使用当前实际部署清单和Git外环境，不凭空写文件名或输出秘密。

本轮文档仅运行check:governance、文档边界测试与git diff --check。验证结果在本计划末尾记录，不把计划中的命令列作已通过。

## 7. 回滚与停止边界

- PR-1先保留旧入口兼容跳转和可回退布局，数据库只追加兼容迁移；不能通过回滚源码恢复已经解除的生产授权。资料转换必须有独立预览/审计和指定批次恢复方案。
- PR-2可停止采集并将面板标为不可用，不影响业务提交；不删真实审计/业务数据，不让故障采集器阻塞业务链。结构回滚按快照与迁移策略受控执行。
- 出现实际权限越界、最后平台来源可能丢失、历史版本重写、秘密泄露、必需真实服务缺失或共享写集冲突，停止对应推进并报告具体事实。
- 最新授权仅推进当前CP-1至PR检查点；不自动合并发布，不启动CP-2，不执行生产资料转换/业务启用。heartbeat已按负责人要求删除，不重建定时任务；取消定时跟进不等于中断正常开发，不向原聊天发未经负责人授权的消息。

## 8. 本轮策划验证记录

2026-10-29：本轮未开始运行实现、未创建Issue/PR、未分配新功能版本、未运行大套测试或操作生产；只修改设计/计划/导航与来源索引，保留本地未提交状态，不操作共享Git索引或推送触发部署。

- 首轮corepack pnpm check:governance通过：37份文档、422个本地链接、20份来源复核、151个模块依赖对及阶段五覆盖断言。
- 文档/治理边界首轮21项中20项通过；1项在临时目录写documentation-index.json时报EBUSY，未触及运行代码，未修改测试、预算或断言。
- 原样重跑完整test/documentation.test.mjs及test/governance-boundaries.test.mjs：21/21通过，退出0、无Skip；首轮失败保留，不称一次全绿。
- git diff --check首轮通过；计划自检无TODO/待定占位，直属专项与总计划PR归属一致，负责人常规停点仅PR-1/PR-2；源码、CI、部署和人工验收未执行。

## 9. 夜间开工记录（2026-10-29）

- 负责人先授权提交需求/启动夜间开发，再明确开发中状态及持续推PR、核验、合并部署循环；本摘要覆盖上节策划历史边界。20分钟heartbeat qms创建成功为ACTIVE，仅限REQ-0032，先核活跃任务不重复执行。
- 飞书按系统管理范围查重15条，has_more=false，无独立控制台同目标记录；新建一条REQ-0032/reczz28TGUdtjO7t，六个业务文本字段逐项回读一致。未写进度状态；后续rev328为开发中/P1，保留负责人云端实际值，不用创建时提交的P3覆盖。
- GitHub仓库当前公开、main为7fc80d4；全部既有Issue/PR81项及本地计划无V0.0.36以上占用，本轮登记V0.0.36/37并建立Issue82/83，不擅自改变可见性。PR尚未创建。
- 原聊天最近轮已完成且未加载，当前Git差异为本聊天文档；沿既有codex/org-direct-admin-planning，不切分支、不建异地worktree。父代理独占Git/索引/schema/生成，子代理仅写所分配新目录。
- 开工前邻近基线：corepack pnpm --filter @qms/web test src/features/navigation/navigation-access.test.tsx src/features/auth/AuthenticatedRoute.test.tsx，2文件23项通过，退出0、无Skip；不替代后续真实PG/Worker/浏览器和全量门禁。
- 实现子代理console_preview：只写apps/web/console-preview.html及src/interaction-preview/console/*，执行任务1的三类样例TDD。只读startup_spec_review独立评审计划和现有接缝；当前未形成实现完成结论。
- 独立开工评审startup_spec_review结论“优化后开工”：保留既有目标及验收强度，补TARGET/SESSION_HOME防选B读写A、守卫前拒绝观测及可信unknown归属、登录/MFA/强制改密全链returnTo三处技术接缝。已补设计、写集与具体断言，无需重新访谈或变更业务授权；该评审不替代各实现SPEC/QUALITY和真实验收。
- 父新建任务自有PG容器qms-console-20261029-pg（127.0.0.1:55582，qms.task=management-console-20261029，tmpfs），134链迁移成功；Git外test-runtime.json存测试配置不入Git。保留原停止的qms-n3服务，不擅自删除/复用。当前PG健康且保留供后续实现，不是可清理闲置资源。
- API context实现console_context_api：新增unit27/真实HTTP-PG24及邻近29，子报告80项通过；context_spec独立SPEC PASS→context_quality独立QUALITY PASS。父冻结六文件后直接重跑4完整文件80/80、退出0，原始日志parent-context-green.log与文件清单在Git外证据目录。父contracts:generate及contracts:check实际通过、提交生成类型由后续CP-1统一处理。生成过程构建API不等于全阶段验收。
- 样例console_preview：初始RED→8项GREEN，preview_spec_review PASS；QUALITY指出44px真实缺口，父IAB证实顶栏36px，正在TDD返修。争焦点反馈经父真实点击两次activeElement和新增真实user-event回归未复现，不改成已修故障。父已实际查看首页/组织/来源详情/复用画布、375/1024/1440局部几何和暗色，未替代完整键盘/正式业务验收；截图保留Git外。
- auth_return_to：受控router state贯穿登录/首次改密/MFA，无URL秘密或持久化token；实现者先RED→11文件151项通过，收窄enrollment内存副本后5文件107项通过。独立auth_spec发现遗漏正式/app/supplier-quality/eight-d/:UUID，已交原实现者按全部实际动态调用链补RED/GREEN；不以首批绿灯宣称当前完整认证已验收。
- 父Vite样例服务为127.0.0.1:5178、exec session18100；pnpm可执行shim启动失败已改用同一已安装Vite的node入口成功，不改依赖/配置。仅用于当前样例验证，自动唤醒先检查进程/端口，不重复启动。
- 样例最终44px覆盖普通显示名input（父先证实35.6px缺口后补选择器），preview_quality_review最终PASS；父完整样例文件12/12、exit0，原始日志parent-preview-green.log。父IAB于375px实测顶栏/查看/页脚/关闭/普通编辑input均44px，document宽360不整体横溢，preview-touch-375.json/png在Git外；截图不代完整设备可访问性验收。该子任务实现冻结，正式页面不得导入样例模块。
- 认证SPEC原8D遗漏已用精确UUID路径修复，横展真实动态路由和服务端协作链接，auth_spec复核PASS；子14文件185通过，父4完整文件113项exit0（parent-auth-return-green.log），仅覆盖该冻结版本。随后auth_quality发现P2：登录/MFA在途离页，旧POST回调仍导航旧returnTo；原实现者正在新增deferred RED并修存活/导航代次及秘密回填，旧113项不能作为返修后绿灯。
- console_shell新实现子代理独占apps/web/src/console/下8文件，先RED再实现正式布局/独立主题/生成DTO能力导航/范围守卫；父后续掌App、个人入口、跨窗口失效接线。没有创建功能占位正式页面或将CP-2观测提前标可用。
- 最新进行中任务仅auth_return_to（QUALITY竞态返修，14文件完整组合验证中）与console_shell（正式布局首轮11行为RED→10绿/1可访问名修正，补会话A→B→A及真实Router blocker后固定回归中）。父不得重开同任务或并发覆盖；ConsoleEntry个人账号按钮尚未实际派出，线程槽不足的派发失败不记为已启动，后续可用槽再交新实现者。
- 当前所有成果仍在原功能分支工作区未提交，父尚未做整体Web lint/build/阶段验收；治理来源hash需要在各子任务最终双审后按实际变更逐项复核同步，不盲刷所有来源，不把中途预期hash失败报作业务缺陷。新API已生成的api.ts是受控产物，不手改。
- 最新夜间授权已追加到Issue82/83真实评论，覆盖原Issue正文旧等待口径；来源见Git外github-night-authorization.json。新窗口样例当前IAB为本地console-preview，已保留handoff；自动恢复浏览器先读当前文档并重新获取实际标签，不猜旧元素ID。

## 10. 2026-10-30 夜间heartbeat接续

- 核对实际Git仍为codex/org-direct-admin-planning / af9f7a4，未提交差异属于本聊天分配写集，没有切换/推送/PR或生产变化。REQ-0032再次回读rev328开发中/P1，六个批准业务文本与提交快照一致；自有55582PG仍healthy。
- console_shell首版固定6文件48项通过并冻结，独立shell_spec发现P1：已验证A→B pending→回A pending会因可重复key复活旧A敏感children；另P2粗指针桌面侧栏40px遗漏。已交原实现者做完整target/path/session/refresh/invalidate代次横展及44px正确RED/GREEN；该48项不用于声称返修后PASS。
- auth_return_to迟到mutation正确RED覆盖10失败/1通过，最小生命周期/导航代次守卫后新增链曾全部通过；完整14文件组合11916为196通过/1失败（原AuthToolbar10000ms超时，未改原文件），完整单文件诊断5/5退出0。随后同一14文件组合30743新增logout场景10541ms超时，发现一条it串成功/失败两个完整StrictMode场景；当前只将本轮deferred场景改成独立参数化case，保全部断言/默认预算/motion，不跳过、不调高超时，保留失败历史。最终组合尚未通过，不提交PR放行。
- 父本轮未同时启动Web测试、lint或build，不将正常开发返修当作需负责人决策的阻断；继续由现有auth_return_to和console_shell执行，不重复创建相同任务。个人账号入口代理尚未成功启动（槽位限制），不能把派发失败说成已实现；待槽释放再新派。

## CP-1 收口增补（2026-10-30）

- 负责人要求本检查点同步落实部署后builder prune。最小变更为实际部署健康核验及deployed-sha记录后、最终成功日志前，在既有部署锁内执行`docker builder prune --force`；只清默认dangling builder cache，不加`--all`，不清镜像/容器/卷/业务上传/备份。默认builder缓存不是Compose项目隔离，后续构建可能失去缓存；不承诺完全解决所有磁盘占用。
- 清理失败明确输出部署健康但缓存清理失败，保留deployed-sha且退出非零，不宣称业务已回滚；前序部署失败不执行清理。实现TDD红3/5、绿含备份11/11，独立SPEC→QUALITY均PASS；父验证另记录。未SSH、未生产部署、未真实prune或测量回收量。
- API/Web lint、build、契约五步真实exit0；构建仍有既有大chunk警告，无调高阈值掩盖。完整Worker第一次7/8，通知计数失败现场保留，由真实任务/通知链诊断。
- 正式浏览器工具返回`privileged native pipe bridge is not available; browser-client is not trusted`；不通过替代通道绕过拒绝。该项不是浏览器PASS，视觉/多窗口正式验收仍缺证据，不能以静态样例或jsdom替代。
- qms heartbeat已由应用工具确认删除；本轮继续正常开发，不等待下一次唤醒。

### 宿主异常与恢复（2026-10-30）

- 父独立部署控制流含备份完整11/11、无Skip通过（parent-deployment-prune-green.log），未执行真实Docker清理。
- 全Web尝试未产出case结果，随后明确出现Windows `os error 1455`（页面文件太小），既有exec丢失。恢复后系统LastBoot为2026-10-30T08:57:28.5+08:00、无旧vitest/jest存活；全Web原轮记未完成，不记PASS，也不重启正常活跃任务。保留原日志，改为已冻结11完整文件组合收口，宿主资源不足不等于业务测试通过。
- 任务PG使用tmpfs，宿主重启后必须重验身份、数据库及136迁移前置；未核实前不复用旧连接即跑验收。

### 收口门禁现状（2026-10-30，非发布）

- 11完整Web父联合264/264、exit0，修后完整组合成立；旧263/264及原超时保留。workspace根通配82/82、无Skip；归档隔离和治理真实PASS。
- Foundation与scanning Compose配置exit0；production叠加首次缺NPM_DOCKER_NETWORK失败，补仅配置验证占位网络名后exit0。没有创建该网络或部署服务，不能作云端网络实测。
- 阶段一/二入口已实际尝试并FAIL于缺少完整隔离验收环境；parent-cp1-phase{1,2}-preflight.log保留，未执行项不是PASS。旧子任务runtime不冒充完整三库/网关/邮件/MFA/浏览器验收资源，后续仍需补齐。
- 当前尚无CP-1提交/PR/CI/部署；未完门禁不能改成已发布或人工验收。

- 重启后真实资源核验：三个task容器曾Exited255，已仅恢复本task容器；PG tmpfs已重置，旧累计失败数据库及fresh数据库内容丢失，只有Git外原日志/hash保留，不能再声称旧数据库现场仍可读。Worker诊断沿相同runtime重建唯一task fresh库并部署原136迁移，不触碰55440、其他数据库或生产。

### 提前进入草稿PR审查（2026-10-30）

负责人再次明确开发完成即推进PR。本轮立即冻结已审实现、提交推送创建CP-1草稿PR，将未完成全量集成/全Web和正式浏览器/阶段门禁列为阻断Ready/合并的检查项，而非继续仅本地等待。此动作不降低门禁、不把已有FAIL改PASS，不中断绑定exec94589的正常Web执行，不自动合并部署。分支同时保留既有V0.0.35两份文档归档/方案提交历史，不重写或强推。
