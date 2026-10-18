# QMS 四项需求人工验收与关闭回填记录

## 当前摘要（2026-10-18，Asia/Taipei）

- 范围：REQ-0013～0016，沿用本会话最终确认的 A～G 交付拆分及集中 MFA / 安全弹窗调整。P3 不在本轮；G 仅预留文档。
- 负责人确认与授权：本会话明确“人工验收完成，回填飞书并关闭issue”。对应此前已明确的四条需求、最终部署及人工验收清单，记录为负责人确认通过；不补造逐项浏览器操作、设备型号、截图或自动浏览器 PASS。
- 实际部署版本：`234bbdc70b5fea8ab28d119a8c8d88cd9c824667`。[最终 Foundation](https://github.com/JasonShu0722/QMS-2.0/actions/runs/39067232231) 8/8 成功；[生产部署](https://github.com/JasonShu0722/QMS-2.0/actions/runs/39067817450) 成功。80 套 841 项真实 PostgreSQL 集成测试、8 项 Worker 生命周期通过；迁移前加密数据库快照、实际迁移完成、API / Worker / Web 健康和公网 HTTP 已核实。
- Issue：#20～27、#36 均已先追加对应验收、部署、范围及复盘记录，再以 `completed` 关闭并回读。
- 飞书：四条原始方案、任务及验收标准保留，子任务字段仅追加交付 / 人工验收 / Issue 关闭说明；Issue / PR 链接和实际完成时间已逐条写入并回读。负责人随后确认“已改为已结束”，首次回读四条终态 revision 220；补齐交付段终态说明后，2026-10-18 10:11（Asia/Taipei）最终回读 revision 224，REQ-0013～0016 均为“已结束”。
- 分别状态：四条需求开发、推送、PR 合并、生产部署、负责人人工验收、9 个 Issue completed 关闭、飞书回填及终态回读均已完成。外部同步无剩余项。
- 阶段回填历史：此前 `进度状态` 接口返回 `READONLY`，网页连接中断，文档归档 `c89fe4848c42fcbc3250213b7069d7b37b47b3be` 曾记录待负责人网页更新。此次由负责人网页完成，Codex 仅回读并更新可写交付说明，没有改权限、绕裸接口或创建替代状态。
- 本次仅文档终态归档，使用同范围验收补齐号 `V0.0.15-fix2`，接续 `V0.0.15-fix1`；提交前核对远端 main、既有 Issue / PR 和本地全部分支，无既有 fix2。使用 `[skip ci]`，不因终态记录重复部署运行代码。文档提交 SHA 与上述生产 SHA 分开记录。
- 下一动作：本轮已结束，无待执行回填；后续问题按原 Issue 修复或新需求接续，不根据历史勾选项重复开发或发布。

## 逐需求映射与实际结果

| 需求 / record_id | 最终验收范围 | Issue 关闭结果 | 合并 PR / 主分支整合 | 完成时间（Asia/Taipei） |
| --- | --- | --- | --- | --- |
| REQ-0013 / `rec28mipZSRu6t` | B 个人菜单、D 记住登录、E 本人头像；所有账号 MFA 由管理员在账号管理配置，个人安全使用弹窗卡片 | [#21](https://github.com/JasonShu0722/QMS-2.0/issues/21)、[#23](https://github.com/JasonShu0722/QMS-2.0/issues/23)、[#24](https://github.com/JasonShu0722/QMS-2.0/issues/24)、[#36](https://github.com/JasonShu0722/QMS-2.0/issues/36) 均 closed / completed | #29 / #34、#35、#37、#38 / #39 | 2026-10-18 09:20:56 |
| REQ-0014 / `reczz28OHZTVnF2H` | C 批量创建、首登改密、有效临时密码查询 / 复制 / 下载、管理员重置 | [#22](https://github.com/JasonShu0722/QMS-2.0/issues/22) closed / completed | #30 / #33 / #34，最终已进入 main | 2026-10-18 09:20:23 |
| REQ-0015 / `reczz28OHe4q2CDK` | F1 供应商独立档案和按需多人账号；F2 客户；F3 仅编码 / 名称物料；G 外部接收仅预留 | [#25](https://github.com/JasonShu0722/QMS-2.0/issues/25)、[#26](https://github.com/JasonShu0722/QMS-2.0/issues/26)、[#27](https://github.com/JasonShu0722/QMS-2.0/issues/27) 均 closed / completed | #31 / #34、#40、#41、#42、#43 | 2026-10-18 09:20:50 |
| REQ-0016 / `reczz28OHgapBJZb` | A 双门户单行顶栏、工作标签与清单、未保存 / 恢复 / 专注及受后续菜单影响的联合行为 | [#20](https://github.com/JasonShu0722/QMS-2.0/issues/20) closed / completed | #28 / #32 / #34，后续外壳调整包含在最终部署 | 2026-10-18 09:20:13 |

完成时间取该需求最后一个关联 Issue 的实际关闭时间，使用 UTC+08:00；不以部署时刻或飞书写入时刻冒充关闭事件。链接字段只放代表事项，全部关联保留在各条追加交付段和本表。

## 证据来源与边界

- 人工来源：负责人在本会话的明确验收及关闭回填指令。个人头像安全扫描询问已解释现有规则，未提出新的修复需求；本次不改变扫描、MFA、会话、密码或主数据规则。
- 自动来源：对应最终 SHA 的 CI、生产部署日志和公网检查。此前失败、修复及候选快照继续保留在既有计划、各 PR 与 `FOUNDATION.md`，不改写成全程无失败。
- Git 外证据：`D:/WorkSpace/QMS-2.0-local/p0p1-issue-closure-results-20261018.json`、`p0p1-closure-latest-feishu-20261018.json`、各需求写入 / 回读 JSON、`p0p1-final-manual-acceptance-20261018.md`、`p0p1-overnight-progress-20261018.json`。凭据和原始日志均不入 Git。
- 归档前发现 JSON 日期解析会丢失原 UTC 标识，已按原 GitHub `closed_at` 显式转 UTC+08:00，修正四条完成时间及追加文字并回读；本表为修正后实际时间。
- 复盘：本轮实现与返修的根因及证据已在原 PR、既有账号 / 供应商 / 运维交接和验收文档沉淀。本次关闭没有新的业务实现或通用治理规则，不新增平行规范。平台阶段只读与网页回读沿用既有交付流程。
- 后续问题沿原 Issue 的修复 PR 或新需求接续；涉及数据恢复遵循现有运维与备份手册评估，不自动执行破坏性迁移回滚。

## 历史与接续入口

- [分单元实施总计划](2026-10-17-qms-p0-p1-implementation.md)
- [开发策划与确认](2026-10-17-qms-p0-p1-development-planning.md)
- [顶栏 / 菜单 / 头像](2026-10-17-qms-p0-p1-web.md)
- [账号 / 会话 / MFA](2026-10-17-qms-p0-p1-identity.md)
- [主数据及外部接收预留](2026-10-17-qms-p0-p1-master-data.md)
- [集中 MFA 与安全弹窗](2026-10-18-account-security-dialog.md)
