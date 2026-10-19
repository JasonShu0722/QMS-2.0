# QMS 个人账号整合与全页密度返修实现计划

## 当前摘要（2026-10-19，Asia/Taipei）

- 批准：负责人已确认三项返修方案并要求继续；[独立规格](../specs/2026-10-19-qms-account-overview-density-design.md)为本轮范围。
- 映射：REQ-0017／0018／0021 → 复用 Issue #44／#47 → 本地 `codex/account-overview-density` → 候选交付 V0.0.21。旧 PR 均已合并，本轮使用新 PR；负责人已明确“已开源，继续吧”，进入集中推送与最新 CI。
- 基线：活动 D 盘 checkout 的 `main` 为 `7e987b8`，包括本地 V0.0.20-fix2 文档提交；origin/main 和线上为 `c7dc86b21ba6bb72cea3c3ccfabda1955e26de90`。本地入口与 Git 外证据位于 `D:/WorkSpace/QMS-2.0-local/`。从当前 HEAD 建功能分支，保留本地提交。
- 状态：本地实现、返修、账号／密度独立规格与质量复审、最终整合审查全部完成。主代理 Web 全集 91 files／653 tests、冻结源码类型／构建、治理／归档与隔离浏览器矩阵通过；云端 CI 和部署尚未执行。
- 当前授权：负责人“已开源，继续吧”解除私有期间本地限制，接续本轮已批准返修的推送、新 PR、CI，以及本聊天已批准范围检查通过后的合并和部署；已实际查询仓库为 public。Issue 关闭、飞书写入与真实业务人工验收仍单独保留，禁止预览数据库 55440。
- 下一动作：核对 main 基线、集中推送本分支并关联 Issue #44／#47 建新 PR，最新 PR 全部检查通过后合并，核验同 SHA 的 main CI 与自动部署。云端步骤结束即通知可闭源；不修改仓库可见性。

> 面向执行代理：使用项目 QMS Superpowers 和 subagent-driven-development。分工仅允许不相交文件写入；验证冻结覆盖源码，Git 由主代理管理。

**目标：** 一张账号概览、一份可撤销和局部分页／滚动的登录会话表，以及覆盖正式业务页面的减半留白。

**架构：** 删除重复活动清单，历史接口承担单一数据源；复用现有安全弹窗与账号生命周期保护；以共享 theme token 和现有 CSS 收敛全局密度。

**技术栈：** React、TypeScript、Ant Design、现有生成契约、Vitest。

## 文件与责任

| 所有者 | 文件 | 责任 |
| --- | --- | --- |
| 账号实现子代理 | `qms-2.0/apps/web/src/features/account/AccountCenterPage.tsx`、`AccountSessionHistory.tsx`、`AvatarEditor.tsx`、`account.css`、`account-center.test.tsx` | 单一卡片／列表、头像旁身份摘要、撤销生命周期及账号回归 |
| 密度实现子代理 | `qms-2.0/apps/web/src/theme/ThemeProvider.tsx`、`theme.css`、`theme.test.tsx`、`layouts/shell.css`、正式 feature CSS（排除 account.css）和 workbench CSS | 共享 token、标题／区块／表单留白及残余扫描 |
| 主代理 | `qms-2.0/apps/web/src/i18n/Language.tsx`、规格／计划、前端规范／指南、README 和文档索引 | 语言整合、证据与接续 |

审查返修追加到密度实现者写集：`styles/global.css` 原定义，以及正式业务 TSX 中显式 Space／Row 的纯间距参数。按实际发现逐项调整，不修改业务逻辑；账号与密度写集继续分离。

## 任务 1：账号整合

