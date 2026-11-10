# API接收取消幂等卡控实施计划

> 使用项目qms-superpowers-zh路由的subagent-driven-development和test-driven-development执行，独立SPEC后QUALITY。

## 当前摘要

| 项 | 当前事实 |
| --- | --- |
| 目标/批准 | 负责人明确去掉Idempotency-Key设计与卡控，常规可逆接缝自行处理，不重复方案确认 |
| 范围 | 外部收件不要求/读取该头，每次独立记录；回执201/204；调用说明/复制/Swagger/观测/测试一致，JSON对象要求保持 |
| 映射 | REQ0036/Issue97追加，branch codex/inbound-without-idempotency，base/main/生产4aff557；预留V0.0.44，2026-11-10远端无开放PR、未见版本冲突，提交前再核 |
| 授权 | 指定本地开发、沿常规Issue/PR及本会话明确持续上线目标接续；不操作生产凭据/数据，不关闭Issue或写飞书 |
| 状态 | PR107已合并main434afa1，候选CI/Review及整tree核对成立；新mainCI42780611795 Web6 PCN pending测试超时FAIL，部署被阻；V0.0.44-fix1定向返修中 |
| 工作区 | 活动D盘，起点clean；前期用户CodeGraph及发布归档在codex/local-archive-20261110保留，不混入；Node24.21/pnpm11.19/1GiB单worker重命令串行，禁止55440 |
| 下一步 | 原PCN完整baseline真实RED后最小查询/时序修复→原11完整GREEN/限定双审→fix1 PR/mainCI→自动部署及公网；原发布失败保留，不rerun刷绿 |

## 实施与写集

- [ ] 父登记Issue97，阅读当前接收代码/调用方、批准设计，锁定新语义。根拥有迁移/schema、公共错误文案、生成契约、权威设计/计划/SECURITY/运维/API接入指南/FOUNDATION和索引。
- [ ] 一个全新实现代理负责api-integration收件service/controller/dto/interceptor及直接集成测试，Web调用说明/复制配置及其测试，必要浏览器旧断言。先冻结缺头201/同号多次独立入库及复制无旧协议RED，父真实执行后才改源码；代理禁止测试/构建/Docker/Git重命令。
- [ ] 父146让body_digest nullable，保历史，不删除数据；按需调整受影响运维fixture以证明新NULL记录可恢复/轮换。不修改管理端Idempotency-Key处理。
- [ ] 真实一次性PG全迁移/相关完整API文件及邻近parser/admin、Web相关完整文件、API/Web build、contracts generate/check、Compose、治理/归档/diff；重命令一次一个，原失败和未覆盖如实记录。
- [ ] 独立SPEC后QUALITY，范围含新旧数据/契约/观测/历史及管理幂等隔离，不扩大审查。真实浏览器登录/MFA复制无头配置并用对应临时凭据无头发送两次证明独立接收；不调用生产token。
- [ ] 验证审查后查版本/head/base、提交推送PR关联Issue97无自动关闭；精确CI与Review后获准合并、mainCI与自动部署完整日志/公网证据。失败保原实际FAIL，不rerun刷绿。
- [ ] 精确清理自有PID/容器，Issue结果最小追加并回读；最终发布事实本地归档，保人工来源联调待验，不反复推文档触发部署。

## 沉淀与证据

权威规则以本次设计及API接入/SECURITY同步为准，旧阶段计划保留历史并加后续决定引用。Git外证据目录D:/WorkSpace/QMS-2.0-local/inbound-without-idempotency-20261110；接收重试可能多记录是明确行为，不另建自动去重。最终覆盖/失败/限制写FOUNDATION；不得用生产匿名HTTP替代真实登录行为验收。

### 实际实现与验证

