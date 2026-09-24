# 交接、验收证据与 QMS 专用 Skill

本页承接[开发治理](DEVELOPMENT-GOVERNANCE.md)与[文档复核](DOCUMENTATION-MAINTENANCE.md)。命令均从 `qms-2.0/` 执行，Windows 先加载仓库外 `Enter-Qms.ps1`。输出目录的父目录必须已存在，输出目录本身必须是 Git 外的新目录；工具拒绝覆盖旧证据。

## 任务交接

```powershell
corepack pnpm task:handoff --output D:/WorkSpace/QMS-2.0-local/handoff-p2-01 --plan ../docs/superpowers/plans/2026-09-22-qms-engineering-p2.md
```

生成 `handoff.md` 和 `handoff.json`：源码 HEAD、分支、未提交及未跟踪的改动路径、源码指纹、规则入口、知识入口和选定计划中的未勾选项。省略 `--plan` 时明确显示未选择计划；不能把没有待办行理解为已完成。

适用规则根据当前改动目录筛选，同时保留完整规则清单。任务若将进入未修改目录，必须再读取那个目录的 AGENTS。计划内容是接续资料，不自动授予新操作权限。工具会根据开放维护台账的来源文件列出直接关联的 `MAINT-*`，但间接影响仍须在任务影响分析中人工补充；事项关闭必须更新台账并提供真实证据。工具不会把历史 PASS 复制为新的验收结论。

## 验收汇总

```powershell
corepack pnpm evidence:collect --profile governance --output D:/WorkSpace/QMS-2.0-local/evidence-p2-01
```

| 组合 | 实际执行 | 不能据此声称 |
| --- | --- | --- |
| `governance` | 治理检查、治理工具专项测试、归档隔离 | 业务功能或阶段验收完成 |
| `unit` | 治理检查、现有默认 `test` | PostgreSQL、浏览器主链或生产恢复通过 |
| `phase-1` | 原 `acceptance:phase-1` | 未包含在原入口中的容器生命周期或生产放行 |
| `phase-2` | 原 `acceptance:phase-2` | 供应商阶段三主链或生产放行 |

阶段组合必须先按原验收要求准备一次性服务。工具不创建、清理或切换数据库，不降低前置条件，不连接保留预览库。缺少 npm_execpath 或运行时不满足 `package.json` 时，报告失败且步骤保持未执行；应通过上面的 pnpm script 入口运行。

生成 `evidence.md` 和 `evidence.json`，记录实际 Node/pnpm、选择组合、起止源码指纹、命令、退出码、耗时和执行状态：

- `PASS`：该步骤真实退出 0；总体 PASS 还要求所有步骤执行成功、源码前后相同且没有被安全策略排除的清单文件。
- `FAIL`：步骤失败、进程启动失败、运行时不匹配、源码发生变化或报告取得失败。
- `NOT_RUN`：前置条件或前一步失败导致未执行，不是通过或跳过验收。
- `RUNNING`：进程尚未结束或被强制中断；工具每步前后更新文件，不把不完整证据标为成功。

原始子进程输出只显示在终端，不复制进报告。报告不采集环境变量、命令输出正文或差异正文。失败后不自动重试；先查看终端与失败步骤，再使用新的输出目录重跑。

## 源码指纹与限制

Git 清单覆盖活动 `qms-2.0/`、根 `docs/superpowers/`、根 AGENTS/README 和 `.github/workflows/`。对覆盖文件内容计算 SHA-256，文本统一 CRLF/LF；包括未跟踪的非忽略源码及受控生成契约。删除文件保留空摘要。报告不会读取归档和已忽略文件；清单内秘密文件、证书、备份、运行产物或符号链接被排除并计数，不能据此生成完整 PASS。

该指纹不是 Git 提交，不包含仓库外环境、数据库状态或依赖安装树；短暂修改后恢复原内容也不能仅凭首尾快照识别。验收期间应冻结源码写入，后续变更需重新评估证据覆盖。报告生成后也可能过期，接续时比较指纹与来源，不把旧报告当作当前状态。

## 专用 Skill

| 入口 | 触发场景 |
| --- | --- |
| [功能交付](../.agents/skills/qms-feature-delivery/SKILL.md) | 领域开发、缺陷与跨层变更，连接影响分析和验收 |
| [权限审查](../.agents/skills/qms-permission-review/SKILL.md) | 账号、组织/供应商、节点和附件授权的专项复核 |
| [故障诊断](../.agents/skills/qms-incident-diagnosis/SKILL.md) | 依据现象逐层查证，修复后验证防复发 |
| [QMS Superpowers 工作流](../.agents/skills/qms-superpowers-zh/SKILL.md) | QMS 功能、计划、子代理、审查和真实验收的流程路由 |

四个入口是中文短指南，不复制权威规则，也不授权部署或生产修改。它们位于工程内 `.agents/skills/`；从工程 AGENTS 可直接定位。客户端扫描该工程目录后才可能加入自动发现列表，本轮不修改全局 Skill 配置，不声称当前会话已热加载。

## 治理补强

文档检查自动发现活动工程内的 AGENTS 并与索引核对，排除依赖、生成物、测试产物、归档和本地原型目录；目录作用范围必须与真实路径一致。模块边界检查复用已有 TypeScript 编译器，读取语法树和 API tsconfig，检查静态导入、再导出、字面量动态导入和 require；无扩展名 Controller 同样禁止，无法静态判定的动态导入明确失败。

检查不证明数据库访问都经过公开服务，也不证明权限或事务正确；仍按[变更影响分析](CHANGE-IMPACT.md)进行对应测试和审查。本轮范围、验证与后续候选见[P2 实施计划](../../docs/superpowers/plans/2026-09-22-qms-engineering-p2.md)。
