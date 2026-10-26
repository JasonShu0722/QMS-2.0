# N3 过程人工台账与完整内部 8D 实施计划

> 面向 AI 工作者：必须使用项目 qms-superpowers-zh，按 subagent-driven-development 逐任务 TDD，先规格后质量独立审查；共享注册、契约生成、Git 和整合验证由主代理串行完成。

## 当前摘要

| 项目 | 当前事实 |
| --- | --- |
| 目标 | N3：过程人工台账到完整内部8D、有效性验证、并行审核关闭、网页及PDF报告的一条真实链，不交付只有发单的半链 |
| 批准 | 2026-10-26负责人已明确“我醒了，可以恢复正常规则了”，夜间临时连续交付授权立即结束。恢复N3到O3 / PR检查点及常规交付规则；不再依据夜间授权自动合并部署或接续N4，既有本地验证可以继续 |
| 需求 | REQ-0026 / reczz28RDS4BnuCp、REQ-0027 / reczz28RDS4Bp8Yn；user身份回读revision300、has_more=false，均开发中。直接会话批准覆盖本N3子范围，无飞书写入 |
| 映射 | [Issue #70](https://github.com/JasonShu0722/QMS-2.0/issues/70)，关联原Issue #66；[PR #71](https://github.com/JasonShu0722/QMS-2.0/pull/71)首版5d6f490，base/main a32615c。V0.0.31；两项确认评审返修使用V0.0.31-fix1，修复head以PR最新提交为准，不新开PR或扩大REQ |
| 基线 | 开发基线 / N2发布记录a32615ce245ae2242e8b1607aa6c564c244e0de7。活动分支codex/qms-n3-process-eight-d，验证起点HEAD a9f660e，最终候选以PR head为准；N2纯文档归档安全cherry-pick为e9ad0f2。2026-10-26GitHub连接实读visibility=public，未由代理改变可见性 |
| 现状差距 | 旧ProcessIssueService只支持BRIEF；来源强制分类 / 数量 / 时间，只有5类，缺两态及多物料；N2关闭轮次、职责和设计器基础可复用但生产domain adapter为空 |
| 评审 | 可按既定规则开工；保留BRIEF及其他域兼容，在原过程事实拥有者中扩展，不新建第二份过程事实或复制组织名单。权限细分仅实现已批准角色边界，不通过岗位名称或admin旁路 |
| 停止点 | 恢复正常交付检查点：先完成N3验证与审查，达到O3后汇报并核对有效PR授权；合并、发布和下一阶段另按常规规则核准。仓库开源不等于发布授权，生产配权/流程绑定启用和关闭回填不随代码部署代办 |
| 未纳入 | IMS / AI真实适配、指标统计、客户 / 新品接入、供应商门户及汇总绩效；一期不做在线鱼骨 / FTA绘图、Office可编辑报告或通用BPMN |
| 当前接续 | 原head5d6f490的9项CI全部通过，但评审两项P2阻止直接集成。fix1已统一100个不同附件的保存/提交/旧在审关闭守卫，并独立投影待审CLOSURE延期资格及真实UI入口；A、B API与Web均独立双审通过。父验证155纯测、152真实PG、编译Worker8、Web132项通过，保留资源/命令失败和整文件复验；生成契约及API/Web构建通过。更新同PR后必须等待新head CI，不自动合并部署/N4 |
| 夜间接续 | 夜间heartbeat `qms`已在负责人恢复规则后通过应用工具删除，并核实配置文件不存在。保留既有本地测试和证据，不再自动连续交付；中断且未收到完整退出证据的测试不记PASS |

## 1. 依据与不再悬置的业务规则

依据[整体路线N3](2026-10-24-qms-problem-management-delivery-roadmap.md)、[完整需求011～030/052/058～069/073～074](../specs/2026-10-24-qms-problem-management-requirements-list.md)、[已确认研讨](../specs/2026-10-23-qms-domain-problem-management-discussion-draft.md)及[N2发布与接缝](2026-10-24-qms-n2-configuration-and-workflow-foundations.md)。本计划将已确认规则转为字段 / 动作 / 测试，不扩大审批或要求整包重新批准。

- 班长/PQC均可登记维护；未知分析可空，六类为物料/作业/设备/工艺/设计/误报。台账仅跟进中/已关闭；PQC确认关闭或说明原因恢复，班长不因维护权限获关闭权，闭后补资料不重开8D。
- 一条来源一行，条码非唯一；同工序同条码仅提示。多物料默认一行，可展开，物料编码/名称、供应商、物料批次、人工选有效SQE及四类复核事实分项保存，不建供应商→SQE自动映射。未发8D不产生SQE正式待办。
- 获权PQE/制程质量室经理可单/多选发8D，实际发单人固定为专业审核人；科室内选择负责人，负责人可加同组织跨部门协作者。只有负责人提交，不把协作或管理员等同任意动作资格。
- 内部低中专业+经理并行，高/重大专业+分管部长并行；经理=负责人只跳管理侧并留痕。任一退回整轮重审，直接复用N2轮次，不新建八级串行审批。
- 撤回跨部门重派仅获权PQE；办理内部转派仅当前负责人/其经理/分管部长，在审禁止。来源调整仅相应工程师；在审修改须明确确认撤审，取消不写。风险由已批准四类人员的独立能力维护，涉及审批来源改变须整轮失效，不静默续用旧签批。
- PQE设分析/对策期限和关闭计划；负责人主动确认分析/对策完成后填完整提交计划。日期明确选择，不猜默认天数。延期上级→既定质量侧，领导同申请人仅留痕跳领导侧，不跳质量侧；原期限直到全部通过才改变。
- D2～D8为内容分区，不是八道工作流；D4先分析过程，再发生因、流出因，系统因可空。D5/D6同一措施含实施、前后状态、真实首批断点、后续批数或时长及明确有效结论；不以文件/日期自动认定有效，不强制统一阈值或批数时长双填。
- D7七列11预置文件，可加行；不默认全部要更新、不擅删历史预置。D3、OK/NG、系统因、按需附件和可选扩展围堵不变相强制。
- 报告草稿可保存未完成内容；完整提交前校验必要发生/流出措施已实施且有效。关闭版绑定内容/来源/审批历史；闭后来源补充不改原批准快照，不额外开放未经批准的内部整单重开/改分析结论。

## 2. 最小结构与兼容决策

### 2.1 原事实、附属事实与报告

沿用process_defects及既有DomainSourceIssue/Link和problem_index。追加迁移，不修改已应用110份迁移。允许未知分类及必要来源事实以null表示，不伪造数量1、时间或误报；旧已知数据原样保留。若放宽既有字段导致消费者类型变化，修正真实调用方，不用非空断言或模拟数字隐藏。

来源扩展字段为traceCode、analysisProgress、ledgerStatus、close事实/历史及映射读取结果。多物料为过程模块拥有的process_defect_material_items，已有单物料迁移为首项，旧接口单物料输入只作为同一事实的兼容投影，不变成两个独立拥有者。legacy BRIEF不删除。

8D使用process_eight_d_reports及不可变process_eight_d_revisions等过程拥有表，problem_id关联正式问题；正文JSON结构由纯策略严格验证，不接受任意任务JSON。报告行版本与审批内容版本区分：正文/来源/责任变化递增受控内容版本；时间等受控元数据有自己的CAS，不无故让旧签批变新签批。所有变更有事务审计/Outbox。

过程模块公开服务拥有本域表。Workflow、问题读取、Worker、附件/报告只通过注册适配器或公开事务服务访问，不直接查过程私表。生产适配器只注册process-quality，客户/新品/供应商保持未接入，不注册fixture。

### 2.2 有限注册与防旁路

复用FileResourceAccess的模块初始化注册模式，补WorkflowClosureRegistry和ProblemDomainRegistry必要的启动期注册/覆盖接缝，重复/晚注册失败；不创建动态插件平台。过程读适配器对既有BRIEF委托原行为，对新EIGHT_D提供真实内容、来源、动作和版本历史。

受控过程版本的负责人处理节点也有显式processEightD标识；旧runtime act/claim/replay、旧任务投影和能力入口不能绕过领域保存/完整提交/转派守卫。候选模板初始化、合法发布、过程版本绑定、enabled启用分开，初始未绑定/未启用不能发正式8D。处理节点配置暴露既定延期顺序和可配置提醒，不增加业务审批。

### 2.3 权限与锁顺序

现有process-quality:defects:read/write保持来源读取/维护兼容；补独立close、issue、sources、risk、deadlines、report动作能力以表达已批准岗位职责，目录只登记不代配生产岗位。实际有效任职、同组织/责任科室、本单身份、状态、内容/流程版本共同校验，不使用PQE/经理等名称匹配。

共用锁序为问题→流程实例→领域内容→用户→组织/科室/岗位。修改已审正文/来源/风险时在原事务先按旧事实取消旧轮，再写新事实；不能写完后让adapter失去旧上下文，不能另开事务或吞掉取消失败。提醒和通知在投递前复验当前角色/来源，不伪造会话。

## 3. 文件所有权与依赖

| 单元 | 独立实现写集 | 公共接口与验证 |
| --- | --- | --- |
| A 台账 | API process-defect-ledger.service.ts、process-quality.dto/controller的台账区、ProcessDefect Prisma块、新过程台账迁移、相关test/process-quality；不改发单区 | 来源两态/多物料/批量分类/SQE事实/映射解析；公开sourceReference、lockAndResolve兼容；真实PG/HTTP及旧new-product调用回归 |
| B 正文策略 | API process-eight-d-document.ts、独立process-eight-d-document.dto.ts及test/process-quality/process-eight-d-document.spec.ts | 导出ProcessEightDDocument、emptyProcessEightDDocument、normalizeProcessEightDDocument、analysisCompletionIssues、submissionIssues、documentFileIds及ProcessEightDDocumentDto；纯策略无数据库依赖，Swagger DTO供生成前端契约 |
| C 8D业务 | API process-eight-d.types/dto/service/controller/closure-adapter/read-adapter/file-adapter、过程8D迁移、相关集成test；发单分支由本单元在A冻结后接通 | 正式发单、内容/来源/风险/协作/转派、版本、同事务撤审、N2 adapter；公开事务lockRecord/authorizeRead/authorizeEdit/readReport等，具体签名见4.3 |
| D 延期/任务 | workflow-deadline-extension*.ts及过程process-eight-d-task/deadline/reminder文件、单独追加迁移和相关tests；不改C服务 | workflow层执行有界上级→质量侧规则，过程公开hook读取/更新期限；处理/延期待办及真实Worker提醒，原期限不暂停 |
| E 可点样例 | Web interaction-preview/process-eight-d/及process-eight-d-preview.html、隔离样例测试 | 仅内存，不接正式路由、API/生产数据，不导入正式页面；先展示台账选择/表单/锁版/并行/退回/缺项/报告 |
| F 正式Web | Web process-quality台账/发单及新process-eight-d工作区组件、problem-workspace接入、tasks受控动作、相关tests | 待API DTO与生成契约冻结后实施，只用@qms/contracts类型、共享主题/请求/附件/未保存保护 |
| G 组合与证据 | 主代理：权限目录、模块/registry/worker注册、生成契约、module-boundaries、计划/文档/索引、Git及最终验证 | 共享写入串行；Prisma generate/build/test阶段不与源写入并发；不以子代理结论替代实跑 |

## 4. 实施顺序与固定协作接口

### 4.1 A：来源先红后绿

- [x] 测试先证明“分类可空/误报、多物料、班长不能关闭、PQC可关闭恢复、同码同工序保留只提示、闭后补资料不改8D”在旧版失败。
- [x] 追加台账迁移及字段，补新DTO/校验/权限，不改历史迁移；基础未知信息保留null，按折叠区维护。
- [x] 台账完整文件及旧来源/新品消费者回归；输出sourceSnapshot包含真实已保存字段和物料，不丢原始来源/历史。

示例验收：`expect(record.responsibilityCategory).toBeNull(); expect(record.ledgerStatus).toBe('FOLLOWING')`；用真实leader/PQC两账号证明独立close资格，拒绝不改变版本/审计。

### 4.2 B：无数据库正文策略

- [x] 先写未实现导出及无效D6提交拒绝红灯；最小实现结构规范化与路径化缺项，不加依赖。
- [x] ProcessEightDDocument固定分区：description、okFileIds/ngFileIds；temporaryMeasures及containment/optionalAffectedContainment；analysisProcess/analysisFileIds/occurrenceCause/escapeCause/systemCause；correctiveActions同一数组承载D5与D6；horizontalDeployment与standardization；closureSummary。
- [x] 临时措施含id、description、departmentOwner、introducedAt、fileIds；围堵行含group/location、quantity/null、measure、owner、plannedAt、completion、ngQuantity/null，不写示例0/50。
- [x] correctiveActions含id、causeKind(OCCURRENCE/ESCAPE/SYSTEM)、action、owner、plannedAt、verificationMethod、fileIds及implementationAt/result、beforeState/afterState、firstBatch、followUpBatchCount/null或followUpDuration、verificationRecord、verificationFileIds、effective/null。
- [x] 标准化保留11个稳定key及名称，行含id/key/documentName、needsUpdate/null、departmentOwner、plannedAt、completedAt、status、reason；只对明确需要更新或不适用的行校验对应完成/理由，不把所有初始行强制更新。
- [x] 草稿允许未完成；分析完成检查D4发生/流出总结和相应D5计划；完整提交检查所有已录发生/流出必要对策已实施、真实首批、后续批数或时长、改善前后与验证记录及人工明确effective=true。系统因、OK/NG、按需附件、可选表不强制；不提供任意“非必要”绕行开关。

示例：`expect(submissionIssues(draft).some(x => x.path.includes('effective'))).toBe(true)`；`systemCause=''`、空OK/NG或无可选围堵不单独产生缺项。所有fileIds仅收UUID，未知结构/超限/重复id拒绝。

### 4.3 C：过程8D事务与N2关闭接通

- [x] 核对DomainSourceIssueService/Link、WorkflowRuntime和N2轮次全部调用方后，先真实PG写“不启用/未绑定不能发单、实际发单人审核、协作者不能提交、审批中不得普通改写/转派”的失败用例。
- [x] 过程报告原始表字段至少problem_id、organization_id、responsible_section_department_id、professional_user_id、document、version、content_version、analysis_completed_at、analysis_due_at、submission_due_at、closure_due_at、closed_revision_id及审计时间；不可变修订保存正文、来源快照、实际审批/关闭与版本。
- [x] 对同组织有权来源单/多选创建EIGHT_D，原简报原样委托；保留≥1来源的既有最低关联规则，重复关联提示/确认及非复发继续均留痕，不自动改为复发。
- [x] 协作整单编辑仅当前有效有权人员；内容CAS失败409保稿；管理元数据与正文/来源版本区分，操作人不可信body字段不能伪造专业审核/owner/context。
- [x] 使用固定事务公共方法：`lockRecord(tx, actor, problemId, purpose)`按问题→实例→过程报告锁定后返回server-owned ProcessEightDRecord；`authorizeRead(tx, actor, record)`、`authorizeEdit(tx, actor, record)`不新增迟到锁；`deadlineContext(tx, record)`及`applyDeadlineExtension(tx, record, stage, dueAt)`供D通过adapter调用，不向外暴露表。
- [x] 实现WorkflowClosureAdapter全部钩子；提交先验证完整性/附件，移动到受控closure节点并启动同一事务轮次；complete仅在双侧同版本通过时写关闭修订，一次关闭。return/cancel恢复现有负责人/协作者编辑，旧轮保历史。
- [x] 实现独立受控save、analysis-complete、submit、collaborators、reassign、risk、sources及binding/activation接口；在审变更只有明确confirmCancelApproval后取消旧轮再变更，普通保存拒绝。
- [x] 报告网页/JSON读取及PDF版本输出引用同一保存版本，审批/来源快照不漂移；内部闭后只开放已确认来源补充，不擅自开放整单分析结论重写或重开。附件对象版本、授权/CLEAN扫描、闭后保留引用由adapter复验。

### 4.4 D：延期、当前动作与真实提醒

- [x] 先以旧实现证明没有两级延期、旧期限不暂停、同人不伪审批、撤权后不能签/催办的红灯。
- [x] workflow层提供有界延期运行能力，配置取已发布/绑定版本的处理节点processEightD策略。请求与回执持久化并固定来源、期限阶段/原值、新明确日期、理由和申请人；上级通过后质量侧才可办，任一退回保原期限，全部通过才同事务应用。
- [x] 仅真实有效上级与申请人同用户时留痕跳领导侧，质量侧仍实际审批；缺岗/多人不兜底管理员。延期不修改正文审批结果，不自动暂停原期限或伪造新的阶段计划。
- [x] 处理/延期待办与关闭审核待办分开投影；generic claim/转派/任意完成JSON不能绕过。处理阶段催负责人+实际发单质量侧，审核阶段只催未办当前职责；无明确期限不编超期。
- [x] 配置允许显式开/关及有界提醒频率，未配置不猜业务天数；真实Worker重试/幂等/失效资格/原子投影及失败回执留证。使用现有Outbox/通知能力，不建通用调度平台。

### 4.5 E/F：样例、真实页面与报告

- [x] E先交付独立内存样例；展示单/多选、跨页提示、多物料展开、D2～D8、草稿/缺项、锁版/取消、并行及退回、网页报告预览。样例确认单独记，不当真实业务验收。
- [x] DTO冻结后主代理生成契约，F接正式台账、发单预览、8D工作区及任务。不能直接导入样例模型/数据，不能重新手写DTO。
- [x] 表单和报告共享真实受控数据，网页/报告/轨迹视图遵循已批准Blendex空间模式；D0～D8内容不机械对应审批节点。文件使用现有上传/扫描/CLEAN/预览/授权下载，PDF检查实际长表跨页及图片，不用网页截图冒充。
- [x] TDD覆盖401/403/409/未知写结果、迟到响应、组织切换、脏稿、键盘/窄屏及只读；不改变全局timeout/测试motion来消绿。浏览器工具不可用按既定人工清单接续，不伪造PASS。

## 5. 整合验收与O3发布门禁

- [x] 确认REQ实际record_id及范围未撤回，Issue映射、版本/分支、最新来源指纹完整。
- [x] 每个任务完成：新实现worker→独立规格→独立质量→主代理检查差异并亲跑相关测试；返修同样复核，不忽略P1/P2。
- [x] 真实隔离PG从空库及上一110链升级，真实RustFS/固定digest ClamAV/Mailpit及编译Worker；仅本任务标签与回环新端口，不连接55440。截图/附件样本/环境和秘密只在Git外。
- [x] 串行contracts:generate/check、API/Web lint/build、归档隔离、完整配置API/Worker及Web清单分组冻结验证、治理和Compose配置。失败原样保留；整文件复验不声称首次全量全绿。
- [x] 从人工登记→多选/复发确认→发单→协作→分析计划完成→实施断点有效→完整提交→两侧审核→关闭→历史PDF的真实主链；还原退回、撤权、并发、来源/风险确认撤审及延期、附件拒绝和通知重复消费。
- [x] 提供正式角色/组织/版本/步骤/预期的人工清单，未真实执行浏览器或人工反馈保持待验；机器门禁不被人工确认替代。
- [x] 对齐N2/旧简报及受影响客户/新品等兼容路径，更新能力/交接/FOUNDATION与索引。
- [x] 准备本地提交候选、PR正文及真实验证/失败/未覆盖说明。负责人已恢复正常规则并再次要求继续推进，适用验证/双审完成后按常规持续授权提交推送PR；合并部署、生产岗位配置、绑定启用、关闭回填及N4分别核对，不继续沿用已结束的夜间临时授权。

## 6. 执行记录

- 初始治理：37文档 / 347本地链接 / 20来源 / 127模块依赖通过，3项维护仍开放；未改reviewDue。
- 起点不是N3已完成：本计划承接已批准设计，真实现状及新代码/测试/审查/证据按后续记录接续，不把旧阶段PASS复制过来。
- 2026-10-25接续：保留活动分支与全部N3未提交改动，未推送、建PR、配生产权限或部署。四个带qms-n3任务标签的一次性服务继续供验收使用，未访问55440。新增130000/140000/150000/160000迁移已实际应用，不再修改其SQL。
- 主代理真实锁验证：旧用户UPDATE锁下SQE外键写入55P03红灯；改为NO KEY UPDATE后authentication-reference-lock及process-manual-ledger-concurrency两整文件8/8通过，安全writer仍等待、撤权后旧session被拒。证据位于Git外n3-evidence/auth-reference-red.log及auth-reference-green.log；独立最终复核待冻结。
- 主代理共享事务验证：真实actor传递、同事务全部审批历史、来源外层事务回滚三例先3/3失败；补齐后workflow-closure-round及domain-source-issue-contract两整文件66/66通过，未把筛选测试冒充全量。证据shared-transaction-red/green.log。
- 主代理生产注册验证：新增服务/适配器/提醒注册三例先3/3失败；注册后与process-manual-ledger真实HTTP共2文件17/17通过（其中来源HTTP14例）。旧未注册运行12/14、供应商与映射两例503原样保留于module-wiring-red.log；修复运行见module-wiring-green.log。
- 当前已知缺口：C规格返修、D质量返修、通用流程防绕过、未知数量消费者、附件报告读取与正式Web仍在推进；源文件未冻结前不出最终审查PASS。浏览器桥接未获信任，未绕过限制，样例和机器验证均不等于人工业务验收。
- 接续整合结果：契约已由Swagger生成；报告/附件4个纯测试文件62例通过；附件独立真实PG/版本化对象存储/ClamAV3例通过。API完整纯测首跑96文件：94通过、2失败，1150通过、2失败；原失败是权限目录旧期望和新增审计动作缺标签，最小修复后4个相关整文件193例通过，不把该复测改写成全量一次全绿。
- 真实C/D首跑4文件：2通过、2失败，29通过、15失败。C的13例依次暴露fixture owner assignment与受控策略不符、发布缺实际actor，尚未证明业务链通过；D的2例为pg_sleep返回void不能反序列化，加显式类型后延期整文件13例通过。任务/提醒首跑18例通过，但独立复审发现提醒到期测试会把异常回滚当成零通知成功，须补PROCESSED/成功回执断言后重新验证，不保留假绿结论。
- 新一轮审查尚未放行：C发现关闭期限索引投影、内部转派幂等资格、风险依据持久化和任职到期锁后复验四项；通用任务transfer还有受控版本漏口；PDF图片异步解码隔离、重复引用处理预算及拒绝审计待修。均已分派有限写集返修，不扩展N4～N6业务。
- 夜间后台接缝返修后：C最后外层来源锁升级/来源等待后owner时效、A未绑定组织供应商profile身份、PDF异步隔离/重复引用预算/拒绝审计及受控task transfer均已分别规格/独立质量复核。C曾31PG+35纯策略66过，A曾37过，目标数按原运行保留不重复累计。新增受控字段异常保留默认错误脱敏，真实HTTP缺项定位与独立同/跨科室重派通过；无配置binding已明确发送200 JSON null并与Swagger nullable一致，不以metadata测试替代传输验证。
- 主代理完整真实HTTP链及negative/registration共8例通过，含版本化上传、真实ClamAV、签名GET真实octet-stream与SHA一致、D2～D8保存、双侧审核关闭和批准PDF；独立编译N3 Worker入口2例通过。PDF新增原七列序号及CRITICAL重大风险显示分别先红，当前整份14例通过。未执行浏览器/CORS/原生PDF查看器，不称人工验收。
- 全量API首轮第1片500过/1失败暴露新receipt组织外键漏项；追加第五份迁移`20261026010000_process_eight_d_receipt_organization_reference`，不改已应用原四份SQL，不增加FK例外。组织生命周期及空库/110链升级两文件54例过。完整phase2原入口前置配置不足实际FAIL，保持与分层证据分开，不声称完整本地phase2 PASS。
- API第二轮：完整100个单测文件1253例全过；第1集成片31文件501例全过；第2片265过/2失败是N2调度夹具只识别旧用户FOR UPDATE、未识别本轮NO KEY UPDATE，根因不是writer业务失败。仅修调度匹配、保留全部状态/SQLState/写入次数断言后，该整文件6例通过。API/contract全域字节比对只变化这一第2片测试文件，生产、单测、第1片输入完全一致，复用依据`api-v2-impact-reuse.json`明确保存；后3片在新隔离库继续，仍未称全量通过。
- 正式Web分层：F1经历事实秒/毫秒保护及候选401回传返修后，新完整6文件55例过、tsc0；F3旧完整15文件215例过后，独立规格又发现真实设计器写链的CSRF后scope、unknown冻结/重认证及401导航缺口，新增22例和相邻16例单项通过，须重新整组。F2真实SharedPanel lifecycle、图片/PDF弹窗、原七列/九位置、缺项定位/实际时间等返修后等待27文件组合；不得复用旧38例为新完整通过。UI与API继续独立门禁，普通问题自行修复，未推PR/部署。

### 6.1 2026-10-26最终回归接续

- API完整单测100文件1253例、第1集成片31文件501例与第2片31文件267例已有全文件证据。第3片旧供应商复合首登用例默认5秒失败；真实阶段计时5959ms，拆成“双员工及禁用”和“双供应商隔离”两个独立场景，保真实密码链及原断言，增双向提交拒绝/零修订断言。整文件默认5例通过，两个场景2475/2559ms；McClintock规格与Laplace质量独立通过。仅测试变化，不降低Argon2参数或延长超时。
- 第3片最终`api-integration-final-v6`为31文件426例通过；前三片与单测复用以API/契约全域字节指纹及受影响文件清单核对，不是一次全量首次通过。第4片30文件中28文件通过、2文件失败（5例失败 / 359例通过）：真实附件缺加密归档夹具前置；过程8D的内部转派测试夹具仍同时授独立重派权，未进入预期内部路线，等待用例失败又未可靠恢复spy，出现递归连带失败。原日志保留，Rawls负责最小夹具返修与整文件复验，不能借此放宽生产权限或断言。
- 已在Git外补齐真实加密ZIP前置，单文件219字节、ZIP加密标记核验，后续由真实ClamAV拒绝场景取证，不能用“变量已填写”替代扫描通过。独立Worker8项因API失败等待依赖而未运行，原等待脚本明确FAIL，不伪报Worker全量通过；此前N3编译Worker2例证据另存。
- F2组合最终`f2-combination-20261026-023339/run-20261026-033413`为27文件299例通过，116输入源指纹不变。旧唯一PCN证据保留测试仅收窄可访问查询，不改生产/断言/timeout。返修后独立SPEC仍发现外层工作空间撤权清理未传播P1、附件pending可提交/重派导致CLEAN无法接收P2；Faraday受限返修。原148文件完整runner在首组尚未完成时按准确PID树停止并记INTERRUPTED，不能沿用为通过或边写边验。
- F3最后create未知结果修复冻结第一次body/key/节点UUID，显式原请求重试、409保输入刷新核对、scope/CSRF与旧401边界；Russell独立规格通过，独立质量及父完整148文件验证继续。header不代表后端receipt重放。
- 父实际执行API lint/build、契约包test/build、归档隔离、生成契约检查、Web lint/build、Foundation+scanning Compose配置均退出0；根工具11完整文件66例通过，无skip。前端返修后的构建/完整回归仍需重新覆盖。`check:governance`当前明确因已变化前端来源摘要FAIL，须双审后同步而不是盲刷SHA；维护事项复核通过，未改到期日。
- N3尚无运行代码提交/PR/部署。Foundation工作流当前未配置业务浏览器运行，CI不能补造为真实浏览器证据；原生桥接拒绝后的限制和第7节人工清单继续保留。完整阶段二入口曾真实FAIL于隔离gateway/夹具配置前置，本轮分层真实服务验证不改写成`acceptance:phase-2`整体PASS。

### 6.2 后续收敛与同类边界横展

- 原8D内部转派夹具由Rawls修复，Popper规格及Lorentz质量独立通过：仅局部移除独立重派授权以真正覆盖OWNER / MANAGEMENT路线，明确断言receipt来源；原286个expect及timeout不变，无条件恢复spy。整文件31例通过，父第4片复验已覆盖该修复。
- 原任务夹具单次Worker100条假设在共享一次性库的合法事件积压下失败。Linnaeus改为真实相关队列数量的有限公开批处理，并以5个真实流程生成110个前序事件回归；只重放及清理自己的事件，不清其他组织数据。Meitner规格通过，质量独立接续；原36例和全部断言 / timeout保持，新增1例。CPU-profile整文件37例通过不替代普通运行；v7第4片398过 / 1失败，v8仍在原分页5秒失败，原失败继续保留。
- 父进一步在同一Jest调用链拦截实际pg输入，仅Git外诊断，抓取同SQL / 同绑定的`EXPLAIN ANALYZE`：执行3364.5ms、roles主键扫描1656288次，根节点cost8699且无JIT。关闭JIT的诊断仍失败，不能以配置关闭掩盖；先前外部脚本80ms计划没有复现该差计划，不能据此否定真实慢查询。Tesla在TaskService的既定组织范围内做最小同义SQL优化，保留权限 / 组织 / 节点 / 受控版本及分页前过滤；生产源一旦变化，旧完整API组不再作为最终候选全量证据，已准备全新05库和v9全单测 / 四片重验，不修改旧库或旧结果。
- F2父层撤权与附件pending返修经Locke规格复核通过；随后发现原unknown重试遇CSRF429等非终结失败会解除冻结，横展至本轮7处受控writer。Boole完成List / Designer / Template，Erdos规格及Averroes质量通过：9个预期红灯→18定向通过→完整5文件115例通过；父另将N2“适配器未注册”旧静态提示改为发布时实际校验，中文 / 英文与测试断言同步，静态复核通过，旧115例不冒称覆盖新文案。
- Franklin处理过程共享写hook、8D工作区、绑定及延期审核：校正红灯21失败 / 15通过→定向36通过（86项名称筛除）→完整4文件122例通过，无skip。原body / key保留，首次明确拒绝与success / 401 / 403 / 409边界不变；F2保留父清理与CSRF后pending守卫。Kuhn规格通过，Planck质量接续；8文件指纹与父授权的外部文案差异分别审计。
- 正式Web完整148文件v2已冻结启动，四个明确无重叠清单串行执行，PID及状态保存在Git外`web-final-v2/result.json`；未完成前不声称全量通过。新版Web lint / build实际退出0。父复核公开远端、main未变a32615c、无既有N3 PR；user身份两条REQ回读revision300、has_more=false，六个核心字段与批准快照逐项完全一致。生产公开login / OpenAPI均200，仍无N3路径，主资源仍N2；公共HTTP本身不证明部署SHA。
- 已针对实际变更逐项复核文档来源并更新索引，不批量无依据刷新：治理实际通过37文档 / 355本地链接 / 20来源复核 / 131依赖对，3维护项保持开放。N3仍未提交运行代码 / PR / 部署；最终记录更新后继续同步计划源摘要及门禁。

### 6.3 恢复正常规则后的最终工程收口

- 负责人醒来明确恢复正常规则，应用工具删除夜间heartbeat `qms`并核实配置不存在；随后明确继续推进N3。常规提交/PR持续授权有效，不再自动合并部署、配生产岗位、启用绑定或接续N4。
- API最终完整配置清单为100个非集成文件1253项、123个真实集成文件1594项及独立编译Worker8项，pending=0。父重新核对739个记录输入SHA全部一致，并重跑组合汇总器通过；初始115个已应用迁移文件（含lock）SHA不变，第五份补迁移也受最终API输入指纹覆盖。
- Web旧runner退出后第4批没有完整JSON，明确保留为中断，不从日志拼接。新恢复4～6批按配置双worker执行：第4批168项通过，第5/6批原3个完整文件出现5项失败。两文件为默认10秒超时，另一文件为发布提示已改而英文测试仍匹配旧文案；原FAIL/JSON/日志全部保留。
- Rawls只修改英文期望一行，精确验证完整发布/绑定/启用提示，保留可见性断言；首轮单文件另遇原403浮层可见性失败，未改原用例，原失败保留，随后33项完整复验通过。父在默认timeout/motion、不改业务源码的条件下串行执行3个完整文件58项，全部通过，前后输入指纹一致；没有case筛选或逐case拼绿。
- 父亲跑最终Web汇总：148文件1566项全部覆盖，70完整文件687项按来源证明复用、78完整文件879项新跑，未覆盖0、errors为空。新3个完整对象替代原3个完整失败对象，标题/数量精确一致；仅英文测试一行的输入SHA变化，其余Web/契约/根配置输入一致。证据为Git外`web-final-coverage.json`、`web-final-three-complete-20261026/`，这是源码支持的组合PASS，不是首次一次全量全绿。
- Carver有限独立复核确认fs直接读文件强制fresh、四根配置固定a9f660e的LF桥已堵原两项P2，不冒称历史RAW字节全同。Descartes对最后MFA/样例查询修复及英文一行修复质量通过；显式替换补丁也经父规格检查、Descartes独立增量质量审查通过，不将自检代替审查。
- 父最终API/Web lint/build、Swagger契约检查、契约编译、归档隔离、Foundation+scanning及production+scanning Compose静态配置均exit0；根工具12完整文件72项通过，无skip。英文测试最后变更后Web lint另验；文档及来源摘要同步后重新执行治理和受影响文档测试。Compose不代表启动生产或备份恢复，真实浏览器及人工清单仍待验。
- 当前main仍a32615c、仓库public、Issue #70开放、无已有N3 PR，已重新fetch核对；代理不改可见性。PR使用Refs #70，不自动关闭Issue或整包REQ。敏感新增路径及可识别GitHub令牌/私钥扫描无命中，不将Git外环境、日志和附件放入提交。
- 首次staged whitespace检查覆盖到原untracked文件后发现3处EOF空行，只去重复末尾LF/CRLF、保留最后一个原样换行；前缀字节完全一致。Descartes独立确认恰好3路径的EOF-only例外，最终API739记录中736项RAW一致、3项仅此格式差异，不能再称全RAW一致。追加API lint及PDF/报告/提醒3完整文件41项通过；首跑因任务PG不可达失败保留，实查四个本任务容器此前均Exited255，仅按任务/Issue/一次性标签校验后启动原四个容器，不重置数据库或删除数据。最终证据`api-o3-coverage.json`及`final-eof-formatting/`。

### 6.4 PR #71 两项评审返修（V0.0.31-fix1）

- 外部评审绑定5d6f490：附件各数组可各100，但报告读取总数限100；100个OK加1个NG会被接受却无法读取。修复统一共享正文策略的100个不同附件上限，跨区复用同UUID只计一次，保存/提交及旧在审关闭均须守卫，报告端防御上限不放宽。
- 外部评审绑定5d6f490：任务把延期资格放在可编辑HANDLING分支、工作区依赖submit显示按钮；但后端明确允许在审CLOSURE延期。修复须独立投影真实延期资格，审批中仅可申请关闭延期，不开放正文、提交或转派；保持负责人/有效任职/策略/期限/已有申请去重与撤权保护。
- Zeno负责共享正文及报告边界，Boole负责任务/工作区及core接缝；写集分开，生成契约、Git与公共整合由父串行。源码冻结后只执行受影响完整文件及必要真实HTTP/PG/Worker邻近回归，不因旧全量绿灯跳过新增路径，也不为同范围返修重新运行所有无关GUI文件。
- 原CI40249188581已实读9/9全部成功，只证明原head5d6f490。最新修复必须对应新head与新CI，原评审、失败、回复和验证证据均保留，不能把COMMENTED自动评审当业务人工验收。
- A先15失败/118通过，后4完整文件133项通过；B API先补资格与闭前超限红灯，后5完整文件63项通过（真实PG41、纯策略22）；Web文案前90项通过，最后EN状态及新断言由父另验。Zeno、Boole实施；A规格Jason/质量Curie，B API规格Jason/质量Erdos，B Web规格Dewey/质量Curie均通过，冻结哈希匹配。
- 父复用既有`runEvidence`与`sourceSnapshot`：7完整纯测文件155项、8完整PG文件152项、编译Worker8项及6完整Web文件132项通过。运行期1350个来源的既有LF归一化指纹一致，排除0；这是受影响范围的完整文件组合，不冒充新head全量CI。
- 原8文件PG批次一份提醒文件发生Memory allocation error，其余7份完整文件142项通过；新进程提醒复验9通过/1默认120秒超时，均保留。重复06库已有118份8D，提醒测试会全域扫描旧样本；另建07一次性库，115迁移/seed通过，旧06不重置/删除，提醒整文件10项通过。Worker首次根目录cwd找不到`dist/worker.js`，属于父验证命令工作目录错误；按原`apps/api`目录完整8项复验通过，不改生产代码、断言、超时或Argon2参数。
- 证据在Git外`pr71-parent-validation-summary.json`、`pr71-parent-api/`、`pr71-parent-web/`、`pr71-parent-fresh07/`及`pr71-parent-worker-correct-cwd/`；原FAIL、NOT_RUN与新PASS分别保存，不称一次全绿。Swagger生成/检查、API/Web lint/build已通过；文档治理及提交前检查随后收口。IMS、其他域、生产岗位/绑定、人工验收与关闭回填均未扩大。

## 7. 人工验收清单（待实际执行）

浏览器桥接当前不可用，不更换不受信任通道绕过。O3提交候选需在这里填写实际源码SHA/构建版本和测试组织；下表仅为角色、页面与预期，不代表截图、键盘、窄屏或人工业务验收通过。生产岗位、绑定和启用按后续部署授权单独办理。

| 角色 / 页面 | 操作与预期 | 当前人工结果 |
| --- | --- | --- |
| 班长、PQC / 制程不良台账 | 新增及补全记录，未知数量/时间/分类保持空；折叠填写线索；同工序同条码只提示、不合并 | 待验 |
| 班长、PQC / 台账详情 | 班长可维护但不能关闭；PQC确认关闭、说明原因恢复；台账仅跟进中/已关闭，不使用8D状态代替 | 待验 |
| 台账维护人、指定SQE / 物料明细 | 默认首项显示、可展开多项；选SQE后仅该人员复核四类事实；物料标识改变清当前结论但保留历史；不产生未发单待办 | 待验 |
| 有权PQE、制程质量室经理 / 台账发单 | 单/多条及跨页选择；真实科室及有效负责人选择；已有单据明确提示复发选择；隐藏关系不泄露标识 | 待验 |
| 负责人、协作者 / 8D工作区 | D2～D8分区编辑及草稿；协作者可编辑不能提交；临时措施/分析/OKNG/验证附件按需上传预览，不伪装扫描通过 | 待验 |
| 负责人 / D5～D7 | 发生因和流出因措施对应实际实施、改善前后、首批断点、后续批数或时长、人工有效确认；D7七列11预置可加行，非所有行强制更新 | 待验 |
| 负责人、科室经理、分管部长、PQE / 转派 | 办理中部门内授权转派；只有独立能力可跨部门重派；审批中禁止转派；旧会话和到期任职不能继续办理 | 待验 |
| PQE、对应管理侧 / 并行关闭审核 | 任何一侧单独批准不关闭；经理同负责人只跳管理侧；高/重大走分管部长；任一退回整轮重审且旧意见保留 | 待验 |
| PQE、负责人、上级 / 期限与延期 | 显式分析/关闭期限；分析完成后提交计划；上级再固定质量侧审批，最终通过前原期限不变；延期后中心与工作区一致 | 待验 |
| 有权风险/来源维护人 / 在审调整 | 明确确认后取消旧轮并保留依据；取消确认不写入；重新提交需两侧重审 | 待验 |
| 报告阅读人 / 当前、批准、历史报告 | 版本及草稿标识清楚；长表分页、中文与图片不裁切；PDF含对应附件；闭后补来源不重写批准版；撤权后拒绝导出 | 待验 |
| 各实际办理人 / 我的待办与通知 | 处理/延期/关闭职责分开；失效职责不继续展示或催办；重复消费不重复通知；不能由generic领取/转派绕过8D | 待验 |
| 任意有权账号 / 窄屏与键盘 | 375px及桌面表格/抽屉可达；感叹号hover与focus可见提示；未保存离开确认、409保稿、组织/账号切换清旧数据 | 待验 |