- [Issue97追加](https://github.com/JasonShu0722/QMS-2.0/issues/97#issuecomment-6761510566)已写并回读，复用同目标不新建事项。全新remove_inbound_idempotency代理独占API收件/观测和Web说明/复制及直接测试，父公共schema146/错误文案/契约/运维fixture/文档整合；所有重命令父串行执行，代理未运行测试或Git。
- 旧145链真实PG/HTTP RED：缺头期待201实际400、同旧key不同体201实际409，2FAIL/17按名称过滤；Web真实RED 1FAIL/10过滤（curl仍包含旧头），非编译环境失败。最初shell pattern管道被cmd解析未启动runner，随后安全caller pattern执行取得上述有效RED。
- 146迁移及Prisma generate通过：只body_digest DROP NOT NULL，不删历史/索引；API新行省略列存NULL，messageId=receipt UUID。Swagger生成通过，无Idempotency-Key/200/duplicate。
- 三完整直接PG/HTTP文件39/39 PASS/16.074秒：无头/非法/重复旧头、原key同/异内容、并发八份、未知提交/响应丢失重试新增记录、实际密文字节容量和audit回滚/撤销竞争、观测隔离保持。
- 邻近六完整真实PG文件73/73 PASS；同命令误写common/integration-public-boundaries不存在使整体exit1，六文件有效证据不抹去，纠正真实路径后连公共error/audit四完整文件287/287 PASS/5.05秒；不调整业务断言/超时。
- Web5完整文件39/39 PASS/167.39秒，含copy/curl无旧协议及ABA/失权/clipboard失败、历史请求检索、删除原管理幂等重试、admin writer；独立no_key_spec SPEC PASS后no_key_quality QUALITY PASS，静态结论不代运行。
- API build通过；此时后续Web build、真实browser和恢复/轮换仍待，不提前标PASS。
- 后续Web build PASS/31.98秒Vite，已有chunk-size提示保留；一次性146真实PG+私有MinIO备份恢复8/8 PASS/18.57秒、密钥轮换5/5 PASS/10.45秒，新NULL摘要及服务端编号恢复/轮换后保持，实际密文字节/凭据/删除历史计账保持。只是小样本技术证据，不代表全容量/异地灾备。
- 真实浏览器两完整场景2PASS/35.7秒：真实登录/MFA/页面维护/永久凭据两次复制，实际配置无旧头；用复制凭据无头发送201及再次相同正文另一份201、关回执三次204/五份实际行且NULL摘要，按服务端编号检索和纯文本正文、撤销/删除/同码新接口隔离保持；浅深及窄屏覆盖依原脚本。未使用生产凭据或发送生产业务数据。
- PG/MinIO均精确ID/label/tmpfs检查后销毁，API/Vite按PID/父命令核后停止，3136/5186空闲，未连接55440。CodeGraph CLI当前PATH不可用，未重装/初始化，跨文件接缝已定向读源码，不据图谱减少门禁。
- contracts:check、Compose基础/扫描/生产quiet、归档隔离通过。治理来源链依次暴露运维/数据保护引用摘要、MAINT003来源、台账上游摘要未同步而FAIL，定向读消费者并更新实际摘要后最终PASS：38文档/502链接/20复核/161依赖及阶段覆盖1PASS；MAINT003仍open/原期限不动，无生产持续告警新结论。提交前再次远端核main4aff557/无开放PR、V0.0.44无冲突。
- 暂存162来源摘要及28文件核对通过、diff检查通过；V0.0.44提交d8cda2f2f5cd42b44359fbbb200b2b198e32cb46已推，[PR107](https://github.com/JasonShu0722/QMS-2.0/pull/107)与[Issue阶段结果](https://github.com/JasonShu0722/QMS-2.0/issues/97#issuecomment-6762112065)均回读成功。CI42778770683 attempt1和Codex Review尚在跑，未提前声称上线。
- PR107最终42778770683 attempt1 24/24 success、同head Review completed/any=false/unresolved=false；父独立premerge核head/base4aff557/mergeable后squash合并main434afa1b1ee7025abf3f23785965c8eb1dab466c，Git全tree与候选相同。新main push CI42780611795独立运行，部署尚未发生，不用PR绿代main。

### V0.0.44-fix1 发布门禁返修

新mainCI42780611795 attempt1的Web6 job129709557049实际FAIL：SupplierPcnPage.test.tsx的`does not offer to discard the PCN while approval is pending`超过原10000ms，片1FAIL76PASS/16文件。日志没有具体卡点，不能把宿主慢或某一帧当根因；其余作业仍待全终态核验，部署不会因局部绿而执行。父完整本地baseline也真实10PASS/1FAIL，同case12765ms，文件67.158秒/总83.23秒，不是“只CI偶发”的推断。

沿[Issue97修复登记](https://github.com/JasonShu0722/QMS-2.0/issues/97#issuecomment-6762518985)，新branch codex/inbound-no-key-release-fix1基于434afa1，预留V0.0.44-fix1。全新pcn_release_fix1仅拥有既有PCN测试，正向查询限定真实台账/Drawer、等待真实可见再交互，原全局无discard AccessibleName否定、POST/pending拒关闭及finally释放保持，不改timeout/motion/CI/产品。API/146/契约未变化，原无头真实收件/恢复等证据按范围继续有效。修后原完整文件及限定SPEC后QUALITY、新PR/main及实际部署须另验，不向已合并PR107补推。

旧main最终24项22success/2failure：唯一Web6 PCN超时，foundation129714632718为`web-tests must be success`派生；其余API/4PG/15Web片通过。[自动deploy42782230464](https://github.com/JasonShu0722/QMS-2.0/actions/runs/42782230464)/job129714769457 completed/skipped，未SSH或实际上线。修后原完整11/11 PASS/61.04秒，目标case8978ms仍原10000预算；独立no_key_spec限定SPEC PASS，QUALITY接续。没有修改API/Web生产或迁移，原有效证据复用。

fix1独立QUALITY读实际baseline/green日志后PASS，治理先报告该测试来源摘要未同步，限定复核FRONTEND来源后更新准确摘要，最终38文档/503链接/20来源/161依赖及阶段覆盖1PASS。提交前main434afa1、无开放PR、fix1未被占用；修复仅测试+两记录+一来源摘要，不重新执行无变API/browser/build。

### V0.0.44-fix2 测试清理接续（仍PR108）

fix1候选d9b5fdb已推[PR108](https://github.com/JasonShu0722/QMS-2.0/pull/108)，[Issue登记](https://github.com/JasonShu0722/QMS-2.0/issues/97#issuecomment-6762705503)回读。首CI42782944144 attempt1全部终态22success/2failure：Web1 job129717227796的16文件252断言全PASS，但2个环境销毁后uncaught `window is not defined`，栈指rc useDelayState的ms timeout，归属session-window.test.tsx；foundation129722368902仅web-tests派生。PCN所在片已过、其余API/PG及15Web片过；Review无发现不覆盖CI失败，未合并/部署，也不rerun。

准确根因范围：实际AntD Form的errors/warnings各useDebounce，空数组10ms/非空0ms；底层useDelayState没有卸载清理，符合CI栈，日志不能确定具体哪个字段。Button默认boolean loading不走ms，已排除最初猜测。仓库password-submission已有cleanup后act等待源码10ms的先例。新实施代理session_teardown_fix2只session-window本地helper/afterEach及真实Form自检，原19case不变、无全局clear/吞异常/改依赖/production/timeout/motion。

父原完整baseline19PASS无uncaught，只CI是真异常RED；新增真实Form计时器自检取得1FAIL/19按名称过滤，helper仅cleanup后剩3timer期待0；加精确10ms settling后session-window20+password-submission10两个完整文件30/30PASS/48.17秒，无uncaught。独立限定SPEC PASS，QUALITY接续；[fix2登记](https://github.com/JasonShu0722/QMS-2.0/issues/97#issuecomment-6762877023)已回读，沿PR108提交fix2不另开重复PR。
