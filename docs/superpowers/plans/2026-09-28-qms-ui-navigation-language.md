# QMS 2.0 导航分组与语言控件修复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development 逐任务实现此计划，并在任务完成后执行规格与质量审查。

**目标：** 修复工作台侧边栏的平铺导航，并将登录页与内部顶栏的语言切换统一为可访问的按钮菜单。

**架构：** 保留现有路由、权限过滤、业务域图标轨和上下文菜单，只把工作台完整导航改为共享的业务域分组渲染。语言切换继续由 `LanguageProvider` 管理状态和持久化，`LanguageSwitcher` 改为按钮触发的可访问菜单，两处外壳共用同一组件和视觉规则。

**技术栈：** React 19、TypeScript、Ant Design、lucide-react、Vitest、Testing Library。

---

### 任务 1：导航分组数据与工作台渲染

**文件：**
- 修改：`qms-2.0/apps/web/src/features/navigation/navigation.ts`
- 修改：`qms-2.0/apps/web/src/layouts/InternalLayout.tsx`
- 修改：`qms-2.0/apps/web/src/layouts/shell.css`
- 测试：`qms-2.0/apps/web/src/features/navigation/navigation.test.tsx`

- [ ] **步骤 1：编写失败测试**：验证工作台出现业务域分组标题、分组入口仍可访问；验证进入 `/app/problem-center` 后保持图标轨与上下文菜单。
- [ ] **步骤 2：运行定向测试确认失败**：`corepack pnpm --dir qms-2.0 --filter @qms/web test -- src/features/navigation/navigation.test.tsx`，预期新分组断言失败。
- [ ] **步骤 3：实现最小改动**：为导航项增加受控分组元数据，工作台按分组渲染标题和入口；域内与移动抽屉继续复用现有单项渲染。
- [ ] **步骤 4：运行定向测试确认通过**：重复上述命令，预期导航测试全部通过。
- [ ] **步骤 5：提交任务**：`git add qms-2.0/apps/web/src/features/navigation qms-2.0/apps/web/src/layouts docs/superpowers/plans/2026-09-28-qms-ui-navigation-language.md && git commit -m "fix(web): group internal navigation by domain"`。

### 任务 2：统一语言切换按钮

**文件：**
- 修改：`qms-2.0/apps/web/src/i18n/Language.tsx`
- 修改：`qms-2.0/apps/web/src/styles/global.css`
- 修改：`qms-2.0/apps/web/src/layouts/shell.css`
- 测试：`qms-2.0/apps/web/src/features/admin/admin-language.test.tsx`

- [ ] **步骤 1：编写失败测试**：验证语言控件以按钮呈现、打开菜单后显示中英文选项、选择后更新 `LanguageProvider`，并保留可访问名称。
- [ ] **步骤 2：运行定向测试确认失败**：`corepack pnpm --dir qms-2.0 --filter @qms/web test -- src/features/admin/admin-language.test.tsx`，预期新按钮断言失败。
- [ ] **步骤 3：实现最小改动**：使用 Ant Design Dropdown/Button 或等价现有组件实现共享按钮菜单；移除对原生 `select` 的布局依赖，保持登录页和内部顶栏的位置适配。
- [ ] **步骤 4：运行定向测试确认通过**：重复上述命令，预期语言测试全部通过。
- [ ] **步骤 5：提交任务**：`git add qms-2.0/apps/web/src/i18n/Language.tsx qms-2.0/apps/web/src/styles/global.css qms-2.0/apps/web/src/layouts/shell.css qms-2.0/apps/web/src/features/admin/admin-language.test.tsx && git commit -m "fix(web): polish language switcher"`。

### 任务 3：联合验证与交付

**文件：**
- 修改：无额外生产文件；必要时只修复任务 1/2 暴露的问题。

- [ ] **步骤 1：运行 Web 测试、lint 和 build**：
  - `corepack pnpm --dir qms-2.0 --filter @qms/web test`
  - `corepack pnpm --dir qms-2.0 --filter @qms/web lint`
  - `corepack pnpm --dir qms-2.0 --filter @qms/web build`
- [ ] **步骤 2：运行治理与边界检查**：`corepack pnpm --dir qms-2.0 check:governance`、`corepack pnpm --dir qms-2.0 check:archive-isolation`、`git diff --check`。
- [ ] **步骤 3：检查差异和分支状态**：确认只修改 issue 范围内文件，未触碰 `archive/qms-1.0/`、生成契约或秘密文件。
- [ ] **步骤 4：推送分支并创建 PR**：关联 issue #7，写明测试命令和限制。
- [ ] **步骤 5：合并前提交代码**：等待 PR 检查结果；若自动检查通过，将分支代码提交到远端并在最终交接中记录 SHA、PR、issue 与验证结果。
