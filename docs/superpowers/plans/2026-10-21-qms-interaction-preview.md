# QMS 基础交互可视化样例实现计划

> 面向 AI 代理：使用 subagent-driven-development；先红灯、最小实现、绿灯；主代理串行进行整合验证和 Git 操作。

## 当前摘要

| 项目 | 当前事实 |
| --- | --- |
| 最后核对 | 2026-10-21，Asia/Taipei；设计已确认，负责人追加“是不是得先有可视化确认的样例库” |
| 范围与顺序 | 先做独立、可点击的样例库并取得视觉反馈；正式共享控件和业务页面保持原状，样例确认后再迁移 |
| 依据 | [已确认设计](../specs/2026-10-21-qms-interaction-system-design.md)；本文细化 U1／U2 的样例先行部分，不宣称 U3～U5 已执行 |
| 映射 | [Issue #58](https://github.com/JasonShu0722/QMS-2.0/issues/58)；无对应飞书 REQ／record_id，不自行造号或回填 |
| 分支与基线 | `codex/qms-interaction-preview`，开发基线 `bd6444b`；远端 main 实查 `fd1e6b9`，其间 4 个既有归档提交保留；提交 PR 前单独整理本轮差异，不推送历史归档提交 |
| 版本 | 本单元预留 V0.0.24；已核对远端分支、开放 Issue／PR 和本地版本记录，未见同号；提交前复核 |
| 授权 | 本地样例、测试、独立审查、功能分支 PR 已获准；不合并／发布／写生产或飞书。视觉确认与自动测试分别记账 |
| 当前状态 | S01～S08 和独立入口已实现；负责人“样例我大致看了，没问题”属于方向初步认可。8 项单元交互、Web 类型检查／生产构建／样例排除及 14 项真实浏览器检查通过；独立规格／质量静态复核无阻断；治理及 Git 收尾见下文 |
| 下一动作 | 核对治理及本轮提交范围，整理不含旧归档提交的功能 PR；后续按认可样例编写共享基线及正式页面分批迁移计划，不直接一次性改写全站 |

**目标：** 让负责人在真实 React／Ant Design 中确认按钮、切换、工具栏、弹层与异常状态，确认后的样例成为迁移基线。

**架构：** 使用独立 `interaction-preview.html` 和 `src/interaction-preview/main.tsx`。复用正式 ThemeProvider／LanguageProvider／tokens，新增样例的限定 CSS，不导入正式 App、认证和业务请求；不新增正式路由或菜单。Vite 生产仍仅构建 index.html，验证 dist 无样例 HTML／模块。

**技术栈：** 已安装 React 19、TypeScript、Vite、Ant Design、lucide-react、Vitest／Testing Library；无新依赖。

## 文件与职责

| 文件 | 职责 |
| --- | --- |
| `qms-2.0/apps/web/interaction-preview.html` | 独立开发 HTML，仅引用样例入口 |
| `qms-2.0/apps/web/src/interaction-preview/main.tsx` | StrictMode、正式主题及语言 Provider、样例限定样式 |
| `qms-2.0/apps/web/src/interaction-preview/InteractionPreview.tsx` | 目录、主题／语言控制、样例组装、候选标识与领域适用矩阵 |
| `qms-2.0/apps/web/src/interaction-preview/BasicExamples.tsx` | S01 按钮、S02 选型、S03 工具栏、S04 表单弹层 |
| `qms-2.0/apps/web/src/interaction-preview/ScenarioExamples.tsx` | S05 流程、S06 导入附件、S07 状态详情、S08 分析扫码 |
| `qms-2.0/apps/web/src/interaction-preview/preview.css` | 仅样例作用域的布局、视觉及响应式，不改变正式页面 |
| `qms-2.0/apps/web/src/interaction-preview/interaction-preview.test.tsx` | 核心交互行为测试；仅明确的样例反馈，不模拟真实业务验收 |
| 设计／本文／FRONTEND-DESIGN／README／文档索引 | 入口、状态、核验与未覆盖范围 |

## 任务 1：先建立行为反馈循环

- [x] 写测试：按钮异步失败保留状态并允许重试；单选草稿必须保存才生效；弹窗取消时保护已修改内容。
- [x] 写测试：流程理由与权限、导入部分成功／重试、数据错误恢复、重复扫码。
- [x] 加载环境后切入 `apps/web/`，运行 `node node_modules/vitest/vitest.mjs run src/interaction-preview/interaction-preview.test.tsx --maxWorkers=1`，已确认因模块尚不存在而失败；实际红灯和最终绿灯见证据。
- [x] 委派新实现代理；文件写入范围互不重叠，禁止子代理 Git 操作，验证由主代理串行执行。

核心断言示例：

```tsx
await user.click(screen.getByRole('button', { name: '打开编辑弹窗' }));
await user.type(screen.getByRole('textbox', { name: '问题标题' }), '修改');
await user.click(within(screen.getByRole('dialog', { name: '编辑示例记录' })).getByRole('button', { name: '取消' }));
expect(await screen.findByText('放弃未保存的修改？')).toBeVisible();
```

## 任务 2：独立入口与视觉框架

- [x] 基于现有共享主题，使用克制的 QMS 工作台风格：左侧场景目录、顶部审阅标识与设置、正文按 8 组展示。
- [x] 每组并列解释“何时使用／何时不用”和真实状态；所有反馈注明“样例”，不显示伪业务成功。
- [x] 六主题、中英文、跟随系统、键盘焦点、长文案和窄屏；不添加正式 App 路由、不调用 API。
- [x] 场景覆盖映射已确认设计 D01～D20；规划／扩展标识清晰，不把适用模式说成业务已启用。

## 任务 3：基础样例（S01～S04）

- [x] 按钮：主／次／文本／危险／图标／更多、loading／disabled、长文字及失败重试。
- [x] 选择：Switch 立即改变样例值；Checkbox／Radio 草稿保存；Segmented 视图切换；Tabs 内容导航。
- [x] 工具栏：输入查询／重置、结果数、当前筛选、表格当前页选择、清除选择、范围明确的批量动作。
- [x] 弹窗：字段校验、保存结果、dirty 关闭确认、请求中关闭保护、错误／冲突保留输入、焦点恢复。

## 任务 4：业务模式样例（S05～S08）

- [x] 流程：只读与处理资格、通过／退回理由、前置条件及完成反馈；无真实批准或签名。
- [x] 导入附件：明确本地三行示例，逐行处理、部分成功、原失败行重试、停止后保留已完成行；仅显示附件扫描状态，不接受真实文件。
- [x] 数据状态：首次加载、空数据、筛选无结果、失败／重试、无权限、正常数据、当前／历史只读详情。
- [x] 分析移动：0／缺失／不适用、单位／期间／来源、简单趋势及等价表格；扫码输入、防重复、结果反馈，明确不是相机或真实设备验证。

## 任务 5：整合验证、视觉检查与评审

- [ ] 冻结源码后串行运行定向测试、Web lint、Web build、治理、归档隔离和 `git diff --check`。失败先定位，不降低断言或跳过前置。
- [ ] 检查 dist 不含 `interaction-preview.html` 和样例源码／标识；不借用其他源码版本的构建产物。
- [ ] 本地仅绑定 127.0.0.1 开发服务，打开样例；检查三档尺寸、六主题、中英文及核心操作。自动浏览器受阻时按既有规则提供实际入口和人工清单，不声称自动通过。
- [ ] 独立规格轴通过后再做质量轴；修复有效反馈，主代理独立核对。
- [ ] 负责人可视化确认：按钮层级／尺寸／边框、切换选中态、间距、表单页脚、主题与窄屏。收到反馈前保持“待视觉确认”。

## 任务 6：PR 与后续迁移

- [ ] 按本轮真实文件和父提交整理功能分支；保留 main 上 4 个既有归档提交，不混入样例 PR。
- [ ] 重新核对版本／base／head，提交、推送并创建或更新 PR、附到本聊天；不合并／部署。
- [ ] 视觉确认后的修正先落样例与共享来源，确认稳定后生成正式迁移的逐领域计划；当前不一次性改 36 个页面。
- [ ] Issue 关闭、发布和外部回填分别按实际授权及最终验收；本阶段保持开放。

## 实际证据

### 负责人初步审阅（2026-10-21）

- 原话：“样例我大致看了，没问题”。来源为当前会话直接反馈。
- 覆盖结论：已初步认可当前样例方向，可作为后续迁移基准；未取得逐状态、六主题、三尺寸、真实设备或真实业务链的人工结果。
- 正式页面尚未迁移；不因本确认自动合并／发布、关闭 Issue 或回填飞书。
- 实现代理：S01～S04 `01a15c04-0740-75d3-9cd4-60bfabec77e4`；S05～S08 `01a15c04-5eba-7561-a04a-de8b6834de1a`；主代理整合入口、CSS、测试与文档。
- 规格审查 `01a15c11-5b2f-7ed0-8ef4-d5e8bb46d2f3`：首轮发现流程示例完成／退回后仍可操作，已收紧到 review 状态并提供明确重置，复核收口。质量审查 `01a15c35-36fb-7140-a80f-fe5f4cc890d0`：限定文件的静态审查无阻断；不代替浏览器运行证据。
- 自动化尚在收尾：最初模块缺失红灯已确认；当前逐项保留实际失败与复测结果。jsdom 仅验证本地交互状态，Modal 动画可见性和实际焦点由真实浏览器另验；不能通过降低真实交互要求取得 PASS。

### 本地验证与实际限制（2026-10-21）

- 命令环境：每次先加载 `D:/WorkSpace/QMS-2.0-local/Enter-Qms.ps1`，该脚本将目录切回工程根；执行 Web 原生命令前再 `Set-Location apps/web`。首轮 pnpm 脚本将 `--` 继续传入 Vitest 导致未正常定向；已停止该进程，最终使用直接 Node 入口，无依赖／脚本配置改动。
- 最终定向命令：`node node_modules/vitest/vitest.mjs run src/interaction-preview/interaction-preview.test.tsx --maxWorkers=1 --reporter=dot`，1 文件 8 项通过，44.25 秒；覆盖草稿／生效值分离、关闭保护、失败重试、流程资格／状态、导入重试、错误恢复、重复扫码和入口范围。
- jsdom 的 Ant Design 动画测量节点和隐藏输入不等于真实视觉：单元测试检查操作状态及输入保留；双 Modal 测试单独允许 20 秒（实际完整套件通过），按下／抬起完整回车事件验证防重复按键。曾失败的断言与超时不算通过证据；最终绿灯只对应当前测试。
- `node node_modules/typescript/bin/tsc --noEmit`、`node node_modules/vite/bin/vite.js build` 均退出 0；构建有现有大分块警告，不改阈值。读取本次 dist 校验无样例 HTML／模块／标识通过；没有借用旧产物。
- 实际 Chromium 浏览器：六主题切换、中英文各 1440／1024／390 三档无整页横溢出、修改取消后二次确认并保留输入、放弃后焦点回触发按钮，共 14 项通过；页面错误 0、业务 API 请求 0。Select／Radio 使用键盘选择，隐藏语义输入不强制点击；响应式结果等待实际重排稳定后断言。
- 浏览器证据位于 Git 外 `D:/WorkSpace/QMS-2.0-local/interaction-preview-review/browser-check.json`。仅独立本地样例，不代表真实业务、全状态组合、200% 缩放、真实触屏／PDA／相机／扫码枪、生产验收。截图文件本机不能解码，未将它们作为已查看视觉证据；负责人初步认可单独记录。
- 本地预览：`http://127.0.0.1:5187/interaction-preview.html`，仅绑定回环地址；正式站点没有样例路由或菜单。
- 最终文档门禁：`corepack pnpm check:governance` 通过（36 文档、300 链接、20 来源复核、123 个依赖对）；文档专项 12 项通过，归档隔离和 `git diff --check` 通过。远端 main 刷新后仍为 `fd1e6b9`，开放 PR 查询为空，本单元继续使用预留 V0.0.24。

### 正式页面的下一批次

1. 先在既有统一规格中固化已认可的控件选型与动作语义，将样例中的局部 token／样式逐项评估后映射到共享主题；不直接整份复制 preview.css，不建立第二套按钮库。
2. 第一批迁移双门户顶栏、语言／外观入口、常用弹窗操作区；列出旧／新调用方及权限、未保存和焦点保护要求。
3. 第二批按主数据／列表工具栏、问题／流程、供应商／制程／客户／新品／审核、文件／分析／治理逐领域迁移；每批有自己的 Issue、文件范围与联合验收，领域独立例外有依据地保留。
4. 本单元先完成样例 PR；上述迁移需详细实施计划和相应独立检查，不将方向认可写为全站已交付。
