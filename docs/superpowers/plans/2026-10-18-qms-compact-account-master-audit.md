# QMS 紧凑界面与账号、主数据、审计实现计划

## 当前摘要（2026-10-19，Asia/Taipei）

- 后续人工反馈：负责人已确认账号概览整合、单一会话表及全页留白进一步减半，接续 [V0.0.21 返修计划](2026-10-19-qms-account-overview-density.md)。下列“无未完成开发项、仅剩人工验收”是原版交付结束时的历史判断，已被此次已批准返修更新；当前仅本地，未推送或部署。

- 批准：负责人指令“我更新了进展，推进开发中条目”，随后对已列明的四单元规格确认“范围没问题”；本次回读飞书 revision 248，五条 REQ-0017～0021 仍为开发中。批准内容与 record_id 见下表及 Git 外快照；P3 不纳入。
- 设计：[本轮设计](../specs/2026-10-18-qms-compact-account-master-audit-design.md)。独立评审以当前源码为准，采用现有会话历史、前端分块导入、安全账号摘要，未采用草稿中的新历史表、异步任务及新增姓名字段。
- 源码：活动checkout已快进到已部署main `c7dc86b21ba6bb72cea3c3ccfabda1955e26de90`（V0.0.20）；Node24.21.0/pnpm11.19.0。原8a86b28是开工历史基线。
- 授权：原范围开发、PR、合并与上线已完成；负责人确认仓库恢复私有后要求按原计划继续收口。本次更新本地证据、清理明确的一次性资源；Issue关闭和飞书写入仍待最终人工验收及对应授权。
- 版本：核对远端 main、本地全分支提交、开放 Issue/PR 与计划预留，当前已用最大修订号 V0.0.15；预留 A V0.0.16、B V0.0.17、C V0.0.18、D V0.0.19。提交前再次核对。
- 证据：原主题/顶栏/账号四文件基线 30/30 PASS；Git 外 `req17-21-baseline-web.log`。账号中心现有 List/Space 弃用提示保留，MAINT-001 尚未关闭。
- 分别状态：REQ-0017～0021均已实现并上线，PR48～51全部合并；V0.0.20 PR53也已合并部署。最终main `c7dc86b`，Foundation39207200414、Deploy39207880874均PASS，快照/迁移/完整镜像SHA/健康/HTTP/契约/资源已核验。无已确认的未完成开发项；仅剩最终真实登录业务界面人工验收及获准关闭/回填。C旧失败保留且未重跑。
- 真实资源：原一次性PG55457/存储55458/扫描55459/邮件55460、55461用于本轮验证；四容器和两个专属匿名卷已清理。创建及失败日志保留，未触碰55440。

