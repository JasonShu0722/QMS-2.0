# QMS Web 统一要求

本文件补充仓库根和 `qms-2.0/` 的 AGENTS，适用于本目录及下属前端代码。

## 作用范围

本文件适用于 `apps/web/` 及其下属目录。

## 权威入口

- 前端设计规范：`../../../docs/superpowers/specs/2026-09-21-qms-frontend-design-standard.md`
- 实施及参考代码指南：`../../docs/FRONTEND-DESIGN.md`
- 生成 API 契约：`../../packages/contracts/src/generated/api.ts`

- 开始前阅读[前端统一设计规范](../../../docs/superpowers/specs/2026-09-21-qms-frontend-design-standard.md)与[实施及参考代码指南](../../docs/FRONTEND-DESIGN.md)，在所属阶段计划确认范围和验证。
- 后续新增/改版页面遵循浅蓝默认、浅/深/跟随系统与独立品牌主色、两级领域导航、轻量内部工作标签和统一业务页面模式。外观入口只保留顶栏一处。
- 文案、标题、菜单变更按统一规范第2.1/3节：清理泛化解释和重复可见标题，保留口径/风险/恢复/语义焦点，同步收拢容器；业务使用单列两级折叠菜单，管理分类清晰、图标符合业务语义，保持各自现有主题与权限边界。
- 文案排查须覆盖可达弹窗/抽屉/子组件/导入器和全部状态；保留业务含义不等于常驻解释。权限/恢复提示按当前状态、不可逆风险按具体操作出现，不用“不自动/不代替/服务端为准”等边界段落填充默认页面，详见统一规范第2.1节人工反馈澄清。
- `src/prototypes/ui-direction/` 是可运行设计参考，不是正式组件库；正式页面不得导入原型代码或整份原型 CSS。保留演示标识和独立构建入口。
- 优先复用 React + TypeScript + Ant Design、现有路由/标签状态/语言/请求机制与 lucide-react。共享主题与组件集中维护，不逐模块复制，不为套用商业模板引入第二套 Bootstrap 外壳。
- 接入前补齐加载、空数据、错误、权限、未保存保护、键盘焦点及窄屏状态。主题须覆盖 Ant Design、自定义内容、浮层与图表。设计规范不代表这些能力已经在正式应用实现。
- QMS 节点和动作来自受控流程与契约，不复制样板固定 8D 数据或静态统计；API 类型仍只来自 `@qms/contracts`。
- 使用实施指南验收清单记录实际检查与限制；基础平台变更仍执行根 AGENTS 要求的完整验收。文档或样板验证不能替代真实业务验收。
- 新公共交互或视觉规则在统一规格中维护，并更新参考代码索引；常规实现按已授权范围推进，不把本文件解释为新增用户审批关卡。

## 验证命令

```powershell
corepack pnpm --filter @qms/web lint
corepack pnpm --filter @qms/web test
corepack pnpm --filter @qms/web build
```
