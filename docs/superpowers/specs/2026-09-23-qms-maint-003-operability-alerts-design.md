# MAINT-003 运维告警判定与隔离演练设计

## 目标

把当前一次性数据库快照推进为可复用的告警判定层，并用真实 PostgreSQL 隔离环境验证“正常 → 告警 → 恢复”的状态变化。该批不宣称已接入生产指标出口、值班系统或通知渠道。

## 范围

- 为 Outbox 积压/失败、附件扫描滞留/错误定义版本化阈值。
- 对脱敏快照执行 `CLEAR`、`WARN`、`CRITICAL`、`UNKNOWN` 判定，输出稳定 JSON 和退出码。
- 在一次性 PostgreSQL 中注入代表性 Outbox 和扫描故障，证明告警触发与恢复。
- 在运行观测文档和 `MAINT-003` 台账中记录本批边界、证据和下一步。

## 非目标

- 不在本批引入 Prometheus、云监控或第三方告警依赖。
- 不向生产库建立连接，不改变生产数据库结构，不发送真实通知。
- 不把本地快照、阈值判定或故障注入结果作为生产告警关闭证据。

## 判定规则

- `outbox.failed >= 1` 或 `scan.error >= 1`：`CRITICAL`。
- `outbox.duePending >= 1`、`outbox.oldestDueSeconds >= 300`、`scan.pending >= 10` 或 `scan.oldestPendingSeconds >= 900`：`WARN`。
- `outbox.duePending >= 10`、`outbox.oldestDueSeconds >= 900`、`scan.pending >= 50` 或 `scan.oldestPendingSeconds >= 3600`：`CRITICAL`。
- 输入结构、版本或数值非法：`UNKNOWN`。
- 多条规则同时命中时取最高严重度，报告只保留脱敏指标和值。

## 后续生产闭环

本批完成后仍须确定生产指标出口、只读授权、采样频率、阈值复核人、通知渠道和故障注入方案，才能关闭 `MAINT-003`。
