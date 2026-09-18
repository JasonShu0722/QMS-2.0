# QMS 部署目录说明
# QMS Deployment Directory

本目录包含 QMS 质量管理系统的所有部署相关文件和脚本。

---

## 📁 目录结构 (Directory Structure)

```
deployment/
├── nginx/                      # Nginx 配置文件
│   ├── nginx.conf             # Nginx 主配置（双轨路由）
│   ├── ssl/                   # SSL 证书目录
│   └── README.md              # Nginx 配置说明
├── backup/                     # 数据库备份脚本
│   ├── backup.sh              # 备份脚本
│   ├── restore.sh             # 恢复脚本
│   └── README.md              # 备份说明
├── ssl/                        # SSL 证书存放目录
│   └── README.md              # SSL 证书说明
├── deploy.sh                   # 🚀 自动化部署脚本
├── verify_deployment.sh        # ✅ 部署验证脚本
├── DEPLOYMENT_GUIDE.md         # 📖 完整部署指南
├── DEPLOYMENT_CHECKLIST.md     # ✅ 部署检查清单
├── QUICK_START.md              # ⚡ 快速开始指南
└── README.md                   # 本文件
```

---

## 🚀 快速开始 (Quick Start)

### 方式 1: 自动化部署（推荐）

```bash
# 1. 配置环境变量
cp ../.env.example ../.env.production
nano ../.env.production

# 2. 执行部署脚本
chmod +x deploy.sh
./deploy.sh

# 3. 验证部署
chmod +x verify_deployment.sh
./verify_deployment.sh
```

### 方式 2: 手动部署

```bash
# 1. 启动服务
cd ..
docker compose --env-file .env.production up -d --build

# 2. 执行数据库迁移
docker compose exec backend-stable alembic upgrade head

# 3. 验证服务
docker compose ps
```

---

## 📖 文档说明 (Documentation)

### 1. QUICK_START.md
- **用途**: 5 分钟快速部署指南
- **适用场景**: 开发环境、测试环境、快速验证
- **内容**: 最简化的部署步骤

### 2. DEPLOYMENT_GUIDE.md
- **用途**: 完整的生产环境部署指南
- **适用场景**: 生产环境部署、正式上线
- **内容**: 
  - 详细的前置条件检查
  - 完整的部署步骤
  - 双轨环境配置
  - 数据库迁移管理
  - 故障排查指南
  - 性能优化建议
  - 安全加固措施

### 3. DEPLOYMENT_CHECKLIST.md
- **用途**: 部署检查清单
- **适用场景**: 确保部署完整性
- **内容**: 
  - 部署前检查（23 项）
  - 部署执行检查
  - 功能验证检查
  - 性能与安全检查
  - 部署后检查

---

## 🛠️ 脚本说明 (Scripts)

### 1. deploy.sh - 自动化部署脚本

**功能**:
- ✅ 检查前置条件（Docker、环境变量）
- ✅ 备份现有数据库
- ✅ 停止旧版本服务
- ✅ 构建并启动新版本
- ✅ 执行数据库迁移
- ✅ 验证服务健康状态
- ✅ 运行功能测试
- ✅ 生成部署日志

**使用方法**:
```bash
chmod +x deploy.sh
./deploy.sh
```

**日志位置**: `deployment/deploy_YYYYMMDD_HHMMSS.log`

### 2. verify_deployment.sh - 部署验证脚本

**功能**:
- ✅ 检查所有容器状态（9 个容器）
- ✅ 验证后端健康检查
- ✅ 验证数据库连接
- ✅ 验证 Redis 连接
- ✅ 验证 API 端点
- ✅ 检查系统资源（磁盘、内存）

**使用方法**:
```bash
chmod +x verify_deployment.sh
./verify_deployment.sh
```

**输出示例**:
```
========================================
QMS Deployment Verification
========================================

[1/15] Checking Docker...
✓ Docker is installed
✓ Docker Compose is installed

[3/15] Checking containers...
✓ PostgreSQL container is running
✓ Redis container is running
...

========================================
Verification Summary
========================================
Total Tests: 15
Passed: 15
Failed: 0

✓ All tests passed! Deployment is successful.
```

