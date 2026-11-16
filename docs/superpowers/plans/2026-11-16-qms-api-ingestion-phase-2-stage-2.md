# REQ-0038 API二期第二阶段：制程不良品入库具体实施方案

> 面向执行者：负责人已在本会话明确批准REQ-0038持续开发至PR/合并/部署。按qms-superpowers-zh执行TDD、实现子代理及独立SPEC→QUALITY；重测试/构建/浏览器串行单worker。下方需求登记阶段的仅文档边界保留历史，不覆盖当前授权。

## 当前摘要

2026-11-17：负责人已批准将[AI补充方案](../specs/2026-11-16-qms-process-defect-ai-description-supplement.md)并入同一PR，持续推进合并部署。追加输入变量、指定输出字段、多渠道/模型配置；参考Dify及n8n官方文档，复用原Worker/密钥加密及权限。开发不创建或借用真实供应商密钥、不外发真实业务数据、不修改生产配置。

| 项目 | 当前事实 |
| --- | --- |
| 授权 | 负责人明确“已更新需求状态…继续推进开发，直至完成PR、合并、部署”，沿用已确认规格；不代写生产业务配置或人工验收 |
| 台账 | REQ-0038 / reczz28aMCqsFOpX；user回读rev373开发中，负责人当前直接声明本人已更新状态并批准当前范围 |
| 前置 | REQ-0037入库引擎，关联REQ-0027制程/新品历史范围；不改原记录 |
| 基线 | 运行源码072479afed986c11553976c9180bf767d11dba98，本地f6dd064仅前轮归档；分支codex/process-defect-ingestion-plan，既有$null保留 |
| 状态 | Issue129/V0.0.55本地验证完成，待提交PR。基础API单测171文件2527PASS、领域18文件263有效PASS、Web15文件363有效PASS、管理员context26PASS，基础审查问题已修。162链已真实应用；AI API最终构建/类型检查及契约PASS，连接23项有效PASS、后续10项PASS，jobs完整4文件51PASS（含ABA、撤权重放、更新掩码、回退缺项、业务版本及失效连接下停用），在新专属release库再验51PASS；真实备份恢复8/8PASS。API及Web独立SPEC与QUALITY全部PASS，已知P2均关闭；Web最终9完整文件133唯一项PASS（AI19+旧调用方114），lint/build PASS。新release库领域/入库完整3文件102PASS；最终治理、审计目录10项、归档隔离及diff-check PASS。最终产物真实API/PG/编译Worker浏览器三场景有效组合PASS（首次2PASS/1FAIL，AI修正准确按钮名后1PASS），未把首次失败改写为整次全绿 |
| 下一步 | 提交一个PR，精确CI/Review通过后合并、部署、公网只读核验及本地收尾。真实供应商/IMS联调、物理手机与10GiB完整恢复为NOT_RUN，不代人工验收 |

**目标：** IMS不良逐条入现有制程台账，统一手工字段、缺项完善、关联快照与自动补配。

**架构：** 扩展既有入库目标，不复制收件、幂等或队列。制程领域拥有登记/快照/补配，组件领域仍拥有项目映射；复用Worker，不增加消息系统或通用转换平台。

**AI增量分工及验收：** connection代理独占渠道/模型/只写密钥/受控HTTP和160迁移；backend代理独占规则输入输出、描述任务/Worker/人工优先及161迁移和schema；Web代理独占配置/规则/预览/台账AI交互；父统一App注册、错误/审计目录、契约、文档、Git及串行验证。先RED再实现，覆盖多渠道模型合法性、仅发选定字段、文本/JSON输出、失败保底、旧响应与人工保护、密钥不可回读/换地址强制新key、管理员/普通及跨组织；真实供应商无获准凭据为NOT_RUN。基础证据按变化影响复用，描述写入和入库接缝必须复验。

**当前验证调度：** Git外`process-defect-ingestion-20261116/validate-serial.ps1`用Windows本地named mutex串行启动Node验证，已实际双进程互斥及非零退出码自检PASS；各实现者可在静态修复间排队执行，不再因人工“占窗”而让另一方空等。所有测试/构建/浏览器均经该入口，源码所有权及冻结要求不变。已结束/NEEDS_CONTEXT的代理使用followup_task唤醒，单纯send_message不触发下一回合；前端一次接续遗漏已纠正。原始FAIL、NOT_RUN及修复前证据保留，临时DIAG最终删除。

