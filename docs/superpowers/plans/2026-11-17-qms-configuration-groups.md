# AI配置中心与多协议专项修复计划

## 当前摘要

2026-11-17当前授权：负责人已批准AI专项修复及fix小版本推进。[设计](../specs/2026-11-17-qms-configuration-groups-design.md)收敛为独立模型渠道/提示词应用、中心草稿发布版本与规则变量绑定、旧配置平稳迁入、四协议；最新取消独立制程配置入口，原工序板块映射留平台配置。提交前云端main仍174dd10、开放PR为空，预留V0.0.55-fix3，复用REQ0038/Issue129。活动分支codex/configuration-groups基于已部署174dd10，原发布归档在旧分支保留，既有$null不动。163/164迁移已实际应用并冻结；18完整API文件255项及9完整Web文件207项有效组合通过，独立SPEC/QUALITY均PASS。最终API/Web构建、lint、契约、治理/隔离/Compose通过；真实API/PG/MFA/编译Worker/本地四协议HTTP四业务场景组合通过，加载完成后两新页三宽度几何及桌面/390截图已核对。当前接续一个fix3 PR及精确CI/Review、合并部署；不改生产配置或飞书状态。

## 当前实现与验收

最新范围调整：负责人取消独立制程配置入口。提示词中心与入库规则绑定继续实施，原工序板块映射保留平台配置；本轮不新增制程专用配置页面。对应Web导航/caller和浏览器断言按此接续，下方初始摘要的独立入口表述由本条取代。

父负责Git/版本/文档、资源、App/API公共模块注册、错误/审计目录、Swagger生成契约与治理。各代理文件所有权隔离；重测试/构建/浏览器经Git外ai-center-20261117/validate-serial.ps1同OSmutex串行、单worker。

- [x] 协议代理：旧渠道默认Chat、四协议DTO/HTTP/持久化和163追加迁移；官方协议文档核验，真实受控HTTP、PG、密钥/SSRF/响应错误与当前连接回归。
- [x] 应用代理：中心草稿/发布/停用、版本及样本试跑，164追加迁移；旧规则配置归中心与版本绑定、任务快照、组织/权限/CAS/幂等；真实PG迁移及引擎/AI完整回归。
- [x] Web代理：AI独立菜单及真实路由、模型协议/应用管理及试跑、入库变量映射和版本选择；平台配置保原工序映射，管理员可达/只读拒绝、dirty/busy/未知/身份ABA及窄屏，使用生成契约不重复DTO。
- [x] 最终整合：API/Web lint/build、contracts generate/check、governance/归档隔离/Compose、真实API/PG/编译Worker/浏览器三宽度；独立SPEC→QUALITY，真实供应商与手机NOT_RUN。
- [ ] 一个fix3 PR，精确head CI与Review通过后合并，同树mainCI/自动部署/快照/实际迁移数/三服务健康/公网新契约与资源；Issue发布记录保持开放。
- [ ] 仅本地归档发布事实、精确清理自有资源，保留历史main/分支/$null，不重复推送归档触发部署；不代业务验收。

## 本地验证事实

证据统一位于Git外`D:/WorkSpace/QMS-2.0-local/ai-center-20261117/`；原始FAIL/NOT_RUN保留，不覆盖旧标签日志。

| 范围 | 有效结果 | 证据与边界 |
| --- | --- | --- |
| 四协议及连接 | 7完整文件47/47 PASS | `protocol-complete-green`；HTTP33是其子集，不重复计数；官方文档来源及首次404保留于`protocol-sources.md` |
| 应用、迁移、领域、规则与AI | 7完整文件78/78 PASS | `application-release-final`，原生Jest JSON逐文件；真实PG及受控本地HTTP |
| 原入库引擎 | 完整92/92 PASS | `application-release-engine-final`；旧库2项5000ms失败保留，新库同预算2919/2731ms通过；未增加case预算 |
| 旧任务守卫及标签返修 | 3完整文件40/40 PASS | 先5条真实RED，后`application-spec-legacy-green`；该集合被最终78项覆盖，不重复计数 |
| 管理员与拒绝边界 | 完整26/26 PASS | `admin-context-final`，平台管理员无需代改岗位，普通未授权两新API拒绝 |
| 审计 | 2完整文件12/12 PASS | `audit-metadata-green`，新增动作中文名及有界protocol/publishedVersion元数据 |
| API及契约 | PASS | `api-build-release-final`包含最后enabled重放授权修复；`api-lint-final`、`contracts-first`生成及`contracts-check-final`实际通过 |
| 文档/模块/归档/Compose | PASS | `governance-final`：38文档、528链接、20来源、171依赖；`archive-final`、`compose` |
| Web回归 | 9完整文件207唯一用例组合PASS | scope104、绑定7、中心6、ConsoleLayout33、平台guard8、工序3、入库页46；分别完整执行，不称单次全量207项。4caller合批240秒中断未计PASS，分文件均未增预算。中心标签trim的真实RED后改`label ?? ''`并完整6项GREEN |
| 真实浏览器 | 4业务场景有效组合PASS | 首完整4场景2PASS/2FAIL（新定位器has包含绝对dialog作用域错误）；改为真实键盘操作后`browser-center-ai-final`3PASS（含手工重复项），四唯一场景组合全部通过。`browser-center-layout-final`1/1PASS补加载完成断言，实际验证两新页1440/390/320与应用弹窗三宽度；父读取最终桌面/390图片。首轮加载帧截图保留，不充作稳定视觉证据 |
| 最终Web编译 | PASS | `web-build-final-reviewed`及`web-lint-final-reviewed`覆盖最后中心标签修复；之前构建/类型证据及重复接管构建原样保留 |

已保留失败分类：缺实现RED；163尚未应用导致的列缺失属于前置环境FAIL，不称绑定功能RED；旧错误码兼容及跨组织渠道引用均实修；近期认证401误断言按既有403修正；新启用规则幂等回放撤权真实RED后仅补初始授权数组；JSDOM动效准备帧与透明Select输入断言修为实际交互，真实可见几何仍须浏览器证明。SPEC/QUALITY报告分存`spec-review.md`、`spec-final-review.md`、`quality-review.md`，协议/后端/Web均PASS；最后标签兼容问题已闭合，审查不代替实页运行。

真实供应商密钥联调、物理手机、其他尚未接入业务场景及生产人工验收为NOT_RUN；本地受控HTTP不能改称实际供应商连通。

## 已撤回草案历史

以下为已撤回方向的历史清单，不是当前执行授权或完成情况：

- [ ] 核主干/已有归档与版本，创建功能分支并在Issue129记录返修范围。
- [ ] 新实现代理先RED分类/深链及dirty/busy保护，再复用原组件最小实现，完整受影响caller回归。
- [ ] 独立SPEC→QUALITY；Weblint/build、治理/隔离、真实浏览器新分类与管理员入口/窄屏。
- [ ] 一个fix3 PR，精确head CI/Review后合并，同树/mainCI/部署/公网核验。
- [ ] 本地发布归档不重复推送；清理自有一次性资源，保留旧main/历史分支及既有$null，Issue/人工验收分别记账，不改飞书状态。

父负责Git/版本/文档/生成及资源调度；实现者只改平台配置及必要新文件/caller tests，重任务OSmutex串行。原FAIL真实保留，不增预算/关motion刷绿。最终台账只有实际结果；真实账号业务验收与物理手机另列。
