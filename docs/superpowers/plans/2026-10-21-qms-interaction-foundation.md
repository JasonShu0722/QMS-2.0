# QMS 第一批共享交互迁移实施计划

> 使用项目级 QMS Superpowers、writing-plans、子代理实现／TDD、先规格后质量审查及主代理独立验证。已确认设计和样例不重复访谈。

## 当前摘要

| 项目 | 当前事实 |
| --- | --- |
| 时间及授权 | 2026-10-21，Asia/Taipei；负责人初步认可样例后要求继续推进。最新明确要求：“本地代码改完后统一重新推PR以及代码合并，推之前通知我开源仓库处理” |
| 外部动作门禁 | 当前仅继续本地实现／验证／审查，推送前通知负责人；等实际确认完成仓库处理后，统一推送／更新 PR，检查通过再合并。不得自行公开仓库、调整计费或绕过云端检查；发布与生产操作仍独立核对 |
| 定位与版本 | [Issue #60](https://github.com/JasonShu0722/QMS-2.0/issues/60)，V0.0.25；已存在样例 [Issue #58](https://github.com/JasonShu0722/QMS-2.0/issues/58)／[PR #59](https://github.com/JasonShu0722/QMS-2.0/pull/59)，最终统一整理同一完整变更范围，不再自动创建并行 PR |
| 本地基线 | `codex/qms-interaction-foundation` 基于样例检查点 `c9133f1`；起始未提交仅上一轮计划回执与文档来源摘要，均为本聊天成果，继续保留。原 main 的 4 个历史归档提交不纳入本轮推送 |
| 云端状态 | PR #59 的 Foundation39532937503：scope／checks 未启动，GitHub 注释明确付款失败或需提高 spending limit；无 runner、无执行步骤。日志404不代表代码缺陷。前置云端门禁尚未通过，不重复重跑 |
| 本轮范围 | 正式共享按钮 token／操作区样式、顶栏语言选择、外观互斥选项、个人资料／改密／安全弹窗页脚与关联测试／文档 |
| 非目标 | 不改 API／契约／数据库、角色／MFA策略、秘密清理、主题或语言存储键、门户／路由／标签状态；不全站机械替换按钮，不新增组件库／包装层，不改 CI 或仓库可见性 |
| 当前检查点 | 本批代码与独立审查完成；11 文件86项本地测试、类型／生产构建／样例排除、实际登录工具栏14项浏览器检查通过。真实认证API未运行，双门户和账户业务链保留待验收；不是全站迁移或上线完成 |
| 下一动作 | 本批已本地提交 `e4ab906`；负责人进一步明确全部现有页面完成后统一推送，现接续[全页展开计划](2026-10-21-qms-all-pages-interaction.md)，不在本批提前通知开源。不自行公开、不推送、不重跑Actions |

**目标：** 将[已认可样例设计](../specs/2026-10-21-qms-interaction-system-design.md)的选型、层级、反馈和焦点规则落到高频正式入口，并保持真实安全与草稿边界。

**技术与架构：** 继续现有 React／Ant Design／Vite、ThemeProvider、LanguageProvider。主题共享已有 token，局部业务组合使用语义 CSS；外观改为 Radio.Group，语言继续使用已有且正确的 Radio.Group，不为外形更换控件。沿用其键盘与单选能力，不写自制方向键控制器。弹窗动作区只共享样式，不抽通用 Modal／Form 引擎。

## 1. 文件与调用方

| 单元 | 写入文件 | 必须回查的调用方及测试 |
| --- | --- | --- |
| A 共享视觉与语言 | `qms-2.0/apps/web/src/theme/ThemeProvider.tsx`、`theme/theme.css`、`i18n/TopbarLanguageSwitcher.tsx`、`features/account/account.css` | `layouts/ShellHeader.tsx` 的内部／供应商入口、`theme/theme.test.tsx`、`i18n/TopbarLanguageSwitcher.test.tsx`、`layouts/ShellHeader.test.tsx`；工作标签和账户菜单不改 |
| B 外观互斥设置 | `qms-2.0/apps/web/src/theme/AppearanceButton.tsx`、新增 `theme/AppearanceButton.test.tsx`、`features/auth/AuthToolbar.test.tsx`、`playwright/ui-appearance.spec.ts`／`compact-shell.spec.ts`／`login-feedback.spec.ts` | AuthToolbar 登录／恢复／挑战页面、ShellHeader 两门户；原 theme.test.tsx 对选项的查询同步；不更改 ThemeProvider 的存储／系统监听 |
| C 弹窗操作区 | `qms-2.0/apps/web/src/features/account/AccountSettingsDialog.tsx`、`PasswordChangeDialog.tsx`、`features/auth/SecurityDialog.tsx` | `PasswordChangeDialog.test.tsx`、`account-center.test.tsx`、`AccountMenu.test.tsx`；Profile Form、Avatar／Signature 子任务保持原宿主与busy／dirty规则 |
| 主代理整合 | `theme/theme.test.tsx`、新增 `theme/interaction-foundation.test.tsx`、样例入口及测试（仅必要时）、本计划／样例计划／统一规格／FRONTEND-DESIGN／README／文档索引 | 公共 token／CSS 及来源摘要整合串行，子代理不提交／不切分支，冻结后统一测试 |

## 2. 设计落实与验收

- 共享按钮：36 px 基线及现有圆角；统一 14 px 横向内边距、500 字重，普通／主要／危险动作不添加无业务含义的阴影。危险色、禁用、loading、链接、图标按钮的语义保持；不设置全局 `!important` 控件覆盖。
- 语言：保留已有 Radio.Group、CN／EN 文案、`Language / 语言` 组名称和同一 LanguageProvider；箭头切换及登录下拉改变同一个 locale，无重复存储键。将顶栏语言样式移出账户领域，避免语言组件加载整份账户样式；粗指针下每选项同时保证宽／高44 px。独立盘点已确认其语义和键盘机制合适，无须因样例使用 Segmented 而替换；Segmented 继续用于视图模式样例。
- 外观：两个独立 Radio.Group，分别选择亮度与品牌色；组有明确名称，选项标签唯一，选中、悬停、focus-within 清楚；可使用方向键且一组一个单选入口。图标和对勾装饰 aria-hidden，不改变按钮样式来暗示生效以外的保存行为。
- 主题：保留蓝／青／紫和浅／深／跟随系统；按钮、Radio／Segmented、自定义选择卡片和弹层消费同源语义色；模式切换不重置主色，持久化失败仍可操作。减少动态效果遵从系统，不添加持续装饰动画。
- 弹窗：资料与安全的单个关闭按钮保持次要；改密取消／提交的主次及顺序明确；共享页脚可换行、右对齐、间距8 px、触屏目标44 px。保留忙时不能关闭、dirty确认、失败保留输入、关闭后焦点回入口及秘密卸载清理；不将资料保存从Form擅自搬到总弹窗页脚。

## 3. TDD 与实现步骤

- [x] A1 在 theme.test.tsx 增加共享 Button token 与高度不变断言；语言沿用原 locale／键盘与登录入口同步回归。运行定向测试观察新 token 断言红灯，保留原有有效回归。
- [x] A2 最小配置 Button token；顶栏语言保留 Radio，将限定样式集中主题层并补齐触屏和窄屏。重跑 A1 及双门户 ShellHeader 回归；移除样例重复 Button 配置，让已认可样例消费同一正式来源。
- [x] B1 新增外观测试：每组选项的 checked、箭头键切换、主色不随模式重置、外观触发可达及打开／关闭状态。先红灯，再改真实 Radio.Group，保持原偏好机制；旧 button／aria-pressed 查询同步到 radio／checked。
- [x] B2 AuthToolbar／theme／Playwright 已有消费者使用真实新语义；不通过跳过或降低权限／焦点断言取得绿灯。DOM角色变更不改变业务路由。
- [x] C1 在现有密码弹窗测试中断言取消／提交属于同一语义操作区，且busy／dirty路径仍成立；先红灯。用 CSS 类统一三个页脚，不抽新组件，不改回调。
- [x] C2 运行密码、账户菜单和资料／安全相关回归，确认原始成功／失败／关闭逻辑未被样式改动破坏。

新的 token 断言示例：

```tsx
expect(configured.components.Button).toMatchObject({
  paddingInline: 14, fontWeight: 500,
  defaultShadow: 'none', primaryShadow: 'none', dangerShadow: 'none',
});
expect(configured.token.controlHeight).toBe(36);
```

外观键盘断言示例：

```tsx
const dark = screen.getByRole('radio', { name: '深色' });
dark.focus();
await user.keyboard('{ArrowRight}');
expect(screen.getByRole('radio', { name: '跟随系统' })).toBeChecked();
expect(document.documentElement.dataset.qmsAccent).toBe('purple');
```

## 4. 整合验证

每个新 shell 加载本地 Enter-Qms.ps1，再切 `apps/web/`；运行原生 Node 测试入口，单 worker、分组串行，日志在 Git 外。源码写入与验证不并行。

- [x] 组一：`node node_modules/vitest/vitest.mjs run src/theme/theme.test.tsx src/theme/AppearanceButton.test.tsx src/i18n/TopbarLanguageSwitcher.test.tsx --maxWorkers=1`。
- [x] 组二：`node node_modules/vitest/vitest.mjs run src/layouts/ShellHeader.test.tsx src/features/auth/AuthToolbar.test.tsx src/features/account/PasswordChangeDialog.test.tsx --maxWorkers=1`。
- [x] 组三：账户菜单／账户中心／资料授权及样例受影响测试按现有文件串行；保护原授权和秘密行为，不把模拟网络测试称为真实服务验收。
- [x] `node node_modules/typescript/bin/tsc --noEmit`、`node node_modules/vite/bin/vite.js build`；本次 dist 继续排除样例，正式页面禁止导入样例模块。
- [ ] 工程根 `corepack pnpm check:governance`、相关文档测试、归档隔离及 `git diff --check`。
- [ ] 实际浏览器使用正式组件，检查六主题／语言、三个宽度、互斥选中、方向键、焦点与触屏模拟；受保护账户／门户需真实一次性服务和实际角色，前置不足按既有人工清单保留未验收，不能借样例通过补造真实业务通过。
- [x] 独立规格审查通过后质量审查，主代理复核修正及最终源码，记录实际证据。

## 5. 汇总提交及停止点

- [ ] 统一样例／迁移范围与最终标题、版本和Issue映射；保留旧归档，不携带其他聊天文件。只做本地检查点提交，不推送／重跑Actions／合并。
- [ ] 本地工作完成后向负责人给出完整差异、验证／限制、拟推分支及PR范围，通知其处理仓库。等待实际确认，不能把经过一段时间当完成。
- [ ] 确认仓库处理完成后才推送／更新统一PR；云端检查通过再合并。原计费拒绝不改写PASS，也不通过删门禁、换公开仓库或自建runner绕过。
- [ ] 合并若触发部署，先按实际授权核对发布效果；当前无新生产操作授权。最终业务验收、Issue关闭／回填分别核对。

## 实际记录

### 实现及审查

- A 实现 `01a15c53-56a0-77b0-a074-2f1a844610ee`：共享token、样例删除重复配置、语言样式归主题和操作区CSS；B 实现 `01a15c53-b430-7012-877a-4e4186c93419`：外观互斥与调用方／键盘测试；C 实现 `01a15c54-03d1-7dc0-9ddf-61a1868c9595`：三个Modal footer只增加语义group与CSS类。
- 主代理原始红灯：新增 `interaction-foundation.test.tsx` 三项均失败，分别证明缺少共享Button配置、两个radiogroup、改密操作区group。整合曾发现品牌色内容span未闭合，修复后继续；随后原生radio在测试环境共享 `test-id` 导致跨组取消选中，改为React `useId` 派生的独立name，并移除新增测试的环境绕行。失败输出保留，未当作PASS。
- 独立规格复核 `01a15c6d-fc95-79a2-8689-00a17c04c871` 和质量复核 `01a15c71-06ce-7ca1-b7ba-f04312517174` 均无阻断，仅静态范围。主代理另核对CSS导入链、旧外观按钮查询和三个Modal回调不变。

### 本地实际验证（2026-10-21，Asia/Taipei）

环境为加载 `Enter-Qms.ps1` 后再切入 `apps/web/`，Node24.21.0、Vitest3.2.7，单worker分组串行。原始输出与JSON在Git外 `D:/WorkSpace/QMS-2.0-local/interaction-foundation-review/`。

| 组 | 命令范围（`node node_modules/vitest/vitest.mjs run ... --maxWorkers=1`） | 实际结果及证据 |
| --- | --- | --- |
| 1 | `src/theme/interaction-foundation.test.tsx src/theme/AppearanceButton.test.tsx src/theme/theme.test.tsx src/i18n/TopbarLanguageSwitcher.test.tsx` | 4文件22项通过，40.26秒；`group1-final.json`。早期group1及group1-fixed失败不能用于通过结论 |
| 2 | `src/layouts/ShellHeader.test.tsx src/features/auth/AuthToolbar.test.tsx src/features/account/PasswordChangeDialog.test.tsx` | 3文件16项通过，66.54秒；`group2.json`；既有maskClosable弃用提示未扩展本批修复 |
| 3 | `src/features/account/AccountMenu.test.tsx src/features/auth/SecurityDialog.test.tsx src/features/account/AccountCenter.u3.test.tsx` | 3文件40项通过，173.80秒；`group3.json`；模拟网络回归不算真实服务验收 |
| 4 | `src/interaction-preview/interaction-preview.test.tsx` | 1文件8项通过，42.34秒；`group4.json`；验证样例继承共享来源仍工作 |

最终移除 `AuthToolbar.test.tsx` 随本次修改加入的 NODE_ENV 环境绕行（外观已有显式唯一组名，不再需要）；单独复跑该文件5项通过，22.98秒，`auth-toolbar-final.json`。这是同一覆盖的复验，不重复累计到86项总数，生产源码未变化。

`node node_modules/typescript/bin/tsc --noEmit` 退出0；`node node_modules/vite/bin/vite.js build` 退出0，22.48秒，保留现有900kB分块警告。实际读取本次dist确认无样例入口／模块／标识，正式构建排除通过。未更改API／DTO／数据库，因此未运行无关API／PG／Worker全套；全站Button视觉影响仍按后续逐页验收，不由上述测试宣称已覆盖所有页。

文档与隔离门禁：`corepack pnpm check:governance` 通过（36文档、300本地链接、20来源复核、123模块依赖对及阶段五覆盖1项）；`node --test test/documentation.test.mjs` 12项通过，`check:archive-isolation` 和 `git diff --check` 通过。索引复核来源包括本计划、样例接续与统一规格，不新增第二个权威前端来源。

真实Chromium检查使用正式 `/login` 及其AuthToolbar／AppearanceButton，不登录、不发送业务写请求、不Mock接口：六主题、键盘组间独立与跟随系统、抽屉关闭焦点恢复、语言切换、1440／1024／390三档无整页溢出、英文移动选项边界及偏好刷新恢复，共14项通过，pageerror0。早期抽屉入场瞬间测量到屏外位置，改为等待实际布局稳定后断言，没有通过改产品样式或force点击掩盖。证据 `browser-check.json`。

认证 `/api/v1/auth/session` 在该环境实际500：未运行一次性认证API，不是认证服务通过。保留预览55440未使用；Docker标签范围查询没有运行中的本轮验收服务，不擅自启动历史资源。受保护双门户、真实资料／改密／安全及权限／MFA业务主链尚未执行；提供下面人工清单，未反馈前保持待验收。模拟键盘和手机宽度不代表真实触屏／扫码设备，截图不可解码不当作审美复核。原样例初步认可不自动扩展为本轮所有视觉已验收。

### 真实业务待验收清单

目标为本批V0.0.25候选、实际部署／预览SHA待届时填写，内部／供应商分别执行；环境必须为授权的一次性资源或发布后获准生产验收，禁止55440。每项反馈“角色／环境／版本／操作 → 实际结果／证据”，不能只回答总体通过来补造各设备细节。

1. 两门户各进入工作台、打开一条工作页；CN／EN切换，外观入口仅一处、标签／菜单／原路由／未保存输入保留；390宽度及中英文无整页横溢出，触屏实际目标可用。
2. 打开外观，两组分别用Tab和方向键选择，始终各有一个选中，模式不重置主色；六主题、跟随系统、刷新恢复、焦点与窄屏卡片可辨。
3. 修改个人资料后关闭／取消，确认保留或放弃路径；保存失败／409仍保留实际修改；头像／签名独立操作忙时不能关闭或覆盖；只读任职和权限保持。
4. 改密输入后取消／关闭／Esc，继续编辑保留输入、放弃清理；写入中不可关闭／重复提交；失败不丢输入、成功沿原流程撤销其他会话，焦点回入口。
5. 安全弹窗仅有中性关闭，个人账号无管理员MFA策略开关；绑定／恢复码显示确认清理、请求中不能关闭、重开重新读取；仅在实际授权角色和环境执行，不在日志／截图输出秘密。

### 交付边界

目前未推送V0.0.25、未重跑Actions、未合并、未发布、未关闭Issue或回填飞书。仓库处理仅由负责人执行；收到明确完成反馈后再统一更新PR，CI通过后按已授权顺序合并；真实业务验收来源继续独立记录。
