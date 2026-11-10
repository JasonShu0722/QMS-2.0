# 切回窗口静默验证实施计划

## 当前摘要

| 项 | 当前事实 |
| --- | --- |
| 目标/批准 | 2026-11-10负责人明确修复已认可的无感方案，正常切回不闪白/不阻断，真正会话与权限失效保持原安全边界 |
| 映射 | Issue105；分支codex/focus-revalidation，origin/main/生产d9d2a92，接续本地归档971d2ee；预留V0.0.43提交前查重，无飞书REQ，不重复原API接单 |
| 授权 | 本地实施/Issue/验证后PR沿项目持续授权，本会话持续修复上线意图接续集成发布；生产账号/权限变更、关闭Issue、台账回填未授权，不代办 |
| 状态 | 实现冻结，独立SPEC及QUALITY通过；核心118项按受影响文件组合通过、下游104项、API页/client36项与真实浏览器2项通过，Web构建通过；尚未PR/发布 |
| 工作区 | 唯一活动D盘checkout，用户.gitignore/AGENTS/ENGINEERING-TOOLS/来源索引四dirty保留，不混提交；重命令单worker/Node1GiB串行 |
| 下一步 | 完成API页/client邻近回归及治理/归档检查，提交PR；精确新head CI/Review→获准合并→mainCI/自动部署及公网资源核验，实证写FOUNDATION |

## 任务与写集

- 一个实现任务由全新代理负责apps/web/src/features/auth/session-invalidation.ts、AuthenticatedRoute.tsx、session-verification.css、console/ConsoleLayout.tsx、ConsoleEntry.tsx及各自邻近测试。耦合交互不拆并行写。先改旧focus阻断期待为新pending/网络无dialog、草稿/焦点/同次事件合并，新增真实失效优先/ABA回归；旧explicit安全信号阻断测试保留，不能只删断言。父实际RED确认后才改生产，禁止代理独立跑重命令。
- 父统一文档/Issue/索引来源摘要、现有真实一次性PG+API与浏览器新focus-resume.spec.ts。API契约和迁移无变按有效证据复用，不无故生成或全业务阶段验收。Web受影响完整session/console/entry/reauth/client/观测及API页测试按调用影响运行，Web build、治理/归档/diff必须过。
- 独立SPEC按设计检查resume与安全信号分流、首次/路由不放宽、网络轻提示和实际可用UI、ABA/失效不复活；独立QUALITY看controller/generation/事件清理/重复检查、Modal/焦点/响应归属。父读完整log及实际diff，修后仅复验受影响范围。
- 浏览器使用真实一次性PG145链和API，真实登录/MFA及真实context，用Playwright延迟并放行原session/context响应，不用mock替代鉴权成功。父核无dialog/输入不中断/滚动焦点/同源数据不重拉，网络故障提示/重试、硬信号清敏；必要轻量fixture验证原安全dialog宽度，生产不改账号。
- 验证后主动分配版本提交推送一个PR，普通关联Issue105无自动关闭；精确headCI/Review→授权合并→独立mainCI→自动部署/公网资源核验。若门禁失败保留所有实际FAIL及派生/跳过，不rerun刷绿。资源按ID/label/PID精确清理，保用户修改；最终发布事实本地归档免重复部署。

## 证据与限制

证据目录D:/WorkSpace/QMS-2.0-local/focus-revalidation-20261110；Node24.21.0/pnpm11.19.0，浏览器单worker，PG512MiB/1CPU，禁止55440。本轮不修改服务端授权、数据库或生产业务数据；截图细框原因须以真实浏览器最终行为限定，不能凭截图称已捕获具体执行顺序。

### 本地实现与审查

- quiet_resume_implementation新代理承担一个耦合任务；父先运行5行为用例真实RED：5FAIL/64按名称过滤，旧实现确实开阻断dialog/隐藏入口；再最小实现。核心7完整文件首轮116PASS/2FAIL，两个失败分别是AntD双字重试按钮的可访问名称缺失、以及测试把保留Portal中的textbox出现误作前次明确重验已结束。补aria-label及等待真实dialog关闭，不改预算/motion/业务断言；受影响两完整文件34/34 PASS，与未改五文件84项形成核心118项有效组合，不称一次118全绿。
- 六完整下游文件104/104 PASS：ReauthenticationProvider、ConsoleHome、ConsoleObservationSummary、ApiMonitoringPage、DataExchangePage、ServiceOperationsPage；安全信号/拒绝/ABA用例保留。
- API页面/凭据/接收检索、公共admin-request与SessionVerificationGate五完整文件36/36 PASS。合计18个完整文件覆盖258项，分四次运行组合，不宣称全站单次测试。
- 独立quiet_resume_spec SPEC PASS后quiet_resume_quality QUALITY PASS，均限定源码/规格及质量静态审查，不冒充执行者。
- Web生产构建PASS（35.73秒Vite）；既有chunk-size提示保留，没有新增依赖或API/DTO/迁移变化。
- 一次性PG18真实145迁移链+seed成功，API3136/Vite5186真实登录/MFA及实际session/context响应：2浏览器场景PASS/22.7秒。人为延迟真实响应、显式派发浏览器focus/visibility确定性事件，验证无dialog/Modal草稿与输入焦点滚动不变/重复事件只一次session和context/业务列表不重拉；context网络中断后提示、实际重试200；真实服务端logout后恢复跳登录。它证明真实浏览器事件及HTTP路径，不等于物理多窗口和生产账号人工确认。
- API/Vite核PID/父命令停止，PG核精确ID/label/tmpfs移除，3136/5186端口空闲，不触及55440；cleanup.json为PASS。
- 2026-11-10提交前首次版本复核：远端main仍d9d2a92、无开放PR，Issue105已登记V0.0.43，未见冲突。最终提交前再核实际head/base；用户既有dirty始终排除。
- check:governance PASS：38文档/499本地链接/20来源复核/161依赖，阶段覆盖1PASS；check:archive-isolation及git diff --check PASS。API契约和迁移未变，未运行无关阶段/备份全套；云端完整门禁另验新head。权威安全/前端规则及两项真实来源摘要已同步，只暂存本任务frontend review，不混用户CodeGraph条目。