**技术栈：** NestJS/Prisma/PostgreSQL、现有Worker、Swagger生成契约、React/Ant Design、LedgerTable。

业务权威见[需求文档](../specs/2026-11-16-qms-api-ingestion-phase-2-stage-2-requirements.md)，特别是缺项入账、自动只补待补项、保历史且不开放批量刷新。

## 1. 源码调查与最小接缝

| 当前实现 | 已确认差距与动作 |
| --- | --- |
| ingestion.policy.ts和common/integration-master-data.ts只有四目标code/name | 增加PROCESS_DEFECT及目标专用字段；保四主数据严格校验，不把制程塞进伪code/name |
| ingestion.service.ts/ingestion-worker.service.ts已有历史父任务及分段队列 | 复用执行，扩展已入账但待完善/补配结果，不标成重试失败 |
| ProcessDefect已有数量/时间/产品工单工序产线编码及来源身份 | 复用原列，新增名称、班次、板块、关联快照、问题及接收定位，不另造台账表 |
| process-defect-ledger.service.ts create固定MANUAL，外部身份整组校验 | 增加真正IMS事务写入口，与手工新增/缺项维护分别校验，来源编号/时间可空 |
| view实时调用组件resolveForDomain | 新记录用持久快照，Worker补待补；读请求不写，旧未知历史不假造登记时结果 |
| component-project.service.ts读当前stage，matched还依赖productCategory | 制程按所需字段分别判可用，有有效项目先冻结项目组，缺细分类型单独补 |
| ProcessDefectEditor和台账已有宽松事实输入/数量列 | 新建四必填及默认1，缺项维护分次保存；补默认列/待补筛选，保原材料/附件/关闭/CAS/未知请求 |

## 2. 文件责任与范围

以下新文件是选定实现位置，不是已创建功能；开工先核最新目录和AGENTS，复用原模块，不为计划路径另造框架。

| 责任 | 工程内文件 |
| --- | --- |
| 登记/快照规则 | 新增apps/api/src/modules/process-quality/process-defect-registration.policy.ts；修改process-defect-ledger.service.ts、process-quality.dto.ts、process-quality.controller.ts |
| 制程事务适配 | 新增同目录process-defect-ingestion.adapter.ts，修改process-quality.module.ts |
| 板块与补配 | 新增同目录process-operation-sector.service.ts、process-defect-completion.service.ts，注册现有模块及apps/api/src/worker.ts |
| 数据结构 | apps/api/prisma/schema.prisma及追加迁移；编号采用开工时最新链之后的唯一号，不改已发布156链 |
| 入库接缝 | apps/api/src/common/integration-master-data.ts及modules/api-integration/ingestion.dto.ts、ingestion.policy.ts、ingestion-targets.service.ts、ingestion.service.ts、api-integration.module.ts；执行签名实际受影响才改ingestion-worker.service.ts |
| 入库UI | apps/web/src/console/api-ingestion/RuleEditor.tsx、ImportPreview.tsx、JobList.tsx、ingestion-ui.tsx |
| 录单/扫码 | apps/web/src/features/process-quality/ProcessDefectEditor.tsx、ProcessDefectLedgerPage.tsx、process-ledger.tsx、process-quality.css；新增ProcessTraceScanner.tsx |
| 板块界面 | 新增apps/web/src/features/governance/ProcessOperationSectors.tsx，挂入现有ConfigurationAdministration.tsx及管理宿主，复用授权/context |
| 权限与契约 | 按需权限目录、console context/nav、api/client.ts；Swagger生成packages/contracts/src/generated/api.ts，禁止手改 |
| 来源消费者 | 定向核process-eight-d.service.ts、new-product-eight-d-source.service.ts、process-production.service.ts及原导出；只修事实读取，不重建发单/指标业务 |

父代理负责Git、公共注册、契约、索引和资源；领域/入库/UI可按文件所有权分派，整合验证前冻结源码。无需为本次策划再启动实现代理或业务服务。

## 3. 数据与派生结果

