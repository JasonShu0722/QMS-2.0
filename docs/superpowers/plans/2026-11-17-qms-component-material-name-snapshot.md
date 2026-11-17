# 组件项目映射物料名称快照实施计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在组件入库规则中支持物料名称内部关联，并保留现有入库策略与空值保护。

**架构：** 现有规则增加可选名称查询配置；物料模块提供精确只读接缝；入库引擎统一解析，组件适配器受控写入名称快照。复用现有任务、预览、幂等和审计机制。

**技术栈：** NestJS / Prisma / PostgreSQL、React / Ant Design、Swagger生成契约，无新依赖，无业务表迁移。

---

## 当前摘要

2026-11-17，负责人确认编码对编码关联、快照模式、未匹配时允许名称为空，并要求形成本轮计划。已明确：API组件编码匹配同组织物料编码，读取物料名称，入库保存快照；未匹配时新建名称为空、已有名称不清空。已登记 REQ-0040（record `reczz28annS6gYZa`，状态保留“待评估”）及 Issue134；实现分支 `codex/component-material-name-snapshot` 从 `origin/main` `85be130` 建立。后端真实 Worker 回归已达 94/94，Web 定向 5/5、原相关集合 47/47，契约、API/Web 构建、治理和归档隔离已通过。独立 SPEC 已 PASS；独立 QUALITY 发现的撤销物料读取权限后停用现有规则死锁正在修复并复验。上一轮本地发布记录和既有 `$null` 保留，不混入本轮产品提交。

## 文件与职责

| 文件 | 职责 |
| --- | --- |
| `qms-2.0/apps/api/src/modules/api-integration/ingestion.dto.ts` | 新增组件名称内部查询DTO，旧规则默认语义不变 |
| `qms-2.0/apps/api/src/modules/api-integration/ingestion.policy.ts` | 目标限制、互斥、字段白名单与报文编码校验 |
| `qms-2.0/apps/api/src/modules/material-master/material-master.service.ts` | 同组织、按文本编码精确读取名称和版本，独立读权限 |
| `qms-2.0/apps/api/src/modules/api-integration/ingestion.service.ts` | 所有执行路径共用解析，预览/确认一致性与水位保护 |
| `qms-2.0/apps/api/src/modules/api-integration/ingestion-targets.service.ts` | 传递受控空名称/未供应语义，不放宽其他目标 |
| `qms-2.0/apps/api/src/common/integration-master-data.ts` | 最小类型调整，区分空名称与没有名称供应 |
| `qms-2.0/apps/api/src/modules/platform-configuration/component-project-ingestion.adapter.ts` | 内部模式新建可空、更新未匹配保旧名称 |
| `qms-2.0/apps/web/src/console/api-ingestion/RuleEditor.tsx` | 名称来源切换与物料字段下拉，隐藏配置不混传 |
| `qms-2.0/apps/web/src/console/api-ingestion/ImportPreview.tsx` | 显示名称快照及未匹配结果 |
| `qms-2.0/apps/web/src/console/api-ingestion/ingestion-ui.tsx` | 受控状态和双语文案 |
| `qms-2.0/packages/contracts/src/generated/api.ts` | Swagger命令生成，不手工编辑 |
| `qms-2.0/apps/api/src/modules/audit-log/audit-log.service.ts` | 必要的最小来源依据白名单，不记录整条报文 |

## 任务1：实施准备与需求登记

- [x] 核对现有RuleEditor、规则DTO/校验、组件入库适配器、物料服务和空名称表字段。
- [x] 固化负责人确认的业务口径与本计划。
- [x] 按交付规则查重并登记 REQ-0040（record `reczz28annS6gYZa`）与 Issue134：组件项目映射入库支持物料名称内部快照；状态保留“待评估”，直接会话授权覆盖当前开发范围。
- [x] 核对远端main与版本预留，分支 `codex/component-material-name-snapshot` 从 `origin/main` `85be130` 建立；上一轮归档和 `$null` 保留。
- [x] 将REQ→Issue→分支→版本及批准来源接续到本计划；实现前按适用AGENTS核边界。

## 任务2：后端契约、名称解析与执行路径

- [x] 先在 `test/api-integration/ingestion-policy.spec.ts` 补RED：历史规则不变；内部配置仅组件可用；字段仅 `materialName`；查询与报文名称互斥；合法编码保前导零和大小写；缺组件编码仍拒绝。
- [x] 最小新增 `componentNameLookup` DTO/配置校验，内部模式不再要求报文 `mapping.name`。

契约示例（设计输入，不是已实现接口）：

```json
{
  "target": "COMPONENT",
  "mapping": { "code": "partCode" },
  "componentNameLookup": { "source": "MATERIAL", "field": "materialName" },
  "mode": "INSERT_ONLY",
  "updateFields": []
}
```

真实测试样例固定为：当前组织物料 `00042 → 控制器A`、其他组织同码 `00042 → 不可读名称`；组件报文仅 `{"partCode":"00042"}`，断言名称为当前组织的 `控制器A`。未匹配报文 `{"partCode":"00043"}` 新建名称为null；已有 `00043 → 人工名称` 重处理未匹配时，名称和业务版本均不因空供应而变化。

