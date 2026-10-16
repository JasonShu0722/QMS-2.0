# 前端设计实施与参考代码

统一依据：[QMS 2.0 前端统一设计规范 v1.0](../../docs/superpowers/specs/2026-09-21-qms-frontend-design-standard.md)。该规格是设计与评审要求，本指南负责定位参考实现、复用边界和验证路径，不另维护一套色值表。

## 1. 当前基线

2026-10-09 会话确认的[导航、登录工具栏与需求反馈专项设计](../../docs/superpowers/specs/2026-10-09-qms-navigation-and-feedback-design.md)覆盖 REQ-0006～0010：系统服务整合、暂时移除知识与文件入口、保留待办卡片、登录页语言与外观、双门户反馈按钮。Issue #12～#15 已建立，本地独立部分并行、共享文件统一整合；本地实现、规格 / 质量审查及现有环境门禁已完成，四个 PR 的目标仍独立。实际证据、用户手动验收来源及闭环结果见[本轮执行计划](../../docs/superpowers/plans/2026-10-09-qms-navigation-repair.md)。PR #16～#19 已依次合入 main 并逐单元核验自动部署，最终 SHA 为 `acc4c152943fa2bec4df163c91d1b6a0a904fe18`；真实 URL、部分线上回归和链接回填见执行计划。负责人已按手动清单确认最终验收；四个 Issue 已关闭，五条飞书已结束并回填实际完成时间。代理独立验证与用户手动确认分别记账，具体浏览器版本及设备型号未单独提供。

用户已认可 UI V2 的总体设计：浅蓝默认、深浅/跟随系统、独立品牌主色、工作台完整导航、领域图标轨与上下文菜单、内部工作标签、专注处理。外观入口统一在顶栏。

**现有正式页面已完成首轮视觉迁移，样板继续作为设计参考。** 正式 Web 沿用 React + TypeScript + Ant Design 以及现有业务路由、请求和权限。未来领域表单、质量统计与完整草稿生命周期仍按各业务阶段交付。

## 2. 参考代码与样式索引

以下路径均指向同一份活动样板，不另复制快照目录：

| 参考文件 | 可复用的设计内容 | 不能直接作为正式实现的内容 |
| --- | --- | --- |
| [PrototypeShell.tsx](../apps/web/src/prototypes/ui-direction/PrototypeShell.tsx) | `PrototypeShell` 的主题解析/ConfigProvider；`ShellBody` 的导航、标签、设置抽屉、专注外壳；`Ledger` 的列表布局 | 模拟导航、固定存储键、仅内存草稿、演示权限和信息弹窗；TS/CSS 中重复的色值定义 |
| [shell.css](../apps/web/src/prototypes/ui-direction/shell.css) | 根主题变量、蓝/青/紫和深浅配色、两级导航、标签、响应式 | 全局 `:root` / `body` 和演示选择器不可整份进入正式应用；深色强调文字须核对对比度 |
| [main.tsx](../apps/web/src/prototypes/ui-direction/main.tsx) | 工作台、分析、处理空间的信息层次，趋势与缺陷图表布局 | 示例日期、指标、记录、静态 SVG 统计、固定流程节点、演示导出/提交 |
| [prototype.css](../apps/web/src/prototypes/ui-direction/prototype.css) | 面板、表格、表单、流程区域及图表的组合样式 | 全局元素重置、旧外壳样式、过小辅助字号不能直接当作正式基线 |
| [model.ts](../apps/web/src/prototypes/ui-direction/model.ts) | 标签身份、深链接、主题/会话存储的容错思路 | 演示记录与类型不是 API 契约；未知记录回退首条只适用于演示，正式页面要显示不存在/无权限 |
| [ui-prototype.html](../apps/web/ui-prototype.html) | 独立设计评审入口 | 不能纳入正式业务路由或默认生产页面 |
| [离线构建脚本](../apps/web/scripts/build-ui-prototype-offline.mjs) | 生成单文档评审材料 | 不是部署方式，不包含认证、真实接口或服务端草稿 |

样板运行、交互路线与离线分享见[样板 README](../apps/web/src/prototypes/ui-direction/README.md)。历史交互验证及限制见[V2 计划](../../docs/superpowers/plans/2026-09-20-qms-ui-direction-v2.md)。