1. 现有ProcessDefect仍为唯一事实，复用defectQuantity；四必需事实在IMS可空，手工新增严格完整。
2. 追加lineName/operationName、DAY/NIGHT或空班次、板块结果及规则版本，编码/名称分开。
3. 项目快照保存项目ID/代码/名称、阶段、映射/项目版本、关联时间；细分类型/板块分别保存结果及来源。选择有明确字段的受控快照结构，不存整份映射响应或人员隐私副本；按查询/索引消费者决定专用列。
4. 缺项issues和待补项目/类型/板块独立于FOLLOWING/CLOSED；待补扫描使用组织范围部分索引，不每轮扫全历史。
5. 业务记录关联原入库item、接收ID及行号，原事务保证同一来源行不重建；外部编号存在沿原唯一约束，无编号保持空，不伪造业务键。后补冲突明确提示并保数据。
6. 旧数据不回填1、发生时间或当前阶段；缺快照标历史未确认，不能读页面时伪补。新增结构采用追加迁移，兼容原查询、发单及历史。

不新增正文指纹用于业务去重；现有安全哈希、CAS、版本水位及证据摘要保原消费者。

## 4. 开发任务与TDD

### A. 登记、缺项及领域写入

- [ ] 新增apps/api/test/process-quality/process-defect-registration.spec.ts先RED：手工四必填/默认数量、IMS缺项/非法时间、班次边界/时区、描述0/false/长度和字段白名单。
- [ ] 最小实现registration policy；区分手工新增、IMS入库和缺项维护，不全局关闭验证。
- [ ] 新增process-defect-ingestion.integration-spec.ts先RED再GREEN：缺项入账、身份可空、同接收行复用、编号冲突、人工分次补全及事务审计。
- [ ] 全新一次性PG实际迁移/seed，验证原process-defect-http和process-defect-ledger完整文件。示例断言：

```text
manual.create缺traceCode => 字段拒绝，台账不增
IMS缺occurredAt/productCode => 台账新增，数量1，空字段且issues可见
同receipt+row重试 => 原台账ID，不重复新增
patch补traceCode => 可保存，其余缺项仍可查
```

### B. 板块配置、快照与自动补配

- [ ] 新增process-defect-completion.integration-spec.ts先RED：首次关联、分次补齐、项目转量产、单条/批量组件补配自动发现、归档/组织停用/CAS/Worker重启。
- [ ] 实现板块规则受控CRUD、唯一工序名、版本与审计；缺配置不猜测。
- [ ] Worker有界扫描待补对象，调用组件公开resolve端口；按仍缺字段补，成功及审计同事务，无变化不重复写。
- [ ] 实测新品快照→项目改量产→补细分类型，原阶段不变；后续新登记为量产，列表读取无写副作用。
- [ ] 检查实际新品/8D/统计/导出消费者，用持久关联口径；保已发问题与人工纳入关系。

### C. 入库目标及配置UI

- [ ] ingestion-policy.spec.ts/ingestion-targets.spec.ts先RED，增加制程目标、字段及权限；原四目标完整回归。
- [ ] 扩目标专用映射和有序描述配置，不放宽旧目标校验；保规则版本/水位/三策略及人工字段保护。
- [ ] 复用现有inspect/write事务，区分未知编号新对象与已知来源；待补是已入账结果，不阻塞后续行。
- [ ] ingestion-engine.integration-spec.ts及新制程文件覆盖历史父任务、自动多行、未知请求重试、旧来源/旧确认、容量/retention保护。
- [ ] RuleEditor沿现有样式，普通映射/描述组合/自动字段清楚；预览和任务链接实际台账ID，份数/行数/数量不混淆。
- [ ] 板块配置复用平台管理入口；platform:admin默认可见可用，普通未授权/跨组织拒绝，不改生产岗位。

### D. 表单、默认列与扫码

- [ ] process-ledger-editor.test.tsx、process-formal-ledger.test.tsx和ApiIngestionPage.test.tsx先RED，覆盖必填、默认1、分次补缺、默认列/偏好、筛选及描述组合。
- [ ] 表单及清单最小调整，保原物料/SQE/附件/责任分类/关闭恢复及未知请求原body/key；不另建录单台账。
- [ ] ProcessTraceScanner.tsx只在点击后请求相机，本地识码、成功只回填；支持的浏览器用BarcodeDetector，缺失时动态加载@zxing/browser本地解码，开工核维护版本并锁依赖。不用Chrome专属入口冒称全移动端兼容，不增加云端识码服务。
- [ ] ProcessTraceScanner.test.tsx测拒绝/取消/关闭/卸载/身份切换释放轨道、输入不丢；真实手机另测二维码/现场一维码，不用mock相机替实物证据。

