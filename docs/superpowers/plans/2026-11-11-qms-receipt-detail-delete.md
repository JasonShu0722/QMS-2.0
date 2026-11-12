# 接收记录详情与删除体验实施计划

> 使用 qms-superpowers-zh 路由 TDD、subagent-driven-development、独立 SPEC/QUALITY 和真实 PostgreSQL/浏览器验收。

## 当前摘要

| 项 | 当前事实 |
| --- | --- |
| 目标/批准 | 负责人确认一期接收记录默认正文、框内滚动/复制、列表多选和删除记录，并追加公共管理页去冗余、筛选收起和接口名称直观展示 |
| 映射 | REQ0036 / Issue97，branch codex/receipt-detail-ux，base/main ada7ec；预留 V0.0.47，提交前查重 |
| 授权 | 沿现有一期开发/PR/合并部署持续授权接续；不关闭 Issue、不写飞书、不操作生产凭据 |
| 范围 | ReceiptList 详情/选择/删除/筛选折叠/接口名称；ConsoleLayout 管理页冗余说明；IntegrationReceiptController/Service 删除接口、审计、容量；不改外部接收协议、迁移或管理接口 |
| 状态 | PR114 / V0.0.47-fix4 已部署0e07e99，PR/main各24项PASS、Review无发现、同SHA三服务及公网资源通过；负责人新截图确认右侧空尾列仍不符合要求，沿原紧急修复授权接续fix5，不能把表格撑满当作业务列利用全宽 |
| 证据 | 删除前真实 RED 为 404/字段缺失；修复后覆盖删除回滚、越权、幂等、审计失败、清理并发、名称历史和候选隔离；前端覆盖默认正文、框内滚动复制、勾选删除、候选筛选和公共壳 |
| 下一步 | codex/receipt-width-distribution 从生产0e07e99接续V0.0.47-fix5；删除空尾列，余宽按现有业务列比例分配，选择列保持像素宽，保留业务列调整/显隐/固定/移动横滚。先真实6列表头RED，再完整相关验证、双审/CI/部署 |

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

## 2026-11-12 人工体验返修

- 人工 FAIL：默认勾选列宽且无调整入口；长正文使弹窗 body 与正文同时滚动；文字复制按钮与滚动条挤在一起。此前浏览器只检查正文自身 overflow 和关闭按钮可见，没有断言唯一滚动区与按钮/滚动条真实几何，原 PASS 不覆盖这些目标。
- 修复范围：接收表选择列默认 44px，沿现有列偏好提供宽度调整且保持选择列不可隐藏/移动；详情只让正文滚动，标题/元数据/关闭固定可达；复制使用半透明图标，保留键盘/ARIA/失败反馈并避开滚动条。不改 API、数据、权限和删除语义，不新增依赖。
- TDD：父运行 ReceiptList 三个新增用例，3 FAIL，分别实测 body overflow=auto、Copy SVG 不存在、选择列为 AntD 默认变量宽度。证据 Git 外 `receipt-detail-ux-20261111/visual-red.log`。新实现代理 receipt_visual_fix，公共索引和交付记录由父串行处理。
- 验证：ReceiptList/共享 ledger/model 完整文件、Web build、治理/归档检查；一次性 PG/API/真实浏览器验证桌面与窄屏长正文只有一个滚动区、标题和关闭保持可视、Copy 与滚动条不相交、选择列实际默认宽和调整后的宽及选择不丢。保留原失败及实际未覆盖范围，SPEC 后 QUALITY，再精确 PR/main CI/部署。
- 移动兼容补充：667×320 粗指针下元数据改为同行单行省略，完整值保留在 `title`/ARIA，Modal 标题与关闭区固定，正文框仍为唯一滚动区；真实浏览器已验证复制可点击、正文滚到底部可见且弹窗外层不滚动。
- 最终复核：独立 SPEC、QUALITY 均 PASS；长字段全文通过点击 Popover 呈现，保留 Enter/Space。最终参数数组启动的完整三文件 70/70 PASS（`visual-release-final.log`，原 10 秒预算），Web build、治理 PASS。直接 shell 复验曾出现一项选项可见性与两项 10 秒超时，未复现具体根因；命令行筛选还出现参数被 shell 拆分而误扫其他文件，已中断，未计入 PASS。Corepack 默认命中缺失的 pnpm12 缓存，最终直接使用已缓存 pnpm11.19.0 构建通过；不修改全局运行时或项目依赖。

