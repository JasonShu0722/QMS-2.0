# REQ-0030 管理授权、组织删除与制程入口修复计划

> 使用项目 qms-superpowers-zh，按子代理任务执行TDD、规格审查、质量审查；主代理串行管理共享契约、迁移生成、Git及整合验证。

## 当前摘要

| 项目 | 当前事实 |
| --- | --- |
| 目标 | 修复平台管理员内部组织全量适用权限、可解释的组织删除、审计关键词与目标定位、制程8D跟进/登记/出货独立入口 |
| 批准 | 2026-10-26负责人明确“已更新智能表格状态以及优先级，立即启动这一轮修复”；REQ-0030 / reczz28Ru7XCLtaR，user回读revision304、has_more=false，P0 / 开发中；原方案/子任务/验收保持，登记时仅提单的限制已由当前直接开工指令接续 |
| 映射 | [Issue #72](https://github.com/JasonShu0722/QMS-2.0/issues/72)，V0.0.31-fix2；关联REQ-0025/0026/0027反馈，不关闭其后续整包 |
| 基线 | main/线上44f612bab92a787e64dfc04f97295b3e343cd332；本地N3发布文档归档e7ceb60完整保留，功能分支codex/req0030-admin-process-fix基于该提交，运行时代码及文档修复将在本次功能提交中登记 |
| 评审 | 优化后开工：复用有效授权与SQL对应逻辑、已有问题中心/8D表单和出货组件；管理员范围是负责人本轮明确变更，不把旧“本组织全量”规则当永久限制；具体身份与安全初始化需先核对真实来源 |
| 现状与不确定项 | 组织创建自动治理仅5权限且无audit:read；删除初始化判定依赖创建人/回执/审计严格匹配；审计查询导出均动作精确匹配；制程缺独立8D列表，出货挂台账底部。登记按钮存在且页头布局有横向溢出嫌疑；ZLGLB实际阻断仍需只读证据，不能冒称旧兼容根因 |
| 停止点 | 本地实现、双审及适用真实验证完成后到PR检查点；GitHub实际回读visibility=public，验证后按持续授权推送/PR，代理未改可见性。合并/部署、生产配权/流程启用、目标删除及飞书状态变更另核准；不自动N4 |
| 下一动作 | A/B/C/D/E独立规格及质量审查均已收口，最后READ锁升级缺陷已按真实PG红绿灯修复，父独立barrier复验、108文件1377项及编译Worker8项通过。完成文档/治理最终检查后提交推送及创建PR，检查最新head的CI；不合并/部署 |
| 证据 | Git外D:/WorkSpace/QMS-2.0-local/req0030-evidence/approved-start.json及issue-created.json；不连接55440，生产只读与一次性测试明确分开 |

## 1. 范围和最小方案

- 平台管理员显式授权，复用岗位/任职及原兼容授权，不凭用户名、岗位名或“拥有某几项权限”推断超级身份。只覆盖内部组织适用功能；普通用户与供应商边界、单据实际职责和审批约束保留。有效授权的ORM与SQL投影一致，任职到期/撤权/组织停用生效。
- 不自动给所有旧管理员扩权；制定真实来源核对、差异预览和受控初始化方式，不将代码部署当生产授权动作。新内部组织自动进入已明确授权的平台管理员范围，不创建逐组织使用依赖。
- 删除只清理已核验初始化附属项；旧凭据不足不能伪造。权限与创建人身份分离，有权平台管理员可处理他人误建空节点；审计保留、幂等/版本/并发引用与失败回滚保留。
- 审计关键词中文/英文大小写不敏感、未知动作原码可搜；总数/列表/导出一致。组织/资源定位在现有页面传递，不新增默认跨组织汇总或自动授予权限。
- 制程台账、制程问题跟进、出货报告各有独立路由/导航/标签。问题跟进复用公共索引/工作空间，一张8D一行，固定制程范围；台账和8D状态分开。登记沿用现有表单，宽表局部滚动、页头按钮可达。

## 2. 任务与文件所有权

| 单元 | 写入范围 | 步骤与验收 |
| --- | --- | --- |
| A 管理员授权 | 主代理串行：common/security、authorization、identity/org公开授权入口、Prisma/迁移、权限DTO与配置入口 | 先追全调用方/初始化事实；真实授权拒绝用例红灯；最小实现及撤权/跨组织/SQL一致性绿灯；公开接缝后D接入；独立规格再质量审查 |
| B 审计检索 | worker：audit-log的query/export/read-model与相应测试；不改公共权限/DTO/generated | 先中文/片段/大小写/未知码查询和导出一致性红灯；复用共享过滤；纯测/真实PG回归；定位UI由父在公共契约后接入 |
| C 制程页面 | worker：Web process-quality、problem-center必要复用入口、navigation、InternalLayout及对应测试/i18n定向文案 | 先三路由/固定制程过滤/独立出货/登记布局行为红灯；最小页面和CSS；原登记/发单/出货/工作标签及未保存/撤权邻近回归；不导入原型、不增加依赖 |
| D 删除说明 | 后续worker：organization lifecycle service/read-model/DTO和台账相关Web，对应tests；与A公共文件串行 | 真实旧/新初始化、其他创建人、有真实引用、元数据缺项、幂等/回滚/并发回归；有权可见依赖与目标审计定位，不改历史SQL |
| E 整合 | 主代理：注册/契约生成、模块边界、规格/权威文档/索引、Git与真实资源 | 授权/数据变更专审；Swagger生成check；API/Web/受影响Worker、真实PG、构建、归档隔离/Compose/治理；最终一致源码证据及PR检查点 |

跟进列表的公开摘要补充由E0独立实现：沿用有界ProblemDomainField列表的可选summary.fields，在现有已授权页面记录上给出责任科室/负责人名称、阶段和三类期限；不另建问题事实或新列表服务。去掉列表每行另读整份报告的额外网络调用，关闭版按固定修订提取必要事实，名称只查询本页明确ID。

## 3. 执行检查点

- [x] 按实际record_id回读批准，查重创建Issue，核对实际公开状态和main，保留本地归档并切独立功能分支。
- [x] 核对现有管理员初始化及全部ORM/SQL授权调用，锁定A方案与最小迁移/配置；记录安全边界与生产差异预览。
- [x] B/C独立先红后绿；A完成公开接缝后D实现，不重复修改共享文件。
- [x] 各单元规格通过后质量审查，修复后重审；父独立验证关键允许/拒绝、原失败及完整文件。
- [x] 一次性资源迁移/真实PG/Worker与附件邻近链；所有前置真实，不Mock/Skip代替，不访问55440。
- [x] 契约生成检查、lint/build、相关Web及API、治理/归档隔离/Compose和diff检查；人工浏览器另记实际结果，不以CI替代。
- [ ] 更新能力/交接与本计划证据，回读REQ范围未变；本地提交，重核可见性及有效授权后推PR，不提前合并部署。
- [ ] 获独立发布授权后再核mainCI、快照/迁移/同SHA运行服务及目标页面；线上实际删除由负责人决定。

## 4. 最终验收与沉淀

管理员身份/权限预览、内部组织菜单/API、未来子组织、新目录权限、同名普通用户拒绝、供应商拒绝及撤权失效分别取证。删除保留真实引用/审计，ZLGLB最终给具体命中而非推测。审计中英文筛选/分页/导出一致，组织定位不泄露。制程真实登记→发单→跟进汇总→处理/报告主链及独立出货旧能力不丢，桌面/375px/缩放的页头可达与局部滚动单独确认。

权威规格同步管理员授权范围及删除说明；平台交接记录公共授权接缝与初始化方式，前端指南记录列表布局修正，验收和能力状态保留失败/重试、源码SHA和人工未覆盖。Issue/REQ回填及关闭与发布分别核准，不批量结束旧需求。

## 5. 实际执行记录

- 2026-10-26：授权快照六项业务字段与提交版逐项一致，负责人仅将状态改开发中、优先级P0；revision304。Issue #72已建，初始误写private已按GitHub实际public更正，未修改可见性。
- 精确核对label后启动原四个qms-n3一次性服务，保留旧库；新建qms_req0030_20261026_admin/audit/org三个独立数据库，端口55478。全部116份迁移成功，新20261026120000仅登记platform:admin、不授任何生产账号；SQL已冻结记录SHA，禁止再编辑。真实ClamAV配置TCP PONG通过，容器默认socket探针unhealthy仍原样记录，不称扫描验收。
- B审计关键词：Helmholtz先10失败/4通过，最小实现后5完整纯测文件67通过；独立audit库seed成功，两完整真实PG文件20通过，无skip/todo、来源前后1365文件相同且排除0。Herschel SPEC PASS、Zeno QUALITY PASS；只读审查者未重跑PG，父最终公共授权冻结后的独立复跑仍待接续。证据见Git外audit/20261026-122908-144及audit/pg-20261026-124622-619。
- 计划登记与文档检查实际PASS：37文档、357本地链接、20来源复核；文档/边界工具21项通过。该结果仅记录当时文档范围，不替代正在实施的运行时门禁或最终治理。
- A首版42纯测文件508项、3真实PG文件83项通过，但Peirce独立SPEC发现账号治理把runtime投影误当真实来源、跨组织8D读取硬门槛、岗位预览及物料候选等缺口，未签发PASS或进入QUALITY。Laplace已针对治理#1/#2/#4返修，真实岗位5文件104项、身份4文件106项及43纯测文件509项通过；原native分配异常及7条实际红灯分别保留。Mill负责治理轴独立SPEC重审，不能以首轮绿灯覆盖这些发现。
- 父接入兄弟调用方AdminRoleService.assign的roleGrantSources，先出现测试夹具缺变量失败（非有效功能RED），修正夹具后实际复现普通操作者可替换停用平台管理员授权；最小修复后完整两真实PG文件47项通过。物料候选改用共同SQL featurePredicate，实际RED期望1而得到0，完整台账18项通过；同组织、活跃、指定SQE及撤权拒绝保留。新平台授予/撤销中文审计标签先2失败/33通过，补字典后两纯测文件49项通过。三组父证据均在Git外对应role-assignment-ceiling、material-sqe-marker、admin-audit-labels日志中。
- E0首版30纯测、195邻近及32真实PG通过；Feynman SPEC发现真实archivedAt记录到不了归档摘要，Poincare新增真实archive场景复现32通过/5失败（未修复时）。同一只读链接续跨内部组织读取及正式8D表单筛选：PROCESS_DEFECT也含旧BRIEF，不能前端过滤后冒称总数/页准确，需分页前由领域拥有者提供表单谓词。修复与重审进行中，契约需冻结后第二次生成。
- D前端targeting按新增审计定位的拒绝文案修正预期，先1失败/47通过，完整48项通过；Workspace原2失败/30通过，收窄真实控件查询和刷新等待后完整32通过，288.66秒。保留原matcher、userEvent、timeout/motion和失败记录，临时探针清除；AuditAdministration取消不计PASS，Structure未运行。C已获下一段Web租约，不能把D四文件整组记全绿。证据为org-delete/web-lease-handoff.json，Dewey待SPEC重审。
- D后续由Dewey SPEC、Sartre QUALITY均通过；75是组织相关两文件合计，包含12项策略测试，不逐项冒称75个PG场景。父补齐AuditAdministration/Structure两完整文件30项通过，无skip，验证前后427个Web/契约/根配置输入完全一致；D四份Web证据分别为48、32、6、24，不宣称一次全批首次绿灯。
- A治理轴Mill SPEC通过，父另补供应商治理真实来源遗漏，三种marker来源经真实SupplierAccountIdentityService.setStatus先实际RED，改共同roleGrantSources后两完整PG文件50通过。Kant QUALITY只发现CLI canonical角色版本ABA：grant再revoke回相同权限后旧编辑稿可能重加marker。Socrates最小修复同事务推进关联岗位roleVersion、no-op不推进、INTMAX及审计失败回滚，真实PG29/邻近PG104/bootstrap3通过；Russell SPEC及Halley QUALITY独立通过。未执行生产初始化。
- C当前冻结13文件及第二次生成契约指纹一致；Aristotle SPEC、Rawls QUALITY通过。新完整followup29、ProblemCenter8、API helper3共40项通过，无case排除，另保留15文件145项回归及此前失败；未将两批相加冒称一次全量。父Web lint/build通过，原chunk-size告警保留；真实桌面/375px及人工业务验收未执行。
- E归档、表单预分页、跨组织报告读取首轮通过44PG/10公共读PG/258纯测；后续资源适配器缺目标scope已修：服务端持久化资源归属构建局部READ scope，真实actor身份不变，实际PUT、ClamAV扫描、签名URL下载字节/hash验证通过。管理配置GET/bind/activate采用目标组织，advisory/CAS/receipt/audit同scope、同key跨组织隔离，不新加旧配置没有的outbox。新完整52PG、2真实链、38附件PG及108纯测1377为worker证据，非父复跑；详见followup-file-read-repair/result.json。
- E最新SPEC发现配置写/回放缺近期完整认证，父新增实际HTTP MISSING/EXPIRED用例RED两项actual200；只用公用assertRecentAuthentication替换旧SHARE用户锁，位于target授权/receipt/CAS/write前，保持只读GET可用，避免SHARE再NO_KEY升级。父最终v2新库下独立治理3完整文件64通过；原exec过程被会话中断、无完整process结果，保留INTERRUPTED并核对751输入未变，不算代码FAIL或PASS。新parent_resume库116迁移/seed成功，使用有PID及持久结果的有限本地测试helper续跑process/system，未创建自动化或重跑已绿治理。
- 父早期API默认107文件1370通过、无skip且750输入未变，属于资源/配置最后窄补前证据；最新108文件默认回归另跑并保存unit-final-summary.json，不用早期绿灯替代最终树。根工具11完整文件66项及归档隔离通过。静态production Compose首次缺测试环境NPM_DOCKER_NETWORK，保留失败，显式设置静态fixture网络后config --quiet通过；没有建网络/部署或验证真实生产网络。
- E完整质量审查Russell仅余READ锁升级P2：公共索引授权已持有problem SHARE，后续读三类事实升级UPDATE使并发GET真实40P01。Boole仅将lockFacts的problem/instance/report三处READ改为SHARE，默认写仍UPDATE；真实双事务barrier先红后绿，原54用例逐字保留，完整PG55通过，21纯测文件338通过。Harvey独立SPEC、Newton独立QUALITY均通过；父再次执行真实barrier1通过（54项未选，不计整文件全绿）、默认API108文件1377通过、API构建及编译Worker8通过。原窄审native执行失败不算审查结果，保留于read-lock-fix。

## 6. 最终父验证与PR检查点

最终运行代码以功能PR head为准；本地开发base为e7ceb60、运行基线44f612b，不能把N3发布或早期测试替代本次结果。父已回读REQ revision304仍P0 / 开发中、六项业务字段完全一致；main仍44f612b，仓库public，未由代理改可见性。

| 门禁 | 实际结果及范围 |
| --- | --- |
| API默认测试 | 最后三处READ锁窄补后父重跑108完整文件1377项通过、无skip；751个API/根依赖输入前后一致，采用既有工具CRLF转LF指纹，不声称全RAW字节等同 |
| 真实PostgreSQL | 最后READ锁修复前父10完整文件258项、无skip，按治理64/过程74/系统120合成；修复后完整8D55项替换原54项证据，另有父真实barrier独立复验1项通过。258与55存在重叠，不相加；最终改动仅三处读锁和一个新case，不把前次751源一致声明扩到新树或声称其他PG文件已全量重跑 |
| Web | C独立三文件40项最终通过，另保留15文件145项；D四文件分别48/32/6/24通过；父两管理文件30项时427个Web/契约/根配置输入前后相同。分层证据不相加冒称全Web默认配置一次执行 |
| 契约/构建/工具 | 第二次Swagger生成和check通过；父Web lint/build通过，big-chunks告警保留；根工具11文件66项、归档隔离、静态Compose通过；最终READ锁修后父API构建、编译后Worker完整8项通过 |
| 独立审查 | B规格Herschel/质量Zeno，D规格Dewey/质量Sartre，A治理规格Mill及CLI返修规格Russell/质量Halley，C最终规格Aristotle/质量Rawls均通过。E近期认证门禁由Zeno窄轴SPEC通过，完整QUALITY Russell仅余READ锁P2，返修Harvey SPEC及Newton QUALITY均通过，无遗留已确认P1/P2 |

证据根为Git外`D:/WorkSpace/QMS-2.0-local/req0030-evidence/`，父合成汇总在parent-backend-final-v2/consolidated.json，保留原无完整退出的INTERRUPTED、失败/诊断和新完整文件结果。未通过全测试源码额外tsc检查的233条写集外诊断仍保留，不冒称这些类型检查通过；生产源码/CLI及实际执行测试门禁另列。

提交前再次实际核验：API lint、contracts:check通过；治理37文档/363本地链接/20来源复核/131依赖对及阶段五条目检查通过，文档/边界21项通过，diff无空白错误；未改维护项日期。实际record_id回读整个响应与上一批准快照一致（revision304、has_more=false），GitHub仓库仍public、origin/main仍44f612b。以下PR创建步骤由持续授权直接接续，不因此取得合并或发布授权。

## 7. 发布后人工验收清单（待执行）

| 角色/前置 | 操作与可观察结果 | 当前结果 |
| --- | --- | --- |
| 精确受控初始化后的平台管理员，源/目标内部组织明确 | 切换目标组织仍可查看适用管理功能和审计；普通同名admin或未获标记的岗位不自动升级 | 待验；未执行生产初始化 |
| 有权管理员，真实ZLGLB | 重查删除依赖，明确当前命中类型/数量和处理路径；只有真实满足空节点保护才由负责人决定删除，不能用本地legacy夹具当作该节点根因 | 待验；未读取该节点实际原始数据 |
| 审计读取/导出人 | 中文动作、英文片段、完整码查询与导出一致；从组织/删除依赖定位正确scope/resource；非法深链拒绝 | 待验 |
| 班长/PQC与只读用户，桌面/375px及缩放 | 有权者可见登记并保存，原未知事实/多物料/关闭资格不变；无权写拒绝；宽表局部滚动、页头及键盘操作可达 | 待验；未伪造真实几何截图 |
| 获权工程师与负责人 | 登记→选择来源发8D→制程跟进只见正式8D→按风险/负责人等筛选→工作区/附件/当前或批准报告，状态与期限准确 | 待验 |
| 对应真实单据职责人/跨组织管理员 | 管理员可按授权读目标报告/附件和配置，不代理owner/专业/管理审批；配置写超5分钟要求重新认证，已有回执也不绕过 | 待验 |
| 出货报告维护人 | 独立导航/路由/工作标签，原查看/创建/关联/归档与离开保护不丢，台账不再混入报告列表 | 待验 |

合并/部署、生产配置/管理员初始化、实际删除、人工验收及Issue/飞书回填分别核准。不自动进入N4，不关闭REQ-0025/0026/0027或本REQ；没有生产数据回滚/异地灾备演练或人工确认就不记录该项PASS。