### E. 契约、整合、真实验收及独立审查

未来开发从qms-2.0执行，每shell先加载D:/WorkSpace/QMS-2.0-local/Enter-Qms.ps1；PG环境在Git外，仅一次性资源，禁止55440。以下不是本轮已运行命令：

```powershell
corepack pnpm --filter @qms/api test --testPathPatterns=process-defect-registration.spec.ts
corepack pnpm --filter @qms/api test:integration --testPathPatterns='process-defect|ingestion|component-project'
corepack pnpm --filter @qms/web test src/features/process-quality/process-ledger-editor.test.tsx src/features/process-quality/process-formal-ledger.test.tsx src/console/api-ingestion/ApiIngestionPage.test.tsx
corepack pnpm contracts:generate
corepack pnpm contracts:check
corepack pnpm --filter @qms/api lint
corepack pnpm --filter @qms/web build
corepack pnpm --filter @qms/api build
corepack pnpm check:archive-isolation
corepack pnpm check:governance
git diff --check
```

- [ ] 新policy/两个集成文件完整执行，邻近组件/制程/入库/retention按影响分析回归；记录真实命令与PASS/FAIL/NOT_RUN，不以过滤用例数冒称完整集合。
- [ ] API/Web类型、生产构建、契约、Compose、模块治理；只为实际跨模块调用加批准依赖。
- [ ] 新增apps/web/playwright/process-defect-ingestion.spec.ts，真实API/PG/编译Worker覆盖默认管理员、IMS多行缺项、人工完善、自动补配、阶段冻结、三策略/四旧目标、1440与390/320几何。
- [ ] 独立SPEC后QUALITY，修复真实问题后复验影响范围；物理手机不可得保NOT_RUN及具体人工清单，不放宽超时/关motion/skip刷绿。

## 5. 登记、发布及闭环

- [x] 本轮：云端查重4个历史匹配、has_more=false，核19字段/选项；新建REQ-0038，写背景/期望及五方案字段，保旧REQ，不写编号/阶段/紧急程度/负责人/完成时间。
- [x] 写后回读reczz28aMCqsFOpX及9字段一致、无ignored_fields；截图附件另追加并最终回读，初始待评估→最终开发中属于外部变更，本轮未设或推断操作者；提交不等于开工。
- [ ] 获准开工：独立评审最新源码与方案差异，建/关联一个Issue，查重分配实现版本并建功能分支；本次文档版本不预占未来运行版本。
- [ ] 实现/适用验证/双审通过后提交推送并建一个PR，普通关联、不自动关闭；同目标修复沿原未合并PR。
- [ ] 精确head CI/Review通过且有发布授权后合并；核同树、完整mainCI、部署来源SHA/快照/迁移数/三服务健康及公网契约资源。
- [ ] 最终版本按S2-01～12角色/业务联合验收；真实IMS/手机不足明确NOT_RUN。获验收及关闭回填授权后再闭环，不代设批准。
- [ ] 本地归档保历史成果，精确清理自有资源，不动$null/其他库/分支/用户应用。

## 6. 规则沉淀及本轮验证

### 开工接续与当前证据（2026-11-16）

负责人当前消息直接批准全部已整理范围并持续至PR/合并部署，实时user回读rev373开发中；原登记时“操作者未核”已由负责人本人声明补齐，不再反复索要批准。Issue129已建立，V0.0.55作为本次完整实现号；原文档未单独提交发布，不额外消耗版号。活动分支沿codex/process-defect-ingestion-plan，旧本地main/前轮归档和$null保留。

实现代理：s2_domain_impl负责制程领域/追加迁移/补配Worker及受影响旧fixture；s2_ingestion_impl负责公共目标类型/规则/事务接缝及测试；s2_web_impl负责配置/录单/台账/板块/扫码及默认列共享最小接缝；父负责契约生成、错误码/权限公共回归、真实浏览器、Git/文档/资源及最终审查。共享文件所有权已明确，heavy窗口由父串行分配。

一次性qms-process-defect-ingestion-pg（codex.task=PROCESS-DEFECT-INGESTION，127.0.0.1:55636，512MiB/1CPU/tmpfs）实际157迁移及标准seed通过，随后追加158迁移及Prisma generate通过；已应用新迁移冻结不反复改。真实运行数据库qms_process_defect_ingestion，不连接55440。证据D:/WorkSpace/QMS-2.0-local/process-defect-ingestion-20261116/。