## 3. 正式接入位置与顺序

| 顺序 | 现有正式入口 | 迁移要求 |
| --- | --- | --- |
| 1. 主题与基础样式 | [main.tsx](../apps/web/src/main.tsx)、[App.tsx](../apps/web/src/App.tsx)、[global.css](../apps/web/src/styles/global.css) | 建立一份共享主题配置，桥接 CSS 语义变量和 Ant Design token；同时覆盖弹层、图表及门户，不与语言/认证 Provider 冲突 |
| 2. 外壳与标签 | [InternalLayout.tsx](../apps/web/src/layouts/InternalLayout.tsx)、[SupplierLayout.tsx](../apps/web/src/layouts/SupplierLayout.tsx)、[WorkTabs.tsx](../apps/web/src/work-tabs/WorkTabs.tsx)、[workTabsStore.ts](../apps/web/src/work-tabs/workTabsStore.ts) | 在现有路由与权限上对齐导航、标签溢出、恢复、未保存保护与专注模式，避免另建一套正式标签 store |
| 3. 共用业务模式 | [ProblemCenterPage.tsx](../apps/web/src/features/problem-center/ProblemCenterPage.tsx)、[ProblemWorkspacePage.tsx](../apps/web/src/features/problem-workspace/ProblemWorkspacePage.tsx)、[AttachmentPanel.tsx](../apps/web/src/features/attachments/AttachmentPanel.tsx) | 从代表性台账与处理页提炼标题/工具栏/状态/节点/证据布局，再复用到其他模块；保留契约、权限和并发反馈 |
| 4. 扩展质量应用与分析 | [Workbench.tsx](../apps/web/src/workbench/Workbench.tsx) 及所属业务功能目录 | 按阶段接入真实指标、统计范围和下钻；新增分析依赖与算法单独评估，不把示例图表直接当作质量统计 |

上述第 1–3 项已在[现有界面改版计划](../../docs/superpowers/plans/2026-09-21-qms-ui-production-refresh.md)中执行首轮迁移。第 4 项仅统一现有入口及空状态，未新增分析业务、统计口径或假数据。

正式代码优先复用下列实现，不直接导入样板：

| 正式文件 | 职责 |
| --- | --- |
| `apps/web/src/theme/tokens.ts`、`ThemeProvider.tsx` | 模式/品牌色解析、容错记忆、CSS 变量和 Ant Design token 同源 |
| `apps/web/src/theme/AppearanceButton.tsx` | 唯一外观入口与设置抽屉 |
| `apps/web/src/features/auth/AuthToolbar.tsx`、`AuthToolbar.css` | 登录前两个紧凑入口，复用共享语言菜单与外观抽屉；窄屏 / 粗指针触控区域 |
| `apps/web/src/features/feedback/FeedbackButton.tsx`、`feedback-config.ts` | 双登录后外壳共享需求反馈；指针防误触、有界位置记忆与固定安全外部链接 |
| `apps/web/src/features/navigation/navigation.ts`、`layouts/InternalLayout.tsx` | 前端导航事实、原路由识别、系统服务各子入口独立权限；对象页加载失败仍登记当前工作标签 |
| `apps/web/src/layouts/ShellHeader.tsx`、`shell.css` | 内部/供应商共享顶栏、导航尺寸、窄屏及专注布局 |
| `apps/web/src/layouts/UnsavedChanges.tsx` | 已登记编辑器的链接离开、标签切换/关闭与 beforeunload 保护 |
| `apps/web/src/work-tabs/` | 宽度收纳、检索、另开浏览器页签、按身份隔离的有界会话元数据 |
| 各 `features/*/*.css`、`workbench/workbench.css` | 列表、处理空间、流程画布、附件、任务和工作台的作用域样式 |

登录页面背景素材、hero、顶部品牌和布局保留；只更新登录框及内部控件。共享主题不导入样板全局 CSS，也未引入 Bootstrap 或商业模板依赖。

## 4. 编码统一要求

