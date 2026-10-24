# N1 到期维护事项事实复核

## 1. 本轮范围与结论

- 复核日期：2026-10-24，Asia/Taipei；起始时钟实际读取为 `2026-10-24T19:40:37+08:00` / `2026-10-24T11:40:37Z`，两者均为同一天，不使用未来日期。
- 授权关联：负责人已正式启动的 N1、Issue #64；分支 `codex/qms-n1-organization` 为本次委派上下文，不在侧任务中执行 Git 命令重新核对或变更分支。
- 活动目录：`D:/WorkSpace/QMS-2.0/qms-2.0`。每个 shell 均先执行 `. D:/WorkSpace/QMS-2.0-local/Enter-Qms.ps1`；实际运行时为 Node.js `v24.21.0`、pnpm `11.19.0`。
- 仅写 `governance/maintenance-items.json` 与本文件。无业务代码、测试、索引、依赖、Git、外部台账或生产变更；新文档导航及机器索引由主代理登记。
- **维护事实已重新复核，不是问题全解决。** 三项均保留 `open`，不填写关闭日期或关闭证据。维护检查通过也不等于全量测试、N1 交付、人工验收或生产放行。
- 去重统计：本次运行覆盖 37 个不同测试用例，36 通过、1 失败、0 跳过；其中账号 20/20、对象引用 5/5、快照 2/2、告警 6/6、台账检查器 3/4。另有 5 条容量源码静态断言通过，不混算为真实备份测试。13 个对象/观测测试在隔离检查器失败后单独重跑通过，不重复计数。

### N1 主代理后续接续

上段为侧任务当时真实输出，保留失败历史。独立修复任务确认 `test/maintenance.test.mjs` 的三处默认时钟调用在固定夹具到期后会提前触发“复核已到期”，掩盖原本要验证的重复 ID / 空 trigger / 开放关闭字段断言。修复只为这三处显式传入夹具有效期内的 `2026-09-24T00:00:00Z`，不改系统时钟、夹具日期、原断言、运行时检查器或生产日期；真实红灯 3 / 4、绿灯 4 / 4，无跳过。主代理登记本文为维护台账主题的非权威复核附件后，`check:docs` 通过（37 份、317 链接、20 来源复核），`check:maintenance` 通过（开放3、关闭0）。整合全量门禁仍依 N1 计划另取证，不把这些结果称为 N1 业务完成。

## 2. 复核方法与来源

先读取根及工程 `AGENTS.md`、目标目录规则、项目级 `qms-superpowers-zh`、当前 N1 计划摘要、`MAINTENANCE-REGISTER.md`、机器台账及 `scripts/check-maintenance.mjs`。检查器要求开放来源摘要一致、复核日不在未来、到期日未到；关闭另需证据文件、命令及 PASS，但字段不能替代真实执行。

本次实际逐项读取的机器来源如下；完整 SHA-256 只维护在机器台账，不在本文复制第二套摘要：

| 事项 | 读取并登记的来源 | 本轮用途 |
| --- | --- | --- |
| MAINT-001 | `apps/web/src/features/account/AccountCenterPage.tsx`、`apps/web/src/features/account/AccountCenter.u3.test.tsx` | 账号当前渲染结构与选定测试范围 |
| MAINT-001 | `apps/web/src/features/audit-standards/AuditStandardsPage.tsx`、`apps/web/src/features/new-product-quality/NewProductQualityPage.tsx` | 审核标准 List/Drawer width、新产品质量 Space direction 的仍存用法 |
| MAINT-002 | `apps/api/scripts/data-protection.mjs`、`apps/api/scripts/data-protection-objects.mjs`、`apps/api/test/operations/data-protection-objects.test.mjs` | 容量守卫、对象引用校验与恢复映射 |
| MAINT-003 | `docs/OPERATIONS-RUNBOOK.md`、`docs/OPERABILITY-READINESS.md` | 运维与真实演练的权限、环境和关闭边界 |
| MAINT-003 | `apps/api/scripts/operations-snapshot.mjs`、`scripts/operations-alerts.mjs`、`governance/operability-alerts.json` | 一次性目标限制、只读聚合、判定规则与退出码 |
| MAINT-003 | `test/operations-snapshot.test.mjs`、`test/operations-alerts.test.mjs` | 本轮实际执行的纯函数与 CLI 测试 |

