# QMS 2.0 工程规则

## 作用范围

本文件适用于 `qms-2.0/` 及其子目录。根目录 `AGENTS.md` 的跨版本规则始终优先；更深层的 `AGENTS.md` 只补充本目录专属规则，不重复改写根规则。

## 权威入口

- 项目开发治理：`docs/DEVELOPMENT-GOVERNANCE.md`
- 当前能力状态：`docs/CAPABILITY-STATUS.md`
- 文档和规则索引：`docs/README.md`、`governance/documentation-index.json`
- 产品设计和阶段计划：仓库根目录 `docs/superpowers/specs/` 与 `docs/superpowers/plans/`

## 必须遵守

- 所有实现、测试和 Docker 构建上下文只能位于 `qms-2.0/`。
- API Swagger 是唯一前端契约来源；修改 DTO 后必须运行 `contracts:generate` 和 `contracts:check`。
- 不得手工编辑 `packages/contracts/src/generated/api.ts`。
- 关键功能必须使用真实 PostgreSQL、真实 Worker、真实对象存储或真实浏览器验证；不得用 SQLite、Mock 或 Skip 代替要求的证据。
- 任务完成前运行 `corepack pnpm check:governance`，并按变更范围执行分层门禁。
- 每个用于实现 / 验证的新 Windows shell 先加载活动入口并核对运行时与 Git 状态；共享 checkout 的 Git 操作由主代理串行执行，验证期间冻结覆盖源码。细则见 `docs/ENGINEERING-TOOLS.md`。
- 规格、交接、验收和运维 Markdown 以中文为权威语言；命令、路径、API 路径和代码标识保留英文。
- 新 Git 提交、PR 标题及最终合并提交使用 `V主版本.次版本.修订号 中文变更主题`，大写 `V` 开头，从 `V0.0.0` 起步；同一次调整的针对性修复使用 `V主版本.次版本.修订号-fixN 中文修复主题`，`N` 从 1 递增。版本来源、序号核对、squash 和历史处理遵循 `docs/DELIVERY-MAINTENANCE-PROCESS.md` 的「GitHub 提交命名」；命名不扩大 GitHub 写入或发布授权。
- 设计和计划必须策划交付单元、REQ 与 Issue / PR 映射、建 Issue 与提交 PR 的独立步骤、最终回归、关闭、协作台账回填及规则沉淀目标。通用分组、闭环与失败接续要求以 `docs/DELIVERY-MAINTENANCE-PROCESS.md` 为权威入口；具体数量和顺序由任务目标决定，不按飞书记录数机械分配。
- 常规交付按负责人持续授权主动在实现前关联 / 建立 Issue，验证与审查通过后提交 / 推送并创建 / 更新 PR；明确限制优先，纯文档维护免 Issue / PR。合并 / 发布及外部同步仍分别核对授权。人工、代理和 CI 验收来源分开记录，不把用户确认改写成自动测试 PASS。

## 工程工具

交接与证据工具使用 `docs/ENGINEERING-TOOLS.md`。功能开发、权限专项审查和故障定位分别按需读取 `.agents/skills/qms-feature-delivery/SKILL.md`、`.agents/skills/qms-permission-review/SKILL.md`、`.agents/skills/qms-incident-diagnosis/SKILL.md`；它们不替代这里及根目录的规则。

所有会改变行为、契约、数据、权限、流程或验收证据的任务，先读取 `.agents/skills/qms-superpowers-zh/SKILL.md`，再按其路由加载对应的 `superpowers-zh` 子技能。该项目级入口不替代领域交接技能。

## 验证命令

```powershell
corepack pnpm check:governance
corepack pnpm contracts:check
corepack pnpm test
```

阶段整合和发布仍须遵守根 `AGENTS.md` 的完整验收要求。
