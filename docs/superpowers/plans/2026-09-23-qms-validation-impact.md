# QMS 变更影响推荐实施计划

**目标：** 落地 P2-04 的确定性验证推荐，保持现有门禁权威。

**设计：** [变更影响推荐设计](../specs/2026-09-23-qms-validation-impact-design.md)。

**文件职责：** `qms-2.0/governance/validation-impact.json` 保存路径与推荐清单；`scripts/recommend-validation.mjs` 获取 Git 改动并合并规则；`test/validation-impact.test.mjs` 验证关键分类与真实 Git 输入；`docs/VALIDATION-IMPACT.md` 解释用法和限制。`package.json`、索引、导航和 CI 接入治理检查。

- [x] 先写路径重叠、未知路径和真实 Git 改动的失败测试，确认缺少实现导致失败。
- [x] 实现规则清单与 CLI；覆盖 `HEAD` 工作区、可选 `--base`、中文 Markdown 和 JSON 输出，未知路径必须给出保守清单。
- [x] 在治理检查中验证规则 ID、命令 ID、路径模式和文档入口；把专项测试接入默认测试。
- [x] 更新中文导航、影响分析、复核来源摘要和命令说明。
- [x] 运行专项测试、`check:governance`、归档隔离、相关默认测试，实测当前工作区报告并记录源码范围与限制。

## 实际结果

`validation:recommend --format json` 已在当前工作区实测，规则命中开发治理、文档、API、Web、部署与依赖路径，未知路径为 0；备份工具的高风险推荐另有反例测试。`check:governance` 与专项测试通过，最终默认测试结果见 Git 外 `D:/WorkSpace/QMS-2.0-local/p2-continuation-20260923/evidence-unit/`。推荐只输出应检查范围；阶段一、阶段二命令出现在结果中并不代表已运行或通过。本计划不声称发布或业务验收完成。
