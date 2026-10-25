# N3 过程人工台账与完整内部 8D 实施计划

> 面向 AI 工作者：必须使用项目 qms-superpowers-zh，按 subagent-driven-development 逐任务 TDD，先规格后质量独立审查；共享注册、契约生成、Git 和整合验证由主代理串行完成。

## 当前摘要

| 项目 | 当前事实 |
| --- | --- |
| 目标 | N3：过程人工台账到完整内部8D、有效性验证、并行审核关闭、网页及PDF报告的一条真实链，不交付只有发单的半链 |
| 批准 | 负责人2026-10-25明确“继续推进 N3 阶段开发，直至下个 PR 检查点”；沿已确认需求和整体路线，不重复访谈整包业务 |
| 需求 | REQ-0026 / reczz28RDS4BnuCp、REQ-0027 / reczz28RDS4Bp8Yn；user身份回读revision300、has_more=false，均开发中。直接会话批准覆盖本N3子范围，无飞书写入 |
| 映射 | [Issue #70](https://github.com/JasonShu0722/QMS-2.0/issues/70)，关联原Issue #66；V0.0.31，已核对实际main、全部可见PR及tags无冲突，未推送 / 建PR |
| 基线 | main / 生产a32615ce245ae2242e8b1607aa6c564c244e0de7；私有。活动分支codex/qms-n3-process-eight-d从该基线建立，N2纯文档归档安全cherry-pick为e9ad0f2，不带旧运行代码 |
| 现状差距 | 旧ProcessIssueService只支持BRIEF；来源强制分类 / 数量 / 时间，只有5类，缺两态及多物料；N2关闭轮次、职责和设计器基础可复用但生产domain adapter为空 |
| 评审 | 可按既定规则开工；保留BRIEF及其他域兼容，在原过程事实拥有者中扩展，不新建第二份过程事实或复制组织名单。权限细分仅实现已批准角色边界，不通过岗位名称或admin旁路 |
| 停止点 | 完成本地实现、双审、相关真实资源验证和提交候选后停O3，提醒负责人开源；当前不推送、建PR、合并、部署、配生产权限、发布绑定业务或关闭回填 |
| 未纳入 | IMS / AI真实适配、指标统计、客户 / 新品接入、供应商门户及汇总绩效；一期不做在线鱼骨 / FTA绘图、Office可编辑报告或通用BPMN |

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
| B 正文策略 | API process-eight-d-document.ts及test/process-quality/process-eight-d-document.spec.ts | 导出ProcessEightDDocument、emptyProcessEightDDocument、normalizeProcessEightDDocument、analysisCompletionIssues、submissionIssues、documentFileIds；无数据库/HTTP依赖 |
| C 8D业务 | API process-eight-d.types/dto/service/controller/closure-adapter/read-adapter/file-adapter、过程8D迁移、相关集成test；发单分支由本单元在A冻结后接通 | 正式发单、内容/来源/风险/协作/转派、版本、同事务撤审、N2 adapter；公开事务lockRecord/authorizeRead/authorizeEdit/readReport等，具体签名见4.3 |
| D 延期/任务 | workflow-deadline-extension*.ts及过程process-eight-d-task/deadline/reminder文件、单独追加迁移和相关tests；不改C服务 | workflow层执行有界上级→质量侧规则，过程公开hook读取/更新期限；处理/延期待办及真实Worker提醒，原期限不暂停 |
| E 可点样例 | Web interaction-preview/process-eight-d/及process-eight-d-preview.html、隔离样例测试 | 仅内存，不接正式路由、API/生产数据，不导入正式页面；先展示台账选择/表单/锁版/并行/退回/缺项/报告 |
| F 正式Web | Web process-quality台账/发单及新process-eight-d工作区组件、problem-workspace接入、tasks受控动作、相关tests | 待API DTO与生成契约冻结后实施，只用@qms/contracts类型、共享主题/请求/附件/未保存保护 |
| G 组合与证据 | 主代理：权限目录、模块/registry/worker注册、生成契约、module-boundaries、计划/文档/索引、Git及最终验证 | 共享写入串行；Prisma generate/build/test阶段不与源写入并发；不以子代理结论替代实跑 |

## 4. 实施顺序与固定协作接口

### 4.1 A：来源先红后绿

- [ ] 测试先证明“分类可空/误报、多物料、班长不能关闭、PQC可关闭恢复、同码同工序保留只提示、闭后补资料不改8D”在旧版失败。
- [ ] 追加台账迁移及字段，补新DTO/校验/权限，不改历史迁移；基础未知信息保留null，按折叠区维护。
- [ ] 台账完整文件及旧来源/新品消费者回归；输出sourceSnapshot包含真实已保存字段和物料，不丢原始来源/历史。

示例验收：`expect(record.responsibilityCategory).toBeNull(); expect(record.ledgerStatus).toBe('FOLLOWING')`；用真实leader/PQC两账号证明独立close资格，拒绝不改变版本/审计。

### 4.2 B：无数据库正文策略

- [ ] 先写未实现导出及无效D6提交拒绝红灯；最小实现结构规范化与路径化缺项，不加依赖。
- [ ] ProcessEightDDocument固定分区：description、okFileIds/ngFileIds；temporaryMeasures及containment/optionalAffectedContainment；analysisProcess/analysisFileIds/occurrenceCause/escapeCause/systemCause；correctiveActions同一数组承载D5与D6；horizontalDeployment与standardization；closureSummary。
- [ ] 临时措施含id、description、departmentOwner、introducedAt、fileIds；围堵行含group/location、quantity/null、measure、owner、plannedAt、completion、ngQuantity/null，不写示例0/50。
- [ ] correctiveActions含id、causeKind(OCCURRENCE/ESCAPE/SYSTEM)、action、owner、plannedAt、verificationMethod、fileIds及implementationAt/result、beforeState/afterState、firstBatch、followUpBatchCount/null或followUpDuration、verificationRecord、verificationFileIds、effective/null。
- [ ] 标准化保留11个稳定key及名称，行含id/key/documentName、needsUpdate/null、departmentOwner、plannedAt、completedAt、status、reason；只对明确需要更新或不适用的行校验对应完成/理由，不把所有初始行强制更新。
- [ ] 草稿允许未完成；分析完成检查D4发生/流出总结和相应D5计划；完整提交检查所有已录发生/流出必要对策已实施、真实首批、后续批数或时长、改善前后与验证记录及人工明确effective=true。系统因、OK/NG、按需附件、可选表不强制；不提供任意“非必要”绕行开关。

示例：`expect(submissionIssues(draft).some(x => x.path.includes('effective'))).toBe(true)`；`systemCause=''`、空OK/NG或无可选围堵不单独产生缺项。所有fileIds仅收UUID，未知结构/超限/重复id拒绝。

### 4.3 C：过程8D事务与N2关闭接通

- [ ] 核对DomainSourceIssueService/Link、WorkflowRuntime和N2轮次全部调用方后，先真实PG写“不启用/未绑定不能发单、实际发单人审核、协作者不能提交、审批中不得普通改写/转派”的失败用例。
- [ ] 过程报告原始表字段至少problem_id、organization_id、responsible_section_department_id、professional_user_id、document、version、content_version、analysis_completed_at、analysis_due_at、submission_due_at、closure_due_at、closed_revision_id及审计时间；不可变修订保存正文、来源快照、实际审批/关闭与版本。
- [ ] 对同组织有权来源单/多选创建EIGHT_D，原简报原样委托；保留≥1来源的既有最低关联规则，重复关联提示/确认及非复发继续均留痕，不自动改为复发。
- [ ] 协作整单编辑仅当前有效有权人员；内容CAS失败409保稿；管理元数据与正文/来源版本区分，操作人不可信body字段不能伪造专业审核/owner/context。
- [ ] 使用固定事务公共方法：`lockRecord(tx, actor, problemId, purpose)`按问题→实例→过程报告锁定后返回server-owned ProcessEightDRecord；`authorizeRead(tx, actor, record)`、`authorizeEdit(tx, actor, record)`不新增迟到锁；`deadlineContext(tx, record)`及`applyDeadlineExtension(tx, record, stage, dueAt)`供D通过adapter调用，不向外暴露表。
- [ ] 实现WorkflowClosureAdapter全部钩子；提交先验证完整性/附件，移动到受控closure节点并启动同一事务轮次；complete仅在双侧同版本通过时写关闭修订，一次关闭。return/cancel恢复现有负责人/协作者编辑，旧轮保历史。
- [ ] 实现独立受控save、analysis-complete、submit、collaborators、reassign、risk、sources及binding/activation接口；在审变更只有明确confirmCancelApproval后取消旧轮再变更，普通保存拒绝。
- [ ] 报告网页/JSON读取及PDF版本输出引用同一保存版本，审批/来源快照不漂移；内部闭后只开放已确认来源补充，不擅自开放整单分析结论重写或重开。附件对象版本、授权/CLEAN扫描、闭后保留引用由adapter复验。

### 4.4 D：延期、当前动作与真实提醒

- [ ] 先以旧实现证明没有两级延期、旧期限不暂停、同人不伪审批、撤权后不能签/催办的红灯。
- [ ] workflow层提供有界延期运行能力，配置取已发布/绑定版本的处理节点processEightD策略。请求与回执持久化并固定来源、期限阶段/原值、新明确日期、理由和申请人；上级通过后质量侧才可办，任一退回保原期限，全部通过才同事务应用。
- [ ] 仅真实有效上级与申请人同用户时留痕跳领导侧，质量侧仍实际审批；缺岗/多人不兜底管理员。延期不修改正文审批结果，不自动暂停原期限或伪造新的阶段计划。
- [ ] 处理/延期待办与关闭审核待办分开投影；generic claim/转派/任意完成JSON不能绕过。处理阶段催负责人+实际发单质量侧，审核阶段只催未办当前职责；无明确期限不编超期。
- [ ] 配置允许显式开/关及有界提醒频率，未配置不猜业务天数；真实Worker重试/幂等/失效资格/原子投影及失败回执留证。使用现有Outbox/通知能力，不建通用调度平台。

### 4.5 E/F：样例、真实页面与报告

- [ ] E先交付独立内存样例；展示单/多选、跨页提示、多物料展开、D2～D8、草稿/缺项、锁版/取消、并行及退回、网页报告预览。样例确认单独记，不当真实业务验收。
- [ ] DTO冻结后主代理生成契约，F接正式台账、发单预览、8D工作区及任务。不能直接导入样例模型/数据，不能重新手写DTO。
- [ ] 表单和报告共享真实受控数据，网页/报告/轨迹视图遵循已批准Blendex空间模式；D0～D8内容不机械对应审批节点。文件使用现有上传/扫描/CLEAN/预览/授权下载，PDF检查实际长表跨页及图片，不用网页截图冒充。
- [ ] TDD覆盖401/403/409/未知写结果、迟到响应、组织切换、脏稿、键盘/窄屏及只读；不改变全局timeout/测试motion来消绿。浏览器工具不可用按既定人工清单接续，不伪造PASS。

## 5. 整合验收与O3停止

- [ ] 确认REQ实际record_id及范围未撤回，Issue映射、版本/分支、最新来源指纹完整。
- [ ] 每个任务完成：新实现worker→独立规格→独立质量→主代理检查差异并亲跑相关测试；返修同样复核，不忽略P1/P2。
- [ ] 真实隔离PG从空库及上一110链升级，真实RustFS/固定digest ClamAV/Mailpit及编译Worker；仅本任务标签与回环新端口，不连接55440。截图/附件样本/环境和秘密只在Git外。
- [ ] 串行contracts:generate/check、API/Web lint/build、归档隔离、完整配置API/Worker及Web清单分组冻结验证、治理和Compose配置。失败原样保留；整文件复验不声称首次全量全绿。
- [ ] 从人工登记→多选/复发确认→发单→协作→分析计划完成→实施断点有效→完整提交→两侧审核→关闭→历史PDF的真实主链；还原退回、撤权、并发、来源/风险确认撤审及延期、附件拒绝和通知重复消费。
- [ ] 提供正式角色/组织/版本/步骤/预期的人工清单，未真实执行浏览器或人工反馈保持待验；机器门禁不被人工确认替代。
- [ ] 对齐N2/旧简报及受影响客户/新品等兼容路径，更新能力/交接/FOUNDATION与索引。
- [ ] 准备本地提交候选、PR正文及真实验证/失败/未覆盖说明后停O3，提醒负责人开源。当前不推送建PR；未来获准合并/部署/绑定启用/最终联合验收/关闭回填分别核对。

## 6. 执行记录

- 初始治理：37文档 / 347本地链接 / 20来源 / 127模块依赖通过，3项维护仍开放；未改reviewDue。
- 起点不是N3已完成：本计划承接已批准设计，真实现状及新代码/测试/审查/证据按后续记录接续，不把旧阶段PASS复制过来。
