# 台账删除、权限同步及用户管理实现计划

## 当前摘要

2026-11-17负责人已确认全部方案并要求推进，REQ0039/reczz28ac6coijUr rev374实际待评估、直接会话授权开发，rev375追加两原始截图，未代改状态/优先级。Issue132，V0.0.56，codex/ledger-user-optimization，基线已部署f7fef0f；前轮归档及既有$null保留。权限165已应用冻结，无schema/166；Swagger生成及check通过。三主线SPEC→QUALITY全部通过；用户主命令及dirty真实问题已修，最终旧caller全部有效通过，台账Web8完整164有效组合、删除完整14、邻近PG5完整23、目录29/27、控制台路由71通过。真实生产preview/API/MFA/编译Worker三场景有效组合全部通过（首1PASS2脚本FAIL，修locator和明确草稿放弃后用户1及台账1分别PASS），含1440/390/320、认证顶层hit-test/焦点恢复、删除后Worker不回写、运行时异常零。当前整合最终门禁执行中，随后一个PR；尚未提交或发布。

**目标：** 按[批准规格](../specs/2026-11-17-qms-ledger-permissions-user-management.md)实现三条业务主线，保原专业流程和数据授权。

**架构：** 复用软归档边界与公开领域引用接缝、现有AdminMutation/Worker和LedgerTable偏好；专属功能权限用追加迁移等价拆分；用户管理复用现有独立组件，以四页签承接原动作，不复制业务提交逻辑。

**技术栈：** NestJS/Prisma/PostgreSQL、React/Ant Design、生成契约。无新依赖。

## 任务与所有权

- [x] 主代理：核批准范围、需求查重及真实字段，创建REQ0039/Issue132并回读；版本/分支隔离、保前轮归档。
- [x] 权限实现代理：API权限目录/投影及专属守卫、165追加权限迁移、Web菜单/context/AI和映射消费者及真实PG/相关Web回归；SPEC→QUALITY通过。
- [x] 删除实现代理：复用archivedAt无需166/schema变更，删除DTO/controller/service/Worker与IMS去重守卫、领域公开引用接口及相关测试；最后DTO边界P2实际HTTP修复并通过完整14项。
- [x] 用户弹窗代理：四页签、未知主/子命令与原调用方完整有效回归；SPEC→QUALITY通过，测试适配仅收窄定位和更新已批准交互语义，原FAIL保留。
- [x] 台账Web实现代理：现有ProcessDefectLedgerPage及删除对话框、列偏好最小接缝、搜索及完整相关回归；复用生成DTO，SPEC→QUALITY通过，真实PW由父接续。
- [x] 主代理整合：错误/审计中文名、契约生成/检查、文档及来源索引、治理/归档/Compose、API/Web lint/build均通过。无新App注册需求。
- [x] 独立SPEC→QUALITY：后端、台账Web、权限及用户全部通过，原P2及FAIL保留，完整报告Git外。
- [x] 主代理真实验收：一次性PG 55636/browser库165、真实API/编译Worker/生产Webpreview/MFA，管理员默认投影、三宽度/四页签/敏感按需/认证层级与焦点/选择删除及列恢复；普通拒绝和共同锁竞态由实际HTTP/PG证据覆盖。
- [ ] 最终提交/推送单一PR关联Issue132和REQ0039，精确head CI/Review；后续按有效授权接续合并与逐版本部署、快照/实际迁移数/三服务同SHA和公网只读验证。
- [ ] 最终回归、Issue只记录实证保持开放，不代人工验收/飞书状态；精确清理自有资源，本地发布归档不重复触发部署，保历史main/分支/$null。

## 验证矩阵

| 主线 | 必需真实结果 |
| --- | --- |
| 删除 | 单条/跨页/当前页选择，正式引用阻断，预览后引用/版本变化拒绝，原子性、幂等重放撤权、来源重投不复活、AI/补配不回写 |
| 台账 | 录单默认列、已保存自定义保留、旧默认定向恢复、待完善待补配可读、关键词、顶部紧凑工具栏及三宽度 |
| 权限 | 拆分前后普通岗位有效职责等价、无扩大、新delete未自动给write，管理员单独platform:admin可达操作，普通无权/跨组织/撤权重放拒绝 |
| 用户 | 单一行按钮、四页签独立动作、draft/busy/unknown和身份ABA、敏感按需、强删预览和嵌套认证层级、任职摘要完整可读 |

每个新Windows验证shell先加载Enter-Qms.ps1；Git外证据`D:/WorkSpace/QMS-2.0-local/ledger-user-optimization-20261117/`。重测试/构建/浏览器经同OS mutex串行、单worker。真实测试与迁移前检查资源身份/源码冻结；原失败留新label，不加case timeout/不关motion/不拿Mock代真实验收。对仍有效的旧范围可按影响分析复用，不冒称全量重跑。

## 沉淀目标

交付前在权限治理及前端实施规范记录新增功能必须同步目录/菜单/context/后端/岗位选择器/允许拒绝回归；记录用户多页签的秘密按需与草稿保护、台账已删除来源不可复活。不泛化无实际使用者的新框架。

## 验证接续记录

