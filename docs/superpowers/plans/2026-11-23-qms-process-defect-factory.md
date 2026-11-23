# 制程不良品台账工厂区分实施计划

> **面向实施者：** 按 `qms-superpowers-zh` 进入隔离、测试先行、实现子代理、独立规格与质量审查、真实验证流程。本文不授权启动代码实施或外部操作。

## 当前摘要

| 项目 | 当前事实 |
| --- | --- |
| 范围（2026-11-23，Asia/Taipei） | [已确认设计](../specs/2026-11-22-qms-process-defect-factory-design.md)：制程台账列、登记维护、入库规则与处理；同轮修复 `MAINT-001` 既有弃用用法，制程台账有横向溢出时滚动条常驻页面底部。不新增主数据、权限、历史回填或 8D 字段。 |
| 批准与授权 | 本聊天明确批准方案与同轮维护，并授权修复检查、提交 PR、通过后合并和部署本交付单元。不自动配置生产 IMS 规则、关闭 Issue 或写入协作台账。 |
| 交付定位 | 历史 `REQ-0038` 仅为来源背景，本次无独立 `record_id`。[Issue #161](https://github.com/JasonShu0722/QMS-2.0/issues/161) 关联制程工厂、滚动条和 `MAINT-001`。2026-11-23 核对本地计划、远端 `main` 历史及开放 PR 后预留 `V0.0.68`。活动基线 `1a447e63` 与远端 `main` `fb4ec395` 内容一致；原有其他计划改动独立保留。 |
| 当前检查点 | 工厂、入库映射、底部横向滚动条及 Ant Design 弃用迁移已实现，最终本地定向回归与独立复审通过。远端检查及部署须按对应 PR 和 `main` 的实际运行记录确认。 |
| 证据与限制 | 一次性 PostgreSQL、实际 Worker 与认证 Chromium 已通过工厂导入、手工登记和长表操作；详细覆盖和限制见下方。无真实 IMS 样本，不推断路径或两厂编号唯一性。`MAINT-002/003` 已完成到期复核并按原周期继续跟踪，不认定已关闭。 |
| 下一动作 | 最终治理和回归通过后关联 PR；同 HEAD 检查通过才合并，核对主分支检查和部署结果。不自动切换既有生产规则；正式启用新映射前须用真实 IMS 报文确认字段路径和来源编号。 |

**目标：** 在班次前显示工厂；手工必选；IMS 的 `1` / `2` 正常转换，字段异常不丢记录。

**架构：** 可空的台账事实与固定枚举；扩展既有制程写入、入库评估与受控查询。规则版本、组织范围、来源身份、审计和台账个人偏好沿用现有实现。技术栈为 NestJS、Prisma/PostgreSQL、React/Ant Design、Swagger 生成契约。

## 本地验证记录

基线 `1a447e63`，验证对象为本次工作区增量。脱敏输出留在 Git 外 `D:/WorkSpace/QMS-2.0-local/factory-161-20261123/`；未连接保留预览库 `55440`。

| 检查 | 结果与边界 |
| --- | --- |
| 一次性 PostgreSQL 18 迁移与制程核心回归 | `PASS`，迁移与种子成功。四个文件 57/57（入库、台账、手工策略、审计），见 `migrate.log`、`api-core-r2.log`。扩展组合曾出现超时和 Windows 进程退出，不能视为全量通过。 |
| 生成契约与 API 构建 | `PASS`，运行 `contracts:generate`、`contracts:check` 和 `corepack pnpm --filter @qms/api build`。 |
| Web 工厂列与规则编辑 | `PASS`，`web-preferences-r6.log` 四项定向复验，覆盖列位置与空值、筛选、历史列偏好及规则提交。真实手工登记见 `browser-r2.log`；真实 API、Worker 与 Chromium 的模拟 IMS 链路见 `browser-ingestion-r7.log`。初轮筛选弹层遮挡班次列宽控制，改用已验证在弹层外的发生时间列控制后，全用例通过；中间一次 503 为测试启动时未配置 `QMS_PUBLIC_BASE_URL`。 |
| 滚动条长表 | `PASS`，`playwright.ledger-sticky.config.ts`、`browser-sticky-r6.log`。1440px 桌面和 390px 粗指针，分别验证 10/50/100 条的首／中／末位置、标题与表体同步、鼠标／触控横滚、键盘回首及在批量操作栏存在时仍可操作。`browser-sticky-r5-red.log` 保存窄屏勾选后挡住触控的独立审查复现。 |
| `MAINT-001` 与治理 | 定向验证 `PASS`：`process-shipment-report.test.tsx`、`AdminPage.identity.test.tsx` 两项，`ReceiptList.test.tsx` 筛选、容量和删除保护三项。扩展回归 `FAIL`：有接收容量未知结果重试用例失败，仍有 `InputNumber addonAfter` 与 `useForm` 连接提示。原登记用法已迁移但事项不关闭或改期。最终 `check:governance` 文档检查通过，退出码 1，首个阻断为 `MAINT-001` 到期。证据：`web-maint-focus-r8.log`、`web-receiving-r8.log`、`web-maintenance-r7.log`、`governance-final.log`。 |
| 续验：容量、配置及 API | 接收定向 4/4（`receipt-r16.log`），验证以原请求重试并在成功后解锁。配置刷新失败曾覆盖草稿（`config-refresh-failed-red.log`），修正后保留草稿及未保存保护；两类编辑器保存路径和岗位类别新建也纳入回归。附加真实 PostgreSQL 三文件 136/136（`api-http-r12.log`），含入库引擎、制程 HTTP 与手工台账。`MAINT-002/003` 仍开放。 |
| 正式 IMS 与生产 | `NOT_RUN`。合成样例只验证技术链路；不证明正式报文路径、两厂明细编号唯一性、物理手机表现或生产上线。 |
| 最终本地复核 | `PASS`：配置守卫 10/10（`config-r18.log`）、接收定向 4/4（`receipt-r16.log`）、Web 构建（`web-build-r18.log`）、治理单测 51/51 与治理总检查。独立复审确认失败刷新、岗位维护及容量重试边界；`MAINT-001` 按维护台账关闭。 |

## 行为检查表

| 场景 | 预期 |
| --- | --- |
| 手工新建 | 必须选一工厂或二工厂；API 也拒绝未选、传空和非法编码。 |
| 手工历史记录 | 不回填；查看为空显示 `/`。通过普通维护保存历史人工记录时须补选；维护已有合法工厂的人工记录时可省略该字段并保留原值。 |
| 普通维护 IMS 记录 | 工厂只读；仍可维护其他既有字段，不能通过普通接口改或清工厂。 |
| 已配置来源字段 | 数字 `1` / `2` 或去除首尾空白后的字符串 `"1"` / `"2"` 映射为 `FACTORY_1` / `FACTORY_2`。不接受布尔值、非精确数字串（例如 `"01"`）、对象或数组。 |
| 已配置字段为空或非法 | 缺键、`null`、空串或纯空白为 `factory:EMPTY`；其余不支持值为 `factory:INVALID`。有效行继续新增，工厂为 `NULL`，显示 `/`，并进入待完善；不返回或保存非法值为工厂字段。 |
| 已有规则和任务快照无映射 | 工厂字段不参与本次写入或差异；新记录保持 `NULL`，不追加工厂异常，不改变既有规则行为。新增或正常编辑规则时必填映射，包括重新启用。 |
| 更新已有记录 | 只有允许更新 `factoryCode` 且通过原有版本与人工确认保护时才写入，包括按异常报文显式写空；如不允许则保留已有工厂和该字段原有问题。后续合法值清除工厂问题，不清其他字段问题；同值及同问题重放不重复写版本。 |

## 任务 0：开工、来源与交付映射

- [ ] 按[交付流程](../../../qms-2.0/docs/DELIVERY-MAINTENANCE-PROCESS.md)核对授权、已有 Issue / PR、远端与版本预留；一个交付单元关联或创建一个 Issue，登记 `本聊天批准 → Issue → 分支 → PR`。记录负责人、源码基线和证据目录，不补造飞书编号。
- [ ] 获取脱敏 IMS 报文，确认实际工厂点路径（`FACTORY_CODE` 只作示例）和同组织内两厂来源明细编号是否唯一。若样例暂不可得，可开发及使用合成报文做真实技术集成验证，正式 IMS 联调记 `NOT_RUN`；若确认两厂编号可能碰撞，维持现有冲突保护，不改去重键、不直接启用混合来源，单独确认身份规则后推进上线。
- [ ] 在活动 checkout 核对原有改动，按项目工具约定隔离。每个实现和验证 shell 从 `qms-2.0/` 加载 `D:/WorkSpace/QMS-2.0-local/Enter-Qms.ps1`，核对 `node --version`、`corepack pnpm --version`、`git status --short` 与当前包清单，验证期间冻结源码。

## 任务 1：持久化、手工写入与查询

**文件：** `qms-2.0/apps/api/prisma/schema.prisma`、同目录 `migrations/` 下一个新的制程工厂迁移；`qms-2.0/apps/api/src/modules/process-quality/` 中的 `process-defect-registration.policy.ts`、`process-quality.dto.ts`、`process-defect-ledger.service.ts`、`process-defect-completion.service.ts`。

- [ ] 在 `qms-2.0/apps/api/test/process-quality/` 的 `process-defect-registration.spec.ts`、`process-defect-http.integration-spec.ts` 和 `process-defect-ledger.integration-spec.ts` 先写失败用例：未选创建拒绝、两种合法工厂写入、手工旧记录补选、IMS 普通写入工厂拒绝而其他字段可保存、旧记录返回 `null`，以及 `EQ` / `NE` / `EMPTY` / `NOT_EMPTY` 筛选与 `total` 同口径。更新现有手工创建夹具补充合法值，仅旧数据用例通过迁移前插入或受控数据库夹具保留空值。
- [ ] 新建追加式迁移，Prisma 增加 `factoryCode String? @map("factory_code") @db.VarChar(16)`。现有数据库约定下使用以下 SQL，无回填、无默认工厂、无未经查询证据支持的索引：

```sql
ALTER TABLE "process_defects"
  ADD COLUMN "factory_code" VARCHAR(16),
  ADD CONSTRAINT "process_defects_factory_code_check"
  CHECK ("factory_code" IN ('FACTORY_1', 'FACTORY_2'));
```

- [ ] 在制程注册策略维护一份 API 侧 `PROCESS_FACTORY_CODES` 字面值及类型守卫；Swagger 创建必填、更新可省略但不接受 `null`、列表/详情响应为可空枚举。在现有锁内按已存来源类型检查手工写入；规范化 `IMS` 空值，不把工厂加入全局完成必需项，以免迁移历史记录被批量标待完善。在既有版本历史快照与允许的审计元数据中记录工厂变更，不记录非法原始值。
- [ ] 让 `PROCESS_FILTER_FIELDS`、枚举值白名单及列映射使用 `factoryCode`；复用现有参数化服务端条件，不新增查询接口。用一次性 PostgreSQL 比较迁移前旧数据和迁移后新写入；负例确认数据库约束不接受任意编码。

## 任务 2：入库配置与异常落库

**文件：** `qms-2.0/apps/api/src/common/integration-master-data.ts`；`qms-2.0/apps/api/src/modules/api-integration/` 中的 `ingestion.policy.ts`、`ingestion.service.ts`、`ingestion.dto.ts`；`qms-2.0/apps/api/src/modules/process-quality/process-defect-ingestion.adapter.ts` 与任务 1 的完成服务。共享完成服务由主代理串行整合。

- [ ] 在 `qms-2.0/apps/api/test/api-integration/ingestion-policy.spec.ts` 的制程规则组内加入以下测试，验证转换缺失时先 RED；在 `qms-2.0/apps/api/test/process-quality/process-defect-ingestion.integration-spec.ts` 用现有夹具验证落库和规则更新边界：

```ts
it.each([
  [1, 'FACTORY_1', []], ['1', 'FACTORY_1', []],
  [2, 'FACTORY_2', []], ['2', 'FACTORY_2', []],
  [undefined, null, ['factory:EMPTY']], [null, null, ['factory:EMPTY']],
  ['  ', null, ['factory:EMPTY']], [3, null, ['factory:INVALID']],
  ['01', null, ['factory:INVALID']], [true, null, ['factory:INVALID']],
  [{ code: 1 }, null, ['factory:INVALID']], [[1], null, ['factory:INVALID']],
])('maps factory payload %p without rejecting the row', (value, factoryCode, issues) => {
  const config = normalizeIngestionRule({ ...processRule, mapping: { factoryCode: 'source.factory' } });
  const source = value === undefined ? {} : { factory: value };
  expect(evaluateIngestionRow(config, { source })).toMatchObject({ matched: true, fields: { factoryCode, issues } });
});
```

- [ ] 添加映射白名单；在 `saveRule` 的受控保存路径要求配置，不改变历史规则读取或已排队快照的解析。预览、单条、历史及自动入库共用 `evaluateIngestionRow`。只在配置了来源点路径时贡献工厂值：

```ts
const value = pathValue(row, path);
const code = typeof value === 'string' ? value.trim() : value;
const factoryCode = code === 1 || code === '1' ? 'FACTORY_1'
  : code === 2 || code === '2' ? 'FACTORY_2' : null;
if (factoryCode === null) issues.push(code == null || code === '' ? 'factory:EMPTY' : 'factory:INVALID');
```

- [ ] 在目标类型、差异计算与适配器保留 `undefined`（不映射）和 `null`（已评估为空）的区别。只对工厂接受 `null` 作为候选变更，`before` / `after` 复用现有可空差异结构。把 `factory:*` 的问题归属映射到 `factoryCode`，让更新权限、完整性问题替换和清除按同一归属判断；成功修正时移除旧工厂问题，异常类型切换不累加两种问题。确认工厂为空且问题未变时不产生版本变更。对预览及条目详情使用现有受控字段展示结构和问题列表，不把原始来源对象透出。
- [ ] 验证真实事务中的 `INSERT_ONLY`、`UPDATE`、`CONFIRM`、工厂不在更新白名单、允许更新时正确写空、有效值修正后问题消失、人工工厂受保护、陈旧预览和归档重放不绕过原守卫。验证旧快照不产生工厂问题及跨组织拒绝；确认既有 `externalRecordKey` / 收件行定位策略不变。

## 任务 3：生成契约、台账及规则编辑

**文件：** `qms-2.0/packages/contracts/src/generated/api.ts`（仅生成）；`qms-2.0/apps/web/src/features/process-quality/` 中的 `ProcessDefectLedgerPage.tsx`、`ProcessDefectEditor.tsx`、`process-ledger.tsx`；`qms-2.0/apps/web/src/console/api-ingestion/` 中的 `RuleEditor.tsx`、`ingestion-ui.tsx`、`ImportPreview.tsx`、`JobList.tsx`；如需保留两个新增列锚点，再定向扩展 `qms-2.0/apps/web/src/ui/ledger/model.ts` 与 `index.tsx` 的现有偏好合并。

- [ ] API 稳定后由主代理运行 `corepack pnpm contracts:generate`、`corepack pnpm contracts:check`。前端从生成类型读取工厂枚举类型，不复制 DTO。首先在 `process-ledger-filters.test.tsx`、`process-ledger-editor.test.tsx`、`ApiIngestionPage.test.tsx` 写失败测试：列位置、旧列设置、空值、查询参数、新建未选不请求、有值正确提交、IMS 工厂只读和配置/预览。
- [ ] 用一致的双语枚举文案驱动列表、侧栏、手工选择和入库值显示；空值使用 `/`。新列默认位于“发生时间 → 工厂 → 班次”，加入现有列设置、筛选白名单与枚举选项；“为空”不传 `/` 字符串。旧偏好新增工厂列时插入班次前，保留现有产品类型锚点和用户设置的相对顺序、列宽与隐藏状态；显式隐藏工厂后刷新仍保持隐藏。一个代表性已有偏好和一次恢复默认都要回归。
- [ ] 手工表单只为人工记录编辑工厂，无默认工厂；IMS 在维护面板显示只读值且写入体不包含该字段。规则编辑器仅在制程目标展示必填来源路径及固定映射提示；非制程目标不附加限制。试处理、任务差异和待完善提示分别显示缺失/无效，不把业务字段问题误显示成整行失败。

## 任务 4：制程台账横向滚动条常驻

- [ ] 仅制程不良品台账启用底部常驻滚动条。复用现有 `LedgerTable` 的横滚和表头同步，保持一个可见横向滚动条、原纵向页面滚动与列设置；表格无横向溢出时隐藏。
- [ ] 浏览器验证桌面和窄屏、短表和长表的页首／页中／页末均可直接横滚，表头与表体同步，末行和批量工具可操作；缩放或列偏好变更时重新测量。

## 任务 5：验收与交付闭环

- [ ] 在有效的项目 Windows 环境、一次性 PostgreSQL（禁止 `55440`）验证；从先红后绿到以下相关文件及构建检查。`process-defect-ingestion.spec.ts` 复用真实 API、已编译 Worker、MFA 和独立数据库；浏览器验证管理和业务主链、窄屏、双语、用户偏好及无权限账号。真实资源不足直接记录具体 `FAIL` / `NOT_RUN`，不以 Mock 替代验收。

```powershell
corepack pnpm --filter @qms/api test ingestion-policy.spec.ts process-defect-registration.spec.ts
corepack pnpm --filter @qms/api test:integration "--testPathPatterns=process-defect|ingestion"
corepack pnpm contracts:generate
corepack pnpm contracts:check
corepack pnpm --filter @qms/web test process-ledger process-formal-ledger ApiIngestionPage ledger/model.test.ts
corepack pnpm --filter @qms/api build
corepack pnpm --filter @qms/web build
corepack pnpm --filter @qms/web test:e2e process-defect-ingestion.spec.ts
corepack pnpm check:governance
git diff --check
```

- [ ] 真实链路用一批含合法 `1`/`2`、空值和非法值的行分别覆盖试处理和自动/历史处理：空或非法行也新增，数据库为 `NULL`、页面 `/` 且有可读待完善原因、记录数不丢；修正报文更新后工厂问题消失，并保留其他问题和既有时间、描述、数量。确认 `platform:admin` 能保存规则和登记，普通无权账号拒绝，其他入库目标及未配置老规则不受影响。
- [ ] 各实现任务完成后独立规格审查、再做质量审查；主代理冻结整合版本复核证据后，按已授权范围提交、推送和创建/更新单一 PR。PR 不自动关闭 Issue，登记结果、限制和回滚路径。证据保存于 Git 外，按实际命令、退出码、源码版本、覆盖项单列代理 / CI / 人工来源。
- [ ] 获得单独授权后才合并、发布、配置生产映射。先执行追加迁移并确认 API/Worker/Web 同 SHA，再用实际 IMS 脱敏样例验证来源路径、两厂编号和四类报文，核对健康、展示与任务状态。若需回退，先停用新映射规则并处理相关自动、试处理和历史任务快照，再回退应用；保留可空字段及已写工厂数据，不以删列作为常规回退。
- [ ] 最终版本逐项通过才在获授权后关闭 Issue 并回读；若后续存在协作记录且有独立写入授权，再按真实 `record_id` 回填，未登记时不适用，未授权时不写。把经实际验证的路径配置、字段异常不阻断及回滚限制沉淀到 `qms-2.0/docs/API-INTEGRATION.md`，把业务验收与未覆盖范围记入 `qms-2.0/docs/PHASE-4.md`；复跑治理检查。部署失败或任一验收未通过，保留开放 Issue，按同一交付单元接续。
