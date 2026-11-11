# 接收记录详情与删除体验实施计划

> 使用 qms-superpowers-zh 路由 TDD、subagent-driven-development、独立 SPEC/QUALITY 和真实 PostgreSQL/浏览器验收。

## 当前摘要

| 项 | 当前事实 |
| --- | --- |
| 目标/批准 | 负责人确认一期接收记录默认正文、框内滚动/复制、列表多选和删除记录，并追加公共管理页去冗余、筛选收起和接口名称直观展示 |
| 映射 | REQ0036 / Issue97，branch codex/receipt-detail-ux，base/main ada7ec；预留 V0.0.47，提交前查重 |
| 授权 | 沿现有一期开发/PR/合并部署持续授权接续；不关闭 Issue、不写飞书、不操作生产凭据 |
| 范围 | ReceiptList 详情/选择/删除/筛选折叠/接口名称；ConsoleLayout 管理页冗余说明；IntegrationReceiptController/Service 删除接口、审计、容量；不改外部接收协议、迁移或管理接口 |
| 状态 | 一期整包实现已冻结；真实 API 收件套件 24/24、Web 邻近回归 68/68、真实浏览器 1/1、API/Web 构建、契约与治理门禁通过；PR #112 等待 CI |
| 证据 | 删除前真实 RED 为 404/字段缺失；修复后覆盖删除回滚、越权、幂等、审计失败、清理并发、名称历史和候选隔离；前端覆盖默认正文、框内滚动复制、勾选删除、候选筛选和公共壳 |
| 下一步 | 等待 PR #112 精确 CI/Review，通过后按持续授权合并部署并核验主干 CI/自动部署；真实业务方联调、生产配权及人工视觉验收仍单独记录 |

## 文件所有权与任务

- 新实现代理 A：`apps/api/src/modules/api-integration/integration-receipt.controller.ts`、`integration-receipt.service.ts`、`integration-receipt.dto.ts`、直接/邻近 API 测试；负责删除权限、事务锁、容量、审计、幂等和结果保留。先写删除 RED，父真实运行后再改生产。
- 新实现代理 B：`apps/web/src/console/api-integrations/ReceiptList.tsx`、`api-integrations.css`、`ReceiptList.test.tsx`；负责默认正文、滚动、复制、选择、确认和刷新。现有正文 RED 草稿由父确认后继续，不能削弱无权/过期/ABA断言。
- 新实现代理 B 同批补齐：筛选默认收起/并排按钮、接口名称展示；先补受影响 RED，保留原请求查询和组织范围断言。
- 前端代理同批负责 `ConsoleLayout.tsx`/console.css及其测试：正文重复标题和身份范围说明删除、组织选择移顶栏，保留全部服务端范围/未保存保护/标题焦点；先补公共导航布局RED，横展全部管理路由。
- 父统一：设计/计划/API-INTEGRATION/SECURITY/FOUNDATION、权限目录（若确认复用 `integration:manage` 则不改权限目录）、生成契约、治理索引、Issue/PR/发布证据。其他任务 dirty 文档保留，不混入。

## 验证门禁

- [ ] API RED：删除接口缺失/404或预期行为失败，覆盖单条/批量/越权/跨组织/空重复UUID/上限；正文自动读取/复制/滚动测试 RED 已存在，父运行确认。
- [ ] 实现后真实一次性 PostgreSQL 146 链跑直接收件/删除/保留/审计/观察完整相关文件；确认删除释放密文字节、请求结果保留、并发锁后不重复扣减。
- [ ] Web 相关完整文件、API/Web build、contracts generate/check、Compose、governance/archive/diff；真实登录/MFA 浏览器验证详情默认正文、复制、选择/删除和权限边界。
- [ ] 独立 SPEC 后 QUALITY，审查范围限定本次详情/删除；失败保留，不 rerun 刷绿。
- [ ] 预留 V0.0.47 查重、PR 关联 Issue97、精确 CI/Review、main CI、自动部署、Swagger/公网资源核验；部署后本地归档并精确清理自有资源。

## 明确限制

- 删除不可撤销；一期不提供撤销恢复、不支持跨页全选、不删除请求结果、不删除接口/凭据、不做业务数据回滚。
- 页面正文仍按权限返回纯文本；未执行生产凭据联调或业务入库验收。
