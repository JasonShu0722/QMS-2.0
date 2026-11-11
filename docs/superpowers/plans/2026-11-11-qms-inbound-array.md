# 外部API统一对象数组实施计划

> 项目qms-superpowers-zh路由subagent-driven-development/TDD及独立SPEC后QUALITY。

## 当前摘要

| 项 | 当前事实 |
| --- | --- |
| 目标/批准 | 负责人明确根正文改对象数组作为通用规则；采用每项非null对象、允许空数组、一次请求一收件的最小语义 |
| 映射 | REQ0036/Issue97追加；branch codex/inbound-array-payload，base/main6f885bb，预留V0.0.46；2026-11-11远端无开放PR，V45已用，提交前复核 |
| 授权 | 指定行为修改沿现有开发/Issue/PR及本会话持续上线授权接续；不代业务联调、凭据操作、Issue关闭或飞书回填 |
| 状态 | 实现/契约/双审/真实API69项、Web相关回归与浏览器2项通过，API/Web构建、contracts、Compose、治理和归档通过；未提交/发布 |
| 工作区 | 活动D盘，其他任务dirty为console-feedback计划/FRONTEND-DESIGN，保留并排除；Node24.21/pnpm11.19、Node1GiB单worker重命令串行，禁止55440 |
| 下一步 | Issue97追加→V0.0.46查重/提交PR→精确CI/Review→mainCI/自动部署及公网契约验证；保留CredentialPanel先前查询成本失败与最终3/3通过事实 |

## 任务与验证

- 父登记Issue97并维护本设计/计划/API-INTEGRATION/SECURITY/历史规则后续决定及FOUNDATION/索引；公共错误文案、生成契约由父统一，不碰其他任务两dirty。
- 新实施代理独占inbound.service/controller，API直接与邻近接收成功fixture、Web ApiIntegrationsPage/ConnectionCopy及其测试、既有api-integrations浏览器fixture；先写真实数组201/旧对象400与copy数组规则RED，父运行后才生产实现。先通知DTO/controller冻结供生成；其他调用方fixture所有受影响根对象发送须改数组，保全部拒绝/限流/容量/审计/历史断言，不能只删测试。
- 一次性PG146链真实HTTP相关完整测试及Web完整文件、API/Web build、contracts generate/check、治理/归档/diff/Compose；真实浏览器登录/MFA后复制新说明，数组无头发送并检索纯文本/201204。历史已存对象读取继续验证；无迁移/加密变更，备份轮换证据按无变源码可复用。
- 独立SPEC后QUALITY，范围数组边界、契约/说明一致及一次收件/历史安全；发现即修后限定复验，正确结论不重复全审。
- 本地验证后预留V46查重→提交推送PR关联Issue97无自动关闭→最新headCI/Review→获准合并→mainCI/自动部署完整日志/公网契约和资源核验。失败保留，不rerun刷绿。
- 自有资源精确ID/label/PID清理；Issue最小追加回读，不写飞书/关闭；发布事实本地归档避免重复发布，旧生产凭据不调用。通用对象数组规范沉淀于本设计/API-INTEGRATION/Swagger/复制说明，历史对象兼容仅限读取。

## 实际验证记录

- 真实API RED：数组请求原400、对象请求原201；Web旧说明/复制RED；前一次Web运行受Go内存分配失败中止，未当业务RED。实现后六完整PG/API文件69/69 PASS/32.128秒，覆盖数组空/单/多项、非法根/项、并发、限流、容量、审计、删除/清理及公开边界；历史对象读取夹具保留。
- Swagger generate/check PASS，契约请求体为array/items object；API build PASS，Web build PASS/30.56秒。Web相关Page11/Receipt8通过，真实CredentialPanel3项最终18.66秒全部通过（先前两次查询成本超时记录保留，数组文案无关）；其它管理对象写API未改数组。
- 真实一次性PG146/API/Vite登录/MFA浏览器2/2 PASS/38.3秒：复制数组说明、无头发送多对象数组，201/204、检索纯文本、撤销删除/同码隔离保持。自有API/Vite/PG按PID/ID/label/tmpfs清理；未连55440、不使用生产凭据。
- 独立array_spec SPEC PASS、array_quality QUALITY PASS；当前来源摘要未发现过时项。剩余治理、PR/main/部署和真实发送方联调待，不能把本地验证写成上线。
- Compose配置、治理（38文档/506链接/20来源/161依赖/阶段覆盖1PASS）及归档隔离通过，当前远端main6f885bb无开放PR；预留V0.0.46，提交前再次查重。CredentialPanel首次两次10秒超时记录保留，最终最小查询收窄后完整3/3 PASS/28.69秒，不能把旧失败归因数组。

## 证据位置

Git外D:/WorkSpace/QMS-2.0-local/inbound-array-20261111，实际PASS/FAIL/未覆盖分层写FOUNDATION。其他任务文档先读仅保留，不承诺其发布验收。
