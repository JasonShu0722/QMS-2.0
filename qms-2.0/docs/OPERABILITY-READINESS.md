# 运行观测与隔离演练准备

本页提供试点准备时可执行的只读数据库快照、告警判定和已有备份恢复演练入口。它不表示已经接入生产监控、告警、值班或生产灾备。当前命令只接受显式声明的一次性 loopback PostgreSQL 数据库，库名须以 `qms_observe_` 开头，并在连接前拒绝保留预览端口 `55440`。

## Outbox 与扫描快照

在 `qms-2.0/` 下、使用 Git 外的一次性 `DATABASE_URL` 执行：

```powershell
$env:QMS_ACCEPTANCE_DISPOSABLE_DATABASE = 'true'
corepack pnpm --filter @qms/api operations:snapshot
```

命令在 PostgreSQL 只读事务中采样，查询超时为 5 秒，输出 JSON 聚合值，不输出连接串、事件载荷、错误正文、对象键、文件名或用户资料。字段含义如下：

| 字段 | 含义 |
| --- | --- |
| `outbox.duePending` | `PENDING` 且到期可领取的事件数 |
| `outbox.failed` | `FAILED` 事件数 |
| `outbox.oldestDueSeconds` | 最老到期事件至采样时的秒数；无事件为 `null` |
| `scan.pending` | 已上传固定对象版本、仍处于隔离态且待扫描的文件数 |
| `scan.error` | 隔离态且扫描过程出错的文件数 |
| `scan.oldestPendingSeconds` | 最老待扫描文件从上传完成到采样时的秒数；无文件为 `null` |

`REJECTED` 是扫描判定结果，不属于扫描过程错误。一次采样不能证明 Worker 存活或通知送达。

## MAINT-003 告警判定层

仓库现在提供版本化的本地告警判定策略 `governance/operability-alerts.json` 和无副作用评估器 `scripts/operations-alerts.mjs`。评估器只接受上面的聚合快照，不连接数据库、不读取载荷，并输出 `CLEAR`、`WARN`、`CRITICAL` 或 `UNKNOWN`。策略规则按最高严重级别合并：

- `outbox.failed` 或 `scan.error` 大于等于 1 时为 `CRITICAL`。
- Outbox 到期数量、最老到期年龄、待扫描数量和最老待扫描年龄分别按策略文件中的预警与严重阈值判定。
- 年龄为 `null` 表示没有对应队列，不触发年龄告警；输入结构或数值不合法时返回 `UNKNOWN`。

从 `qms-2.0/` 把采样结果交给评估器：

```powershell
corepack pnpm --filter @qms/api operations:snapshot | corepack pnpm operations:alerts --stdin
```

评估器退出码为 `CLEAR=0`、`WARN=1`、`CRITICAL=2`、`UNKNOWN=3`。它是可复用的判定层，尚未连接生产指标出口、定时采样、通知渠道或值班系统；因此不能把本地命令成功描述成生产告警已上线。

用真实一次性 PostgreSQL 执行 `MAINT-003` 触发与恢复演练：

```powershell
corepack pnpm --filter @qms/api test:operations-alerts
```

验收脚本会拒绝预览端口和非一次性目标，检查干净基线为 `CLEAR`，插入带唯一前缀的失败 Outbox 事件与扫描错误夹具，验证 `CRITICAL` 及两类告警，再清理夹具并验证恢复为 `CLEAR`。夹具和原始日志留在 Git 外，脚本不会连接生产或保留预览库。

`MAINT-003` 仍保持开放。关闭前还必须确定真实指标出口、只读授权、采样频率、阈值负责人、通知渠道，并在目标运行架构中验证故障触发、处置和恢复链路；本地判定器和一次性数据库演练只是关闭前的可复用基础。

## 备份恢复演练

按[数据保护](DATA-PROTECTION.md)准备本任务一次性 PostgreSQL、私有版本化 MinIO、Git 外密钥与产物目录，构建 API 后从 `apps/api/` 执行：

```powershell
node --test test/operations/data-protection.acceptance.mjs
```

原脚本要求 `DATABASE_URL`、对象存储连接与凭据、`QMS_BACKUP_KEY`、匹配的 PostgreSQL 容器、`QMS_ACCEPTANCE_ARTIFACT_DIRECTORY` 和 `QMS_ACCEPTANCE_DISPOSABLE_DATABASE=true`；缺少任一条件即失败。它在隔离库和桶验证密文完整性、对象版本、恢复映射、空目标限制与真实读取。演练后核对自有容器与端口再清理，原始日志和加密备份留在 Git 外；在阶段记录中登记源码、环境、命令、结果和限制。生产容量、RPO/RTO、真实云权限和恢复用时目标不能从本地 PASS 推断。
