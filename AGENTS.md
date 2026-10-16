# QMS 跨版本规则

## 作用范围

本文件适用于仓库根目录及所有子目录。更深层的 `AGENTS.md` 只能补充其目录专属规则，不得削弱这里的跨版本边界、安全要求和活动开发位置。

## 活动位置

- 活动 QMS 2.0 checkout 是 `D:\WorkSpace\QMS-2.0`，实现命令从其 `qms-2.0/` 子目录执行。
- E 盘 checkout 和 C 盘 worktree 仅用于回退参考，不是活动开发位置。
- 本 checkout 使用 sparse checkout；QMS 1.0 保留在 Git 历史和原始只读归档中，不得扩展或执行。
- Windows 本地配置位于 `D:\WorkSpace\QMS-2.0-local\Enter-Qms.ps1`；预览凭据和验收日志在 Git 外保存。

## 归档与实现边界

- `archive/qms-1.0/` 是只读开发快照，不得构建、测试、部署、安装依赖或修复。
- `qms-2.0/` 是唯一实现目录，拥有独立依赖、迁移链、容器入口和文档体系。
- 不得把 QMS 1.0 兼容层复制到 QMS 2.0，也不得在归档目录中继续开发。
- Docker 构建上下文必须位于 `qms-2.0/` 内。

## 设计、计划与文档

- QMS 2.0 设计和阶段计划使用 `docs/superpowers/specs/` 与 `docs/superpowers/plans/`。
- 开始工作前阅读适用设计、阶段计划、`qms-2.0/AGENTS.md` 和目标目录的更深层规则。
- 规则和文档入口由 `qms-2.0/governance/documentation-index.json` 维护；运行 `corepack pnpm --dir qms-2.0 check:governance` 检查一致性。
- 业务描述、设计、计划、交接、验收和运维 Markdown 以中文为权威版本；命令、路径、API 路径、代码标识和第三方产品名保留英文。

## QMS 开发流程技能

- 涉及 QMS 2.0 行为、契约、数据、权限、流程或验收证据的任务，必须先使用项目级 `qms-superpowers-zh`：`qms-2.0/.agents/skills/qms-superpowers-zh/SKILL.md`。
- 项目级技能负责路由 `superpowers-zh` 的设计、计划、隔离、TDD、子代理、审查、验证和收尾流程；它不替代领域技能和本文件的仓库边界。
- 用户在 QMS 维护上下文中询问遗留工作、待修复问题、飞书待办，或要求接单 / 推进批准需求时，先读取 `qms-2.0/.agents/skills/qms-start-development/SKILL.md`。查看先只读，明确修复再接单；具体页面 / 报错、引用示例和规则讨论不自动触发表格接单。单独设置“开发中”仅授权该范围的本地开发，先评审需求与机器人初稿，不重复确认开工。
- 负责人已要求本项目常规交付主动先复用 / 创建 Issue、验证审查通过后提交 / 推送功能分支并创建 / 更新 PR；复用该持续授权，不等提醒。只策划 / 只本地等限制优先；纯文档维护免 Issue / PR。合并、发布、台账写入及生产操作另核对授权，文档推送若触发自动部署同样适用。权威细则见 `qms-2.0/docs/DELIVERY-MAINTENANCE-PROCESS.md`，不配置定时接单。
- 负责人已允许按权威交付流程主动分配版本；计划顶部使用开发治理规定的当前摘要接续。OpenClaw 可以通过批准的只读资料分析云端项目源码与文档并填写需求初稿，严禁修改项目源码、设置开发批准状态或执行生产操作；输入、五字段输出与责任边界见 `qms-2.0/docs/OPENCLAW-OPS-HANDOFF.md`。

## 前端与 API 契约

- 前端工作遵循 `docs/superpowers/specs/2026-09-21-qms-frontend-design-standard.md` 和 `qms-2.0/docs/FRONTEND-DESIGN.md`。
- Web 变更前必须阅读 `qms-2.0/apps/web/AGENTS.md`；UI V2 是设计参考，不是生产迁移证据。
- Nest Swagger 是唯一前端 API 契约来源。修改 API DTO 后运行 `contracts:generate` 和 `contracts:check`，提交生成的 `qms-2.0/packages/contracts/src/generated/api.ts`。
- Web 客户端只能从 `@qms/contracts` 导入生成类型，不得重复定义 DTO 或编辑生成类型。

## 安全与验收

- 秘密、环境文件、上传文件、日志和数据库备份不得进入 Git。
- 验收使用一次性数据库、对象存储、扫描服务、Worker 和浏览器资源，不得连接保留预览数据库 `55440`。
- 缺少 PostgreSQL、网关、浏览器、密钥、邮件或对象存储前置条件时必须失败；不得以 SQLite、Mock 或 Skip 替代真实证据。
- Foundation 变更至少执行归档隔离、契约检查、Web/API 测试、真实 PostgreSQL 集成测试、构建和 Compose 配置验证。
- 完整阶段验收使用 `corepack pnpm --dir qms-2.0 acceptance:phase-1` 或 `acceptance:phase-2`，实际 PASS/FAIL、命令、环境和限制记录在 `qms-2.0/docs/FOUNDATION.md`。

## 基础设施边界

- API 与 Worker 共用一个镜像，使用不同命令启动。
- CI 只使用一次性资源并在完成后销毁，不提供持久化预览环境。
- Foundation 附件适配器和单次 Worker 是服务边界，不等于已交付完整上传、扫描或通知业务功能。
- 阶段二编号、问题索引、流程设计器/运行时、简报/8D 和供应商质量业务字段必须遵循对应阶段交接，不得混入 Foundation 工作。
