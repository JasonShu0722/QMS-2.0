# V0.0.53 认证浮层与档案多选删除实现计划

## 当前摘要

| 项目 | 当前事实 |
| --- | --- |
| 授权 | 用户明确两项修复，先完成上一轮收尾后继续；复用本会话开发/PR/合并部署授权，不代改生产业务或飞书 |
| 映射 | Issue124；V0.0.53；codex/master-data-bulk-delete；基线已部署6e18f4fa21d8e7b8c95a9d76f3e963455e47138a；远端main/开放PR查重无冲突 |
| 状态 | 实现与适用验证完成：API27PASS及邻近30PASS，取消旧消费者四完整文件107PASS，批删/供应商最终26PASS、客户21/物料19/组件45完整PASS，契约/API类型/Web类型构建/治理/归档/Compose通过；真实浏览器2PASS（36.6s）。SPEC及QUALITY返修后增量通过 |
| 下一步 | 创建PR关联124，精确CI/Review后合并部署，核主干/快照/156迁移与同SHA三服务及公网；生产业务人工与物理手机仍未执行 |

设计见[本轮规格](../specs/2026-11-14-qms-master-data-bulk-delete-design.md)。不重新开发已发布历史导入，不修改其总量或统计语义。

- [x] 上一轮发布/公网/Issue回写/本地归档收尾，Git外临时PG清理；历史main/分支/$null保留。
- [x] 从origin/main新分支隔离，Issue124及版本登记。
- [x] API：各领域公开service/controller提供批量删除，DTO使用UUID+expectedVersion，逐条结果和引用保护；真实PG红绿回归，所有实际引用调用方检查。
- [x] 共享认证：复现业务嵌套层遮挡并修复最高层/焦点/取消；保留原认证重放语义，单测与真实浏览器。
- [x] Web四列表：勾选、固定批量栏、确认/结果/未知重试/作用域失效及窄屏；沿用组件已有多选。
- [x] 主代理生成契约/集中client注册、管理员及普通拒绝整合；串行重验证，独立SPEC→QUALITY。
- [ ] 创建PR关联Issue124，精确CI及Review、合并树、主干CI、部署快照/迁移/同SHA健康、公网核验。
- [ ] 最终Issue最小回写并保持开放；本地归档/资源清理，生产业务人工与物理手机未执行如实记录。

父代理独占Git、文档、生成契约及共享注册；子代理各自文件所有权明确，不并发heavy测试。所有实现/验证先加载D:/WorkSpace/QMS-2.0-local/Enter-Qms.ps1，单worker，不连接55440。Git外证据目录D:/WorkSpace/QMS-2.0-local/master-data-bulk-delete-20261114/。本轮沉淀现有FRONTEND-DESIGN的认证最高层要求与四档案删除实际边界，不另建全局流程或抽象框架。

## 实际失败与接续

- API最初13项因无endpoint正确RED；1000条真删除和原结果重放GREEN，不增timeout。组件动态引用竞争撤去共享锁会RED，最小FOR SHARE接入原解析SQL后GREEN；额外查询最初影响旧单测，合并进原SQL后复验。供应商协作账号fixture先违原权限边界，修fixture后GREEN。分页1000原400正确RED，新专用supplier/component DTO后最终3文件27PASS；四邻近真实PG文件30PASS复用有效证据，无新迁移/provider。
- Web首6完整文件116PASS/4FAIL（120项）；客户真实input及50/500精确定位已修，客户21/物料19完整PASS，组件45/admin-request9PASS。供应商保存后的全页查询累计超过10s，改局部容器定位、保断言和motion/预算，最终待复验。一次错误pnpm参数误启全量已中断，无关audit-standard两项超时保留、不扩修。
- 删除响应验证发现成功HTTP后client先清幂等key，畸形计数再重试会换key；原RED13已保留。最小可选validator在清key前执行，未传验证的旧consumer语义保持；最终共享13待复验。
- 认证原新增403取消虽在入库解锁，但QUALITY沿旧UserForceDelete/AdministrativeReconfiguration确认会误deny并丢输入，记录FAIL。返修改用专用本地已知未提交取消，不改变真实服务器权限403；补真实Provider→旧消费者回归，未通过前不能视为全局修复完成。

最终验证：专用本地取消CLIENT_REAUTHENTICATION_CANCELLED/400完成真实Provider→旧UserForceDelete RED→GREEN，四完整文件Provider14/UserForceDelete40/admin-request9/ApiIngestion44共107PASS，真正401/403及未知重试原边界保持。QUALITY增量PASS；共享删除13/供应商13最终26PASS，其他未变完整文件客户21/物料19/组件45与integration-ui5组合证据有效，不重复累计admin-request9。Web lint首FAIL为两个新增测试类型错误，移除ByRoleOptions无效exact及补closest<HTMLElement>后lint/build PASS（1536MiB，运行前空闲7802MiB），不改变业务行为或断言。所有页长选项统一有效10/20/50/100/500/1000。

真实浏览器首轮两定位FAIL、诊断两FAIL及首次修正一PASS/一FAIL均保留：实际AntD双字按钮含空格，分页标签是“50 条/页”，另“关闭”需限定正文以免重复命中。没有提高timeout/关闭motion；最终两场景2PASS（36.6s），覆盖真实嵌套密码元素命中与焦点、取消关闭重开、真实MFA、原任务明确重提后PG PAUSED；管理员四档案批删、客户部分REFERENCED并保关系、PG删除事实、390px浮动栏/反馈不重叠及主题变量。只去除诊断日志后复用相同行为证据，不因此重建未变业务源码。生产业务未写入，物理手机/正式数据准确性仍待人工验收。
