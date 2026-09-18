# QMS 生产环境部署指南
# QMS Production Deployment Guide

## 概述 (Overview)

本文档提供 QMS 质量管理系统生产环境的完整部署流程，包括双轨架构（Preview & Stable）的配置、数据库迁移、服务验证和故障排查。

This document provides a complete deployment guide for the QMS Quality Management System in production, including dual-track architecture (Preview & Stable) configuration, database migration, service verification, and troubleshooting.

---

## 前置条件 (Prerequisites)

### 1. 系统要求 (System Requirements)

- **操作系统**: Linux (Ubuntu 20.04+ / CentOS 8+ / RHEL 8+) or Windows Server 2019+
- **CPU**: 4 cores minimum (8 cores recommended)
- **内存**: 8GB minimum (16GB recommended)
- **磁盘**: 100GB minimum (SSD recommended)
- **网络**: DMZ 区部署，双网卡配置（外网 + 内网）

### 2. 软件依赖 (Software Dependencies)

- **Docker**: 20.10+ ([安装指南](https://docs.docker.com/engine/install/))
- **Docker Compose**: 2.0+ ([安装指南](https://docs.docker.com/compose/install/))
- **Git**: 2.30+ (用于代码拉取)

### 3. 网络配置 (Network Configuration)

- **外网访问**: 允许 80/443 端口访问（供前端用户访问）
- **内网访问**: 允许访问 IMS 系统 API（用于数据同步）
- **域名解析**:
  - `qms.company.com` → 服务器外网 IP（正式环境）
  - `preview.company.com` → 服务器外网 IP（预览环境）

### 4. SSL 证书准备 (SSL Certificates)

生产环境需要配置 SSL 证书：

```bash
# 将证书文件放置到以下目录
deployment/nginx/ssl/qms.company.com.crt
deployment/nginx/ssl/qms.company.com.key
deployment/nginx/ssl/preview.company.com.crt
deployment/nginx/ssl/preview.company.com.key
```

**开发环境可跳过此步骤**，使用 HTTP 访问。

---

## 部署步骤 (Deployment Steps)

### Step 1: 克隆代码仓库 (Clone Repository)

```bash
# 克隆项目代码
git clone https://github.com/your-company/qms-system.git
cd qms-system

# 切换到生产分支（如果有）
git checkout main
```

### Step 2: 配置环境变量 (Configure Environment Variables)

```bash
# 复制环境变量模板
cp .env.example .env.production

# 编辑环境变量文件
nano .env.production
```

**必须修改的关键配置**：

```bash
# 数据库密码（强密码，至少 16 位）
DB_PASSWORD=your_strong_password_here

# Redis 密码（强密码，至少 16 位）
REDIS_PASSWORD=your_redis_password_here

# JWT 密钥（至少 32 位随机字符串）
SECRET_KEY=your_jwt_secret_key_minimum_32_characters_long

# IMS 系统集成地址
IMS_BASE_URL=http://internal-ims.company.local:8080
IMS_API_KEY=your_ims_api_key

# SMTP 邮件配置
SMTP_SERVER=smtp.company.com
SMTP_USERNAME=qms@company.com
SMTP_PASSWORD=your_smtp_password

# OpenAI API 配置（用于 AI 诊断）
OPENAI_API_KEY=your_openai_api_key
```

**生成强密钥的方法**：

```bash
# 生成 SECRET_KEY
openssl rand -hex 32

# 生成数据库密码
openssl rand -base64 24
```

### Step 2.5: 迁移共享上传卷 (Migrate Shared Upload Volume)

当前 `backend-stable` 与 `backend-preview` 共用 `qms_backend_stable_uploads` 作为上传文件卷，确保头像、电子签名和业务附件与共享数据库路径一致。

如果服务器曾经运行过旧版双上传卷配置，且 `qms_backend_preview_uploads` 中可能存在预览环境独有文件，请在部署前执行一次无覆盖合并：

```bash
docker run --rm \
  -v qms_backend_preview_uploads:/preview:ro \
  -v qms_backend_stable_uploads:/shared \
  alpine:3.20 sh -c '
    cd /preview &&
    find . -type d -exec mkdir -p "/shared/{}" \; &&
    find . -type f -exec sh -c '"'"'
      for file do
        target="/shared/${file#./}"
        [ -e "$target" ] || cp "$file" "$target"
      done
    '"'"' sh {} +
  '
```

### Step 3: 执行自动化部署脚本 (Run Automated Deployment Script)

```bash
# 赋予执行权限
chmod +x deployment/deploy.sh

# 执行部署脚本
./deployment/deploy.sh
```

**脚本执行流程**：

1. ✅ 检查前置条件（Docker、Docker Compose、环境变量）
2. ✅ 备份现有数据库（如果存在）
3. ✅ 停止旧版本服务
4. ✅ 构建 Docker 镜像
5. ✅ 启动所有服务（9 个容器）
6. ✅ 执行数据库迁移（Alembic）
7. ✅ 验证服务健康状态
8. ✅ 运行功能测试
9. ✅ 显示部署摘要

**预期输出**：

```
[INFO] Starting QMS Production Deployment...
[SUCCESS] Docker is installed: Docker version 24.0.7
[SUCCESS] Docker Compose is installed: Docker Compose version v2.23.0
[SUCCESS] Environment file found: /path/to/.env.production
[SUCCESS] Required environment variables are configured
[INFO] Creating database backup...
[SUCCESS] Database backup created: /path/to/backup/qms_db_backup_20260212_143000.sql
[INFO] Stopping existing services...
[SUCCESS] Services stopped
[INFO] Building Docker images...
[INFO] Starting services...
[SUCCESS] Services started
[INFO] Running database migrations...
[SUCCESS] Database migrations completed successfully
[INFO] Verifying services...
[SUCCESS] Container running: qms_postgres
[SUCCESS] Container running: qms_redis
[SUCCESS] Container running: qms_backend_stable
[SUCCESS] Container running: qms_backend_preview
[SUCCESS] Container running: qms_frontend_stable
[SUCCESS] Container running: qms_frontend_preview
[SUCCESS] Container running: qms_nginx
[SUCCESS] Container running: qms_celery_worker
[SUCCESS] Container running: qms_celery_beat
[SUCCESS] Backend (Stable) is healthy
[SUCCESS] Backend (Preview) is healthy
[SUCCESS] Nginx is healthy
[SUCCESS] QMS Production Deployment Completed Successfully!
```

### Step 4: 手动部署（可选，如果自动脚本失败）

如果自动部署脚本失败，可以手动执行以下步骤：

#### 4.1 启动服务

```bash
# 进入项目根目录
cd /path/to/qms-system

# 使用生产环境配置启动服务
docker compose --env-file .env.production up -d --build
```

#### 4.2 执行数据库迁移

```bash
# 等待数据库启动（约 10 秒）
sleep 10

# 执行 Alembic 迁移
docker compose exec backend-stable alembic upgrade head
```

#### 4.3 验证服务状态

```bash
# 查看所有容器状态
docker compose ps

# 查看容器日志
docker compose logs -f backend-stable
docker compose logs -f backend-preview
docker compose logs -f nginx
```

---

## 验证部署 (Verify Deployment)

### 1. 检查容器状态 (Check Container Status)

```bash
docker compose ps
```

**预期输出**：所有容器状态应为 `Up` 或 `Up (healthy)`

```
NAME                    STATUS
qms_postgres            Up (healthy)
qms_redis               Up (healthy)
qms_backend_stable      Up
qms_backend_preview     Up
qms_frontend_stable     Up
qms_frontend_preview    Up
qms_nginx               Up
qms_celery_worker       Up
qms_celery_beat         Up
```

### 2. 测试双轨环境访问 (Test Dual-Track Access)

#### 正式环境 (Stable Environment)

```bash
# 测试前端访问
curl -I http://localhost/

# 测试后端 API
curl http://localhost:8000/health

# 测试 API 文档
curl http://localhost:8000/docs
```

#### 预览环境 (Preview Environment)

```bash
# 测试前端访问（需要配置 hosts 或使用域名）
curl -I http://localhost/ -H "Host: preview.company.com"

# 测试后端 API
curl http://localhost:8001/health
```

### 3. 测试数据库连接 (Test Database Connection)

```bash
# 进入后端容器
docker compose exec backend-stable bash

# 测试数据库连接
python -c "
from app.core.database import engine
import asyncio

async def test_db():
    async with engine.begin() as conn:
        result = await conn.execute('SELECT version()')
        row = result.fetchone()
        print(f'PostgreSQL Version: {row[0]}')

asyncio.run(test_db())
"
```

### 4. 测试 Redis 连接 (Test Redis Connection)

```bash
# 测试 Redis 连接
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" ping
# 预期输出: PONG
```

### 5. 功能验证测试 (Functional Verification Tests)

#### 5.1 用户注册与登录测试

```bash
# 测试用户注册 API
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "test_user",
    "password": "Test@1234",
    "full_name": "测试用户",
    "email": "test@company.com",
    "phone": "13800138000",
    "user_type": "internal",
    "department": "质量部",
    "position": "SQE"
  }'

# 测试用户登录 API
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "test_user",
    "password": "Test@1234",
    "user_type": "internal"
  }'
```

#### 5.2 权限系统测试

```bash
# 获取当前用户信息（需要 Token）
curl http://localhost:8000/api/v1/auth/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### 5.3 通知系统测试

```bash
# 获取通知列表
curl http://localhost:8000/api/v1/notifications \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### 5.4 Celery 任务队列测试

```bash
# 查看 Celery Worker 日志
docker compose logs celery-worker

# 查看 Celery Beat 日志
docker compose logs celery-beat

# 手动触发测试任务（进入容器）
docker compose exec backend-stable python -c "
from app.core.celery_app import test_task
result = test_task.delay()
print(f'Task ID: {result.id}')
"
```

---

## 数据库管理 (Database Management)

### 查看迁移历史 (View Migration History)

```bash
# 查看当前数据库版本
docker compose exec backend-stable alembic current

# 查看迁移历史
docker compose exec backend-stable alembic history
```

### 回滚迁移 (Rollback Migration)

```bash
# 回滚到上一个版本
docker compose exec backend-stable alembic downgrade -1

# 回滚到指定版本
docker compose exec backend-stable alembic downgrade <revision_id>
```

### 创建新迁移 (Create New Migration)

```bash
# 自动生成迁移脚本
docker compose exec backend-stable alembic revision --autogenerate -m "Add new feature"

# 手动创建迁移脚本
docker compose exec backend-stable alembic revision -m "Manual migration"
```

### 数据库备份与恢复 (Backup and Restore)

#### 备份数据库

```bash
# 使用内置备份脚本
./deployment/backup/backup.sh

# 或手动备份
docker exec qms_postgres pg_dump -U qms_user qms_db > backup_$(date +%Y%m%d).sql
```

#### 恢复数据库

```bash
# 使用内置恢复脚本
./deployment/backup/restore.sh backup_20260212.sql

# 或手动恢复
cat backup_20260212.sql | docker exec -i qms_postgres psql -U qms_user -d qms_db
```

---

## 监控与日志 (Monitoring and Logging)

### 查看容器日志 (View Container Logs)

```bash
# 查看所有服务日志
docker compose logs -f

# 查看特定服务日志
docker compose logs -f backend-stable
docker compose logs -f nginx
docker compose logs -f celery-worker

# 查看最近 100 行日志
docker compose logs --tail=100 backend-stable
```

### 查看资源使用情况 (View Resource Usage)

```bash
# 查看容器资源使用
docker stats

# 查看磁盘使用
docker system df

# 查看数据卷使用
docker volume ls
```

### 性能监控 (Performance Monitoring)

```bash
# 查看 PostgreSQL 连接数
docker compose exec postgres psql -U qms_user -d qms_db -c "SELECT count(*) FROM pg_stat_activity;"

# 查看 Redis 内存使用
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" info memory

# 查看 Nginx 访问日志
docker compose exec nginx tail -f /var/log/nginx/access.log
```

---

## 故障排查 (Troubleshooting)

### 问题 1: 容器无法启动

**症状**: `docker compose ps` 显示容器状态为 `Exited` 或 `Restarting`

**排查步骤**:

```bash
# 1. 查看容器日志
docker compose logs <container_name>

# 2. 检查环境变量配置
cat .env.production

# 3. 检查端口占用
netstat -tulpn | grep -E '80|443|5432|6379|8000|8001'

# 4. 重新构建镜像
docker compose build --no-cache <service_name>
docker compose up -d <service_name>
```

### 问题 2: 数据库迁移失败

**症状**: `alembic upgrade head` 报错

**排查步骤**:

```bash
# 1. 检查数据库连接
docker compose exec backend-stable python -c "
from app.core.database import engine
import asyncio
asyncio.run(engine.connect())
"

# 2. 查看当前迁移版本
docker compose exec backend-stable alembic current

# 3. 检查迁移脚本语法
docker compose exec backend-stable alembic check

# 4. 手动执行 SQL（如果需要）
docker compose exec postgres psql -U qms_user -d qms_db
```

### 问题 3: 前端无法访问后端 API

**症状**: 前端页面加载失败，浏览器控制台显示 CORS 错误或 502 错误

**排查步骤**:

```bash
# 1. 检查 Nginx 配置
docker compose exec nginx nginx -t

# 2. 检查后端健康状态
curl http://localhost:8000/health
curl http://localhost:8001/health

# 3. 检查 Nginx 日志
docker compose logs nginx | grep error

# 4. 测试后端 API 直连
curl http://localhost:8000/api/v1/auth/captcha
```

### 问题 4: Celery 任务不执行

**症状**: 定时任务或异步任务未按预期执行

**排查步骤**:

```bash
# 1. 检查 Celery Worker 状态
docker compose logs celery-worker

# 2. 检查 Celery Beat 状态
docker compose logs celery-beat

# 3. 检查 Redis 连接
docker compose exec celery-worker python -c "
from app.core.celery_app import celery_app
print(celery_app.broker_connection().ensure_connection(max_retries=3))
"

# 4. 手动触发任务测试
docker compose exec backend-stable python -c "
from app.services.ims_integration_service import sync_iqc_data
result = sync_iqc_data.delay()
print(f'Task ID: {result.id}')
"
```

### 问题 5: 双轨环境数据不一致

**症状**: Preview 环境和 Stable 环境显示的数据不同

**原因分析**: 
- 两个环境共享同一个 PostgreSQL 数据库，数据应该一致
- 可能是 Redis 缓存导致的差异（Preview 使用 DB 1，Stable 使用 DB 0）

**解决方案**:

```bash
# 清除 Redis 缓存
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" FLUSHALL

# 或分别清除
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" -n 0 FLUSHDB  # Stable
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" -n 1 FLUSHDB  # Preview
```

---

## 维护操作 (Maintenance Operations)

### 更新系统 (Update System)

```bash
# 1. 拉取最新代码
# 私有仓库场景下，服务器需要已有 GitHub 访问凭据；
# 如果走 GitHub Actions 自动部署，则由 workflow 临时注入令牌，不需要在服务器上手工保存账号密码
git pull origin main

# 2. 备份数据库
./deployment/backup/backup.sh

# 3. 重新部署
./deployment/deploy.sh
```

### 重启服务 (Restart Services)

```bash
# 重启所有服务
docker compose restart

# 重启特定服务
docker compose restart backend-stable
docker compose restart nginx

# 重新加载 Nginx 配置（无需重启）
docker compose exec nginx nginx -s reload
```

### 清理资源 (Clean Up Resources)

```bash
# 清理未使用的镜像
docker image prune -a

# 清理未使用的容器
docker container prune

# 清理未使用的数据卷
docker volume prune

# 清理所有未使用资源
docker system prune -a --volumes
```

### 扩容服务 (Scale Services)

```bash
# 扩容 Celery Worker（增加并发处理能力）
docker compose up -d --scale celery-worker=3

# 查看扩容后的容器
docker compose ps celery-worker
```

---

## 安全加固 (Security Hardening)

### 1. 修改默认密码

确保所有默认密码已修改：

- ✅ 数据库密码 (`DB_PASSWORD`)
- ✅ Redis 密码 (`REDIS_PASSWORD`)
- ✅ JWT 密钥 (`SECRET_KEY`)
- ✅ SMTP 密码 (`SMTP_PASSWORD`)

### 2. 配置防火墙

```bash
# 仅开放必要端口
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

### 3. 启用 HTTPS

确保生产环境使用 HTTPS：

- ✅ 配置 SSL 证书
- ✅ 强制 HTTP 跳转 HTTPS
- ✅ 启用 HSTS 头

### 4. 定期备份

```bash
# 配置 crontab 定时备份
crontab -e

# 添加以下行（每天凌晨 3 点备份）
0 3 * * * /path/to/qms-system/deployment/backup/backup.sh
```

### 5. 日志审计

```bash
# 定期检查操作日志
docker compose exec postgres psql -U qms_user -d qms_db -c "
SELECT * FROM audit_logs 
WHERE created_at > NOW() - INTERVAL '7 days' 
ORDER BY created_at DESC 
LIMIT 100;
"
```

---

## 性能优化 (Performance Optimization)

### 1. 数据库优化

```bash
# 分析表统计信息
docker compose exec postgres psql -U qms_user -d qms_db -c "ANALYZE;"

# 清理死元组
docker compose exec postgres psql -U qms_user -d qms_db -c "VACUUM FULL;"

# 查看慢查询
docker compose exec postgres psql -U qms_user -d qms_db -c "
SELECT query, calls, total_time, mean_time 
FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;
"
```

### 2. Redis 优化

```bash
# 查看 Redis 性能统计
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" info stats

# 清理过期键
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" --scan --pattern "*" | xargs redis-cli -a "$REDIS_PASSWORD" DEL
```

### 3. Nginx 优化

已在 `nginx.conf` 中配置：

- ✅ Gzip 压缩
- ✅ 静态文件缓存
- ✅ Keepalive 连接
- ✅ 缓冲区优化

---

## 附录 (Appendix)

### A. 环境变量完整列表

参考 `.env.production` 文件中的完整配置说明。

### B. 端口映射表

| 服务 | 容器端口 | 主机端口 | 说明 |
|------|---------|---------|------|
| PostgreSQL | 5432 | 5432 | 数据库 |
| Redis | 6379 | 6379 | 缓存/队列 |
| Backend (Stable) | 8000 | 8000 | 正式环境后端 |
| Backend (Preview) | 8000 | 8001 | 预览环境后端 |
| Frontend (Stable) | 80 | 3000 | 正式环境前端 |
| Frontend (Preview) | 80 | 3001 | 预览环境前端 |
| Nginx | 80/443 | 80/443 | 网关 |

### C. 常用命令速查

```bash
# 启动服务
docker compose up -d

# 停止服务
docker compose down

# 查看日志
docker compose logs -f

# 重启服务
docker compose restart

# 执行迁移
docker compose exec backend-stable alembic upgrade head

# 进入容器
docker compose exec backend-stable bash

# 备份数据库
./deployment/backup/backup.sh

# 恢复数据库
./deployment/backup/restore.sh <backup_file>
```

---

## 联系支持 (Contact Support)

如遇到部署问题，请联系：

- **技术支持**: support@company.com
- **项目负责人**: qms-admin@company.com
- **文档地址**: https://docs.company.com/qms

---

**部署完成后，请务必进行完整的功能验证测试！**