- [x] 补失败测试：页面仅有一个登录会话区域、无会话历史卡片；历史中的 ACTIVE 非当前条目可撤销，REVOKED／EXPIRED／当前条目不可撤销；分页保留状态。保留既有草稿、失败重试、账号切换及迟到响应断言，将活动 fixture 改成完整历史 DTO。
- [x] 从 `qms-2.0/apps/web` 运行 `node node_modules/vitest/vitest.mjs run src/features/account/account-center.test.tsx --maxWorkers=1 --minWorkers=1`，记录真实红灯，再实现。
- [x] 删除 `getAccountSessions` 展示路径，以 `getAccountSessionHistory(page)` 查询统一表格，使用 `scroll={{ x: 800, y: 320 }}`；分页在表格滚动体外。仅在 `row.status === 'ACTIVE' && !row.isCurrent` 时渲染撤销按钮，沿用既有 API 与同步去重。
- [x] 概览卡片内使用身份区、邮箱表单及安全摘要，窄屏改成单列；保留 `SecurityDialog`、afterClose 焦点与头像行为。刷新失败只重试 GET，改密事件只刷新历史，邮箱不被覆盖。
- [x] 主代理串行运行账号及相邻头像／菜单／改密测试；规格审查通过后做质量审查，发现问题由原实现者修复并复审。

## 任务 2：共享密度

- [x] 扩展 `theme.test.tsx`：Card body 8、Table block 4、页面 8／6、区块 6、Card padding 8；断言标准 controlHeight 36 和粗指针 44 仍有效。
- [x] 从 `qms-2.0/apps/web` 运行 `node node_modules/vitest/vitest.mjs run src/theme/theme.test.tsx --maxWorkers=1 --minWorkers=1`，记录红灯。
- [x] 修改共享变量及 Ant Design Card／Table token，逐项扫描正式 CSS 中 `gap`／`padding`／`margin` 的硬编码留白，收敛为变量或批准减半值；不改原型、图形尺寸、登录品牌与交互命中区域。
- [x] 记录实际覆盖文件与保留尺寸的原因，运行主题与外壳相邻回归；规格审查后质量审查。

## 任务 3：整合与验证

- [x] 主代理补新标签英文映射，更新统一设计规范和指南，来源摘要按真实内容更新。
- [x] 源码冻结后依次执行 Web 全部测试、`node node_modules/typescript/bin/tsc --noEmit`、`node node_modules/typescript/bin/tsc -b`、`node node_modules/vite/bin/vite.js build`；工作目录为 `qms-2.0/apps/web`。
- [x] 从实现根执行 `corepack pnpm check:governance`、`corepack pnpm contracts:check`、`corepack pnpm check:archive-isolation`、`git diff --check`，命令／结果和限制写入本计划与 FOUNDATION。契约未改仍做同步校验；不为纯前端新增数据库资源或伪造真实资源 PASS。
- [x] 尝试本地浏览器检查账号、典型列表／表单／工作台在宽屏／窄屏、深浅与品牌色下的溢出、焦点、表头与分页；明确隔离前端数据和真实登录证据的区别。实际连接不可用则提供具体人工检查项，继续其余门禁。
- [x] 独立整合审查，集中本地提交 `V0.0.21 整合个人账号与压缩全页留白`；不推送，报告云端边界。

## 后续交付与人工验收

- [ ] 负责人恢复允许的 Actions 条件后，核对远程 base／head，复用原 Issue 关联新 PR，集中推送并执行最新完整 CI。负责人后续明确公开并继续，已进入本步骤。
- [ ] 合并／生产部署分别核对授权，按交付流程验证 SHA、镜像、迁移／快照、健康与线上资源；不能以旧版本部署替代本轮证据。
- [ ] 负责人使用实际账号验证一张概览、一份会话表、当前会话保护、撤销／改密后刷新、区域内翻页滚动、邮箱草稿、安全弹窗焦点，以及代表性业务页面留白和触控尺寸。记录版本、页面、角色、设备、结果。
- [ ] Issue 关闭与飞书台账回填等待独立授权；收敛后的公共视觉规则只维护到统一前端规范，不另建平行规范。

## 实施证据

### 上线后人工清单（当前全部待执行）