## 2026-11-12 宽屏整表回归紧急修复

- 人工 FAIL：PR113已部署后，接收记录表格压缩在左侧，来源表头竖排。根因是为固定勾选列而新增 `min-width: 0 !important` 覆盖rc-table原生100%下限，与max-content结合导致整表收缩。先前浏览器只校验选择列宽，遗漏整表可用宽度，因此原PASS不覆盖本故障。
- 真实Chromium RED：1500px容器内实际table988px，撑满断言FAIL；撤覆盖后整表1500px但选择列扩大到约73px，联合目标仍FAIL。只让最后列auto的试验保留记录，不能以牺牲最后业务列手调宽度作为最终修复。
- 新实现代理receipt_table_fill；范围限定接收列表宽度、邻近单测和真实浏览器联合断言，不改API/数据/权限/正文弹窗。一次性PG tmpfs重启后丢表的验收前置失败已保留，重建146迁移并seed成功，未使用保留预览库。
- 发布沿Issue97，预留V0.0.47-fix4，提交前核对远端；不关闭Issue、不写飞书、不修改生产业务数据。
- 最小实现：移除min-width覆盖，新增无业务key、空标题且ARIA隐藏的弹性尾列吸收桌面余宽；不进入列设置，保留业务列全部数值宽度/调整路径，选择列6px内边距。独立SPEC后QUALITY及测试优化限定复核均PASS。
- 验证：真实PG/API/Chromium完整用例1/1 PASS，新增1920整表撑满、44px选择/改宽、390横滚；Web build和治理PASS。Web首三文件70PASS/1FAIL，随后完整ReceiptList仍有动画可见/10秒超时；缩小目标元素查询并缓存computedStyle后最终整文件21PASS/4FAIL（均筛选），四个失败用例分别独立进程原预算全部PASS，合计当前源码25项行为均覆盖通过；共享Ledger/model46项PASS。失败日志保留，未证明唯一负载根因，不把分进程证据写成一次完整文件全绿；云端完整门禁仍必需。

## 2026-11-12 移除可见空尾列

- 人工FAIL：fix4使用空弹性尾列承接余宽，使右侧形成大块空单元格。此前仅验证整表撑满、业务列可调，没有验证没有多余可见列，故原PASS不能覆盖本项体验。
- 新实现代理receipt_no_empty：仅对现有rowSelection且resizableSelection路径分配宽度；选择列像素宽，实际显示的业务列按数字偏好比例填满余宽，窄屏由所有偏好宽度总和形成表格下限。不新增占位列、依赖、数据/API变更或公共配置开关。
- 父真实PG/API/Chromium RED：表头期望6列实际7列，`no-empty-red.log`，失败正对应右侧空列。追加验收所有五业务列的实际调宽方向/还原、末业务列贴合表格右边、选择固定与移动横滚。复用原正文弹窗/复制/删除完整浏览器链，新增检查覆盖显隐和偏好恢复。
- 预留V0.0.47-fix5，Issue97，提交前查重；仍按负责人紧急修复上线授权交付，不关闭Issue或写飞书。
- 实现/验证：无空列，选择px+业务纯百分比、固定table与max(100%,总宽px)。首次混合calc(%-px)在Chromium被忽略，真实五列调宽FAIL，最小隔离浏览器证明纯百分比分配有效后修正；首轮44px旧断言45属于夹具预期，已如实改44。最终`no-empty-final`真实PG/API/Chromium1/1PASS，覆盖六列/末列贴右/五列实际调宽和还原/选择44改宽/显隐重算/390横滚及多屏正文复制删除；截图已保存但view_image解码失败，不宣称人工视觉PASS。ReceiptList完整25/25与Ledger/model完整47/47PASS，Web build/治理/diffPASS，独立SPEC后QUALITY均PASS。