TDD首轮：registration16项12FAIL/4PASS为新规则缺失；policy先3FAIL/10PASS后完整13PASS，新增DST/分数时区进一步验证；Web首录单/扫码18项11FAIL/7PASS，后新增默认列/配置9执行6预期FAIL/3边界PASS，未选135不计执行。首契约生成实际build因新类型不兼容失败，已归各实现者修正，未冒称生成成功。

真实engine首完整75项69PASS/6FAIL；新制程目标共同失败由adapter advisory锁返回PostgreSQL void不能反序列化导致，已实证并分派修复，保首FAIL；旧69通过不代新目标成功。后续所有验证以最终证据接续，不用放宽超时/Mock/Skip刷绿。

扫码使用固定@zxing/browser0.2.1，动态加载fallback，pnpm新增依赖曾顺带更新无关transitive，父已恢复原版本/完整性，frozen offline install通过。安装写node_modules期间曾Jest缺fb-watchman启动FAIL，保工具失败记录；依赖恢复后需复验，不将其归为用例PASS。

### 整合接续（22:32，尚未提交）

contracts-second真实生成PASS，包含API生产build；新ProcessDefectProjectResolutionDto仅保项目/映射必要字段，不存工程师任职或配置审计副本。domain-extra先3FAIL/10PASS后3整文件29PASS；新增来源same-value/issue-only/legacy人工保护先3FAIL/7PASS后单文件10PASS。core相应3engine真RED后最小修proposedChanges、只传真实本次来源字段，最终engine79/policy15/targets-unit55/targets-PG18共4完整167PASS/104.771s。未变旧证据复用，新问题才复验。

Web有效整文件53ledger、7scanner、19editor、3sector合82PASS，tsc通过。板块首两轮失败分别按钮中文自动空格、表头/输入label歧义，限定真实dialog且保原断言后3PASS；无放宽motion/预算。独立SPEC确认projectCode只读字段不再提交、IMS只变化事实、来源编号补录三项原P1/P2关闭；不是所有Web邻近已通过，尚有11完整文件待跑。

18领域邻近首轮因未启动真实RustFS55637而首发连接拒绝，上传/扫描/证据/PDF后续为派生，runner240s到期，保FAIL/未确认其余文件。父补本任务自有版本化RustFS512MiB和ClamAV（PONG，实际约1.03GiB，上限4GiB），未改产品或Mock：2深链文件107PASS/182.814s；ledger10文件68PASS/1FAIL（共享500+待补队列首轮100未轮到测试对象）；consumers6文件86PASS/1FAIL（旧测试重复选同事实与新冻结口径冲突）。前者改真实有界多周期、不增limit/timeout；后者改为转量产前新建未选冻结源可选、转后新源被拒，保原范围/权限断言。两失败完整文件复验通过；18文件有效PASS263，原生JSON及各失败保留。

独立QUALITY两P2：B接收以编号更新A事实后，B去编号映射重处理会重建；受控登记历史漏工单/编码/来源时间的前后值。domain先3真实RED后最小可信linkedTargetId参数/find组织并集及write expected.id查回、history补四字段，3完整文件23PASS。core新增两engine真RED后修自有items+jobs查询及facade转发，不跨领域读表、不新建业务表；完整engine81进行中，并检查实际查询索引消费者。未修复且未复审前不宣布QUALITY通过。

父已新增真实process-defect-ingestion.spec.ts两场景，覆盖默认管理员规则配置、IMS全数组/缺项/分次完善、编译Worker补配/阶段冻结、桌面1440与390/320、不丢扫码关闭草稿及默认数量保存；尚NOT_RUN。使用本次生产preview减少内存，新独立qms_process_defect_browser数据库；真实物理手机/IMS源样例仍未取得，不以浏览器模拟代验收。

在docs/API-INTEGRATION.md和制程领域文档沉淀身份/缺项、快照/自动补配、份数/行数/数量口径；前端规范只补可复用规则，不填本阶段专有取值。来源索引按sourceDigest更新实际变更来源。

