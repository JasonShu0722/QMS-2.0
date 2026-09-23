# QMS 工程优化 P2 首批实施计划

**目标：** 完成 P0/P1 检查收尾，以及 P2-01 交接、P2-02 验收汇总、P2-03 专用 Skill，降低后续开发和维护的接续成本。

**依据：** [总体设计](../specs/2026-09-18-qms-2.0-redesign-design.md)、[P1 实施记录](2026-09-22-qms-engineering-p1.md)、[开发治理](../../../qms-2.0/docs/DEVELOPMENT-GOVERNANCE.md)。用户已授权按建议推进；继续在活动主目录保留既有修改。

**架构：** 复用 Git、Node 内置能力和现有 TypeScript 编译器。所有工具与三个 Skill 位于 `qms-2.0/`；同一份脱敏源码快照同时服务交接和证据汇总。默认只运行明确选择的验证组合，阶段验收仍调用原入口。报告在 Git 外独占创建，不覆盖旧证据。

## 实施顺序与文件

- [x] 治理收尾：`scripts/check-module-boundaries.mjs` 使用 TypeScript 语法树检查静态/动态字面量导入和再导出，识别无扩展名 Controller；`check-documentation.mjs` 发现未登记 AGENTS；增加 `test/governance-boundaries.test.mjs` 与文档反例。
- [x] P2-01：`scripts/engineering-report.mjs` 提供源码指纹、安全输出与参数共用函数；`scripts/create-handoff.mjs` 输出中文交接及 JSON，包括 HEAD、改动路径、来源指纹、适用规则、计划未完成项和知识入口。
- [x] P2-02：`scripts/collect-evidence.mjs` 调用既有检查，记录 Node/pnpm、起止源码、命令、退出码、耗时及 PASS/FAIL/NOT_RUN；失败后停止，写入剩余未执行项。中途输出保留在终端，不复制环境值或原始日志进入报告。源码变化或前置失败时不能得到总体 PASS。
- [x] P2-03：`qms-2.0/.agents/skills/` 增加 `qms-feature-delivery`、`qms-permission-review`、`qms-incident-diagnosis` 三份中文 Skill，仅引用现有规则；校验元数据、链接并用本轮实际任务核对适用边界。
- [x] 导航与验收：新增 `docs/ENGINEERING-TOOLS.md`，同步索引、AGENTS、package scripts、受影响来源摘要；执行专项测试、真实本地交接与证据工具、默认测试及归档隔离，记录结果。

## 验证要求

先写反例再实现：漏登 AGENTS；新增跨模块依赖、无扩展名 Controller、动态导入/再导出、注释不能误报；交接包含未提交内容变化且不读取秘密；仓库内和已有输出拒绝；执行失败及启动失败不能 PASS，剩余项为 NOT_RUN；源码变化使报告失效。

运行 `corepack pnpm test:governance`、`check:governance`、`check:archive-isolation` 和 `test`。证据工具先跑治理组合；不因本轮工具新增而连接数据库、启动生产恢复或宣称阶段验收通过。历史业务 PASS 不转记为本轮新证据。

## 范围与版本收尾

版本收尾在本轮体现为可验证的 HEAD + 工作区文件指纹，保留未提交差异；本计划不自动 Git 提交、推送或部署。源码指纹覆盖活动工程、设计计划及根规则/CI，不读取归档、秘密和忽略产物；覆盖限制必须写入报告。

P2-04 影响推荐、P2-05 维护事项、P2-06 观测与演练按上一轮建议保留为后续候选；本轮不启动新的业务或运维服务。Skill 文件可从工程 AGENTS 发现；自动 Skill 列表取决于客户端是否扫描当前 `qms-2.0/`，不声称当前会话已热加载。

## 实际结果

在活动工程、Node `v22.22.0` 和 pnpm `11.19.0` 下执行：`check:governance`、`test:governance`、`check:archive-isolation` 均通过；默认 `test` 通过。治理工具专项测试 28/28 通过，三份 Skill 的元数据校验均通过。真实交接生成了中文与 JSON 报告；证据工具的治理、单测组合均返回 PASS，执行前后源码指纹相同。失败前置、子进程失败、源码变化、仓库内输出等反例由专项测试覆盖。

首轮报告保存在 Git 外的 `D:/WorkSpace/QMS-2.0-local/p2-handoff-validation-20260922/`、`p2-evidence-governance-20260922/` 和 `p2-evidence-unit-20260922/`。文档收尾后的当前状态报告位于 `p2-handoff-final-20260923/`、`p2-evidence-governance-final-20260923/` 和 `p2-evidence-unit-final-20260923/`；旧报告仅证明对应源码快照。未运行阶段一或阶段二完整验收，本轮不宣称业务验收或生产放行。
