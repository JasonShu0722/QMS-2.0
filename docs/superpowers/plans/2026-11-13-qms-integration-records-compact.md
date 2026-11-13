# 接收记录操作与管理顶部密度实施计划

> 使用项目 qms-superpowers-zh 路由子代理实现与两阶段独立审查。共享Git、生成契约、文档和整合验证由主代理串行执行。

## 当前摘要

| 项目 | 当前事实 |
| --- | --- |
| 批准 | 负责人认可整体方案并启动落地；接收记录操作优化及管理端顶部留白横展 |
| 映射 | REQ0036 / Issue97；codex/integration-records-compact；基线8d0ce1715b319a5f6fbef943586874e2e4e7fb4b；预留V0.0.50，提交前复核 |
| 范围 | 规格见同日 integration-records-compact-design；无迁移、无二期映射、无业务端横展 |
| 状态 | 本地实现与独立SPEC/QUALITY通过；API PG28/28及retention9/9、Web四文件115/115及返修Console33/33、真实浏览器3/3、API/Web lint/build、契约、治理/归档/Compose均通过；PR与部署待接续 |
| 授权 | 持续交付授权覆盖PR、合并部署；不关闭Issue、不写飞书、不改生产资料 |
| 下一步 | 提交推送PR，核精确PR CI/Review、合并树一致、main CI与自动部署，公网只读核验后本地归档清理 |

## 任务

1. API：integration-receipt.dto.ts / service.ts，仅记录页查询与批删上限1000；不改共享其他分页上限。先边界红灯，最小实现后真实PG完整integration-receipts/retention回归；覆盖1000行创建、删除与容量账，1001拒绝、权限/跨组织/未知重试保持。
2. Web接收页：ReceiptList.tsx / api-integrations.css / 受影响测试，必要时LedgerTable新增可选工具栏插槽供原列设置同栏；保持其他消费者布局。移除清理展示、容量同行、顶部分页六档、删除末页回退、当前页选择、底部固定条及未知结果冻结。先测试红灯再最小实现；不得关motion或提高预算刷绿。
3. 管理布局：console.css及对应测试，公共顶部padding收至12～16px，检查console子页首项额外留白；不改字号/点击目标/主题/业务外壳。窄屏相邻回归，前端规范及FRONTEND-DESIGN由父同步。

## 检查点

- [x] 复用Issue97登记、版本查重、隔离分支、方案与计划。
- [x] compact_api、compact_receipt_web、compact_console分别按红绿证据交付；本轮子代理无Git写入，父统一整合。
- [x] API DTO生成contracts generate/check；API/Web lint/build、真实PG受影响文件、治理/归档/Compose按工程门禁，真实浏览器验收，记录失败与未覆盖。
- [x] 独立SPEC通过后QUALITY；问题修复后复验，不重复无变化全量。
- [ ] 提交推送PR关联Issue97；精确PR CI/Review、合并树一致、mainCI、自动部署/快照/149链/健康/公网资源核验。
- [ ] 最终Issue最小回写保持开放；规则文档同步、Git外归档证据、仅清理自有资源。实际人工验收另列。

回滚走受控修复PR恢复原页大小和布局；不删历史数据或回退数据库。删除测试仅一次性数据库。配置/用户数据、既有$null及其他worktree一律保留。

## 当前验证与返修事实

- 一次性PG18容器qms-integration-compact-pg，127.0.0.1:55636、任务标签INTEGRATION-COMPACT，149迁移及标准seed成功，未连接55440。API边界红灯3FAIL/25PASS，最小修改后integration-receipts完整28/28通过，覆盖1000查询/批删及1001拒绝、容量与审计；不将其描述为独立retention文件已执行。
- Web新操作4项RED，分页归一化1项RED；冻结控件用例首次10秒超时后收窄到真实toolbar/form/行并缓存控件，原预算/motion和断言不变，4项及model完整6项GREEN。父四完整文件ReceiptList/ConsoleLayout/Ledger/model共115/115通过；原超时保留在Git外日志。
- Console顶部三档和验证态RED2四项准确失败，GREEN4。首RED因测试CSS声明双分号导致jsdom解析截断，不当成行为红灯。独立SPEC发现真实UserAdministration首工具栏margin与治理面板padding叠加6px，限定管理main首项修复；新增真实组件/外部及非首项对照，RED2两项失败后完整Console33/33通过，SPEC复核PASS。
- Git外证据目录：D:/WorkSpace/QMS-2.0-local/integration-records-compact-20261113/。未执行的PR或上线步骤不计通过。
- 最终父API/Web lint/build、contracts generate/check、治理、归档隔离及Compose退出0；DTO仅数值上限改变，生成TypeScript类型无差异，未手改生成文件。真实独立retention9/9通过。独立compact_spec返修复核PASS后compact_quality全范围及浏览器夹具补审PASS。
- 浏览器首两轮中1000行页面/勾选/窄屏固定条/原子删除均PASS，跨管理页硬重载检查出现空白DOM；补一次性configuration:read权限未消除，不将其归因为权限或生产缺陷。改用实际桌面/移动导航路径后用户页和平台配置页几何12～16px通过；最终完整三场景3/3 PASS（browser-final，约1分钟），无加超时/关动效。开发服务器深链硬重载原因未进一步定位，生产正式账号/物理手机未测。