本轮仅需求读写回读、规格自检、check:governance及git diff --check，不启业务数据库/相机/浏览器/测试/CI/部署。首次查重因CLI不支持绝对@file路径失败，改为Git外工作目录内相对文件后成功；未发生写入，保留诊断。此前计划保存首patch因文档锚点不符整体失败，未留下半文件，随后拆分按准确锚点保存。

登记链接：[REQ-0038](https://larkcommunity.feishu.cn/record/SbOVrpsR1eDx4rcQzD6c9uoUn4c)。Git外证据D:/WorkSpace/QMS-2.0-local/process-defect-ingestion-planning-20261116/；registration-final-audit.json核9字段不变、附件211246字节、stage开发中、rev373；紧急程度和完成时间仍空。旧REQ无写入，未创建Issue/PR或启动开发。

本地文档归档版本V0.0.55：GitHub main072479a、开放PR/相关Issue及本地提交/计划查重无占用；本轮只本地提交，不把文档版本当运行发布。未来实现版本按实际开工时再分配，不预占部署号。检查覆盖中文口径、手工/IMS必填差异、首次有效关联与阶段冻结、无编号去重限制、相机释放、S2-01～12与任务A～E及交付映射；真实业务验收不复用为PASS。

### 最终整合验证接续（2026-11-17）

以下覆盖上方早期“未运行/进行中”状态，原FAIL保留。基础领域/入库SPEC及QUALITY问题均修复，来源关联由引擎验证后注入领域公开适配器；索引实测读取块121→8。基础API四个直接Jest分片合计171文件2527项PASS，无跳过；最初经package尾部`--`误传分片参数导致No tests的尝试为NOT_RUN，不计有效测试。原全量单进程OOM及缺审计标签失败保留，后续有效四分片已覆盖。新API最终build/lint与生成契约检查均PASS。

新release专属数据库从162迁移及标准seed建立，制程台账/制程入库/引擎3完整文件102项PASS，AI规则/任务4完整文件51项PASS；旧共享测试库retention一例5秒超时保留，未增加超时。AI两轴独立审查中五项SPEC、三项API QUALITY与一项Web QUALITY全部关闭并PASS，完整发现、修复和原失败证据在Git外ai/spec-review.md、api-quality-review.md、web-quality-review.md。

Web最终9完整文件133唯一项PASS（AI19、旧caller114），与原363项存在重叠，不相加冒充总量。连接CSRF失效后的导航busy仅在retire释放；真实RED后8项完整GREEN。旧台账Tooltip在约2.6秒已出现，主要耗时为全页按钮查询；限定真实Ledger工具栏owner后完整42项PASS、原用例4.6秒，未改产品Tooltip/动效或10秒预算。临时诊断均移除。最终Web lint/build PASS，产物index-B35snoxK.js、index-DolPiEhS.css；大chunk既有警告保留。

真实加密备份/独立数据库及版本化对象恢复8/8PASS，恢复后AI渠道停用/版本更新已覆盖；MAINT-002仍open、原2026-11-23期限不变，不以小样本声称10GiB能力。治理首轮发现数据保护来源摘要变化，复核并更新；本地17日对应UTC16日，日期校验首FAIL后按UTC记录16日，最终38文档/526链接/20来源、3open维护、171批准依赖PASS。审计目录10项、归档隔离和已暂存diff-check PASS。

最终生产产物、真实API/PG/编译Worker浏览器：browser-stage2-ai-final首次2PASS/1FAIL，前两场景覆盖多行缺项/补配/阶段冻结及手工扫码草稿与默认数量。AI连接GET实际200并含目标ID；三次诊断均证实行存在，首失败是AntD两中文字自动空格，后续规则编辑使用带规则名的aria-label。仅修测试准确定位，移除临时DIAG，不改正确业务逻辑或预算；browser-stage2-ai-rule-label-final第三场景完整1PASS/34.6秒，覆盖密钥不回填、所选输入/模型/JSON字段、非法模型400、三宽度无横溢、实际Worker生成、供应商失败保底及人工迟到建议。有效三场景组合通过，不冒称单次3/3；桌面截图捕获入场过渡帧、390图稳定，不能把过渡帧归为永久叠层问题。纯测试定位增量已由独立QUALITY复核PASS。

未连接55440或生产业务写入；供应商/IMS真实联调、物理手机扫码及近10GiB恢复为NOT_RUN。部署与公网证据将在实际完成后接续，不预填PASS。
