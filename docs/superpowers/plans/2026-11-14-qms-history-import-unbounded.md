# V0.0.52-fix1 历史导入总量限制纠正

## 当前摘要

| 项目 | 当前事实 |
| --- | --- |
| 授权 | 负责人明确否决历史100份/10000行限制，数量不可控，不接受手动拆批；复用本会话修复、PR、合并部署持续授权，不代改生产业务/台账或关闭验收Issue |
| 映射 | Issue121/原入库119，V0.0.52-fix1，codex/history-import-unbounded，基线已部署6a0c2c92ce5a46092561ca3307d42d5ffc257af0；远端无同号预留/开放PR，原本地归档135cad2和历史main及$null保留 |
| 状态 | PR123 headb1f5289 CI43581909372为24/24PASS。自动Review发现共享owner取消后原PENDING父任务未刷新；fix5扩展现有批量SQL同步PENDING/COMPLETED引用，保留BLOCKED原解锁条件及PAUSED/CANCELLED。真实RED→GREEN、独立库qms_history_fix5_final156迁移/seed及API6文件155PASS、tsc、增量SPEC/QUALITY及治理通过；其他未变证据继续有效 |
| 下一步 | 提交推送V0.0.52-fix5至同PR123，精确新head CI/Review后合并部署及公网核验；不写生产业务/台账，不关闭Issue |

本计划接续[原维护计划](2026-11-14-qms-receipt-filter-reset.md)。原V0.0.52的历史上限及要求缩小范围的文案被负责人本次指令覆盖，原发布/失败证据作为历史保留。

## 固定行为

- 历史时间范围一次预览/确认，接收份数和行数没有100/10000总量门槛；不静默只导一部分，不要求用户分时段操作。
- 内部按小段展开/处理是负载控制，不是整个导入的上限。FIFO、原行顺序、原有去重/重处理generation、规则快照与旧确认防覆盖继续有效。
- 预览在数据库固定接收记录ID及顺序，不能提交时重新套时间范围。未知旧正文条数显示“后台统计”，不能把部分计数冒充总数；确认基于有效接收集合，不因未知总数被禁用。
- 提交立即建立一个可见历史父任务，内部每份接收对应原有lazy子job；Worker在数据库游标处规划、展开和处理。新推送在预留历史序列后入队。PAUSE/RESUME/RETRY保留游标，CANCEL终止未规划/未展开与所属子任务，不能规划完就误报整批业务完成。
- 未过期预览、未展开/未完成任务及待确认正文被删除和保留清理一致保护，仍占原组织/接口容量；已经不存在的正文不能凭空恢复。
- 历史总量不因旧10000 jobs/100000 items总数再被拒绝，活动工作集分段控制，队首保留推进能力避免后队占额度死锁。现有实际正文存储容量/网络/鉴权/字段校验保持，不承诺物理资源无限。

## 最小实现接缝

1. 新增preview_receipts快照表及索引；receipt.row_count可空，新收件直接写，旧记录Worker读取时补；jobs新增next_row_index/expansion_complete，旧任务默认已展开。实测后追加最少parent/planner引用字段，复用现jobs/Worker，不建立新的通用框架。
2. HISTORY preview数据库INSERT SELECT固定集合、统计已知条数，不同步解密全量。SINGLE原选择及部署前十分钟旧HISTORY selections继续有效，不修改旧migration。
3. submit沿已有管理幂等/active会话/当前和配置者权限，在接口锁内复验规则版本；仅同步建立父job，jobIds返回父ID。已知receiptCount一次预留1+count序号：父为首、子为parent.sequence+ordinal+1，后续AUTO自动排在整批后。Worker分段创建子job，不同步返回尚不存在的全部子ID，不逐份做JS事务往返。
4. Worker小段展开items及推进cursor同事务；行唯一约束防重。SINGLE也须识别已排队尚未展开的全量job，不能反向重复。payload通用读取不再拒绝历史合法大数组。
5. 保护谓词同步IngestionService.receipt、IntegrationRetentionService两层、IntegrationReceiptService删除；已引用的快照不能随预览到期或规则删除丢失。DTO rowCount/total可空及expansionComplete，必要父批次进度经Swagger生成。默认job列表显示顶层，父详情聚合子条目，ImportPreview与JobList显示后台统计/准备，不误呈现0/0已完成。