Codex 处理前端设计任务时，先按任务查阅统一规范的相关页面模式与主题要求，再从上节定位正式页面和共享组件，并查看 `apps/web/src/theme/tokens.ts` 中的实际色值。外部 `DESIGN.md` 可作为排版、信息层次和密度的参考；落地时映射到 QMS 现有语义变量、Ant Design 配置和正式组件，不另建主题。共享视觉规则变更按下节核对浅/深 × 蓝/青/紫六种组合及跟随系统；成功、警告、危险等状态色和图表类别映射保持各自的业务语义。

1. React/TypeScript 与 Ant Design 延续现有技术体系；通用控件优先复用，QMS 特定组合再抽成共享组件。图标使用现有 lucide-react，名称与业务含义统一。
2. 全局主题变量仅在共享样式层定义；功能 CSS 使用限定的组件/功能作用域，不写影响所有 `button`、`h1`、`input` 的重置。动态业务值与主题色分开管理。
3. 样式消费语义：面板使用 surface/border，说明使用 muted，选中态使用 accent-soft/accent；不要把“蓝色”写进业务组件名称。Ant Design 控件通过统一 token/组件配置适配。
4. 复用样板算法前补齐正式边界：稳定记录身份、URL 合法性、权限变化、用户/组织隔离、草稿生命周期与容量清理。样板的固定数组和内存状态不得替代后端事实。
5. API 类型只从 `@qms/contracts` 引入。不得从样板 model 推导或复制业务 DTO；请求、错误、语言和权限沿用现有应用机制。
6. 新增页面优先组合已有公共模式。遇到共享模式缺失，在当前有实际消费方的批次中抽取；不让多个模块各自复制外壳、设置按钮和通用列表工具栏。
7. 原型保持独立入口与演示标识。正式运行代码不能依赖 `src/prototypes/`；离线产物可重新生成，不提交构建产物、外部套件压缩包或未经许可的商业源文件。

## 4.1 Taste 与前端技能协作

QMS 的信息架构、主题、组件、业务语义和验收以本指南、前端目录 AGENTS 及统一规格为准。QMS 项目入口先确定授权与工程步骤，现有 `frontend-design` 处理本任务的界面实现；已安装的 `design-taste-frontend` 只提供需要的视觉审计 / 重点返修方法，React 性能技能按实现需要补充。沿用同一批准计划、设计讨论、TDD 和独立审查，不因组合技能重复启动流程。

| 请求类型 | 协作方式 |
| --- | --- |
| 帮助文字、标签或单点样式维护 | 直接定位已有实现并做最小修正；保留主题、图标、布局与交互，不为小改追加风格方案、图片或动画 |
| 既有台账、表单、问题处理页优化 | 先查看本页正式实现与受影响状态，明确当前角色、对象 / 节点、下一动作和证据；按阅读 / 操作影响排序，下一批只处理范围内最有价值的少数问题 |
| 已批准的新视觉方向或独立介绍页 | 沿用已确认目标与品牌约束，只有真实未决取舍才讨论；需要原型时隔离保存，不从原型认可推导正式应用迁移授权 |

审计发现需附页面 / 组件位置、可观察问题、影响与最小调整；没有实测页面时标明代码推断，不能编造截图、用户反馈或评分。优先检查信息层次、数据与单位、密度、长文本、焦点和控件可达性，保留功能权限、节点动作、错误输入和未保存状态，不为符合某个审美偏好更换 Ant Design、共享主题或 lucide-react。

视觉复核复用下节既有尺寸、主题与行为清单，按批准范围和变更影响选择实际需覆盖项；不能以 Taste 的抽样缩减原有门禁。每轮优先修正少数最高影响问题，满足本次目标后停止，不因还有风格建议扩大任务。