记录字段：实际部署完整 SHA、角色／门户、浏览器版本、设备／宽度、模式／品牌色、结果、截图或问题描述。使用本人真实账号；撤销项准备一个可撤销的本人其他会话。宽度至少 1440、1024、390；主题检查浅／深 × 蓝／青／紫，并抽查跟随系统和中英文。以下不因隔离 fixture 通过而改成“人工通过”。

| 页面／角色 | 操作与可观察结果 | 人工状态 |
| --- | --- | --- |
| 内部／供应商个人账号 | 只有一张账号概览、一份登录会话表；身份在头像旁，邮箱编辑及安全摘要同卡，窄屏依次叠放，无整页横向滚动 | 待执行 |
| 本人登录会话 | 超过一页时在区域底部分页；长列表在表体内纵向滚动、表头可见；窄屏表内横向滚动可访问操作列 | 待执行 |
| 本人其他有效会话 | 撤销一次显示成功并刷新状态；当前／撤销／过期会话没有撤销按钮。实际权限及近期身份验证按原机制执行 | 待执行 |
| 个人资料草稿 | 编辑邮箱后翻页、撤销其他会话、菜单改密后刷新清单，再打开关闭账号安全；草稿保留，关闭焦点回到账号安全按钮 | 待执行 |
| 个人资料重试 | 人为制造资料读取失败后重试，同时开关安全弹窗；恢复网络后邮箱与保存可用，MFA 摘要不回滚。失败只重试读取，不重复撤销 | 待执行 |
| 头像与安全设置 | 既有头像上传／扫描／设置／移除和安全弹窗流程保持；关闭一次性秘密内容仍按原确认及清理规则 | 待执行 |
| 工作台、台账、表单、流程、管理页 | 顶栏 54px、业务外边距 8／6px、区块 6px、卡片 8px；标题、表单、分页不恢复旧留白。长字段、错误提示、操作控件可自然撑高 | 待执行 |
| 触屏与键盘 | 标准单行控件 36px；粗指针输入／按钮及浮层关闭目标至少 44px；复选框未放大，textarea 保留多行；Tab 焦点、翻页及关闭可操作 | 待执行 |

### 本地检查历史

日志与截图在 Git 外 `D:/WorkSpace/QMS-2.0-local/`，不把计划或子代理报告替代主代理验证。

| 检查 | 实际结果与范围 |
| --- | --- |
| 账号首次红灯 | 主代理 `account-center.test.tsx --bail=1`：旧活动会话读取触发 fixture 拒绝，1 通过、1 失败；未实现统一数据源时不满足新测试 |
| 密度首次红灯 | 主代理 `theme.test.tsx --bail=1`：Card body 仍为 16，目标 8，1 失败；其余未执行 |
| 账号首轮绿灯 | `account-density-account-green.log`：28/28，exit 0；后续质量反馈触发返修，因此不是最终全集证据 |
| 主题首轮绿灯 | `account-density-theme-green.log`：11/11，exit 0；随后增加 global／组件默认值／触控回归，需最终复验 |
| 类型与构建首轮 | 主代理 `tsc --noEmit`、`tsc -b`、Vite build exit 0；保留已有大 chunk 提示，后续返修后再构建 |
| 契约／归档 | `contracts:check`、`check:archive-isolation` exit 0；无 DTO、API、数据库或迁移修改 |
| 治理首轮 | 来源变化门禁先失败，核对 MAINT-001 账号源码差异后更新事实与来源、保持开放；文档／维护／依赖及阶段覆盖检查最终 exit 0 |
| 账号规格审查 | `01a15361-c299-7e61-b71f-161b9026cdca` 限定账号范围 PASS；质量审查 `01a15364-34c3-71c2-8abd-6dd82b2bdbec` 发现资料重试与安全关闭共用请求号的 P2，进入回归返修 |
| 密度规格审查 | `01a1535d-b79b-77b0-b240-f16e7477cfe6`、`01a15362-bf1e-7303-8c81-26c3fa97b03f` 发现相邻标题、显式 JSX 间距、分页 margin、粗指针覆盖和原生单行控件几何遗漏，进入返修 |
| 浏览器首轮 | 工具信任连接、CLI 会话失败后，改用已安装 Playwright 在同一进程检查真实应用与隔离 API fixture；36 组样式断言已走完，但分页按钮定位使用英文而实际为中文，整轮仍 FAIL；修正验证定位并在最终源码上重跑，不冒称整轮 PASS |

