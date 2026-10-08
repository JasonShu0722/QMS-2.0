# QMS 2.0 导航分组与语言控件修复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development 逐任务实现此计划，并在任务完成后执行规格与质量审查。

**目标：** 修复工作台侧边栏的平铺导航，并将登录页与内部顶栏的语言切换统一为可访问的按钮菜单。

**架构：** 保留现有路由、权限过滤和页面元数据，新增受控父域映射。工作台与图标轨只显示父域，叶子功能收进所属领域上下文菜单；移动抽屉提供折叠子菜单。语言切换继续由 `LanguageProvider` 管理状态和持久化，`LanguageSwitcher` 改为按钮触发的可访问菜单，两处外壳共用同一组件和视觉规则。

**技术栈：** React 19、TypeScript、Ant Design、lucide-react、Vitest、Testing Library。

---

### 任务 1：导航分组数据与工作台渲染

**文件：**
- 修改：`qms-2.0/apps/web/src/features/navigation/navigation.ts`
- 修改：`qms-2.0/apps/web/src/layouts/InternalLayout.tsx`
- 修改：`qms-2.0/apps/web/src/layouts/shell.css`
- 测试：`qms-2.0/apps/web/src/features/navigation/navigation.test.tsx`

- [x] **步骤 1：编写失败测试**：验证主导航只有父域、不含供应商 PPAP 等叶子；供应商 PCN 深链接选中供应商质量父域、上下文包含全部兄弟入口；保留页面工作标签标题。
- [x] **步骤 2：运行定向测试确认失败**：从 `qms-2.0/` 加载仓库外 `Enter-Qms.ps1` 后运行 `corepack pnpm --filter @qms/web exec vitest run src/features/navigation/navigation.test.tsx`，预期新父域断言失败。
- [x] **步骤 3：实现最小改动**：主导航显示问题与改进、供应商质量、制程质量、客户质量、新品质量、审核管理、质量分析、检测管理、知识与公告、个人账号、系统管理；页面仍使用现有标签元数据。域内展示父域全部子入口，移动抽屉提供可折叠子菜单。
- [x] **步骤 4：运行定向测试确认通过**：重复上述命令，预期导航测试全部通过。
- [x] **步骤 5：提交任务**：导航与语言控件实现合并提交为 `f72a518`。

### 任务 2：统一语言切换按钮

**文件：**
- 修改：`qms-2.0/apps/web/src/i18n/Language.tsx`
- 修改：`qms-2.0/apps/web/src/styles/global.css`
- 修改：`qms-2.0/apps/web/src/layouts/shell.css`
- 测试：`qms-2.0/apps/web/src/i18n/Language.test.tsx`、`qms-2.0/apps/web/src/features/admin/admin-language.test.tsx`、`qms-2.0/apps/web/src/features/governance/governance.test.tsx`、`qms-2.0/apps/web/src/features/tasks/task-inbox.test.tsx`
- 浏览器测试：`qms-2.0/apps/web/playwright/attachments.spec.ts`、`qms-2.0/apps/web/playwright/governance-dh.spec.ts`、`qms-2.0/apps/web/playwright/task-inbox.spec.ts`、`qms-2.0/apps/web/playwright/workflow-designer.spec.ts`

- [x] **步骤 1：编写失败测试**：验证语言控件以按钮呈现、打开菜单后显示中英文选项、选择后更新 `LanguageProvider`，并保留可访问名称。
- [x] **步骤 2：运行定向测试确认失败**：从 `qms-2.0/` 运行 `corepack pnpm --filter @qms/web exec vitest run src/i18n/Language.test.tsx`，预期新按钮断言失败；同步现有语言单测与浏览器用例的交互方式。
- [x] **步骤 3：实现最小改动**：使用 Ant Design Dropdown/Button 和 lucide 图标实现共享按钮菜单；移除对原生 `select` 的布局依赖，保持登录页和内部顶栏的位置适配，并让关闭菜单后焦点回到触发按钮。
- [x] **步骤 4：运行定向测试确认通过**：重复上述命令，预期语言测试全部通过。
- [x] **步骤 5：提交任务**：语言控件实现合并提交为 `f72a518`。

### 任务 3：联合验证与交付

**文件：**
- 修改：无额外生产文件；必要时只修复任务 1/2 暴露的问题。

- [x] **步骤 1：运行 Web 测试、lint 和 build**：
  - `corepack pnpm --dir qms-2.0 --filter @qms/web test`
  - `corepack pnpm --dir qms-2.0 --filter @qms/web lint`
  - `corepack pnpm --dir qms-2.0 --filter @qms/web build`
- [x] **步骤 2：运行治理与边界检查**：`corepack pnpm --dir qms-2.0 check:governance`、`corepack pnpm --dir qms-2.0 check:archive-isolation`、`git diff --check`。
- [x] **步骤 3：检查差异和分支状态**：确认只修改 issue 范围内文件，未触碰 `archive/qms-1.0/`、生成契约或秘密文件。
- [x] **步骤 4：推送分支并创建 PR**：已推送 `codex/ui-nav-language-issue-7` 并创建 PR #8，关联 issue #7。
- [x] **步骤 5：提交交接**：PR 记录提交 SHA、issue、验证命令和未运行完整 Playwright 服务的限制。合并与生产部署需后续明确指示。

### 追加任务：Foundation 稳定性与运行时间（issue #7 / PR #8）

**基线：** 2026-09-28 的 Foundation #67 总耗时约 18 分钟；其中 Web/API 单测 683 秒、真实 PostgreSQL 集成测试 238 秒、依赖安装 27 秒。Foundation #64 的三个 Web 用例超时，其他三次相邻运行通过。

- [ ] 定向复现三个超时测试，保留业务断言，减少测试交互中不必要的等待；完整 Web 测试复验。
- [ ] 功能分支仅跑 PR，`main` push 保持完整门禁；PR 新提交取消旧运行。
- [ ] 锁文件依赖缓存、Web 测试分片与独立检查并行；真实 PostgreSQL、对象存储、扫描、Worker、构建与 Compose 检查不能省略。
- [ ] Deploy 工作流只接收 `main` Foundation 完成事件，仍要求同仓库 `main` push 且 Foundation 成功。
- [ ] 运行本地分层验证，推送现有 PR #8，确认 Actions 全部通过并记录实际耗时。