辅助读取 `docs/DATA-PROTECTION.md`、真实数据保护验收脚本、账号设置与签名组件、测试 setup、已安装 Ant Design List/Space 实现及 Web 包配置；没有将依赖安装树作为可提交的机器来源。所有 14 条机器来源使用 `scripts/check-documentation.mjs` 导出的 `sourceDigest` 计算，其规则统一 CRLF/LF，不使用未经规范化的文件摘要代替。原有三条来源的当前摘要与复核前相同，新增其余直接来源用于追踪事实与测试变化。

复核后核验来源的只读命令如下；输出逐条来源及摘要，末尾断言真实检查结果：

```powershell
. D:/WorkSpace/QMS-2.0-local/Enter-Qms.ps1
@'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sourceDigest } from './scripts/check-documentation.mjs';
import { checkMaintenance } from './scripts/check-maintenance.mjs';
const register = JSON.parse(await readFile('governance/maintenance-items.json', 'utf8'));
let sources = 0;
for (const item of register.items) {
  assert.equal(item.status, 'open');
  assert.equal(item.reviewedOn, '2026-10-24');
  assert.equal(item.reviewDue, '2026-11-23');
  assert.equal((Date.parse(item.reviewDue)-Date.parse(item.reviewedOn))/86400000, 30);
  for (const source of item.sources) {
    assert.equal(source.sha256, sourceDigest(await readFile(source.path, 'utf8')));
    console.log(item.id, source.path, source.sha256);
    sources++;
  }
}
assert.equal(sources, 14);
assert.deepEqual(await checkMaintenance(process.cwd()), { open: 3, closed: 0 });
console.log('SOURCE_REVIEW_PASS sources=' + sources, new Date().toISOString());
'@ | node --input-type=module
```

## 3. MAINT-001：组件弃用与测试提示

### 实际事实

历史台账记载的 2026-09-23 List/Space 提示及 2026-10-20 的 31 项账号、24 项资料返修测试、Drawer width/Spin tip/useForm 警告原文保留在 `fact` 的历史段。本轮没有重跑那些完整历史组合，也不将历史次数算作当前证据。

当前账号页使用 Card、Descriptions、Space，未发现该文件使用 List 或 Space direction。选定 `AccountCenter.u3.test.tsx` 实际 20/20 通过；本次完整命令输出未出现 warning，包括没有重现历史 useForm 提示。现有 setup 没有通过屏蔽 console warning 来取得该结果，但测试使用既有 API mock、JSDOM、matchMedia/ResizeObserver 替身，不是服务端或真实浏览器验收。

其他页面仍有直接静态证据：审核标准页第 120/131/146 行使用 List，第 123/134 行使用 Drawer width；新产品质量页第 293/298/302 行仍使用 Space direction。已安装 Ant Design List 实现有废弃并将在下一主版本移除的警告分支，Space 实现对 direction/split 指向 orientation/separator。本轮仅据此确认未完成全局迁移，不宣称已动态复现其他页面的全部警告，也不在侧任务中发起依赖升级或批量替换。

### 最小验证

```powershell
corepack pnpm --filter @qms/web test --no-cache --maxWorkers=1 src/features/account/AccountCenter.u3.test.tsx
```

- 实际退出码：`0`，1 个文件、20 个用例通过，Vitest `v3.2.7`。
- 报告开始时间：`19:41:37`；总耗时 `131.93s`，其中测试 `122.08s`。
- 覆盖账号双区概览、内部/供应商资料、StrictMode、冲突重基线、关闭草稿、签名权限及英文显示等既有行为。
- 未验证：其他页面定向测试、全量 Web、构建、真实浏览器、未来 Ant Design 升级及生产故障。本次无 warning 不等于历史提示全部修复。

### 影响与下一步

升级兼容性风险仍存在，保留 `open`。升级前逐页核对官方迁移说明、剩余 List/Space/Drawer 用法，并分别复核 Spin tip/useForm 历史提示；任何相关来源变化或警告升为失败均提前触发复核。

## 4. MAINT-002：备份容量上限

### 实际事实

读取备份工具及数据保护说明，确认它与生产部署迁移前的本机加密数据库快照不是同一工具，不能混用证据。

- `maximumBytes = 256 * 1024 * 1024`，即 `268435456` 字节。
- `pg_dump` 子进程 stdout 累计超过该值会被终止；结果需退出码 0 且大小不超限，否则 `POSTGRES_COMMAND_FAILED`。
- `objectSnapshot` 对全部对象版本累计原始字节独立应用相同上限，超限销毁读取流并抛 `BACKUP_SIZE_LIMIT`，不是单对象各享 256 MiB，也不是 dump 与对象合计只能 256 MiB。
- 序列化 JSON 包超过 `maximumBytes * 2`，即 512 MiB / `536870912` 字节，抛 `BACKUP_SIZE_LIMIT`。dump 和对象都使用 Base64，且有 JSON/元数据开销，不能将两个原始上限之和当作一定可备份的数据规模。
- `readBundle` 的密文文件长度守卫为 512 MiB 加 33 字节：QMSB2 标识 5、nonce 12、认证 tag 16。该守卫在 `readFile` 后检查，并非读取内存峰值保证；本轮没有修改实现。