| 单元 | 需求与 record_id | Issue | 分支 / PR | 依赖与所有权 |
| --- | --- | --- | --- | --- |
| A 紧凑规范与横展 | REQ-0021 `reczz28OqtMgRSZ3`；REQ-0019 的文案横展 `reczz28OqjBueo3s` | [#47](https://github.com/JasonShu0722/QMS-2.0/issues/47) | `codex/req-0021-density`；[PR #48](https://github.com/JasonShu0722/QMS-2.0/pull/48)；部署 `31d0b657` | theme、共享 CSS、工作台与有限页面文案；不写个人账号/导入/审计组件 |
| B 个人账号 | REQ-0017 `reczz28OqQFFRMxc`；REQ-0018 `reczz28OqWvCVFx7` | [#44](https://github.com/JasonShu0722/QMS-2.0/issues/44) | `codex/req-0017-0018-account`；[PR #49](https://github.com/JasonShu0722/QMS-2.0/pull/49)；部署 `47db5bee` | identity、account、安全内容与顶栏；统一契约/语言/API client 由主代理整合 |
| C 主数据 | REQ-0019 `reczz28OqjBueo3s` | [#45](https://github.com/JasonShu0722/QMS-2.0/issues/45) | `codex/req-0019-master-import`；[PR #50](https://github.com/JasonShu0722/QMS-2.0/pull/50)；main `395acc27`；main CI attempt6 PASS；部署39188014390 SSH超时失败，负责人要求不重跑 | 三领域页面/导入/共享导入器；共享导航、语言由主代理整合 |
| D 审计 | REQ-0020 `reczz28OqnwIjwgy` | [#46](https://github.com/JasonShu0722/QMS-2.0/issues/46) | `codex/req-0020-audit`；[PR #51](https://github.com/JasonShu0722/QMS-2.0/pull/51)；原运行代码 `b836b02`；当前原分支已接续main，最新head以PR为准 | audit-query/export、AuditAdministration；契约与语言由主代理整合 |

## 实现步骤与文件责任

> 使用项目 QMS Superpowers 路由及子代理驱动开发；主代理提供完整任务与文件边界。独立文件并行，共享 Git / 契约 / 文档串行；冻结对应源码后执行整合验证。

### 任务 A：统一密度

- [x] 建立 A Issue #47，记录间距标准和横展清单。
- [x] 先为共享密度 token 与既有主题行为补充真实失败断言，再修改 `apps/web/src/theme/`、`layouts/shell.css`、`workbench/workbench.css` 及正式领域 CSS；保留控件/触控和响应式。
- [x] 梳理页面实现说明，删除冗余文案，保留安全、错误、权限、未保存与必要导入规则；记录每处处理或例外。
- [x] 同步统一设计规范和 FRONTEND-DESIGN，完成主题、顶栏、工作台及受影响组件测试、类型检查与构建。

### 任务 B：个人账号

- [x] Issue #44 已固定范围，实施前回读五条授权与目标；接续时 revision 248 未变，负责人再次确认范围。
- [x] API：先补 `apps/api/test/identity/` 历史分页及真实 PG 允许/拒绝测试；修改 `session.service.ts`、`account.controller.ts`、`dto/account.dto.ts`。本人过滤、有界分页、安全投影、稳定排序；不改数据库与保留期限。
- [x] 主代理生成并检查 contracts，新增生成类型导出及 `apps/web/src/api/client.ts` 历史请求。
- [x] Web：先补顶栏/账号/弹窗测试，再实现 EN/CN、头像顺序、改密弹窗、账号信息与安全整合、历史分页。修改 `layouts/ShellHeader`、`features/account/`、`features/auth/SecurityPage`；统一语言条目由主代理整合。
- [x] 验证旧锚点无错误、首登挑战不变、改密与撤销语义、双门户及安全秘密清理。

### 任务 C：主数据

- [x] 建立 C Issue #45，固定前端分块方案与独立幂等/中断语义。
- [x] 先写超过 100 行、请求体边界、进度、取消/继续、未知网络结果同 key 重试、离开保护测试。
- [x] 修改 `features/imports/`、三领域 Import 与清单页；新增/导入弹窗，按行数与字节预算分块，保留原全局行号和逐行结果；不改服务端安全限制。
- [x] 主代理整合相邻导航与中英词条；验证组织切换、无权限及既有编辑/导出/关系。

### 任务 D：审计

- [x] 建立 D Issue #46，固定动作解释与安全操作人摘要，排除新建姓名字段。
- [x] 先写真实 PG 隔离/系统与失效操作人/CSV安全与权限测试，再扩展 audit-query/export DTO 与服务。
- [x] 主代理生成 contracts；改造 AuditAdministration 紧凑筛选、中文动作/账号列、具有目标账号读取权限的定位链接。
- [x] 验证原筛选快照/5000上限/仅创建者下载、公式防护、组织范围与账号定位。

## 验证、审查与交付检查点

- [x] 各任务 TDD 红绿灯及邻近回归；记录命令、真实结果与 Git 外日志。
- [x] 各单元独立规格审查通过，再进行独立质量审查；反馈返修后复审，不用实现者自审替代。
- [x] 冻结源码并验证API/Web、真实PG/Worker、构建、契约、治理、归档/Compose/diff；最终完整主线CI39207200414通过，早期失败保留。
- [x] 按单元文件与基线串行提交；每个 PR 核对独立差异和依赖，前置布局作为显式堆叠 base，不能将混合快照结果当各 PR 独立 PASS。版本再次查重。
- [x] 推功能分支、创建 PR 并附当前聊天；普通关联 Issue，禁止自动关闭关键字。核对最新 PR 检查。
- [x] 获准合并发布并逐版本核验；最终V0.0.20 c7dc86b部署39207880874，快照/迁移/镜像/健康和公开接口资源检查通过。
- [ ] 最终包含四单元的版本逐 REQ 和联合回归：双门户、六主题、1440/1024/390、中英文、键盘、未保存、导入与权限；浏览器不可用时交付手工清单并保持待验收。
- [ ] 最终验收后获准写证据→关闭 Issue 并回读→最小回填五条需求并回读，失败保留接续点，不自改阶段权限。
- [ ] 沉淀统一规范/FRONTEND-DESIGN、ACCOUNT-ADMINISTRATION/SECURITY/OPENAPI、相关主数据交接及 FOUNDATION，更新文档索引与来源摘要；MAINT-001 来源变更需复核但无真实关闭证据保持开放。

## 影响与回退

API 为本人历史读取与审计安全响应/导出增量，历史事实只读；不增加新权限、状态表、后台任务、外部同步、生产数据操作或新依赖。导入的失败/重试可能部分已提交，必须保留原键与结果，不能以重试创建重复数据。前端回退仅还原界面，已导入数据、历史会话与审计保留。未触及头像扫描/邮件/Worker领域实现，不把其原有通过证据冒充本轮新测试。

## 接续审查记录

- B API 规格审查：独立子代理 Archimedes（`01a14f94-c236-7ee1-91f5-4556a734bbc8`）核查控制器、服务、DTO、单测与真实 PG 测试，结论符合，无 P0/P1/P2 阻断。确认本人隔离、完整认证、分页边界、RepeatableRead、安全投影和原撤销语义。旧日志单测 42/42、PG 26/26 仅作为既有证据，本次未复跑；精确到期边界与并发写入快照测试为 P3 补强建议，不能据此扩大通过范围。独立质量审查待完成。
- 中断处理：前任子代理额度失败的未提交内容全部保留；接续实现与原文件所有权一致。Git、共享契约、语言与文档仍由主代理串行整合。未将“范围没问题”记为功能或浏览器验收通过。

## 最终候选人工界面验收清单（待执行）

前置版本：线上V0.0.20 `c7dc86b21ba6bb72cea3c3ccfabda1955e26de90`，入口 https://qms.bigshuaibee.cn 。使用获授权内部管理员、受限账号与供应商账号，记录浏览器和视口。以下全部待人工业务验收；CI截图和部署成功不替代本清单。

| 项目 | 页面与操作 | 可观察预期 | 当前结果 |
| --- | --- | --- | --- |
| A 双门户密度 | 工作台及主要业务页，1440/1024/390 宽度，六主题，中英文 | 页边距与卡片/表格间距统一，无重复留白；窄屏无遮挡，触控目标可用 | 待人工验收 |
| B 顶栏 | 内部与供应商门户，切换语言/外观，键盘遍历 | 公告、语言、外观、最右头像顺序正确；登录页原入口正常 | 待人工验收 |
| B 改密弹窗 | 任意业务页从头像打开，输入后关闭/取消，提交错误及成功 | URL/原页面保留；未保存确认、生效期禁关、错误输入保留、关闭清秘密与焦点恢复 | 待人工验收 |
| B 个人账号 | 账号中心查看资料、安全与历史，翻页并撤销其他有效会话 | 仅本人记录；状态与到期一致；集中 MFA 治理、头像扫描、首登挑战不变 | 待人工验收 |
| C 维护弹窗 | 平台管理三个相邻清单，新增/编辑/导入及未保存离开 | 权限范围正确；客户只写账号可新增；物料读/写/导入互不推定 | 待人工验收 |
| C 大表与失败 | 导入超过 100 行以及含长文本文件，检查逐批请求/进度/行号 | 每批行数/字节受限，全局行号正确，已提交结果真实保存 | 待人工验收 |
| C 重试与停止 | 在途请求确认停止或取消停止，模拟网络结果未知及刷新失败 | 当前请求结束后停止；同内容同键重试；回执不被刷新错误清空，无虚假回滚 | 待人工验收 |
| D 审计 | 筛选、更多条件、导出，检查动作说明与账号摘要 | 桌面紧凑，查询/CSV含义一致，原事件信息保留；缺失摘要不误称系统 | 待人工验收 |
| D 定位权限 | 有/无目标组织账号读取权限，点击账号链接及无效定位 URL | 有权精确定位；越权、重复、失效目标明确拒绝，不打开另一账号 | 待人工验收 |
| 联合保护 | 从未保存账号/导入/权限矩阵切组织、切页面及审计 query 跳转 | 取消保留原草稿和范围，忙碌时不切换；确认后才离开 | 待人工验收 |

反馈逐项记实际版本、角色、操作与 PASS/FAIL/未执行；失败保留现象及脱敏证据，不批量勾选其余项目。

## 2026-10-19 接续诊断与证据

- B 会话 P2：初始读取过期仍设置 loaded，误显示暂无会话；独立 sessionsLoaded 后复现测试及账号 16/16 通过。新证据需随最终 Node 24.21.0 全量套件复核。
- A 对比度 P2：选中工作标签与悬停标题改用 accent-text，六主题普通文本对比断言通过；独立质量复审无阻断。
- Admin：页面专用矩阵确认与共享 guard 重复，已只保留共享 guard。中途错误地把测试 mock 内嵌组件重建导致的 dirty 注销当作产品竞态，增加的共享 hook/PermissionMatrix 修改全部撤去；mock 改顶层状态，取消后草稿保留及第二次导航单次确认均通过。旧真实矩阵 fixture 补真实 Provider。
- 真实资源定向：Node 24.21.0，一次性 PG 55457/对象存储/ClamAV，session-history、audit-query/export、avatar、supplier-master-workflow、supplier-asn 六套 57/57 PASS，日志 req17-21-pg-final-focused-2.log。较早全集为 78/81 套通过（三项失败含超时与 ASN 409），保留原失败；负载下第一次定向因审计事务超时且进程中断，不计 PASS。最终全量结果待补。
- 运行时：早期未加载入口导致 Node 22 下的定向结果仅为诊断证据；所有最终门禁从 Enter-Qms.ps1 启动，Node 24.21.0/pnpm 11.19.0。
- 授权回查：Git 外 req17-21-deploy-auth-recheck-2.json，只读成功，五条仍开发中且批准五字段未实质改变。第一次 CLI 因内存分配失败，没有取得记录或执行写入。
- 未将 CSS fixture、源码审查、用户范围确认、测试启动或未完整输出的进程计为真实业务浏览器 PASS。最终候选人工清单仍待实际版本及反馈。

- 当前审查：C规格/质量均通过（19冻结文件匹配）；B草稿恢复复审通过；Admin质量复审无阻断，no-provider独立宿主及replace历史为P3；D已有规格/质量通过。公共翻译随B预置C/D词条，API client及生成契约按单元分开；C先提交相邻导航，D再提交账号定位与真实Provider矩阵夹具。
- 当前独立快照：A ef810dd / PR48、B 8e579e8 / PR49、C 3d44fff / PR50；堆叠base明确，前置部署后更新main基线并复核。A的CI已通过checks/API unit及部分Web分片，其余运行中；不能据此先合并。
- Node24最终本地：A主题/工作台13/13，B账号＋真实矩阵45/45，Admin定位及共享guard49/49，Web build通过（既有大包提示），governance通过。全量Web多次因本机资源/超时未完成或失败，最终以各提交CI全部结果补齐，不能记为本地全集PASS。

## 发布接续实录（2026-10-19，Asia/Taipei）

| 单元 | PR最新源码检查 | main与部署 | 实际核验 |
| --- | --- | --- | --- |
| A / V0.0.16 | PR48 / ef810dd / CI39150323034 success | 31d0b657 / mainCI39150940325 / deploy39151587587 success | 加密快照验证、101迁移无待执行、API/Worker/Web健康；HTTP200，index-C83V3G9s.js、index-6FsIOYwN.css，密度与accent-text标记存在 |
| B / V0.0.17 | PR49 / a9eb045 / CI39151261515 success | 47db5bee / mainCI39152046356 / deploy39152712419 success | 同上部署门禁；HTTP200，index-Bp0NKiP6.js、index-Ct7coGGV.css，本人历史契约存在，匿名历史401 |
| C / V0.0.18 | PR50 / 8b7e2ff / CI39151268693 success | main395acc27；mainCI39153238102因账单限制未执行，部署阻塞 | 22文件差异，main内容树与B基线相同后合并；尚未上线；attempt1/2均无步骤、同一账单错误 |
| D / V0.0.19 | PR51 / b836b02 / CI39151275101 success | 待C部署后接续 | 真实审计/账号定位/矩阵保护已复审；本次文档状态更新不改变运行源码 |

四单元最新PR的完整Web四分片、API单测、真实PostgreSQL、扫描/存储、Worker生命周期、契约/治理/归档及Compose均在CI实际通过；本地原失败/中断日志仍保留，不转录为本地全集PASS。B的导航语言调用方遗漏在CI暴露，用EN radio更新两处旧下拉交互，15/15本地通过且独立复审未改变导航/授权断言；fix传播至C/D原PR。

线上只读核验脚本与结果在Git外req17-21-verify-http.mjs、req17-21-{a,b}-deployment-http.json；只证明HTTP/公开契约/资源，未创建生产业务数据，也未证明真实登录后的浏览器业务验收。

## 当前外部阻断与恢复点（2026-10-19 02:22，Asia/Taipei）

- C主分支Foundation run [39153238102](https://github.com/JasonShu0722/QMS-2.0/actions/runs/39153238102) 的所有job都未启动，第一次checks job117751044750的注释明确：`The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings`。
- 通过已有Git认证只读读取注释，凭据仅在进程内使用，没有输出或写盘；受支持连接未提供该注释路径、浏览器连接不可用。失败job没有日志，未将404解释成测试通过。一次受控重跑后attempt2的checks job117752596864仍是同一注释，没有测试步骤。Git外证据req17-21-actions-billing-blocker.json。
- A/B生产保持已核验版本47db5bee；没有部署C，也没有合并/部署D。不能将PR源码CI通过改写成C/main CI通过，或从生产跳过门禁。后续文档HEAD的阻断与运行代码的既有绿色结果分别记录。
- 已创建当前聊天每小时跟进`req-0017-0021`，每次至多一次重跑受阻检查，同一账单限制时安静；恢复后按既有批准接续C/D，全部部署核验后暂停跟进。它不接其他需求，不增加支出额度，不更改付款或检查规则。
- 负责人所需动作是恢复GitHub账户Billing & plans/Actions可用性。此项外部账户动作不在本次代码/发布授权内；本轮未付款、未改额度、未安装替代runner、未关闭任何检查。Issue44～47保持开放，飞书无写入，最终真实业务浏览器人工清单保持待验收。


## 2026-10-19 D 合并前云端审查反馈返修

- 原 PR51 已知三条云端 P2，主代理当前源码核对后纳入同一批准目标的纠错，不另接业务需求。当前 head `e40f543` 的 CI 不能覆盖尚未修复行为，返修后集中推送一次再完整验证。
- D1 审计动作标签：已有服务发出的业务动作（例如 ANNOUNCEMENT_CREATED、CUSTOMER_MASTER_UPDATED、MATERIAL_MASTER_UPDATED、SUPPLIER_PROFILE_UPDATED）应有中文说明；真正未知动作仍原码回退。实现者负责 `audit-event-read-model.ts` 与同目录对应单测；遍历现有发出动作及动态动作来源，不引入猜测翻译或重复领域事实。先失败测试、最小显式标签与覆盖校验，再绿灯。
- D2 账号定位历史：用户点击定位链接应新增可后退条目；Back/Forward 进入另一定位时，在未保存确认前不得覆盖目标条目，取消保留当前草稿和可再次使用的历史，确认后才改变范围。实现者只负责 AdminPage.tsx、AdminPage.targeting.test.tsx 和必要的同前缀历史专项测试；复用现有导航保护，不改共享权限语义、不扩展路由基础设施或引入依赖。先用真实 MemoryRouter 多条历史与共享 guard 复现，再最小修复。
- 主代理串行管理 Git、文档/索引和最终整合，两个实现者写入范围分离；无生产操作、无新数据库。原 18 项真实 PG 的业务读取/导出结构未变，但仍须最新完整 CI 的真实集成结果。返修先独立规格审查再质量审查，最后只推原 PR；未解决反馈不视为已通过。


### D2 根因核对后的最小共享扩展

源码确认正式 App 使用 BrowserRouter，现有共享 guard 只能在点击时拦截，POP 已发生后覆盖 URL 会破坏历史；已有 React Router 的 useBlocker 要求 data router。因此允许同一实现者在原 D2 之外修改 `apps/web/src/App.tsx`、`layouts/UnsavedChanges.tsx`、`layouts/UnsavedChanges.test.tsx`，必要新增 App 路由测试；不改变正式路由地址、认证/门户边界、Language/Theme/Reauthentication Provider 语义，不引入新依赖，不改业务权限。

- 保留现有路由组件和布局，使用已安装 React Router 的 createBrowserRouter/RouterProvider 提供原生导航阻塞。
- 共享 guard 在导航发生前拦截 PUSH/POP/REPLACE，忽略不会改变业务范围的同 pathname/search 的 hash 变化；取消使用 blocker.reset，接受使用 blocker.proceed，不能通过 replace/push 重建历史。
- 保留通用 requestLeave 的本地表单/组织/工作标签关闭行为；显式已确认回调里的同步导航不得重复弹窗，不让该确认成为后续任意导航的通行证。导航和本地确认共用单一确认状态，重复导航不得覆盖已待确认的目标。
- AdminPage 注册 busy 保护：忙碌期间不切路由或组织；busy 结束后处理最新待切换目标，若有 dirty 则单次确认再放行。hash-only 不重新激活已消费账号定位。
- 生产 data router 是本次完整回归对象。已有纯组件 MemoryRouter 宿主可保留兼容路径，但不能用其结果替代正式路由阻塞证据；以共享 guard 和 AdminPage 的 createMemoryRouter 测试覆盖链接、Back/Forward、取消/接受、忙碌、单次确认、重复请求与原有调用方。
- 实现者先核对所有 requestLeave 调用方，若还须修改业务调用方或更多测试宿主，先报告实际原因和最小文件列表。主代理统一文档与 Git，冻结后独立双审、Web 类型检查/构建、相关调用方回归及完整 CI。


## 2026-10-19 额度接近上限，切换模型前接续点

负责人要求尽快收尾当前修改、切换模型后继续。本次不再启动完整CI、推送、合并或部署。

- 当前分支 `codex/req-0020-audit`；已推送 HEAD `e40f543a3378cfc8ae466c57044965a1dc7017e6`，PR51 base=main395acc27；旧CI39190126869已取消，不能作为通过证据。以下返修仍在本地未提交。
- D1 已完成：三个owned文件补齐当前251个实际审计动作的中文说明（255个标签，含4个保留项），未知/原型键原码回退不变。红灯留存，API定向3套35tests PASS（`release-d1-green.log`）；独立规格审查代理 `01a15211-d4ac-7833-b04c-e9a948ba2326` PASS。质量轴、主代理独立验证、最新完整CI仍待接续。
- D2 尚未完成：已补History和data-router红灯测试，生产App/Unsaved/AdminPage的共享路由修复待实现/完成。`release-d2-green.log` 是NOT_RUN/NEEDS_CONTEXT，不是通过；以切换前Git外handoff和实际diff为准，不将新增红灯测试状态写成已修复。
- C main完整CI attempt6 PASS，但部署39188014390 SSH timeout/exit255，生产最后由负责人10:22确认仍为B47db5bee。负责人要求不重跑该失败部署，继续源码工作，下次部署再验证。未操作生产进程/缓存/配置，磁盘95%及孤儿构建可能性保留为运维待查。
- PR53仍为原草稿（head8e1ba4c），实现及旧独立双审通过，但没有基于修复后D的完整检查；D合入后再接续base、完整CI及获准合并。
- 下一模型先读 `D:/WorkSpace/QMS-2.0-local/release-model-switch-handoff.md`、Git外req17-21-release-checkpoint.json和本段，核对实际diff/HEAD后继续；保留当前未提交源码及失败测试，不回退、不重复建Issue/PR、不用旧PASS。


## 2026-10-19 私有仓库期间本地接续

负责人最新要求“已经闭源了，你继续推进，直到需要云端CI以及需要action的时候”。已核对dirty文件均属于上次留存范围，保留原红灯与快照，不回退或重建分支。

- 本地工作范围仍为D1标签返修与D2原生导航阻塞。D1已独立规格PASS，本轮补独立质量审查；D2重新确认既有红灯后实现，完成后独立规格及质量审查。
- 本机只运行受影响门禁：审计定向单测、正式data router/共享guard/AdminPage测试，以及AccountMenu、WorkTabs、ShellHeader、导入离开保护与权限矩阵等现有调用方回归；再串行Web类型检查/构建、contracts:check、workspace治理和归档隔离。未改DTO/迁移/权限读取，因此不重复启动原整套真实数据库资源；完整真实PG/Worker和四分片CI仍是推送后的必需机器证据，不能以本地定向PASS替代。
- 所有验证冻结对应源码后执行，不重复跑已经被较大组合完整覆盖的子集；失败先按实际根因返修再复验，日志保留Git外。完成时记录实际PASS/FAIL/未执行，不把本轮完成误写为PR/上线完成。
- 当前用户限制优先于早期自动接续：任何定时跟进也必须遵守本地边界，不因旧“仓库公开”或合并授权描述触发CI/部署。原C失败保留，生产最后确认47db5bee，不重跑失败部署。


### D2 本地调用方回归追加（私有期间）

正式data router回归发现：成功logout的API回调异步navigate('/login')被仍注册的草稿挡住（`release-d2-resume-logout-red-2.log`）。同一共享guard迁移根因下，最小扩展仅允许 `features/account/AccountMenu.tsx` 和对应测试：成功会话终止路径能够离开；失败/取消保留草稿，不全局豁免/login或清除全部dirty，不留下任意后续导航许可。实现前已有明确红灯，返修后与个人菜单/共享guard邻近测试统一复验。其余业务调用方无证据不扩范围。


### D2 待确认导航优先级澄清

React Router 7.18.4 在一次待确认导航中完成另一次 hash-only 导航会重置 blocker，原 proceed 随后抛出 unblocked→proceeding。已用明确红灯复现；采用最小规则：已有待确认目标优先于所有后续导航（包括 hash-only），直到确认/取消；不存在待确认时，普通 dirty 或 busy 下 hash-only 仍允许。此规则不重建历史、不重放URL，也不新增路由许可；测试覆盖先后顺序和原目标放行，14项guard绿灯。此处是原“保留首次待确认目标”的具体边界，不将hash-only允许误解为可以销毁已待确认目标。


### D2 规格复审结果

原 P2“busy 队列账号目标随后被 hash-only 请求覆盖”已修复：共享 blocker pending 继续优先阻塞；`onBlocked` 对已排队目标仅允许真正改变 pathname/search 的新目标替换，hash-only 不覆盖。新增 busy→scope target→hash→busy结束的 accept/cancel/clean 三分支测试，shared guard 当前 17/17 PASS。原 native blocker、历史保留、logout、hash-only普通路径仍覆盖；最终质量审查和完整Web回归限制保留。


### D2 质量审查卸载残留忙碌返修

独立质量轴发现矩阵保存中目录刷新/撤权卸载真实PermissionMatrix，而AdminPage仍保留，旧onBusyChange缺卸载清理导致全局导航busy残留。补真实AdminPage+PermissionMatrix+data-router两条回归，刷新与撤权均先红灯；最小修复仅在矩阵busy effect清理时向原回调报告false，旧异步请求结果仍按alive边界忽略，不改权限或取消实际请求。文件最小扩展 `PermissionMatrix.tsx` 与现有 `permission-matrix.test.tsx`，不扩其他业务。返修后定向复验和原质量代理复审。


## 私有仓库本地收口（2026-10-19，等待云端检查）

- D1：当前已发出251种动作及4种保留动作共255条显式中文标签；未知及原型同名动作保留原码。AST自动覆盖191种静态/直接转发动作，动态分派另行人工逐源核对，不声称AST覆盖全部251种。API三个套件35/35 PASS，原失败保留，规格与质量复审PASS。
- D2：账号链接新增历史；native blocker在确认前保留PUSH/POP/REPLACE目标；待确认目标不被hash-only请求销毁，busy队列只由真正改变业务范围的新目标替换；正常hash-only不重新消费定位。成功logout仅放行该次同步跳转；失败/取消保留草稿。PermissionMatrix卸载清理busy，迟到响应仍被alive规则隔离。
- 独立规格审查代理01a15264-0fe1-71b3-b95e-ec6708300beb、质量代理01a1526d-f76c-7ac2-8d3f-5f442fb317a1均复审PASS；busy/hash和卸载残留两项P2均先红后绿，审查者只读，不把主代理日志记为其执行。
- 物料英文回归曾在组合与整文件运行超过既有10秒上限，失败日志保留；测试宿主关闭motion，并把查询范围限定为实际页面/弹窗、等待创建弹窗不可见，原英文、权限、导入结果和重复跳过断言及超时均保留。质量代理确认没有削弱断言，整文件16/16后纳入最终组合。
- 主代理冻结最终产品及测试源码，使用Node本地入口、单worker运行App路由8、shared guard17、Admin定位43、AccountMenu16、PermissionMatrix29、MaterialMaster16，共6文件129/129 PASS、exit0，372.58秒，无skip；Git外release-frozen-web.log。保留Ant Design弃用/useForm提示，不扩大此次修复范围。
- 本轮未启动数据库或服务、未接触55440；API读取/导出授权及DTO/迁移未改。本地组件Mock测试不是真实PostgreSQL或真实业务浏览器验收；原完整CI及真实PG/Worker仍须绑定返修后的最新SHA重新执行。
- Actions优化原PR53已实现并独立审查，其既有CI未运行成功，完整本地PG曾中断的事实保留；不切换当前未提交D分支、不复用旧PASS。D集成后的基线刷新及完整CI在恢复云端阶段接续。
- 当前没有提交、推送、触发Actions、合并、部署、Issue关闭或飞书写入；不重跑失败C部署。本地类型/构建/治理及Git外接续点已完成，下一步等待负责人开放云端阶段。

最终串行Web类型检查及生产构建均exit0，构建16.09秒；保留既有大包告警，未改构建阈值或新增依赖。契约同步与API35项结果来自本轮较早最终API验证，之后API源码未改。日志release-frozen-types.log、release-frozen-build.log、release-final-contracts.log、release-final-api.log。

最终治理复验PASS（36份文档、275个本地链接、20份来源复核、123对模块依赖），phase-5 coverage 1/1、归档隔离及git diff --check通过。较早workspace58/58保持独立历史证据。文档摘要曾因未归一化CRLF失败，按现有sourceDigest规则修正后通过，失败保留于release-frozen-governance-digest-red.log。本轮本地收口已完成，修改保留在当前分支工作区，未提交和推送。


## 恢复云端交付（2026-10-19）

负责人明确“仓库已开源，继续”；API核对仓库public、PR51仍open且head=e40f543/base=main395acc27，Issue46仍open且范围未撤回。三个原P2无新增反馈；本地原修改及双审证据保留。V0.0.19-fix6本地/已抓取远端无占用，集中提交审计标签与原生导航返修，更新原PR51并等待最新完整CI，未以旧PASS跳过检查。原C部署不重跑；下一次部署失败时保留事实并定位，不改检查、凭据或账单。


## 四单元最终部署核验（2026-10-19）

PR51已以a8871e4829cb2d1a44f57687ccaa52e168e797ab合并，PR CI39202592968/main CI39203301651完整通过。部署39203879250/job117902400958成功，原始日志release-deploy-39203879250.log证明迁移前加密快照完成后才运行migrate（No pending migrations to apply），API/Web healthy、Worker readiness与完整SHA镜像标签一致，最后Deployment successful标记完整。公开HTTP联合核验req17-21-d-deployment-http.json：login/openapi及全部静态资源200，密度token、session history契约与匿名401、终止导入资源、AuditActorSummaryDto/actionLabel均存在。资源index-BcUpx8jF.js/index-DfutgvNG.css相对部署前已改变。本证据不是登录后的业务界面验收，不将负责人“通过了”（Actions截图）当整套人工清单PASS。Issue保持开放，飞书无写入。


## V0.0.20 上线后收口（2026-10-19）

本地main已对齐c7dc86b，部署及公开HTTP/契约/资源证据已完成；四个REQ一次性容器和两个专属匿名卷清理后复核。未新开开发项、未改业务代码、未重跑C部署、未关闭Issue、未写飞书。文档状态更新在本地保存，仓库私有后不为状态同步再触发Actions。

| 需求 | 开发／部署 | 唯一剩余业务验收 |
| --- | --- | --- |
| REQ-0017 | 已完成／已上线 | 双门户顶栏、语言、改密弹窗、键盘与焦点 |
| REQ-0018 | 已完成／已上线 | 本人会话历史、分页／状态、撤销及安全入口 |
| REQ-0019 | 已完成／已上线 | 三主数据弹窗、超过100行导入、停止／重试、逐行回执及权限 |
| REQ-0020 | 已完成／已上线 | 审计筛选／CSV、中文动作／账号摘要、定位权限及前进后退 |
| REQ-0021 | 已完成／已上线 | 双门户、六主题、中英文和1440/1024/390下的密度与可用性 |

联合项：未保存草稿取消后保留、忙碌导航、导入离开保护。收到明确逐项实际反馈后记录人工证据，再依授权关闭Issue #44～47及回填五条需求。