自动浏览器受阻时，按[交付流程的人工验收接续](DELIVERY-MAINTENANCE-PROCESS.md#251-最终回归与逐项关闭)提供“版本 / 页面 / 角色 / 环境 → 操作 → 预期 → 实际结果或待验收”的清单，继续独立已授权工作。截图用于视觉检查，键盘、权限、提交与状态变化需实际操作；收到反馈后只记录实际覆盖，不把人工来源写成自动通过，也不为视觉复核另启动工具修复专项。

同事或新会话缺少个人 Taste Skill 时，仍可按本节及下节清单执行，不依赖某台机器的绝对技能路径，不自动安装上游同名 v2 或运行其浏览器脚本。

## 5. 前端验收清单

按变更影响选择检查项，记录实际证据。仅文档变更不运行数据库验收；正式基础平台变更仍服从根 AGENTS 的完整验收要求。

- [ ] 布局：工作台→领域→返回的导航状态正确；选中态与 URL 一致；顶栏仅一个外观入口；供应商仅有授权入口。
- [ ] 标签：0/1/多页、同记录去重、窄宽度溢出、全部已打开搜索、关闭当前/非当前/最后页、恢复及新浏览器页签均符合规范。
- [ ] 状态：切换记录不串草稿；未保存取消/放弃路径正确；失败保留输入；对象不存在/权限失效有明确页面；非活动页不驻留完整内容。
- [ ] 主题：浅/深 × 蓝/青/紫六种组合覆盖代表页和弹层；跟随系统即时变化、刷新记忆、存储异常降级；危险/成功语义及图表映射不变。
- [ ] 页面：加载、无数据、筛选无结果、错误和无权限均可辨；表格长标题、表单错误、处理中和重复提交有正确反馈。
- [ ] 分析：单位、范围、口径、基期和更新时间清晰；缺失与零不同；下钻带筛选；导出遵循权限。
- [ ] 可访问性：键盘、焦点、弹层焦点恢复、图标名称、对比度、缩放与减少动态效果检查通过；不只凭截图判断。
- [ ] 响应式：至少覆盖 1440×1000 桌面、1024×768 中间宽度和 390×844 手机；标签不换行、正文无整页横向溢出、表格局部滚动。
- [ ] 工程：类型检查、相关交互测试及构建通过；无新控制台错误、资源缺失或非预期外部请求；正式构建不含原型入口。

从 `qms-2.0/` 执行工程检查：

```powershell
pnpm --filter @qms/web lint
pnpm --filter @qms/web test
pnpm --filter @qms/web build
```

按改动运行对应现有浏览器用例或补充有意义的关键路径验收。正式真实业务的浏览器验收需要所属阶段要求的可用后端、隔离测试数据与认证环境，不能用演示数据代替。原型修改时再运行：

```powershell
node apps/web/scripts/build-ui-prototype-offline.mjs
```

离线输出为 `qms-2.0/dist/share/QMS-UI-Preview.html`。单文件打包/语法检查与浏览器运行验收是不同证据；工具不能打开本地文件时明确记录未验证，不宣称已完成离线运行实测。

## 6. 本次沉淀记录

2026-09-21：将已认可方向整理为统一规格，登记参考代码与样式，将规范接入项目开发入口。参考实现继续维护在原位置，本轮不修改正式运行代码、依赖或 API。采购结论为当前无须购买完整版套件；设计协作确需 Figma 资产时可另行评估，不影响本规范执行。

### 2026-09-21 后续正式页面迁移

- 已覆盖：工作台、问题中心、处理空间（含节点/证据分区及专注）、任务、流程列表/设计画布、附件、管理/权限/治理、账号、供应商外壳、认证辅助页和登录框。
- Web 全套单测 23 文件 / 141 用例通过；处理空间最终布局变更后另跑 13 用例通过。类型检查和生产构建通过，正式构建未包含原型入口；原有 AntD 大块提示保留。
- 真实内部/供应商登录及会话/网关用例 3 项通过；新增外观浏览器验收覆盖六种组合、跟随系统即时变化、刷新记忆、标签恢复、领域导航、唯一入口和 1440/1024/390 宽度。全屏截图只用于视觉核对，不能替代业务用例。
- 对比度单测覆盖主题正文及主按钮组合；不宣称每个控件、图表、导出和所有页面状态已完成全面可访问性审计。
- 现有流程编辑器和权限矩阵已登记未保存保护；其他编辑表单、浏览器前进/后退及任意代码触发的路由离开尚未统一保护。当前没有通用服务端草稿保存能力，切换时需放弃修改或继续编辑，不应表述为草稿自动恢复。
- 会话仅保存最多 30 个工作页的标题/路径等元数据，按账号类型、组织和用户隔离；重新打开仍走登录及业务权限检查，不保存业务正文或附件。
- 真实 PostgreSQL 集成与完整基础验收存在未通过项，具体命令、环境和结果见 [FOUNDATION.md](FOUNDATION.md) 本轮记录。本次视觉迁移不等于基础平台完整验收通过。