- [x] 在真实入库引擎文件加入并验证同组织查找、跨组织同码不匹配、新建null、已有名称不被清空、读权限拒绝与查询失败回滚场景。
- [x] 增加物料公开精确读取接缝，复用既有组织/权限校验；引擎统一调用，不逐页拉全表、不跨读私有表。
- [x] 实现受控空值处理并保持外部名称校验，三个已有记录策略沿原差异和水位接缝。
- [x] 补真实PG并发回归：预览后改名/删除/补入物料要求重验；实际写入依据一致；重复请求不重复修改，撤权重放拒绝。
- [x] 补规则停用/移除内部来源、自动执行、历史分段、单条与失败重试的权限覆盖；人工维护不被旧预览覆盖。
- [x] 内部解析遇到无权限或数据库故障必须失败，不降级为“物料不存在”。
- [ ] 跑完整受影响测试文件，交独立SPEC后QUALITY；主代理读取实际日志与退出码。

```powershell
corepack pnpm --filter @qms/api exec jest --runInBand --runTestsByPath test/api-integration/ingestion-policy.spec.ts test/api-integration/component-material-name.integration-spec.ts test/api-integration/ingestion-engine.integration-spec.ts test/api-integration/ingestion-targets.integration-spec.ts
```

## 任务3：生成契约与前端规则配置

- [x] API DTO冻结后由主代理执行 `corepack pnpm contracts:generate`，Web只从 `@qms/contracts` 使用生成类型。
- [x] 在 `src/console/api-ingestion/ApiIngestionPage.test.tsx` 补RED：旧规则回显；来源切换；内部模式只选物料名称、无需报文name；保存只发有效配置；重新编辑不丢内部来源。
- [x] 在原名称格增加来源选择和字段下拉，保取消/草稿/unknown原请求恢复，不新增页面或通用关联设计器。
- [x] 试处理明确名称来源和未匹配结果；未匹配可正常确认入库，不显示为校验失败。
- [ ] 运行完整相关Web文件，复验供应商/客户/物料/制程目标不受影响；独立SPEC→QUALITY覆盖表单和权限。

```powershell
corepack pnpm --filter @qms/web test src/console/api-ingestion/ApiIngestionPage.test.tsx src/console/api-ingestion/AiDescription.test.tsx --maxWorkers=1
```

## 任务4：整合与真实验收

- [ ] 运行 `apps/web/playwright/component-material-name.spec.ts`：真实API/PG/生产Webpreview/编译Worker，创建物料和组件规则，API推送仅编码，确认组件名称来自物料。
- [ ] 覆盖编码不存在仍创建null、物料改名不回刷、原名称保留、显式重处理按策略处理及历史外部规则不变。
- [ ] 验证管理员默认可见可操作、普通无物料读取权限拒绝、组织切换隔离；桌面与390/320宽度控件不溢出。
- [x] 缺失真实资源时记FAIL/NOT_RUN，不以Mock、Skip或提高测试预算代替。
- [ ] 串行执行API/Web lint、build、contracts check、governance、归档隔离和Compose；按变化复验完整邻近文件，不重复无变化已有效证据。
- [ ] 同步 `qms-2.0/docs/API-INTEGRATION.md`、必要的前端指南及实际来源指纹；本轮无表结构迁移，不重写已应用迁移。

```powershell
corepack pnpm --filter @qms/api lint
corepack pnpm --filter @qms/api build
corepack pnpm --filter @qms/web lint
corepack pnpm --filter @qms/web build
corepack pnpm contracts:check
corepack pnpm check:governance
corepack pnpm check:archive-isolation
git diff --check
```

## 任务5：交付、验收与本地收尾

- [ ] 所有适用验证及两阶段审查通过后，提交/推送同一交付分支，创建一个PR关联本轮REQ/Issue；正文记录全部优化点、验证和实际限制，不自动关闭Issue。
- [ ] 核精确head的完整CI和Review；合并/部署按届时有效授权接续，核候选/合并树一致、主干CI、加密快照、三服务同SHA和公网目标行为。
- [ ] 交付前再次核对本计划范围及未验项；不把本地模拟、机器部署或负责人笼统反馈改写成人工业务验收。
- [ ] 逐需求最终回归；Issue关闭/飞书回填仅按实际授权执行，受控字段不代写。
- [ ] 按ID/标签核验后清理自有一次性资源，保历史分支、旧main及 `$null`；后置发布记录留本地，避免重复触发部署。

## 当前验证状态

已完成源码只读策划、文档自检、导航及API指南入口同步。`corepack pnpm check:governance` 退出0：38份文档、535个本地链接、20份来源复核、173个批准模块依赖，阶段五条目检查通过；`git diff --check` 通过。功能测试、真实PG、Worker、浏览器、契约生成及发布均未执行；不能以计划存在认定功能已交付。