- 自有`qms-ledger-user-pg`、`qms_ledger_user`，127.0.0.1:55636/tmpfs/512MiB/1CPU；164链与seed后追加165成功，均Git外留证。独立`qms_ledger_user_browser`已165链+seed，未连接55440。
- 权限：`permissions-green-01`七文件66PASS/1FAIL，唯一completion归档夹具缺新delete授权，不降低新权限规则；六个纯权限文件有效PASS（含迁移read/manage/writer精确等价、二次幂等和管理员投影）。completion在删除后续完整文件覆盖。父`permissions-directory-parent-final`实际只执行console-context完整29PASS，另一个输入路径拼错未执行，不能声称两文件；实际platform-admin-context在`platform-context-parent-final`另完整27PASS。
- 删除：`delete-green-02`五完整文件79/79，含删除8/补配8/生产13/复制10/AI40；首审计reason白名单判断父误读，实际旧键为ingestionReason。后发现原ingestion-audit明确隔离其他领域通用reason，父收窄为deletionReason:300，删除metadata/断言同步且`delete-green-03`完整8/8。原审计FAIL与其余阶段RED/超时不覆盖，独立后端SPEC审查进行中。
- Web权限：`permissions-web-green-01`五完整文件55PASS/1FAIL，仅旧AiApplications busy例10秒预算耗尽；父补无channelread不能新增应用的真实RED后最小gate，`applications-parent-final`10PASS/1busy超时；无源码变化的独立`applications-busy-isolated-diagnosis`该case9353ms PASS，因此此文件11唯一用例为有效组合，不称单次整文件GREEN。禁止因此增加预算/关闭动效。
- 旧治理caller使用旧configurationread期待工序表的RED已确认，现只在该夹具显式增加拆分后process-quality:configuration:read，保持迁移前等价测试语义，不重新扩大实际普通岗位权限；完整回归进行中。
- 用户：原单按钮缺失3真实RED、未知删除父窗保护1真实RED、只读任职入口1真实RED；多次JSDOM可见态/用例10秒以及合批240秒中断日志保留，父最新dialog完整1PASS3超时不作GREEN。独立SPEC发现MFA/临时密码及任职未知命令可被改内容/刷新覆盖，必须冻结原命令并提供同key恢复或明确放弃，正在原实现代理返修；未将测试超时猜作产品/环境根因。
- 需求附件首绝对路径上传被CLI校验拒绝，无写入；切到用户原Temp目录使用相对路径后两图上传成功，rev375。无读取或外发额外用户资料。
- 删除DTO QUALITY真实P2：非字符串ID被ArrayUnique回调直接toLowerCase导致两个HTTP入口500。六项真实HTTP RED吻合；typeof守卫后UUID校验返回400。首GREEN另有旧锁屏障统计缓存失败，测试每轮清PG统计快照而不改生产锁/预算；`delete-quality-green-02`完整14PASS。独立QUALITY增量关闭，并通过台账Web与权限质量审查。
- `api-neighbor-final`完整5文件23PASS，覆盖旧台账、HTTP、正式发单、真实keyring CLI及旧应用迁移；`api-build-final`与`api-lint-complete`退出0。`permissions-callers-final`配置guard完整8PASS及Language有效PASS，控制台两个旧fixture失败；修正为新专属module/read正向及拒绝语义后`console-migration-complete`完整71PASS，原FAIL保留。
- 用户原两项SPEC P2修复后4完整文件16项有效组合PASS；`user-final-1..3`完整dialog4/lifecycle2/readonly1PASS。原整合profile发现matching-remote仍dirty，旧状态字段已独立为动作却残留比较；positions/MFA旧完整测试仍有10秒超时，保原断言和预算后继续精确查询适配。独立增量SPEC同时发现主窗启停/普通保存未知请求可被关闭或新body覆盖，旧整合队列已按自有PID/命令精确中断，见Git外parent-interruption.md；不把中断或旧单例绿灯当全部完成。
- 最终用户主窗普通命令真实语义RED为`user-main-command-red2`，首RED停用双字空格选择器失败仅记fixture FAIL；冻结action/helper/path/body后`user-main-command-green1`完整6PASS，`user-profile-main-fix-full`完整8PASS。子组件4文件16有效组合继续有效；普通主窗与子窗所有P2经独立SPEC/QUALITY增量关闭。
- 用户旧caller有效完整文件：dialog4、lifecycle2、readonly1、target9、forceDelete40、interactions22、draftguards4、permissionmatrix25、AdminPageidentity27、LegacyAuthorization14、MFA10、positions8、profile8、temporaryPassword5；每文件完整结果由user-complete有效项及各返修唯一label组成，不称单次全量。原超时、旧fixture和不支持的matcher失败完整保留。改动仅精确scope/label、重查已卸载节点及等价原value/body/隐私断言，未提高预算/关motion。
- 真实浏览器：`browser-release-first`首3项1PASS2FAIL；API删除/编译Worker不回写已PASS，其余为测试漏明确放弃dirty与把带aria-label的Space误当region。`browser-release-retest`用户已过三宽度/认证顶层后取消按钮精确名未考虑AntD双字空格，后一登录入口超时也保留，未判产品错误。`browser-user-final`完整单场景1PASS（11秒），`browser-ledger-final`完整单场景1PASS（9.1秒），与首已过API/Worker合成3有效场景，均零pageerror。未执行物理手机或生产业务写入，不代人工验收。
- 最终冻结整合：`final-gates-summary.json`六任务exit0，API lint、Web lint/build、contracts check、governance（38文档/531链接/20来源/173批准依赖）、archive通过；API生产build、Compose和diff-check也通过。产物main `index-Co02VB5P.js` / CSS `index-CYp3ZYGP.css`。独立最终QUALITY检查最后6完整caller121项有效组合和PW/门禁，无未修P0–P2。父实际查看390用户窗和1440台账截图，未据截图代写人工批准；第三方AntD弃用/既有chunk警告保留，未扩无关优化。
