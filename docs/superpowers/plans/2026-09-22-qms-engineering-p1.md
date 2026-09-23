# QMS 工程优化 P1 实现计划

**目标：** 将仓库学习中的长期知识、变更分析与维护闭环落实为中文文档和可执行门禁，接续已存在的 P0。

**范围：** 本轮 P1 指工程治理优化，与阶段二计划中的 P1 流程运行时编号无关。历史对话读取未返回原逐项候选表，因此按已能核实的学习建议明确本轮五项范围，避免声称恢复了原始编号。

**架构：** 复用文档索引、现有阶段验收和 CI；新增文档引用原规格与交接，不重复定义业务接口。检查器验证本地链接、权威来源唯一性、来源摘要与复核期限；语义冲突仍需人工审查。

**技术栈：** Node.js 22.22、内置 node:test、JSON 和中文 Markdown；无新增依赖。

**依据：** [总体设计](../specs/2026-09-18-qms-2.0-redesign-design.md)、[开发治理](../../../qms-2.0/docs/DEVELOPMENT-GOVERNANCE.md)。继续在用户指定主目录工作，保留既有 P0 与其他业务变更，不创建分支、不提交或部署。

## 实施顺序

- [x] 1. 新增 `qms-2.0/docs/DOMAIN-GLOSSARY.md`、`ARCHITECTURE-DECISIONS.md`：区分术语、既有决策与交付状态，记录影响与重审触发条件。
- [x] 2. 新增 `qms-2.0/docs/CHANGE-IMPACT.md`：覆盖新增功能、权限、迁移、公共能力复用、依赖选型与维护影响，给出可直接使用的任务记录模板。
- [x] 3. 新增 `qms-2.0/docs/OPERATIONS-RUNBOOK.md`：连接故障诊断、发布、恢复、复盘与维护触发条件，引用实际命令和边界，不宣称生产演练完成。
- [x] 4. 新增 `qms-2.0/scripts/check-documentation.mjs` 和 `test/documentation.test.mjs`；扩展 `documentation-index.json`；接入 `check:governance` 与默认测试。先运行故障夹具，确认缺文件、无权威、坏链接、来源变化和到期会失败，再运行真实仓库。
- [x] 5. 更新文档导航、开发治理和本计划，运行 `corepack pnpm check:governance`、`corepack pnpm test:governance`、`corepack pnpm test`、`corepack pnpm check:archive-isolation`、`git diff --check`，记录实际结果。

## 验收与边界

检查器必须返回非零退出码并定位责任文档；Windows CRLF 与 Linux LF 不产生虚假的摘要变化。复核到期使用 UTC 日期，测试注入固定日期以验证临界值。来源变化只能提示需要复核，不能判断内容一定错误；更新摘要前必须比较源文件并同步文档。

未修改业务 API、数据库、Web 或部署行为，不执行本轮不涉及的数据库迁移和生产恢复。业务阶段验收不由文档门禁替代。原始日志与秘密不入 Git；本轮验证结论记录于此，不改变业务能力验收状态。

## 验证记录

环境：Windows PowerShell，活动目录 `D:/WorkSpace/QMS-2.0/qms-2.0`；加载仓库外 `Enter-Qms.ps1`，Node `v22.22.0`、pnpm `11.19.0`。源码基线 `becf49440e8bca87f28cb68a8c24cc6a5f3379be` 加本工作区原有 P0 与本轮治理差异；无业务源码变更。

| 命令 / 场景 | 实际结果 |
| --- | --- |
| 首次 `node --test test/documentation.test.mjs` | RED：检查器尚不存在，明确 MODULE_NOT_FOUND |
| `corepack pnpm test:governance` | PASS，10/10；覆盖漏登、缺文件、零/多个权威、伪导航、坏链接、来源变更、日期边界、缺复核、越界与废弃替代 |
| `corepack pnpm check:governance` | PASS，23 份文档、129 个本地链接、5 份来源复核、40 对既有模块依赖 |
| 修改数据保护来源后执行 `corepack pnpm check:docs` | 预期 FAIL，退出 1，定位 OPERATIONS-RUNBOOK 依赖 DATA-PROTECTION 的旧摘要；核对正文并更新复核理由/摘要后治理检查 PASS |
| `corepack pnpm test` | PASS，根测试 12/12（含上述 10 项），API 35 suites / 435 tests，Web 27 files / 150 tests；退出 0，Web 404.53 秒 |
| `corepack pnpm check:archive-isolation` | PASS |
| `git diff --check` 与新增文件空白检查 | PASS；新增文件另用 Node 读取并断言无行末空格 |

接入：默认测试已包含文档检查与回归；既有 CI 的治理步骤会执行同一检查器，并补充根 `docs/superpowers/**` 的触发路径。未在远端运行 CI，不将本地结果写成远端通过。

内容复核修正：数据保护中的旧“附件仍待 P3”描述改为引用已交付的公共附件文档；能力总账补入阶段三 S4.1d 的正式发单范围，仍保留回复、证据、验证关闭和试点未闭环的限制。旧历史验收结论未改写。

限制：本轮仅为工程文档、检查器与 CI 触发配置；未执行 PostgreSQL、浏览器端到端、产品构建或生产恢复，不代表业务阶段再验收。默认测试仍有已有 Node VM Modules 实验提示和 Ant Design 弃用提示，无 engine warning。门禁验证结构与所登记来源的时效，不自动判断自然语言语义、不检查远程链接或标题锚点，也不自动定时提醒。复核期限采用 UTC 日期；未提交、推送或部署。
