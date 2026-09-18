# Database Backup and Restore Guide

## 数据库备份与恢复指南

本目录包含 QMS 系统数据库的备份和恢复脚本。

## 文件说明

- `backup.sh` - 自动备份脚本
- `restore.sh` - 数据库恢复脚本
- `README.md` - 本说明文档

## 备份策略

### 自动备份配置

系统默认配置：
- **备份频率**: 每天凌晨 03:00 自动执行
- **保留策略**: 保留最近 30 天的备份
- **备份位置**: `/backups` 目录
- **备份格式**: SQL 文件 + gzip 压缩

### 手动执行备份

```bash
# 在 Docker 环境中执行备份
docker compose exec backend bash /app/deployment/backup/backup.sh

# 或直接在宿主机执行（需要安装 postgresql-client）
cd deployment/backup
chmod +x backup.sh
./backup.sh
```

### 备份文件命名规则

```
qms_backup_YYYYMMDD_HHMMSS.sql.gz
```

示例: `qms_backup_20260212_030000.sql.gz`

## 恢复操作

### ⚠️ 重要警告

恢复操作将**完全覆盖**当前数据库，请务必谨慎操作！

### 查看可用备份

```bash
# 列出所有备份文件
ls -lh /backups/qms_backup_*.sql.gz

# 或使用恢复脚本查看
docker compose exec backend bash /app/deployment/backup/restore.sh
```

### 恢复最新备份

```bash
# 恢复最新的备份文件
docker compose exec backend bash /app/deployment/backup/restore.sh latest
```

### 恢复指定备份

```bash
# 恢复指定日期的备份
docker compose exec backend bash /app/deployment/backup/restore.sh qms_backup_20260212_030000.sql.gz
```

### 恢复流程说明

恢复脚本会自动执行以下步骤：

1. **验证备份文件** - 检查文件完整性
2. **创建恢复前备份** - 自动备份当前数据库（防止误操作）
3. **确认操作** - 需要输入 `YES` 确认
4. **终止连接** - 断开所有数据库连接
5. **重建数据库** - 删除并重新创建数据库
6. **导入数据** - 从备份文件恢复数据
7. **验证结果** - 检查恢复是否成功

## 定时任务配置

### 使用 Cron（推荐）

编辑 crontab：

```bash
sudo crontab -e
```

添加以下任务：

```cron
# QMS 数据库自动备份（每天凌晨 3:00）
0 3 * * * docker compose -f /path/to/qms/docker-compose.yml exec -T backend bash /app/deployment/backup/backup.sh >> /var/log/qms_backup.log 2>&1
```

### 使用 Celery Beat（已集成）

系统已通过 Celery Beat 配置自动备份任务，无需额外配置。

查看 `backend/app/core/celery_app.py` 中的定时任务配置。

## 备份监控

### 检查备份日志

```bash
# 查看备份日志
docker compose exec backend cat /backups/backup.log

# 实时监控备份日志
docker compose exec backend tail -f /backups/backup.log
```

### 备份状态检查

```bash
# 检查最近的备份
docker compose exec backend ls -lht /backups/ | head -5

# 检查备份文件大小
docker compose exec backend du -sh /backups/
```

## 备份文件管理

### 手动清理旧备份

```bash
# 删除 60 天前的备份
docker compose exec backend find /backups -name "qms_backup_*.sql.gz" -type f -mtime +60 -delete

# 仅保留最近 10 个备份
docker compose exec backend bash -c 'ls -t /backups/qms_backup_*.sql.gz | tail -n +11 | xargs rm -f'
```

### 备份文件下载

```bash
# 从容器复制备份文件到本地
docker cp qms-backend:/backups/qms_backup_20260212_030000.sql.gz ./

# 或使用 docker compose
docker compose cp backend:/backups/qms_backup_20260212_030000.sql.gz ./
```

### 备份文件上传到远程存储

```bash
# 上传到 S3（示例）
aws s3 cp /backups/qms_backup_20260212_030000.sql.gz s3://qms-backups/

# 上传到阿里云 OSS（示例）
ossutil cp /backups/qms_backup_20260212_030000.sql.gz oss://qms-backups/

# 上传到 FTP 服务器（示例）
lftp -c "open -u username,password ftp.company.com; put /backups/qms_backup_20260212_030000.sql.gz"
```

## 灾难恢复演练

建议每季度进行一次灾难恢复演练：

1. **准备测试环境** - 搭建独立的测试数据库
2. **执行恢复** - 使用最新备份恢复到测试环境
3. **验证数据** - 检查关键业务数据完整性
4. **测试功能** - 验证系统核心功能正常
5. **记录结果** - 记录恢复时间和遇到的问题

## 故障排查

### 问题：备份失败，提示无法连接数据库

```bash
# 检查数据库容器状态
docker compose ps postgres

# 检查数据库连接
docker compose exec backend psql -h postgres -U qms_user -d qms_db -c "SELECT 1"

# 检查环境变量
docker compose exec backend env | grep DB_
```

### 问题：备份文件损坏

```bash
# 验证 gzip 文件完整性
gzip -t /backups/qms_backup_20260212_030000.sql.gz

# 如果损坏，使用前一天的备份
```

### 问题：恢复后数据不完整

```bash
# 检查备份文件大小（是否异常小）
ls -lh /backups/qms_backup_20260212_030000.sql.gz

# 查看备份日志，确认备份时是否有错误
cat /backups/backup.log

# 尝试使用更早的备份文件
```

### 问题：磁盘空间不足

```bash
# 检查磁盘使用情况
df -h

# 清理旧备份
find /backups -name "qms_backup_*.sql.gz" -type f -mtime +30 -delete

# 压缩备份文件（如果使用了 --format=custom）
pg_dump ... --format=custom --compress=9
```

## 最佳实践

1. **3-2-1 备份原则**
   - 至少保留 3 份备份
   - 使用 2 种不同的存储介质
   - 至少 1 份异地备份

2. **定期验证备份**
   - 每月至少验证一次备份可恢复性
   - 记录恢复时间（RTO）

3. **监控备份状态**
   - 配置备份失败告警
   - 监控备份文件大小变化

4. **文档化恢复流程**
   - 记录详细的恢复步骤
   - 培训相关人员

5. **安全存储**
   - 备份文件加密存储
   - 限制备份文件访问权限
   - 异地备份防止单点故障

## 联系支持

如遇到备份恢复问题，请联系：
- 技术支持邮箱: support@company.com
- 紧急联系电话: xxx-xxxx-xxxx
