# QMS 维护事项台账实施计划

**目标：** 落地 P2-05 的少量真实维护事项与可执行检查。

**设计：** [维护事项台账设计](../specs/2026-09-23-qms-maintenance-register-design.md)。

**文件职责：** `governance/maintenance-items.json` 保存事项；`scripts/check-maintenance.mjs` 验证期限、来源与关闭证据；`test/maintenance.test.mjs` 覆盖反例；`docs/MAINTENANCE-REGISTER.md` 是中文阅读入口。治理、导航与文档索引纳入同一门禁。

- [x] 先写开放项、重复 ID、来源变化、过期和无证据关闭测试并确认红灯。
- [x] 实现维护检查和三项真实开放事项，保持 JSON 与中文阅读入口一致。
- [x] 将检查接入 `check:governance` 与默认测试，更新运维手册、导航和来源摘要。
- [x] 运行专项测试、治理检查和相关门禁，记录实测结果及未覆盖边界。

## 实际结果

`check:maintenance` 与专项反例测试通过；台账当前开放 3 项、关闭 0 项。来源变化、复核到期、重复 ID 和缺少关闭证据会失败。它不查询外部安全公告，也不能仅凭 JSON 字段证明真实问题已解决。最终治理与默认测试结果见 Git 外 `D:/WorkSpace/QMS-2.0-local/p2-continuation-20260923/`。