### 最小验证

本轮直接在 stdin 执行以下静态断言，未导入带顶层 CLI 执行的数据保护主文件，未分配超大 fixture，也未调用 Docker、数据库或对象存储：

```powershell
@'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile('apps/api/scripts/data-protection.mjs','utf8');
assert.match(source, /const maximumBytes = 256 \* 1024 \* 1024;/);
assert.match(source, /size > maximumBytes\) child\.kill\(\)/);
assert.match(source, /size > maximumBytes\) \{ object\.Body\.destroy\(\); throw new Error\('BACKUP_SIZE_LIMIT'\)/);
assert.match(source, /bundle\.length > maximumBytes \* 2\) throw new Error\('BACKUP_SIZE_LIMIT'\)/);
assert.match(source, /bytes\.length > maximumBytes \* 2 \+ 33/);
console.log('CAPACITY_SOURCE_ASSERTIONS_PASS assertions=5; dump=268435456; objects=268435456; serialized=536870912; encrypted-envelope=536870945; static-only');
'@ | node --input-type=module
```

实际退出码 `0`，5 条源码模式断言通过；这只是确认已读取源码中的容量守卫，不是临界尺寸行为、内存压力或真实恢复测试。

既有 `data-protection-objects.test.mjs` 的 5 个小型内存 fixture 用例均通过，退出码见第 6 节独立重跑记录。覆盖固定历史版本、未完成占位、隔离不匹配内容、可用/保留删除对象完整性和恢复版本映射。该文件只调用对象引用纯函数，不执行主备份 CLI。

### 影响与下一步

限制仍在，保留 `open`。实际生产数据规模、容量余量、接近阈值的大包行为、备份/恢复用时及 RPO/RTO 未核实；本轮未运行 `data-protection.acceptance.mjs`，不以小 fixture 替代 PostgreSQL/对象存储恢复证据。试点容量规划或接近任一上限时，在获准的一次性资源测量 dump、所有对象版本及序列化包，评估有界扩展/分段方案，再执行真实恢复。

## 5. MAINT-003：本地观测判定与生产未知

### 实际事实

`operations-snapshot.mjs` 只接受显式一次性标志、loopback、`qms_observe_` 库名，连接前拒绝 `55440`。实现使用只读事务及 5 秒查询超时，聚合 Outbox 和扫描数量/年龄；纯函数测试没有调用实际查询函数。

读取版本 1 阈值与判定器，确认当前本地策略：

| 指标 | WARN | CRITICAL |
| --- | --- | --- |
| Outbox failed | 无单独 WARN | >= 1 |
| Outbox duePending | >= 1 | >= 10 |
| Outbox oldestDueSeconds | >= 300 | >= 900 |
| scan error | 无单独 WARN | >= 1 |
| scan pending | >= 10 | >= 50 |
| scan oldestPendingSeconds | >= 900 | >= 3600 |

多条规则取最高级别；空队列年龄 `null` 不触发年龄告警；非法结构/数值返回 `UNKNOWN`。CLI 退出码为 `CLEAR=0`、`WARN=1`、`CRITICAL=2`、`UNKNOWN=3`，不是所有非零都代表工具自身出错。

### 最小验证

本轮实际执行现有 `test/operations-snapshot.test.mjs` 2 项、`test/operations-alerts.test.mjs` 6 项，全部通过，退出码见第 6 节独立重跑记录。包括非法数据库目标/预览端口拒绝、脱敏聚合、CLEAR、失败提升 CRITICAL、数量与空年龄、非法输入 UNKNOWN、CLI 状态码及策略版本。

这些是本地纯函数/CLI fixture 证据，没有实际数据库采样、关键操作故障注入、Worker 存活检测或通知投递。仓库存在真实一次性数据库触发/恢复验收入口，但本轮未执行，不沿用历史 PASS。

### 影响与下一步

历史台账的“尚未部署生产指标采集、告警阈值或通知渠道”保持为历史登记，不在本轮改写为已经部署，也不未经访问就断言生产现状。本轮能够确认本地判定基础，**生产采集、定时采样、告警渠道与值班状态均未知**。

