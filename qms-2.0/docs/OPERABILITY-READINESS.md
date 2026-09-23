# 运行观测与隔离演练准备

本页提供试点准备时可执行的只读数据库快照与已有备份恢复演练入口。它不表示已经接入生产监控、告警、值班或生产灾备。当前命令只接受显式声明的一次性 loopback PostgreSQL 数据库，库名须以 `qms_observe_` 开头，并在连接前拒绝保留预览端口 `55440`。

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

`REJECTED` 是扫描判定结果，不属于扫描过程错误。一次采样不能证明 Worker 存活或通知送达，也不自动设阈值。试点部署时须按真实基线确定采样频率、阈值、责任人和通知渠道，再用受控故障证明告警能触发、处置和恢复；生产读库权限、网络拓扑及指标出口需单独设计和验收。本轮脚本不会连接生产或保留预览库。

关键操作失败的持续指标及生产告警尚未实现，已登记为 `MAINT-003`；不能把审计中的预期权限拒绝计作系统故障，也不能以本快照代替该事项的关闭证据。

## 备份恢复演练

按[数据保护](DATA-PROTECTION.md)准备本任务一次性 PostgreSQL、私有版本化 MinIO、Git 外密钥与产物目录，构建 API 后从 `apps/api/` 执行：

```powershell
node --test test/operations/data-protection.acceptance.mjs
```

原脚本要求 `DATABASE_URL`、对象存储连接与凭据、`QMS_BACKUP_KEY`、匹配的 PostgreSQL 容器、`QMS_ACCEPTANCE_ARTIFACT_DIRECTORY` 和 `QMS_ACCEPTANCE_DISPOSABLE_DATABASE=true`；缺少任一条件即失败。它在隔离库和桶验证密文完整性、对象版本、恢复映射、空目标限制与真实读取。演练后核对自有容器与端口再清理，原始日志和加密备份留在 Git 外；在阶段记录中登记源码、环境、命令、结果和限制。生产容量、RPO/RTO、真实云权限和恢复用时目标不能从本地 PASS 推断。
