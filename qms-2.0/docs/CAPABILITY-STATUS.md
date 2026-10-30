# QMS 2.0 能力状态总账

## REQ-0032 CP-1 运行发布确认（2026-10-30）

[PR84](https://github.com/JasonShu0722/QMS-2.0/pull/84) / V0.0.36含fix1已部署 `a15b68d0b692f1f70372b3ce70e52ac4ec25c977`；精确PR/main各16项CI成功、PR同head审查无发现，deploy40998606131实际成功。迁移前加密快照→2份迁移/136链→同SHA API/Worker/Web与健康→公网六新契约/index-DoHWJMZd.js/四匿名401机器核验通过；部署后默认builder cache实际回收4.615GB。完整证据和人工角色/多窗/视觉清单见[总计划](../../docs/superpowers/plans/2026-10-29-qms-management-console.md)。

这是CP-1机器发布，不是完整控制台或人工业务验收；CP-2观测/外部连接器未交付。生产来源转换、额外赋权删除、绑定启用、关闭REQ/Issue和飞书回填未代办。下方本地候选、旧失败及“只到PR”文字保留历史范围，当前以本节和总计划最新授权/运行事实为准。


## REQ-0032 CP-1 本地候选（2026-10-30，未发布）

独立管理导航/主题、个人账号新窗口入口、现有管理与流程配置迁入、直属岗位、兼容迁移/解除/历史来源及真实事项首页已形成本地候选。复用原身份、权限、领域服务与生成契约；不将业务待办/审批搬入配置，不新增外部同步引擎。分项及父整合证据见[总计划](../../docs/superpowers/plans/2026-10-29-qms-management-console.md)，失败与修后结果分层保留。

本节不声明 PR/CI、部署或人工验收完成。CP-2 真实观测仍未交付，外部连接器未接入；代码候选不等于生产来源转换、额外赋权/删除或绑定启用。负责人退出夜间后只收敛到 CP-1 PR，heartbeat 已删除，不自动合并部署或进入 CP-2。

## REQ-0031 运行发布确认（2026-10-29）

[PR #81](https://github.com/JasonShu0722/QMS-2.0/pull/81) / V0.0.35含fix1～fix8已部署`7fc80d407a65be4b6a10b683360c36b440812227`。最终PR/main各16项CI成功、精确head代码审查无发现；deploy40837564917实际成功，迁移前加密快照→4份迁移/134总链→同SHA API/Worker/Web及公网新契约/index-DBeXnAmn.js/4匿名401机器核验PASS。详见[实施计划第15节](../../docs/superpowers/plans/2026-10-28-qms-req0031-admin-lifecycle.md)。

组织、部门/科室和用户受控强制删除、当前配置失效补配、四域在审责任失效与恢复、跨组织真实平台身份治理已是运行版本能力，不再重复开发。永久删除不抹历史UUID/业务租户/审批签章，存续账号补配保MFA。生产管理员是否具备有效platform marker仍须实际身份核对，迁移不会按admin用户名赋权。Issue #80/REQ保持开放，人工验收、真实删除/补配、生产赋权/流程启用未代办，不自动N6。

下方候选、失败、未提交或未部署记录保留其历史范围，当前运行事实以上述发布确认为准。


## REQ-0031 发布前本地候选历史（2026-10-29，V0.0.35 / Issue #80）

负责人已批准组织、部门/科室及用户强制删除、失效配置补配和跨内部组织平台管理治理进入开发。当前在`codex/req0031-admin-lifecycle` / PR #81：fix7已推b029dae，原Web1已在该head成功，但最新CI40826739866为Web8候选可见性失败连带foundation，其余14项通过；canonical审查新P1指出用户补配误用永久删除清MFA，前轮无发现不代替该head。fix8同批区分存续补配与永久删除目的、保原因子/封锁及凭证撤销，并仅在候选测试等待真实可见条件；两项各自独立规格后质量、父80真实PG/App与46API单元、76完整Web及原23文件284项组合、构建/契约结果见计划第14节，原失败保留，新head另验。heartbeat已取消，不自动合并或部署，线上仍是N5的`86d68f8`。权威接续、初失败、源码冻结及独立审查见[实施计划](../../docs/superpowers/plans/2026-10-28-qms-req0031-admin-lifecycle.md)，不能沿历史文字重复开工或把本地候选当线上能力。

已实现追加删除事实/历史租户/明确替代迁移，真实平台身份上下文、三类强删、待配置以及四域失效责任恢复的服务器与正式页面；供应商账号可从精确profile或全平台最小目录治理，包括未关联档案和原owner失效的账号。保留原业务租户、审批/签章及审计，不连带删除存续下级、岗位、账号或供应商企业，不代审。最终API单测153文件2267项、集成193文件2380项和Web58文件743项完整文件组合覆盖及新构建独立Worker8项已有证据，原FAIL不抹除；实际Edge及PG已补验全平台孤立供应商账号强删与历史保留。最后测试查询修复窄审及提交门禁接续，未关闭REQ/Issue，未配置生产真实管理员、启用流程或删除生产数据。

本表是当前能力状态的导航，不替代各模块规格、阶段验收日志或生产发布批准。状态只在有对应证据时更新。

## N5供应商完整8D已发布（2026-10-28，机器核验PASS）

V0.0.34含fix1～fix4 / [PR #79](https://github.com/JasonShu0722/QMS-2.0/pull/79)已部署`86d68f8506165bae2650986ba2b0cbbcac77825d`，覆盖供应商独立完整8D、来源复制/披露、延期、任务/通知、报告/PDF及闭后补充。最终PR/main各9项CI、deploy40684505960成功，快照先于7迁移、三服务同SHA及公网30条契约/新JS/6个匿名401核验PASS，详见[N5计划第8节](../../docs/superpowers/plans/2026-10-28-qms-n5-supplier-eight-d.md)。这是代码及机器部署，不是生产业务配置或人工验收；岗位授权、发布绑定启用、真实资料释放和角色验收未代办。Issue #78/REQ保持开放，组织强制删除仍只有新方案，不随N5修好；不自动N6。下方早期状态保留历史范围，当前运行以本节为准。

## N4完整客户/新品8D已发布，N5独立开发中（2026-10-28）

V0.0.33含fix2 / [Issue #76](https://github.com/JasonShu0722/QMS-2.0/issues/76)、[PR #77](https://github.com/JasonShu0722/QMS-2.0/pull/77)已部署a60a189503ff63717aa8bb1a6cad74a7dfbd8c56，交付客户problemId完整8D、新品selection同源闭环及追加空组织受控删除修正。最终PR/main各9项CI成功、同head Code Review无发现，部署40562446790成功；迁移前快照、3迁移、同SHA三服务及公网34条新契约/新JS/6个匿名401实际核验PASS。源测试接入失败、修复和分层证据见计划6.7～6.10，不冒称首次一次全绿或人工业务验收。N5 / Issue #78继续常规独立开发；夜间授权已撤回、20分钟heartbeat已删除，合并部署另核对授权；不代配生产岗位、启用绑定、实际删除组织或关闭需求，N5代码不在本次发布。

PR #75 / V0.0.32含fix7已部署7cd2707f1003546474cac72f6701aa6d8bfc0226。精确PR/main各9项CI成功，Code Review无发现，自动部署40464507159成功；前置加密数据库快照、4份迁移、三服务同SHA、公网新JS/18条台账解析契约及6个匿名401机器核验PASS，详见[计划5.11](../../docs/superpowers/plans/2026-10-26-qms-n4-customer-and-new-product.md)。生产岗位/任职配置及人工验收未由代理执行，客户完整8D/新品及N5仍未交付，不自动开工下一单元或关闭REQ。

PR #75返修按负责人要求集中收口，资格恢复、归档、未知动作隔离、导入预览/提交一致和候选/能力同步证据见[N4计划5.10](../../docs/superpowers/plans/2026-10-26-qms-n4-customer-and-new-product.md)。API全量及相关完整文件分层回归、编译Worker、构建/契约均有真实结果，初失败与组合覆盖保留；发布依据为5.11对应精确版本，不以REQ状态或旧head成功替代。

2026-10-28授权接续：负责人已取消本次夜间交付，应用管理工具确认删除20分钟heartbeat，随后要求继续开发。当前仅按常规实现、独立审查、验证及提交推送PR推进N5；不再沿用夜间自动合并部署授权。Issue #74/#76/#78保持开放，真实组织岗位、人员授权、流程发布/绑定启用及人工验收仍由负责人处理。上文夜间授权和下文旧阶段状态保留历史时点含义，不覆盖这一最新边界。

三入口、映射/派生值、两态与解析正式页面已实现，客户原始清单附件与解析附件分区；独立真实浏览器两完整用例贯通实际岗位及上传/扫描/下载，Web最终160完整文件1821项取得组合覆盖，原查询超限失败和完整单文件返修保留，证据及限制见PHASE-4与计划。客户完整多源8D、新品同源、供应商受控复制/闭环仍有明确缺口。不能把首单元或旧客诉行内报告当N4/N5完成；本次不接N6 IMS/AI或指标绩效，不自动关闭Issue/REQ。

## REQ-0030 上线反馈修复（2026-10-26，V0.0.31-fix2已部署，待业务验收）

负责人将REQ-0030调整为P0 / 开发中并明确立即启动，user回读revision304；[Issue #72](https://github.com/JasonShu0722/QMS-2.0/issues/72) / V0.0.31-fix2按[修复计划](../../docs/superpowers/plans/2026-10-26-req0030-admin-process-fix.md)接续管理员内部组织全量适用授权、初始化组织受控删除及依赖说明、审计关键词和制程页面入口。这里的明确平台管理员范围覆盖此前仅本组织全量的局部管理员定义，普通岗位和供应商权限不自动继承。

[PR #73](https://github.com/JasonShu0722/QMS-2.0/pull/73)最终head f23d01b的CI40315522373和合并后28cc304的main CI40321569614各9项成功，最新Code Review无发现/未处理项，延期读取锁P2已关闭；独立Security Review未运行。main实际PG125文件1676项及Worker8项通过。Actions部署40323717205两次分别因Git SSH和构建ENOSPC失败，原记录保留；负责人清理后手工部署28cc3049d35cf837be386d03bc32789fa3f84f01，提供21:11:00–21:19:54同次快照/镜像状态/成功退出证据，代理公网新JS、新契约及4个匿名401核验通过，按[计划6.4](../../docs/superpowers/plans/2026-10-26-req0030-admin-process-fix.md)登记为多来源机器发布核验，不冒称Actions成功或业务人工验收完成。

当前运行发布为28cc304；下方44f612b是N3含fix1历史基线。生产平台管理员精确来源初始化、流程绑定、ZLGLB实际阻断/删除和真实角色验收仍分别办理，不按账号名自动赋权，不关闭Issue/REQ或写Base状态，不自动N4。本地发布归档不额外推送触发Actions，负责人可恢复闭源。

## N3过程人工闭环（2026-10-26，V0.0.31含fix1已部署）

[PR #71](https://github.com/JasonShu0722/QMS-2.0/pull/71)已合并并部署44f612bab92a787e64dfc04f97295b3e343cd332，过程人工台账、完整内部8D、协作/延期/待办及网页/PDF运行代码已上线。最终PR CI40255961669及main CI40257750060各9项成功，deploy40259187725成功；迁移前加密快照、5份迁移、同SHA API/Worker/Web及公网19条新契约/新JS/4个匿名401已核验，详见[N3计划6.5](../../docs/superpowers/plans/2026-10-25-qms-n3-process-eight-d.md)。

Issue #70及REQ-0026/0027保持开放，两实际记录最近回读revision300仍开发中；IMS/AI与其他域未随本轮开通。生产实际岗位/人员、流程发布/绑定/启用与角色人工验收尚待准备，不把代码部署当作正式业务开通。负责人恢复正常规则后单次批准本轮部署，不自动接续N4，夜间heartbeat已删除。fix1的100个不同附件上限与在审关闭延期入口已随本版交付；原失败/中断、整文件复验及组合覆盖边界保留在计划6.1～6.4，不改写为首次一次全绿。

以下N2及更早记录均为各自发布时历史，当前运行版本以本节为准。发布后文字归档仅本地提交，不额外推送触发Actions；相关CI/部署已结束，可由负责人恢复闭源，代理不改可见性。

## N2-B 流程接续（2026-10-25，V0.0.30含fix3已部署）

负责人明确“继续推进开发，直到需要我开源的时候停下来并告知”，复用Issue #66及仍开发中的REQ-0026，分支`codex/qms-n2-workflow-foundations`基于生产main70fdbab，V0.0.30预留。B1策略 / 真实组织预览、B2固定版本审批轮次、B3职责待办 / 通知、B4设计器配置 / 候选草稿及发布守卫已本地实现及独立双审。API1441集成 / 802单测 / 独立Worker8通过，Web134文件1272项分组与受影响文件复验覆盖通过，build / lint / 契约通过；原失败及额外测试类型检查非零见N2计划9.10，不是一次全量全绿或上线状态。两份追加迁移108→110，旧任务唯一约束和旧图语义不改。

实现与验收证据见[N2计划第9节](../../docs/superpowers/plans/2026-10-24-qms-n2-configuration-and-workflow-foundations.md)。[PR #68](https://github.com/JasonShu0722/QMS-2.0/pull/68)及独立fix3 [PR #69](https://github.com/JasonShu0722/QMS-2.0/pull/69)已合并，最终生产a32615ce245ae2242e8b1607aa6c564c244e0de7；PR / main完整9项各通过，deploy40194990586成功，迁移前加密快照、两份迁移、同SHA镜像 / 健康、外网8条新契约及新JS已独立核验。旧失败及skipped部署记录保留，正式页面人工验收及生产新权限首次初始化未完成。预览不是执行授权，生产适配器注册为空，候选只能显式初始化草稿，不能发布 / 绑定 / 开单。真实领域表单、同事务撤审及供应商门户身份后续N3 / N5交付，不宣称完整8D可用。

## N2-A 配置增量（2026-10-25，V0.0.29已部署，人工验收待完成）

Issue #66 / V0.0.29：单表组件项目映射、基础两列 Excel 导入、跨页多选明确字段批量维护 / 共享影响预览，以及组织管理职责 / 部长分管 / 真实任职预览已本地实现并经独立双审。新配置引用已纳入受控删除 / 停用；不自动授予存量管理员新权限，不改生产数据或既有问题。API335联合及677unit、受影响Web分组285项、build/lint与治理通过，首轮Web入口预算超时及复验如实保留；具体范围见 [N2 计划](../../docs/superpowers/plans/2026-10-24-qms-n2-configuration-and-workflow-foundations.md)。

PR #67已合并并部署`70fdbabb1a5394c2cbbd5896a4e3068f4452e6bf`；PR / main完整检查、deploy40150563126、迁移前备份 / 四份迁移 / 同SHA镜像 / 健康及公开新契约 / JS资源均核验通过。正式页面人工验收、生产新权限首次初始化及真实映射 / 职责维护未执行，不能用样例或机器成功替代。本节为N2-A发布时记录，后续N2-B基础发布见顶部；新8D、IMS / AI及域台账回补没有因此开通，REQ-0025 / REQ-0026不提前关闭。

## REQ-0025 / N1（2026-10-24，已部署，待正式页面人工验收）

正式“组织与岗位”整合、原 ID 名称 / 代码纠错、受控删除及先解有效依赖再停用已由 V0.0.28 / PR #65 上线，最终 SHA `b4e51150e934314889287980d062fe389a89561b`。PR与main完整检查、部署备份 / 同SHA镜像 / 服务健康及外网新契约 / 资源更新均已核验。正式页面人工业务验收仍待执行；REQ-0025尚有N2映射内容，不整条标完成。具体证据、同根因返修和边界见[基础管理前置计划第 4.2～4.6 节](../../docs/superpowers/plans/2026-10-24-qms-basic-management-prerequisite.md)。

组件项目映射、经理 / 部长职责配置与动态流程在 N2，过程 / 客诉 / 新品 / 供应商及 IMS / AI 按[整体路径](../../docs/superpowers/plans/2026-10-24-qms-problem-management-delivery-roadmap.md)后续节点，不因本 N1 验证通过声明问题管理整体已交付。下方旧批次标签仅保留其原证据范围。

## REQ-0024（2026-10-22，本地实现／联合验证中）

岗位即角色的唯一内部存储、岗位直接配权、原子单号／逐行批量任职、完整预览与调岗CAS、只读历史授权、旧HTTP冻结及流程完整岗位名称已本地实现。真实一次性PG跨身份／授权／流程／供应商回归分批通过；含真实Worker进程8项的四文件联合49项通过，不能将49项全称为Worker用例。真实浏览器已分批验证岗位配权→原子建号→预览撤岗、四列XLSX部分成功及只读历史入口。原浏览器两处脚本定位／Escape误关弹窗失败保留，不冒充一次全绿。

负责人已完成开源操作并明确继续，本轮进入Draft PR整理；未合并／部署或完成人工验收，历史生产授权未转换。最后两条浏览器复测为兼岗撤权通过、治理语言单选控件不可见失败，保留失败作为合并前限制，不重命名为业务PASS。最终源码范围、门禁、分批证据与未覆盖项均以[实施计划](../../docs/superpowers/plans/2026-10-22-qms-position-as-role.md)为准。

## REQ-0017～0021（2026-10-19，V0.0.21 返修已上线，人工验收待执行）

REQ-0017～0021 的代码已全部包含在 V0.0.20 部署 `c7dc86b21ba6bb72cea3c3ccfabda1955e26de90`。Foundation `39207200414` 与 Deploy `39207880874` 全部成功；已核验完整镜像 SHA、迁移前加密快照、迁移、API/Web 健康、Worker 生命周期，以及公开 HTTP、OpenAPI 和静态资源。

负责人反馈的重复会话清单、账号概览与全页留白三项返修已按 [V0.0.21 返修计划](../../docs/superpowers/plans/2026-10-19-qms-account-overview-density.md)完成，PR #54 已合并并部署 `ecf7224e023104898606fb6fd154e1b992a95e27`。PR CI39236058320、main CI39237316369、Deploy39238036827 全部通过；快照／迁移／镜像／健康与公开 HTTP／契约／资源核验通过。负责人随后追加展示卡片内部留白反馈，要求参考上一版并横展同类规范；V0.0.21-fix3已在本地接续，尚未推送／部署，详情见同一返修计划。真实账号人工验收仍独立保留，隔离前端及静态资源结果不替代业务验收。

原版 `c7dc86b` 的双门户、六主题、三种宽度、中英文、键盘、未保存保护、导入停止/重试、权限和审计定位仍需分别人工反馈；返修页面按 V0.0.21 重新验收。Issue #44～47、Issue #52 及飞书记录保持开放，关闭与回填仍需对应授权。C 旧部署 `39188014390` 失败记录保留且未重跑；一次性验收容器已清理，本轮未触碰保留预览资源 `55440`。

详情见[实现计划](../../docs/superpowers/plans/2026-10-18-qms-compact-account-master-audit.md)。当前账号摘要不是历史身份快照，前端分批导入不等于后台任务或跨刷新恢复。

## P0/P1 主数据增量（2026-10-18）

两字段物料 `material-master` 已形成源码候选：仅编码/名称、组织内唯一、CAS 改名、逐行新增/重复跳过、模板与授权当前清单导出；独立权限、事务审计和幂等，真实 PG 与定向 Web 结果见 [基础数据计划](../../docs/superpowers/plans/2026-10-17-qms-p0-p1-master-data.md)。上线以对应 PR 的 main/CD SHA 核验为准，浏览器仍待人工确认，不把 API 存在视为整条 REQ-0015 完成。

外部接收仍未启用；[G 预留说明](../../docs/superpowers/specs/2026-10-17-qms-p0-p1-master-data-design.md)列明供应商/客户/物料事实拥有者、未来认证/组织映射/来源幂等/冲突和样本资料位置。手工导入不等于同步，不开放外部接收端点、同步 Worker、机器凭据或无数据监控。

REQ-0022／REQ-0023最新本地接续（2026-10-20）：角色摘要／只读详情、岗位自动角色授权、姓名／电话、两区本人概览与设置已实现。后端真实PG1041项、Worker8项通过；Web96文件711项分批全过，随后StrictMode／焦点最小返修的完整U3 20项和最新focus5项通过，当前716项按分批记录；独立规格／质量审查及新源码构建通过。真实浏览器7项分批全过，覆盖双门户三宽、资料真实冲突、签名摘要、岗位授权／多来源保留／旧会话401及最终403、详情只读与焦点。仍为“进行中”：云端CI／部署、生产人工验收与关闭回填未执行；截图人工视觉及签名撤销实际201／Swagger200既有差异保留限制，不混同上线事实。[联合计划](../../docs/superpowers/plans/2026-10-19-qms-profile-position-role.md)维护各批证据及失败演进。

状态含义：

- `已验收`：当前实现有完整对应验收证据。
- `进行中`：已有实现或定向验证，但范围仍未闭环。
- `未开始`：尚未进入实现或没有可采信证据。
- `受限可用`：仅限明确的开发、测试或内部场景，不代表试点或生产放行。

| 能力域 | 当前状态 | 证据入口 | 主要限制 |
| --- | --- | --- | --- |
| 身份、会话和账号治理 | 已验收 | `FOUNDATION.md`、`ACCOUNT-ADMINISTRATION.md` | 生产密钥、SMTP 和 MFA 运维配置在仓库外 |
| 组织、角色和权限矩阵 | 已验收 | `FOUNDATION.md`、`PLATFORM-HANDOFF.md` | 新领域仍需单独证明权限覆盖 |
| 问题索引与问题工作空间 | 已验收 | `PHASE-2.md`、`PROBLEM-WORKSPACE.md` | 领域模块负责创建和维护专业事实 |
| 流程设计、版本和运行时 | 已验收 | `WORKFLOW-DESIGNER.md`、`PLATFORM-HANDOFF.md` | 不提供通用 BPMN 或任意脚本执行 |
| 待办、通知和 Worker | 已验收 | `PHASE-2.md`、`FOUNDATION.md` | 业务领域通知受众仍需领域联调 |
| 附件生命周期与扫描 | 已验收 | `ATTACHMENTS.md`、`FOUNDATION.md` | 生产对象存储、病毒库和保留策略需部署配置 |
| 审计、导出和追溯 | 已验收 | `FOUNDATION.md`、`DATA-PROTECTION.md` | 正式留存和导出授权需按环境配置 |
| 数据保护、TLS、密钥轮换 | 已验收 | `DATA-PROTECTION.md`、`FOUNDATION.md` | 生产灾备演练和云权限不包含在本地验收内 |
| 供应商质量领域开发 | 已验收 / 受限可用 | `PHASE-3.md`（2026-09-24 阶段三开发收尾门禁）、`SUPPLIER-PLATFORM-HANDOFF.md` | 阶段三开发与真实资源/浏览器主链已 PASS；真实供应商试点和生产发布仍需另行审批 |
| 供应商正式试点 | 未开始 | `PHASE-3.md` | 必须完成阶段三主链和试点门槛 |
| 制程不良品台账 | 进行中 | `PHASE-4.md`、`PHASE-5.md`、`apps/api/src/modules/process-quality/`、`apps/web/src/features/process-quality/`、真实 PostgreSQL/Web 定向测试 | 内部已完成生产批次、出货报告冻结快照、归档 CAS、幂等、文件版本/客户/正式问题关联和内部页面；D7 PostgreSQL/Web 各 5/5 通过。专门浏览器业务闭环、MES/IMS/物流接入仍待验收/联调 |
| 客户质量 | 进行中 | `PHASE-4.md`、`PHASE-5.md`、`apps/api/src/modules/customer-quality/`、真实 PostgreSQL 定向测试 | 已完成客户主数据关系、客诉台账、实物状态、问题关联、最多 100 行逐行导入和 D2 人工登记至独立复核归档；D2 PostgreSQL 19/19、真实浏览器 1/1 通过。简报/8D 发单关闭、客诉附件真实扫描和外部系统联调未完成 |
| 审核管理 | 进行中 | `PHASE-4.md`、`PHASE-5.md`、`apps/api/src/modules/audit-management/`、`apps/web/src/features/audit-management/`、真实 PostgreSQL/Web 定向测试 | 内部已完成计划/模板/NC、客户/二方导入、导入行复核、正式问题发单、整改响应、独立验证和关闭守卫；F4 PostgreSQL 18 13/13、NC 页面 Web 2/2 通过。完整审核专门浏览器主链、移动离线和真实审核系统联调仍待验收 |
| 新品质量 | 进行中 | `PHASE-4.md`、`PHASE-5.md`、`apps/api/src/modules/new-product-quality/`、`apps/web/src/features/new-product-quality/`、真实 PostgreSQL/Web 定向测试 | 内部已具备试产问题、来源快照、问题升级、带病量产审批、试产总结修订和独立批准、来源变更后移交阻断、量产移交互锁、E4 初期流动方案与独立放行记录；E4 PostgreSQL 13/13、Web 14/14 通过。E4 专门浏览器、外部 IMS 联动和生产附件联调仍待验收 |
| 阶段五覆盖台账 | 进行中（内部门禁已通过） | `governance/phase-5-coverage.json`、`PHASE-5.md` | 本地自动化阶段五门禁已 12/12 通过；剩余为外部系统联调、专门供应商/移动设备证据和生产发布审批 |
| 质量数据与指标基础 | 进行中 | `apps/api/src/modules/quality-data/`、`apps/web/src/features/quality-data/`、5.1 设计规格、真实 PostgreSQL/Web 定向测试 | 内部已完成指标公式、阈值、红黄绿状态、例外期/告警、来源快照、版本守卫事实下钻、四域看板和 Excel/PDF 管理报表；质量指标 PostgreSQL 21/21、Web 定向回归通过。外部同步、真实浏览器导出和正式来源链仍待验收/联调 |
| 供应商 IQC 来料检验 | 进行中 | `apps/api/src/modules/supplier-incoming/`、`apps/web/src/features/supplier-incoming/`、5.2 IQC 设计规格 | 已完成台账、草稿录入、详情、完成/更正、照片引用、NG 问题关联、来源约束、权限与 MES 未启用端口契约；对象存储/扫描、真实业务浏览器和 MES 联调未完成 |
| 供应商特采 C2 | 进行中 | `apps/api/src/modules/supplier-concession/`、`apps/web/src/features/supplier-concession/`、真实 PostgreSQL HTTP 测试 | 已完成申请、审批、有效期和 QMS 一次性放行；MES/库存放行互锁与浏览器验收未完成 |
| 供应商质量资料 C3 | 进行中 | `apps/api/src/modules/supplier-admission/`、`apps/web/src/features/supplier-admission/`、真实 PostgreSQL 测试 | 已完成已扫描附件绑定、供应商提交和内部审核闭环；真实对象存储上传与浏览器验收未完成 |
| 供应商月度绩效 C9/C10 | 进行中 | `apps/api/src/modules/supplier-performance/`、`apps/web/src/features/supplier-performance/`、真实 PostgreSQL HTTP 集成测试 | 已完成 IQC 来源月度评分、CAS 发布、供应商门户已发布卡片与申诉创建/提交、内部复核及审计；真实浏览器业务链未覆盖 |
| 供应商年度审核 C7 | 进行中 | `apps/api/src/modules/supplier-audit/`、`apps/web/src/features/supplier-audit/`、真实 PostgreSQL/MinIO/ClamAV 集成测试 | 已完成年度计划/记录、结构化检查项、扫描现场证据、提交/关闭、组织隔离、权限、幂等、CAS、审计和内部审核页面；供应商门户及浏览器验收未覆盖 |
| 供应商质量目标 C8 | 进行中 | `apps/api/src/modules/supplier-quality-targets/`、`apps/web/src/features/supplier-quality-targets/`、真实 PostgreSQL HTTP 集成测试 | 已完成年度/月度目标、提交/审批/发布、版本修订、实际值与偏差历史、CAS、幂等、组织隔离、电子签章引用、审计和内部目标页面；供应商门户及浏览器验收未覆盖 |
| PPAP/ASN 证据互锁 C12/C14 | 进行中 | `apps/api/src/modules/supplier-ppap/`、`apps/api/src/modules/supplier-asn/`、`apps/web/src/features/supplier-ppap/`、`apps/web/src/features/supplier-asn/`、文件生命周期适配器 | 已完成 PPAP Level 1–5 模板清单、条目证据绑定、ASN 证据引用、提交前扫描/版本复验和内部操作页面；真实浏览器验收与外部物流联调未覆盖 |
| 供应商会议 C11 | 进行中 | `apps/api/src/modules/supplier-meetings/`、真实 PostgreSQL HTTP 集成测试 | 已完成会议计划、启动/完成、议题结论、行动项、责任人、截止日期、CAS、幂等、组织隔离和审计；会议通知、供应商门户、跨系统联动及浏览器验收未覆盖 |
| 供应商 PPAP C12 | 进行中 | `apps/api/src/modules/supplier-ppap/`、`apps/web/src/features/supplier-ppap/`、真实 PostgreSQL/MinIO/ClamAV HTTP 集成测试 | 已完成 PPAP Level 1-5 包、模板化资料条目、扫描证据绑定、提交、逐项审核、包级审核、年度再鉴定、版本 CAS、幂等、组织隔离、事件审计和内部操作页面；供应商门户及浏览器验收未覆盖 |
| 供应商检验规范 C13 | 进行中 | `apps/api/src/modules/supplier-inspection-standards/`、真实 PostgreSQL HTTP 集成测试 | 已完成供应商/物料检验规范、版本修订、检验项目、发布前项目校验、并存版本退休、CAS、幂等、组织隔离和事件审计；ASN、条码防重、附件扫描、供应商门户及浏览器验收未覆盖 |
| 供应商条码 C15 | 进行中 | `apps/api/src/modules/supplier-barcode/`、真实 PostgreSQL HTTP 集成测试 | 已完成条码规则草稿/发布、前缀与定长校验、版本退休、扫码记录、防重、CAS、幂等、组织隔离和审计；ASN 资料互锁、供应商门户及浏览器验收未覆盖 |
| 供应商 PCN C6 | 进行中 | `apps/api/src/modules/supplier-pcn/`、`apps/web/src/features/supplier-pcn/`、真实 PostgreSQL 定向测试 | 已完成变更申报、审核、退回修订、CAS、幂等和证据状态复核；真实对象存储/扫描、供应商门户及浏览器验收未覆盖 |
| 供应商 ASN C14 | 进行中 | `apps/api/src/modules/supplier-asn/`、`apps/web/src/features/supplier-asn/`、真实 PostgreSQL/MinIO/ClamAV HTTP 集成测试 | 已完成 ASN 草稿、供应商/物料关联、扫描证据绑定、提交前已发布检验规范与已批准 PPAP 互锁、提交 CAS、幂等、组织隔离、审计和内部操作页面；供应商门户、MES/物流联调及浏览器验收未覆盖 |
| 制程生产分母与良率 D6 | 进行中 | `apps/api/src/modules/process-quality/process-production.service.ts`、真实 PostgreSQL 测试 | 已完成生产批次、修订、良率/直通率、不良记录下钻和 D7 出货报告冻结快照；D7 PostgreSQL 集成已纳入阶段五门禁，外部系统接入和浏览器业务验收未覆盖 |
| 新品试产报告 E1 | 进行中 | `apps/api/src/modules/new-product-quality/`、`apps/web/src/features/new-product-quality/`、真实 PostgreSQL/Web 测试 | 已完成试产指标 CSV、正式/遗留问题快照、总结修订历史和独立审批，来源变更后阻断旧批准总结放行；PostgreSQL 11/11、Web 13/13、真实浏览器 1/1 通过。原生 Excel/PDF 和 IMS 适配器未覆盖 |
| 新品试产问题闭环 E2 | 进行中 | `apps/api/src/modules/new-product-quality/`、`apps/web/src/features/new-product-quality/`、真实 PostgreSQL 定向测试 | 已完成问题统计、分派、措施、独立验证、证据引用、Workflow 关闭守卫、版本 CAS、幂等和审计；一次性 PostgreSQL 10/10、Web 新产品页面 14/14 通过。完整浏览器主链和外部系统联调未覆盖 |
| 新品量产移交 E3 | 进行中 | `apps/api/src/modules/new-product-quality/`、真实 PostgreSQL 测试 | 已完成移交归档门、来源快照和试产指标检查；浏览器验收及外部系统接入未覆盖 |
| 新品初期流动 E4 | 进行中 | `apps/api/src/modules/new-product-quality/`、`apps/web/src/features/new-product-quality/`、阶段五设计规格、真实 PostgreSQL/Web 定向测试 | 内部已完成监控周期、退出条件、方案修订、提交、批准/退回、独立放行记录、证据/资源/版本追溯、CAS、审计和项目页面入口；PostgreSQL 13/13、Web 14/14 通过。专门浏览器联合验收、IMS/生产系统联动仍待后续 |
| 审核导入 | 进行中 | `apps/api/src/modules/audit-management/`、`apps/web/src/features/audit-management/`、审核导入集成测试 | 已完成客户/二方审核导入、外部键幂等、待复核列表、CAS 复核和正式问题发单，真实浏览器主链已通过；Excel 解析和真实审核系统联调未完成 |
| 审核标准库 F1 | 进行中 | `apps/api/src/modules/audit-standards/`、`apps/web/src/features/audit-standards/`、真实 PostgreSQL 测试 | 已完成目录、检查项、版本修订和发布生效；浏览器联合验收未完成 |
| 公告与强制阅读 G1/G2 | 进行中 | `apps/api/src/modules/announcements/`、`apps/web/src/features/announcements/`、`apps/web/src/layouts/AnnouncementReminder.tsx`、真实 PostgreSQL 测试 | 已完成发布、阅读确认、审计和内部全局顶栏必读未读提醒；浏览器验收未完成 |
| 电子签名 G3 | 进行中 | `apps/api/src/modules/e-signature/`、真实 PostgreSQL 集成测试 | 已完成签名注册/撤销、审批签章、指纹快照、不可变约束、组织隔离和审计；真实密钥托管、外部签名服务与浏览器验收未完成 |
| 通知规则、失败处理与任务统计 G4-G6 | 进行中 | `apps/api/src/modules/platform-configuration/`、`apps/api/src/modules/task-notification/`、`apps/web/src/features/tasks/`、真实 PostgreSQL/Web 定向测试 | 内部已完成通知模板/版本/启停、失败队列查询与重试、稳定失败原因码、持久化投递尝试回执、任务统计、失败任务查询/恢复和批量转派；Outbox 单测 16/16、管理端 PostgreSQL 9/9、Web 回执测试通过。真实邮件/IM 回执、失败通道联调和移动入口仍待后续 |
| Worker/现场扫码 A2/G7 | 进行中 | `apps/api/src/worker-runner.ts`、`apps/api/src/worker.ts`、`apps/web/src/features/site-scanning/`、真实 Worker/前端定向测试 | Worker 进程 8/8、现场扫码 Web 3/3 通过；邮件/IM 真实通道、移动/PDA 相机和现场业务浏览器验收未覆盖 |
| 三坐标检测 | 进行中 | `apps/api/src/modules/coordinate-inspection/`、`apps/web/src/features/coordinate-inspection/`、5.6 设计规格 | 已完成申请、提交、审批、排单、进度和权限；真实设备、仪器台账、MSA 与外部系统未接入 |
| 生产发布 | 未开始 | `FOUNDATION.md`、`DATA-PROTECTION.md` | 尚未完成正式部署批准和生产灾备演练 |

更新本表时必须写明日期、对应源码范围、命令和实际结果。历史 PASS 不得覆盖当前较新代码的失败或未覆盖范围。

2026-09-27 更新范围：`apps/api/src/modules/process-quality/`、`apps/api/src/modules/quality-data/`、`apps/api/src/modules/new-product-quality/`、`apps/api/src/modules/audit-management/`、`apps/api/src/modules/task-notification/`、`apps/web/src/features/process-quality/`、`apps/web/src/features/quality-data/`、`apps/web/src/features/new-product-quality/`、`apps/web/src/features/audit-management/`、`apps/web/src/features/governance/`。指标公式/阈值、D7 文件/客户/问题关联、E4 放行记录、F4 NC 整改验证关闭、通知失败回执和对应内部页面已完成；2026-09-27 阶段五自动化门禁 12/12 通过（API 单测 497/497、Web 单测 299/299、API 集成 700/700、Worker 8/8、浏览器 25/25），Docker 资源已清理。外部系统资料尚无，真实邮件/IM 回执、专门供应商/移动浏览器验收和生产发布审批仍待后续，详细限制见 `PHASE-5.md`。
