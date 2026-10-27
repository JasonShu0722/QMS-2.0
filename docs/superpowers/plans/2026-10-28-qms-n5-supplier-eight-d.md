# N5 供应商独立8D与门户闭环实施计划

> 面向代理：使用qms-superpowers-zh及subagent-driven-development，每个单元TDD、独立SPEC后QUALITY；父串行负责共享接口、迁移、生成、索引、Git和发布。

## 当前摘要

| 项目 | 当前事实 |
| --- | --- |
| 授权 | 负责人2026-10-28明确开启夜间N4→N5开发，允许适用门禁后的PR/合并部署，20分钟heartbeat qms-n4-n5已建立；不授权生产配权/启用绑定/实际释放供应商资料或人工验收代签，不回填Base/关闭整包REQ |
| 基线 | 活动D:/WorkSpace/QMS-2.0，分支codex/qms-n5-supplier-eight-d，基于N4待审head 7710a8869b2feb22b3dbf4bca8bb4e7cf995e152。N4 PR #77的最新CI40544949293尚在运行，生产仍7cd2707；N5独立本地单元可在固定公开接缝后并行，N5集成发布必须先完成N4发布核验 |
| 映射 | V0.0.34，[Issue #78](https://github.com/JasonShu0722/QMS-2.0/issues/78)。REQ-0029/reczz28RDS4BnyEL及REQ-0026/reczz28RDS4BnuCp供应商部分；user回读0029 revision311、has_more=false、P2/开发中，仅作溯源，当前直接指令是开工依据 |
| 目标 | 现有供应商单据、门户、修订和SUPPLIER关闭策略真实接线，完成独立整改、受控复制披露、阶段期限及专用延期、受控报告和闭后补充，不重建门户或并行主台账 |
| 下一动作 | 父先冻结供应商元数据及真实提交→轮次窄端口；独立延期纯策略和交互样例可先并行，随后完整事务/报告/来源披露与正式Web接线。持续处理N4精确head CI/审查，部署仍逐版本串行 |
| 证据 | Git外D:/WorkSpace/QMS-2.0-local/n5-evidence；前置N4证据n4-remaining-evidence。一次性DB/存储/扫描/Worker/浏览器，禁止55440，不删除旧库/上传，不做prune |

## 1. 已批准依据和范围

按[原路线N5](2026-10-24-qms-problem-management-delivery-roadmap.md)、[需求052～057/069/074](../specs/2026-10-24-qms-problem-management-requirements-list.md)、[讨论供应商部分](../specs/2026-10-23-qms-domain-problem-management-discussion-draft.md)接续，无需重开已确认需求访谈。

- 供应商单与内部单独立，SQE受控复制为可改草稿、独立定级，未正式发单不产生已定正式协作待办。来料问题入口继续复用。
- 供应商完整提交后先SQE，低中再经理；高/重大经理和部长并行，同人一次明确确认、两份真实职责记录。任一退回后供应商重提，整轮重审。
- 原因分析/对策制定期限和计划关闭由SQE设置；对策完成后供应商填写完整提交计划。延期低中SQE，高重大SQE→经理串行，申请不暂停、最终批准才生效。
- 在审锁版。闭后仅SQE和本单有效经理修补资料，不重新审批/重开/造待办，不改原风险、审批结果或实际关闭时间；批准依据与当前补充区分。
- 本企业有效账号且单据已释放才可见/回复；资料按披露范围授权，源附件ID不是门户许可。未配置门户不假送达。

排除N6、IMS/AI、指标绩效、失效分析汇总、在线绘图、Office报告、新简报建设线。旧BRIEF、INTERNAL回复及固定流程历史兼容保留。

## 2. 最小架构与接缝

### 2.1 唯一单据与正文

保留supplier_quality_problems为唯一主事实，复用supplier_response_drafts和supplier_response_revisions持有完整D2～D8正文及不可变提交。新增供应商8D元数据只记录SQE真实任职/责任科室、日期、当前与批准修订、行版本、补充/来源披露等缺失控制事实；不创建另一套供应商主台账。

复用process-eight-d-document的规范化/完整性及PDF纯渲染，不将supplier加入仅三域的internal-eight-d-domain白名单。供应商服务拥有真实企业授权和独立审批/延期政策，不能套内部负责人、并行专业审核或领导先审延期。

### 2.2 真实供应商提交窄端口

供应商会话不能伪装成SQE调用rounds.start。WorkflowClosureRoundService增加仅服务端可用的供应商提交端口，输入限problemId、真实supplierProblemId、已持久化responseRevisionId与期望正文/实例版本；通过注册的supplier领域adapter重读已授权事实，拒绝客户端快照/审批人/任意回调。

同一ReadCommitted事务完成正文规范化/附件固定引用、不可变修订、内容CAS、流程进入关闭节点及创建SUPPLIER轮次。SQE初始PENDING，管理WAITING；SQE通过才开放管理，回滚不能留下半轮或已提交假象。原内部入口和审批职责仍限真实内部任职，外部提交者来源独立留痕；需要调整creator跨组织约束时只追加精确迁移，不改既有审批资格范围。

外层供应商写回执固定revision/round/body摘要，重放按原修订定位并重新鉴权，不查“该用户最新修订”猜测原请求。锁序先会话/涉及用户，再问题→实例→供应商正文→组织职责；附件服务不得在后置尝试升级同一用户锁。旧泛型SUBMIT/VERIFY/CLOSE/REOPEN与旧回复入口不能操作新受控版本。

### 2.3 复制与披露

现ProcessQualityModule依赖SupplierQualityModule，不反向导入产生循环。新增上层supplier-eight-d-source编排模块调用三域公开来源/报告端口及供应商复制端口；不偷读过程/客户/新品私表，不用forwardRef掩盖循环。

默认只选适当不良事实/物料文本，显示外发预览并允许草稿针对性修改；客户、VIN、联系方式、内部分析及其他供应商字段不自动带出。自由文本须由操作者审核，不宣称自动识别/清除所有敏感语义。附件逐项核查源权/目标企业/固定CLEAN对象版本，建立目标资源副本或严格披露记录，不把原fileId直接授给门户。外部存储动作在事务外，最终提交前复验权限、版本和摘要。

### 2.4 专用延期与报告

延期政策使用独立有界状态：低中QUALITY_PENDING→APPROVED，高重大QUALITY_PENDING→MANAGER_PENDING→APPROVED；RETURN/CANCELLED保留历史，最终通过前不改变原到期日。固定风险/阶段/原日期/当前资格和版本；阶段结束或人员变化拒绝旧审批。不能通过同人自动免审管理侧。

报告分别提供当前、批准、历史修订和闭后补充，供应商只读获准本企业版本。固定文件版本/SHA/扫描记录，事务内选取→事务外渲染→重验权限及指纹，真实PDF字节下载。当前补充不覆盖原批准依据，门户不自动看到内部补充或原内部来源。

## 3. 文件所有权与执行单元

| 单元 | 明确写集 | 交付与先后 |
| --- | --- | --- |
| A 父共享整合 | workflow-closure-round.types/service、模板/验证/guard，supplier-quality.service/module/access/binding及新supplier-eight-d.service/dto/controller/closure.adapter，追加迁移/权限/生成/文档/Git | 先真实供应商整链RED，再元数据及提交端口；原内部和旧供应商回归；共享写集不并行 |
| B 独立延期规则 | 新supplier-quality/supplier-eight-d-deadline.policy.ts及test/supplier-quality/supplier-eight-d-deadline-policy.spec.ts | 纯策略TDD先行；仅风险/阶段/日期/状态及真实审批人ID比较，不触库、不造领导职责、不写现共享延期服务 |
| C 独立交互样例 | 新Web interaction-preview/supplier-eight-d目录、supplier-eight-d-preview.html及对应测试 | 内存样例明示刷新重置，不导入正式页；体现披露、供应商→SQE→管理/同人、退回整轮及延期/闭后只读边界，不宣称业务验收 |
| D 来源/附件/协作 | 新supplier-eight-d-source上层模块与复制/披露服务，按父冻结端口补三域公开来源；独立对应PG文件 | A接口固定后实施。仅正式8D后来源SQE资格与协作待办，不改原分类/FAE或强制联动关闭 |
| E 报告/通知/正式Web | 新供应商专属report/任务提醒服务、既有supplier-problem-read/file适配器；正式supplier-quality组件及共享正文最小resource接缝 | A/契约冻结后实施；父负责app/worker注册与生成，其他写集不得交叉 |

### 3.1 任务B接口冻结

纯函数输入保留平台给出的真实值，不从岗位名推断资格：

```typescript
type SupplierDeadlineApproval = 'QUALITY_PENDING' | 'MANAGER_PENDING' | 'APPROVED' | 'RETURNED' | 'CANCELLED';
type SupplierDeadlineStage = 'ANALYSIS' | 'SUBMISSION' | 'CLOSURE';
// LOW/MEDIUM只SQE；HIGH/CRITICAL先SQE后经理，不能经理提前处理。
// 纯策略只选择当前应处理职责并迁移状态，真实权限与任职由领域服务重验。
```

- [ ] RED：四风险首态/顺序，经理提前拒绝、部长不能替代、任一退回、终态拒绝重复、同人仍两阶段、非法风险/动作/日期失败。
- [ ] 最小实现；所有既有预算不改，完整纯测GREEN；SPEC后独立QUALITY。

### 3.2 任务A首个真实红灯及整合

- [ ] 在supplier-eight-d-closure.integration-spec.ts与真实fixture使用现有createDraft→issueDraft→门户真实会话，证明新SUPPLIER模板/完整提交仍缺接线；前置缺资源不算业务RED。
- [ ] 追加元数据/creator/回执及披露所需迁移；父先验证SQL/来源范围后应用一次性新库，应用后不再改SQL。
- [ ] 最小供应商service/adapter窄端口；四风险/双管理/同人/退回、档案/任职失效/跨企业/重放完整测试GREEN。
- [ ] 生成契约并冻结后分派D/E；实际报告、附件和Worker纵向测试，不以纯策略或fixture代真链。

## 4. 集中验收矩阵

| 领域 | 必须实际证明 |
| --- | --- |
| 身份/阶段 | 两供应商、未释放/失效/跨企业、SQE/本单经理/部长/兼岗，DRAFT/办理/待SQE/待管理/退回/关闭/归档；读取/下载/计数/通知同范围，不能猜ID |
| 提交/关闭 | 完整D2～D8、选填不强制、真实附件；提交锁版与不可变修订，SQE前管理拒绝，高重大并行同人双记录，任何退回整轮失效，迟到不入新轮，并发只关闭一次 |
| 来源/披露 | 三域公开来源版本、最小文本及可改草稿、逐附件CLEAN/版本/企业授权，释放前后对照与旧授权撤回；两单独立不强制内部关闭依赖 |
| 日期/延期 | 无默认天数，分析/完整提交/计划关闭分权；四风险独立路线，申请不暂停、最终才生效、原超期留存，同人不偷跳，不改历史实际关闭 |
| 历史/报告 | 旧BRIEF/INTERNAL/固定版本兼容，新版旧入口拒绝，当前/批准/历史/补充分层，闭后仅本单SQE/经理修补不造待办；实际中文长表/多图PDF、字节/hash和后置权限复验 |
| Worker/UI | 真实投影/重试补偿/去重/撤权，不催旧轮或已通过侧；401/403清敏感、409保稿、未知写原body/key；实际登录/上传扫描/退回/双批/延期/报告及1440/375px浏览器 |

## 5. 交付门禁和停止边界

- [x] 既有计划/需求及实际源码评审，user回读REQ0029、查重建Issue #78、固定版本/分支。
- [ ] 各单元TDD及独立SPEC→QUALITY，父完整链/原内部/旧门户受影响真实回归，集中矩阵审查。
- [ ] Swagger生成/检查、API/Web测试及构建/归档/两种Compose静态/治理/迁移不可变/敏感材料扫描。
- [ ] N4精确head完整CI/云端审查→合并→main完整CI→快照/迁移/同SHA服务/公网核验；该前置未成立不发布N5。
- [ ] 本地N5最终冻结→常规提交推送PR→最新headCI/审查集中修复→按夜间授权合并和同版本部署核验。
- [ ] 角色配置/业务流程发布绑定启用/实际对外披露与真实用户人工验收另由负责人放行；Issue/REQ关闭和Base回填另核对授权，不伪勾完成。

所有结果记录精确源码、完整文件/用例、命令、资源/时间、失败及重跑。组合验证明确源码影响与重叠，不拼单文件局部case消红。主体证据写入原供应商交接、PHASE-4、能力/运维/契约等权威文档并同步索引；本计划仅接续本次范围，不复制成第二套通用治理。

## 6. 首批本地断点（非最终交付）

- Pascal独立延期纯策略真实RED 57失败/7通过→64通过，Volta SPEC及Kepler QUALITY通过；数据库、实际人员资格及期限应用尚未接线。
- Hooke限定supplierEightD模板/DTO/通用guard及全部调用方最小改名，9个定向完整文件294项通过；没有加入内部三域白名单，真实PG/绕过证明与独立双审仍待接续。
- 父新建core/source/parent三个一次性库，123迁移通过。首轮seed因NODE_ENV不是development失败保留，按既有seed前置改为development后成功，不降低密码或安全配置。父真实新链测试在发布SUPPLIER候选时因缺真实领域adapter受控失败，不能把该RED当完整8D业务通过。
- 新增124仅从属控制、提交来源/真实跨企业creator桥接、闭后补充及技术回执，不重建供应商主台账。事务内DDL演练ROLLBACK通过后应用core库；存储测试42P01 RED→表结构读取1项GREEN。该SQL已应用，后续修正只能追加迁移；来源/企业/空值/不可变及旧轮次真实约束仍须增加用例。
- Faraday内存样例2文件25项曾通过；随后去除测试辅助函数错误exact属性，最后类型检查/复跑/375px与双审未完成，不将旧25项冒充最终版本通过。
- N4最新CI跨过原guard后，第三分片暴露CSV追加原组织三列的旧表头断言遗漏；修正仍限定N4测试及归档。为在精确N4树验证并推送，N5保存仅本地开发断点，切回N4不夹带本页/新SQL/新规则，不借此发布未完成功能。N5恢复后继续完整链，不以此断点充当PR检查点。
