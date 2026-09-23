# QMS 2.0

这是 QMS 2.0 的活动开发仓库。QMS 1.0 仅作为只读归档和历史参考，所有实现、测试和部署工作都在 `qms-2.0/` 中进行。

## 目录入口

- [QMS 2.0 工程与本地开发](qms-2.0/README.md)
- [QMS 2.0 开发治理](qms-2.0/docs/DEVELOPMENT-GOVERNANCE.md)
- [QMS 2.0 文档导航](qms-2.0/docs/README.md)
- [QMS 2.0 能力状态总账](qms-2.0/docs/CAPABILITY-STATUS.md)
- [QMS 2.0 总体设计](docs/superpowers/specs/2026-09-18-qms-2.0-redesign-design.md)
- [阶段 0 归档计划](docs/superpowers/plans/2026-09-18-qms-2.0-phase-0-archive.md)
- [阶段 1 基础计划](docs/superpowers/plans/2026-09-18-qms-2.0-phase-1-foundation.md)
- [D 盘迁移计划](docs/superpowers/plans/2026-09-19-qms-2.0-drive-migration.md)

## 开发位置和边界

活动 Windows 工作区是 `D:\WorkSpace\QMS-2.0`，应用命令从 `D:\WorkSpace\QMS-2.0\qms-2.0` 执行。E 盘 checkout 和 C 盘 worktree 仅用于回退参考，不是活动开发位置。

`archive/qms-1.0/` 是只读开发快照，不得构建、测试、安装依赖、部署或修复。不得把 QMS 1.0 兼容层复制到 QMS 2.0，也不得把秘密、环境文件、上传文件、日志或备份加入 Git。

开始任务前必须阅读根 `AGENTS.md`、`qms-2.0/AGENTS.md`、相关目录的 `AGENTS.md` 和适用的设计规格/阶段计划。规则、文档和目录入口由 `qms-2.0/governance/documentation-index.json` 维护，运行 `corepack pnpm check:governance` 检查一致性。

## 文档语言

业务描述、设计、计划、交接、验收和运维文档以中文为权威版本。命令、路径、API 路径、代码标识和第三方产品名保留英文。除非存在外部协作需要，否则不维护完整英文副本。

## 版本与验收

OpenAPI 的 Nest Swagger 输出是唯一前端契约来源；修改 API DTO 后，从 `qms-2.0/` 运行：

```powershell
corepack pnpm contracts:generate
corepack pnpm contracts:check
```

阶段基础变更必须执行归档隔离、契约检查、Web/API 测试、真实 PostgreSQL 集成测试、构建和 Foundation Compose 验证。完整阶段验收使用一次性资源，缺少 PostgreSQL、浏览器、网关、密钥或邮件前置条件时必须失败，不得以 SQLite、Mock 或 Skip 代替真实证据。实际 PASS/FAIL、命令、环境和限制记录在 `qms-2.0/docs/FOUNDATION.md`。