---

## 🔧 常用命令 (Common Commands)

### 服务管理

```bash
# 启动所有服务
docker compose up -d

# 停止所有服务
docker compose down

# 重启所有服务
docker compose restart

# 查看服务状态
docker compose ps

# 查看服务日志
docker compose logs -f

# 查看特定服务日志
docker compose logs -f backend-stable
```

### 数据库管理

```bash
# 执行数据库迁移
docker compose exec backend-stable alembic upgrade head

# 查看迁移历史
docker compose exec backend-stable alembic history

# 回滚迁移
docker compose exec backend-stable alembic downgrade -1

# 备份数据库
./backup/backup.sh

# 恢复数据库
./backup/restore.sh <backup_file>
```

### 容器管理

```bash
# 进入后端容器
docker compose exec backend-stable bash

# 进入数据库容器
docker compose exec postgres psql -U qms_user -d qms_db

# 进入 Redis 容器
docker compose exec redis redis-cli

# 查看容器资源使用
docker stats
```

---

## 🌐 访问地址 (Access URLs)

### 开发环境（本地）

- **前端（正式环境）**: http://localhost/
- **前端（预览环境）**: http://localhost/ (需配置 hosts)
- **后端 API（正式）**: http://localhost:8000
- **后端 API（预览）**: http://localhost:8001
- **API 文档**: http://localhost:8000/docs
- **健康检查**: http://localhost:8000/health

### 生产环境

- **前端（正式环境）**: https://qms.company.com/
- **前端（预览环境）**: https://preview.company.com/
- **后端 API（正式）**: https://qms.company.com/api
- **后端 API（预览）**: https://preview.company.com/api
- **API 文档**: https://qms.company.com/api/docs

---

## 🔐 安全注意事项 (Security Notes)

1. **修改默认密码**: 部署前必须修改 `.env.production` 中的所有密码
2. **SSL 证书**: 生产环境必须配置 SSL 证书
3. **防火墙**: 仅开放必要端口（80, 443）
4. **定期备份**: 配置自动备份任务
5. **日志审计**: 定期检查操作日志

---

## 📊 监控指标 (Monitoring Metrics)

### 关键指标

- **容器状态**: 所有容器应为 `Up` 状态
- **CPU 使用率**: < 80%
- **内存使用率**: < 90%
- **磁盘使用率**: < 80%
- **数据库连接数**: < 100
- **API 响应时间**: < 500ms
- **错误率**: < 1%

### 监控命令

```bash
# 查看容器资源使用
docker stats

# 查看磁盘使用
df -h

# 查看内存使用
free -h

# 查看数据库连接数
docker compose exec postgres psql -U qms_user -d qms_db -c "SELECT count(*) FROM pg_stat_activity;"
```

---

## 🆘 故障排查 (Troubleshooting)

### 常见问题

1. **容器无法启动**: 检查日志 `docker compose logs <container_name>`
2. **端口被占用**: 检查端口 `netstat -tulpn | grep <port>`
3. **数据库连接失败**: 检查环境变量和数据库状态
4. **前端无法访问**: 检查 Nginx 配置和后端健康状态
5. **Celery 任务不执行**: 检查 Redis 连接和 Celery 日志

详细故障排查请参考 [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) 的故障排查章节。

---

## 📞 获取帮助 (Get Help)

- **技术支持**: support@company.com
- **项目负责人**: qms-admin@company.com
- **文档地址**: https://docs.company.com/qms
- **问题反馈**: https://github.com/your-company/qms-system/issues

---

## 📝 更新日志 (Changelog)

### 2026-02-12
- ✅ 创建自动化部署脚本
- ✅ 创建部署验证脚本
- ✅ 完善部署文档
- ✅ 添加部署检查清单

---

**祝您部署顺利！🎉**