## 规模失败与设计修正

100000份真实metadata探针：构造8290ms、预览4089ms且份数100000/条数null正确；原“同步SQL建全部job”提交超过50秒，代理仅取消自有PID163，事务回滚、未生成job。原scale-probe.json为FAIL保留，不能以定向131PASS替代规模验证。

已批准将job注册也移至后台planner：每轮固定小段，只是内部负载控制；父保持聚合状态，规划完成后仍需等待子任务执行，不阻塞子任务且不允许后来的AUTO越过预留历史序列。父取消/暂停/恢复/重试与未规划输入保护须同时成立。该修正替代初版同步全部jobIds及无父任务约束，不修改已应用00300，使用追加00400。新探针验证常量提交及首段推进，不伪称metadata探针等同十万份业务落库。

首轮SPEC两项恢复缺口：父RETRY需一次接管所属未终止PENDING子任务；跳过最后处理失败行后仅解除处理失败父阻塞，不能旁路授权阻塞。Web父任务的聚合items必须保留真实子jobId并可查看差异，不能被原单job守卫过滤；普通job和条目详情继续核验身份。分别追加真实回归。API完整运行的retention超时及一次PowerShell启动OOM均保留为FAIL；不凭推测新增索引、不提高超时，重验证串行，核实测试累计与生产路径实际成本。

后续独立DB首轮23FAIL：首个测试无序选择子任务导致错误对象为空，残留PENDING任务污染全局Worker，后续断言连锁失败。修复fixture选择ORDER BY sequence、每例精确取消自建组织的未完成任务后，同6文件138/138PASS（68.521s），未改生产timeout。新父规模探针只注册一个可见父任务，首规划500份均无错序；不代表十万正文全量落库性能。QUALITY新增终态结果保留缺口按追加迁移处理，不永久保护已完成正文阻止清理。

Web诊断：768MiB verbose为41PASS/1父详情timeout，分段计时确认多层弹窗角色查询占约2秒/处；改为局部标题/按钮定位，保持全部业务、可见性和权限断言，差异按钮查询2136ms→16ms，定向7.93s→5.82s，完整42/42PASS（189.49s）。512MiB原240s未完成、768MiB编译OOM保留；实测空闲5439MiB后1536MiB单进程lint/build通过，未加测试timeout或关闭motion。Ant Design height NaN及既有chunk体积告警保留，不扩展修复范围。另两次Git外验证入口参数/运行时校验在启动前拒绝，未执行业务测试；正确入口重接，不作为业务FAIL或PASS。

真实浏览器：首轮后台统计精确文本定位不匹配、一次详情按钮未按接口收窄导致重复编号命中均已修正；两次规则页签导航超时保留，随后相同功能路径未复现，不武断归因。最终browser-history-final-retest为2/2PASS（1.6m）：有效platform:admin默认权限、四目标真实编译Worker、差异确认、101份完整成功、10001行接纳/首段实际写入后主动取消、旧接收筛选清除、父聚合详情、老认证无密码复验。10001行测试主动取消余量，不声称全量完成；十万份仅metadata规模，不声称十万正文全量性能。最后只移除临时导航诊断日志，不改生产源码、业务操作或断言；复用相同路径证据，CI继续执行清理后的完整文件。

PR123审查反馈：自动Codex指出首次lazy展开与首行写入同事务，失败回滚后itemId已不存在，recordFailure提前退出。真实trigger两case RED复现，最小修复将items/cursor展开提交为独立步骤，下一轮处理首行；RETRY/SKIP、目标回滚、失败项可见及FIFO恢复均GREEN。原三个测试补一轮展开步骤，保持最终断言，完整6文件142/142PASS（66.903s），最新lint/build、独立增量SPEC/QUALITY通过。首CI先发现的web-tests(6)失败为子弹窗正文已挂载未可见，该分片其余107PASS，改为异步act完成点击后先等内容挂载再等可见；不加timeout、关motion或删断言。原head完成及未完成CI结果均分开保存，新head重新走完整门禁。

