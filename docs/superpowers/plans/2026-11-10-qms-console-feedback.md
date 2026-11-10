# 管理页面浮动需求反馈入口

## 当前摘要

- 目标与授权：负责人直接要求管理页面补充业务页面同款反馈按钮。常规实现、验证、提交推送及 PR 获准；不自动合并部署、关闭 Issue、写飞书或恢复 heartbeat。
- 交付单元：[Issue109](https://github.com/JasonShu0722/QMS-2.0/issues/109)，一个实现任务、一个 PR；V0.0.45 于 2026-11-10 查询本地 / 远端 main、近期版本和开放事项后预留，提交前再查重。
- 基线：`a6245edd62bd03c89598fc79f84d3705107813bf`，工作区干净、无其他活跃代理；活动 checkout 功能分支 `codex/console-feedback`，不创建其他 checkout。
- 当前检查点：本地工程完成，独立 SPEC / QUALITY 与父两文件 45/45、Web lint/build、治理及 diff check 均 PASS；下一步提交推送并创建 PR。尚未发布，实页人工验收未执行。
- 验收前置：Web 工具链可用；浏览器连接和正式角色会话需实际检查，缺项记录为未执行，不能替代人工验收。
- 证据位置：Git 外 `D:/WorkSpace/QMS-2.0-local/console-feedback-20261110/`，实际 PR / CI 链接随检查点更新。

## 设计与影响范围

在 `apps/web/src/console/ConsoleLayout.tsx` 公共外壳末尾、与 Drawer 同级挂载一次现有 `FeedbackButton`，位于 ConsoleTheme 内继承管理主题；不放到 Outlet，避免逐页重复挂载。与业务端一样保留非敏感反馈入口，原生会话验证 dialog 仍在顶层阻挡背景操作。

复用现有固定反馈 URL、语言和非敏感位置偏好，保留拖拽吸边、视口修正、位置记忆、键盘和安全新窗口行为。不附加账号、组织、token 或草稿。共享组件 / CSS、InternalLayout / SupplierLayout 均不改；无 API、契约、权限、迁移、Worker、附件或生产数据变化，数据库验收不适用。

## 执行计划

- [x] 新实现代理 console_feedback_impl 仅修改 ConsoleLayout.tsx 和 ConsoleLayout.test.tsx。新增首页 / 深页唯一入口、主题、安全打开、路径 / 草稿 / 业务 tabs 测试，RED 两例明确缺按钮（其余 23 为定向过滤，并非正式回归跳过）。
- [x] 增加共享 import 与外壳末尾挂载；完整 ConsoleLayout 25 / FeedbackButton 20，共 45/45 GREEN，exit0、26.33 秒，无既有断言 / 超时变化。证据 impl-red.log / impl-green.log。
- [x] 独立 SPEC 后独立 QUALITY 均 PASS；父核 diff、完整定向两文件 45/45、Web lint/build、治理和 whitespace 全 exit0。浏览器连接受阻，实页窄屏 / 深浅主题 / 弹层 NOT_RUN，保留人工清单。
- [ ] 提交前核版本与 base，仅暂存本任务文件，提交推送 V0.0.45 并创建关联 Issue109 的 PR，核精确 head CI；不自动关闭或发布。
- [ ] 后续另获发布授权后：同 SHA 部署核验、最终页面及联合回归、Issue 记录、获准关闭 / 台账最小回填；失败保现场，本地通过不代上线。

## 回滚与沉淀

回滚仅撤管理布局 import / 挂载，不影响原业务入口或反馈数据。没有新增公共交互规则，不添加配置 / 框架；共享组件复用及验收结果沉淀于本计划。人工最终清单：管理首页 / 深页各一个入口，窄屏内可达，深浅主题正确，点击保留页面草稿，拖拽不误开，弹层优先级正确。自动、代理和人工证据分别记录。

## 检查点证据

- SPEC：feedback_spec 只读核 diff、共享调用方、主题 / 路由 / 会话边界，PASS，无规格缺口；不冒充运行证据。
- QUALITY：feedback_quality 在 SPEC 通过后独立只读检查，PASS；共享 fixed 定位、主题变量、安全新窗口、原生 gate 与测试覆盖无阻断。
- 父独立验证：完整 ConsoleLayout / FeedbackButton 45/45、Web lint、Web build、check:governance、git diff --check 全 exit0；parent-tests.log / parent-lint.log / parent-build.log / parent-governance.log。构建有原有大 chunk 警告，未为此调整打包或降低门禁。
- 浏览器：实际 browser-client bootstrap 返回 privileged native pipe bridge unavailable / client not trusted；未换通道绕过。实页窄屏 / 深浅主题 / 弹层 NOT_RUN，交付上述人工清单。
- 文档复核：实际 ConsoleLayout 唯一生产差异为共享按钮 import / 挂载，既有前端指南继续有效，增加本次候选与限制；仅同步该来源 LF 摘要，未刷新其他来源或复核日期，不以哈希更新代验收。