实现者：账号测试 `01a1532f-d9e6-79f3-8593-844d4416ae7c`，账号实现 `01a15341-8fb9-72e1-8f94-80ac29fd8140`；主题测试 `01a15330-4521-7991-ae6d-9bcdac8551ce`，密度实现 `01a15341-dd68-7eb0-bfd5-8bff9f58573f`（报告前中断，保留实际 diff），global 收敛 `01a1535f-8545-7041-814e-85da9a1c5085`；审查返修分别由 `01a15367-a01e-7372-b509-7f65c749b4c9` 和 `01a1536b-9f26-7493-93c8-58b0e84e9e0c` 执行。中断或不可恢复角色不补造完成报告。

### 最终源码浏览器检查（主代理）

- `node D:/WorkSpace/QMS-2.0-local/account-density-browser-direct.mjs`：exit 0；Chromium 153.0.8010.12。真实应用采用隔离 API fixture，账号双门户 × 1440／1024／390 × 浅深／三品牌色共 36 组通过；表体 320px、表头可见、分页在滚动体外、窄屏局部横向滚动、页面无横向溢出。翻页保留邮箱草稿，未出现重复活动会话查询。
- 工作台三宽度通过：顶栏实际 54px、入口与概览 padding 8px、区块 gap 6px。粗指针 1440／390 的实际邮箱、按钮、原生文本／select 和 Modal 按钮均为 44px；checkbox 13px、textarea 62px，未机械放大或截断。
- `node D:/WorkSpace/QMS-2.0-local/account-density-browser-supplement.mjs`：exit 0；相邻 h1 margin 0／6px、Table 分页 margin 6／6px、fine 指针单行 input／select／邮箱均为 36px。账号安全关闭后的焦点与邮箱草稿保留、英文概览／会话标签及无溢出通过。
- 结果：`account-density-browser-results.json`、`account-density-browser-supplement-results.json`；截图 `account-density-internal-1440-light-blue.png`、`account-density-internal-390-light-blue.png`、`account-density-supplier-390-dark-purple.png`、`account-density-workbench-1440.png`，均在 Git 外本地目录。主代理已实际查看宽屏／窄屏／工作台截图。
- 这些结果只证明当前前端在隔离数据下的渲染与所列交互；未执行生产认证、真实会话撤销、上传扫描及秘密操作，不代替上线后的业务人工验收。浏览器验证进程及其专属页面已关闭，未创建数据库／Docker 资源。

### 审查返修与复审

- 账号 P2：关闭安全弹窗不再淘汰完整资料重试；独立安全版本保护 MFA。实现者先取得 profile-first／security-first 两项真实红灯，随后补 retry-after-close 的 MFA 回滚红灯，再修到定向 8/8 绿灯；最终完整账号 31/31 由主代理本轮全量运行通过。额外头像旁身份布局先验证缺少容器红灯，后最小 children 透传实现。
- 密度返修：显式 JSX Space／Row、Typography sibling、Table pagination、coarse 浮层及 native input 覆盖、workflow 36px 单行几何、54px 顶栏。实现者主题测试最终 15/15；曾尝试放入 Vitest 的浏览器启动已移除，普通测试不新增浏览器安装前置，浏览器验证独立留在 Git 外。
- 共享密度规格复审 `01a1538e-0930-78d1-82b7-67592d56d9a0`：限定 PASS；质量审查 `01a1538f-485e-7e33-af81-34d2e49759dd`：限定 PASS。只读静态结论与主代理浏览器来源分开。
- 账号质量复审 `01a15391-bfe5-7350-b177-532e940de58c`：限定 PASS，原 P2 解决，未发现新增 P1/P2；该角色继续进行调用方／语言／布局交界的最终整合检查。
- `01a15378-6713-7472-8337-d03939e07b5f`、`01a15379-d0ca-7fa2-9e59-5a896a19acad` 在模型切换后中断，恢复未取得结论后关闭，分别由上述新角色接续，不把未返回报告计为 PASS。