保持 `open`，由平台与运维维护者在获准的目标运行架构明确指标出口、只读授权、采样频率、阈值负责人及通知渠道，再验证失败/积压告警触发、处置与恢复。本轮不新建监控服务，不访问生产，不以本地 CLEAR 证明生产健康。

## 6. 命令、结果与失败记录

以下命令均在活动工程目录、已加载上述 Windows 入口的 shell 中执行。列出的退出码来自实际子进程，不把记录退出码的 PowerShell shell 自身成功当作测试成功。

| 顺序 | 命令 | 实际退出码 | 结果与边界 |
| --- | --- | --- | --- |
| 1 | `node scripts/check-maintenance.mjs`，更新前 | 1 | `MAINT-001 复核已到期`；检查首项失败即停止，原台账三项 reviewDue 均为 2026-10-23 |
| 2 | `corepack pnpm --filter @qms/web test --no-cache --maxWorkers=1 src/features/account/AccountCenter.u3.test.tsx` | 0 | 20/20，无 warning；仅该文件 |
| 3 | `node --test apps/api/test/operations/data-protection-objects.test.mjs test/operations-snapshot.test.mjs test/operations-alerts.test.mjs test/maintenance.test.mjs` | 1 | 17 项，16 通过、1 失败、0 跳过；失败原因见下段 |
| 4 | `node --test apps/api/test/operations/data-protection-objects.test.mjs test/operations-snapshot.test.mjs test/operations-alerts.test.mjs` | 0 | 独立确认 13/13；只移除检查器测试的运行范围，不修测试、不改时钟，不抹去上一次失败 |
| 5 | 第 4 节 stdin 容量静态断言命令 | 0 | 5 条断言通过，静态证据 |
| 6 | `corepack pnpm check:maintenance`，更新后 | 0 | `维护台账 PASS：开放 3；关闭 0`；仅确认字段、摘要及复核期限 |
| 7 | 第 2 节 stdin 来源与日期核验命令 | 0 | `SOURCE_REVIEW_PASS sources=14`，实际 UTC `2026-10-24T11:47:28.804Z`；14 条摘要相符、3 项 open、周期30天、复核日期不在未来 |
| 8 | stdin 文件格式断言：读取本轮两个文件，检查无 BOM、末尾换行、无行尾空白及冲突标记 | 0 | `OWNED_FILES_FORMAT_PASS files=2`；不是 `git diff --check`，遵守不执行 Git 的限制 |
| 9 | `corepack pnpm check:governance` | 1 | `存在未索引或失效的 docs Markdown`，差异是本新文档尚未登记；在文档检查处停止，后续模块检查和脚本串联的 phase-5 测试未执行，不记 PASS |

检查器失败发生于 `test/maintenance.test.mjs` 的“重复 ID、空触发条件和虚假开放关闭字段失败”测试：夹具固定 `reviewDue=2026-10-23`，但首次 `checkMaintenance(current.root)` 未传 `now`。真实时钟已过期，第一项先报 `MAINT-001 复核已到期`，没有走到第二项重复 ID 的判断，故断言 `/重复/` 失败。其余 3 项通过。该问题是现有检查器测试的日期依赖，不是业务恢复失败，也不会因真实台账日期更新而自动修好。

本侧任务不改检查器或测试、不伪造时钟、不重试掩盖失败；后续测试修复需主代理另行安排。当前不能声称治理测试全绿。

完整治理当前未通过；检查器测试的日期依赖失败与新文档待索引是两个不同限制，前者不会由登记文档自动修复，后者由主代理按分工接续。本侧任务不越权修改索引，也不把维护单项检查通过改写为完整治理通过。

## 7. 复核周期与交接

三项 `reviewedOn` 均为真实日期 `2026-10-24`；`reviewDue=2026-11-23`，间隔 30 天。检查器按 UTC 零点到期，即 `2026-11-23T00:00:00Z` / Asia/Taipei `2026-11-23 08:00:00` 开始失败，不是台湾当日午夜，也不是后台提醒服务。

30 天是对仍开放且本轮已实际复核事项的下次检查期限，不是风险消除或获准延期上线。升级依赖、相关来源变化、警告变失败、容量规划/接近阈值、目标观测架构确定或供应商试点准备均提前触发，不等待截止日。没有配置定时接单或持续监控。

主代理接续：登记本文件至文档导航和机器索引，处理现有日期依赖测试的授权/修复安排，在共享源码冻结后运行自身整合门禁；本侧任务的本地证据不能替代该步骤。未执行全量 typecheck/build、业务数据库验收、备份恢复、真实浏览器或生产检查，不因这些未执行项关闭维护事项，也不改写历史验收记录。
