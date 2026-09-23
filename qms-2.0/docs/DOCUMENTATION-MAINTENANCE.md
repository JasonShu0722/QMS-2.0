# 文档索引与复核机制

唯一机器入口是 `governance/documentation-index.json`，阅读入口是[文档导航](README.md)。中文为权威语言；保留英文原始资料时，中文说明须注明原始来源、适用范围及同步日期。第三方参考不是 QMS 的生效规则。

## 检查命令

从 `qms-2.0/` 执行：

```powershell
corepack pnpm check:docs
corepack pnpm check:governance
corepack pnpm test:governance
```

`check:docs` 检查索引唯一性、有效权威来源、docs 目录漏登、真实导航链接、登记文档和 AGENTS 的本地文件链接、废弃替代关系及复核元数据。支持常用行内链接、图片链接、引用式定义和尖括号路径；跳过代码示例和外链。本轮不验证远程可用性、标题锚点、完整 CommonMark 语法或自然语言语义，不能把 PASS 理解为没有业务矛盾。

`check:governance` 包含上述检查和既有规则/模块检查；默认 `test` 与 CI 已接入。检查失败返回非零。检查不运行定时任务，到期是在下次本地或 CI 执行时暴露。

## 来源变化与期限

P2 补充活动工程 AGENTS 自动发现与作用范围核对，并将工程内专用 Skill 纳入索引。具体工具和扫描边界见[工程工具](ENGINEERING-TOOLS.md)。

P1 新增的五份指南在索引中声明 `review`：复核者 `owner`、UTC 日期 `reviewedOn`、最长有效天数 `maxAgeDays`、理由 `reason`、来源路径及 SHA-256。原文件的 CRLF 会统一为 LF 再计算摘要，避免 Windows/Linux 差异。到期日零点起失败；不能填未来日期。

`reviewPolicy.freshnessTopics` 列出必须复核的主题；删去这些主题的复核信息也会失败。来源文件任意变化都触发复核，不自动断言正文错误。新增活跃指南也应登记到此清单；已有历史验收文档仍受索引与链接检查，不补造“刚复核过”的时间。扩大复核覆盖时必须实际阅读对应来源。

复核流程：

1. 从失败消息定位指南和来源，在 Git 差异中比较变更，核实正文、决策和适用范围。
2. 修改所有受影响指南、相关计划和能力入口，记录实际复核者及结论。若无需改正文，说明保持有效的理由。
3. 用下列命令计算指定来源摘要；路径相对于 `qms-2.0/`，不要对秘密或备份执行。
4. 用计算结果更新索引的对应来源、复核日期和理由，然后重跑门禁。禁止仅刷新日期/摘要来消除失败。

```powershell
node --input-type=module -e 'import {readFile} from "node:fs/promises"; import {sourceDigest} from "./scripts/check-documentation.mjs"; console.log(sourceDigest(await readFile(process.argv[1], "utf8")))' docs/PLATFORM-HANDOFF.md
```

## 冲突与废弃

每个仍生效的主题恰好一个 `canonical: true` 文档。旧文档转为 `deprecated` 时取消其权威标记，填写 `replacedBy` 指向有效权威文件，并在正文顶部注明替代关系。不要删除历史验收证据来掩盖失败。

规则适用顺序遵循仓库 AGENTS：上层安全、位置与契约规则不能被子目录削弱；产品含义依原始规格，接口依生成契约，当前实现与限制依最新同范围验收证据。发现冲突时先记录范围、日期和来源，核对代码及用户决策后同步文件；不能仅凭“日期更新”覆盖上层约束。

设计与阶段计划位于仓库根 `docs/superpowers/`；从相关指南或阶段记录链接进入。本轮 P1 的范围、勾选状态与实际验证见[实施计划](../../docs/superpowers/plans/2026-09-22-qms-engineering-p1.md)。

## 学习来源与裁剪

参考 [vibe-coding-cn 开发流程](https://github.com/tradecatlabs/vibe-coding-cn/blob/develop/docs/workflow/development-process.md)关于上下文、验证和文档同步的方法，并沿用 QMS 现有索引与 CI。这里仅引入中文知识入口、复核元数据和无新增依赖的检查器；不引入外部仓库的默认推送规则或大规模代理编排。