- 最终整合审查 `01a15391-bfe5-7350-b177-532e940de58c`：限定 PASS，核对 History 唯一调用不再传 revision、AvatarEditor 可选 children 透传、两项语言映射和双门户正式账号路由、theme/global/account 样式交界。没有以静态结论替代主代理测试。
- 冻结来源清单：`account-density-source-manifest.json` 记录本轮 47 个修改的 Web 源码／测试文件及 SHA-256；最晚源码修改为 2026-10-19 17:20:10（Asia/Taipei），早于最终浏览器与 Web 全量运行。结束时对比清单，源码变化则相应复验。

### 最终本地门禁

- Web 全集：`node node_modules/vitest/vitest.mjs run --maxWorkers=1 --minWorkers=1`，91 个文件、653 项通过，0 失败／跳过，exit 0；日志 `account-density-web-final.log`。同一运行包括账号 31、头像 8、菜单 16、改密 5、主题 15，以及布局／导航／主数据／业务页回归。
- 全集运行 17:30:18～18:02（Asia/Taipei），以单进程避免 Windows 并发内存与生成物冲突；没有因耗时中断后冒称通过。保留 Ant Design 弃用、未连接 Form 与移动审计测试 NaN height 等提示；它们不计为测试失败，也不据此宣称真实设备覆盖。
- 主代理重新对比 47 个 Web 源码／测试文件 SHA-256，冻结期间无变更。冻结源码的最终类型／构建和治理结果在完成后补入下条。

- 最终类型／构建：`tsc --noEmit`、`tsc -b`、`vite build` 依次 exit 0；日志 `account-density-tsc-final.log`、`account-density-build-final.log`。构建保留大于 900 kB 的 chunk 提示，不通过改阈值掩盖。API／DTO／迁移未改，沿用本轮 `contracts:check` 的实际同步 PASS，不把前端 fixture 当真实 PostgreSQL/Worker 验收。

- 最终治理：`corepack pnpm check:governance` exit 0，文档 36／链接 286／来源复核 20、开放维护 3、模块依赖 123 对及阶段覆盖 1 项通过。`check:archive-isolation` exit 0，`git diff --check` exit 0；日志 `account-density-governance-final.log`、`account-density-archive-final.log`。MAINT-001 保持开放，源码变化已核对并更新事实和摘要；未关闭任何 Issue 或写飞书。
- 例外保留：导航行／触控区域、二维码与流程画布／图表几何、登录品牌布局及必要的多行输入高度不减半；保留这些尺寸是保证可操作性和信息完整性。全页共享密度与正式业务局部留白已收敛，未迁移原型。
- 本地提交名称：`V0.0.21 整合个人账号与压缩全页留白`。提交后完整 SHA 和干净状态保存在 Git 外 `account-density-release-checkpoint.json`，不为回填提交自身 SHA 再创建一次文档提交。原 `main` 的本地 V0.0.20-fix2 文档提交完整保留为祖先。

### 云端接续（2026-10-19）

负责人已明确公开并继续。只读核对仓库 public、无开放 PR、Issue #44／#47 仍开放且未撤回；origin/main 仍为 c7dc86b，功能分支基线领先两提交、没有落后。本次追加仅修正文档中的活动目录和授权记录，不改源码；复用同一源码 91 files／653 tests、本地浏览器及独立审查证据。集中推送前再做治理，不重复运行业务全集。