首head最终CI43573249319为21/24PASS：web-tests(6)为上述新测试等待失败；web-tests(13)为7个未改业务文件22FAIL及onTaskUpdate超时，包含超时/隐藏标题/任职选项等，foundation为依赖汇总失败。完整日志及逐项只读审计保留；未扩展修改这些业务文件。新head daec17f对应两分片及全部24项通过，不能把旧FAIL抹成PASS。该head自动审查新P2为parent聚合SINGLE/AUTO失败但重试仅直属owner；真实RED2后补聚合owner、状态刷新、暂停/取消范围，独立质量审查又指出A/B共享owner的原父阻塞需同步恢复，按真实共享回归继续处理。新head第三轮须覆盖修复，原CI绿色不替代新提交验证。

fix3最终证据：复用、范围隔离、A/B共享阻塞和人工暂停均有真实PG RED→GREEN；父重试只重置表示范围内失败及授权，不复活CANCELLED/其他组织或generation，不解除其他owner的人工PAUSED。原150项运行为149PASS/1既有retention5s timeout，保留FAIL；新建release独立DB156迁移+seed后同6文件150/150PASS（66.991s），未增加timeout。暂停修复仅SQL状态CASE，lint/tsc通过，同结构build与未走暂停分支的真实Worker/browser证据复用；最终精确head CI仍完整运行。最新browser-reused-owner-final为PASS（1.5m）。00600索引针对真父查询，100000子任务+10000旧顶层任务的EXPLAIN从过滤10001行、1512缓冲页、3.615ms变为实际父索引20页、0.262ms；仅为此读取消费者新增索引，110001探针行已精确清除。

fix4证据：规划完成但尚未展开的共享owner没有items，原重试查找只依赖条目，会漏掉授权撤销后的空子任务。单个OR补充同manifest收件匹配，普通任务planningPreviewId为空不会扩大控制范围；真实旧actor持续停用、替代管理员从B恢复A、事实只写一次RED→GREEN，连同暂停/范围隔离5项通过。独立fix4库156迁移+seed、完整6文件151/151PASS（80.261s），tsc及增量SPEC/QUALITY通过；无DTO、迁移或普通浏览器路径行为变化，复用未变构建/浏览器证据。Git网络阶段未关闭证书校验、未改代理全局配置或重写分支；原API提交说明末尾换行校验拦截后修正，blob/tree/commit与本地同SHA验证通过才非强制更新ref。

fix5证据：共享owner被另一批取消后，原PENDING父不再永久占用正文；已完成引用在共享失败重试时立即恢复PENDING，其他来源仍有工作则保持PENDING。覆盖已展开/未展开取消、正文过期释放、COMPLETED引用重试、非重叠来源隔离，真实RED与最终4/4GREEN均保留。独立fix5库156迁移+seed、完整6文件155/155PASS（78.179s），tsc通过，主代理已核对原始日志与退出码；生产仅现有一条批量SQL条件变化，无DTO/迁移变化，未变浏览器和构建路径按影响分析复用，最新CI仍完整执行。

## 执行与证据

- 主代理独占Git、文档、生成契约、资源准备与整合；API代理拥有本模块/迁移/保护调用方与真实PG测试，Web代理拥有入库预览/任务组件与UI测试，重验证串行单worker，不连接55440。
- [x] 负责人范围核对、同Issue纠错登记、隔离分支与版本查重、只读架构评估。
- [x] API真实PG RED→最小实现→GREEN；超过100份/10000行（含单份历史大数组）、去重/重启/顺序/快照/清理删除保护/权限/取消/队首推进；完整6文件140PASS，独立SPEC/QUALITY均通过。
- [x] Web未知数量和准备任务状态、可取消/恢复、旧成功回执与近期待认证保护回归；生成契约后类型/构建，完整42PASS。
- [x] 父真实Worker与浏览器整段历史提交及任务可见验收，独立SPEC→QUALITY，最终相关构建/治理/Compose/归档门禁。
- [ ] 新修复PR关联121，精确head CI/Review后合并，逐SHA核主干、迁移快照/三服务健康及公网更新，Issue/人工验收继续分开。

证据：D:/WorkSpace/QMS-2.0-local/history-import-unbounded-20261114/。保留每次真实FAIL/中断与最终PASS，不使用Mock/Skip代替PG/Worker/浏览器。迁移或编译前置失败先修原因，不提高超时掩盖同步全量处理；可复用未变化且有效的既有权限/领域写入证据。

文档沉淀：API-INTEGRATION及原维护设计/计划明确取消总量门槛；内部chunk与业务总量分开，手工拆批不作为恢复办法。人工手机/实际业务数据准确性与机器验证分层。
