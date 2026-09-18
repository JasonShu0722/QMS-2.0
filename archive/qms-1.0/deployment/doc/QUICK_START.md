# QMS 快速部署指南
# QMS Quick Start Deployment Guide

## 🚀 5 分钟快速部署 (5-Minute Quick Deployment)

本指南提供最快速的部署方式，适用于开发环境或测试环境。生产环境请参考 [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)。

---

## 前置条件 (Prerequisites)

- ✅ Docker 已安装
- ✅ Docker Compose 已安装
- ✅ Git 已安装

---

## 快速部署步骤 (Quick Deployment Steps)

### Step 1: 克隆代码

```bash
git clone https://github.com/your-company/qms-system.git
cd qms-system
```

### Step 2: 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env.production

# 编辑环境变量（至少修改以下 3 项）
nano .env.production
```

**必须修改的配置**：

```bash
DB_PASSWORD=your_strong_password_here
REDIS_PASSWORD=your_redis_password_here
SECRET_KEY=your_jwt_secret_key_minimum_32_characters_long
```

**快速生成密钥**：

```bash
# 生成 SECRET_KEY
openssl rand -hex 32

# 生成密码
openssl rand -base64 24
```

### Step 3: 一键部署

```bash
# 赋予执行权限
chmod +x deployment/deploy.sh

# 执行部署
./deployment/deploy.sh
```

**预期输出**：

```
[SUCCESS] QMS Production Deployment Completed Successfully!
```

### Step 4: 访问系统

- **前端（正式环境）**: http://localhost/
- **前端（预览环境）**: http://localhost/ (需配置 hosts)
- **后端 API 文档**: http://localhost:8000/docs
- **后端健康检查**: http://localhost:8000/health

---

## 手动部署（如果自动脚本失败）

```bash
# 1. 启动所有服务
docker compose --env-file .env.production up -d --build

# 2. 等待数据库启动
sleep 10

# 3. 执行数据库迁移
docker compose exec backend-stable alembic upgrade head

# 4. 验证服务状态
docker compose ps
```

---

## 常用命令 (Common Commands)

```bash
# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f

# 重启服务
docker compose restart

# 停止服务
docker compose down

# 进入后端容器
docker compose exec backend-stable bash

# 查看数据库
docker compose exec postgres psql -U qms_user -d qms_db
```

---

## 默认账号 (Default Accounts)

部署完成后，需要手动创建管理员账号：

```bash
# 进入后端容器
docker compose exec backend-stable bash

# 创建管理员账号
python -c "
from app.services.user_service import UserService
from app.core.database import get_db
import asyncio

async def create_admin():
    async for db in get_db():
        await UserService.create_admin_user(
            db=db,
            username='admin',
            password='Admin@123456',
            full_name='系统管理员',
            email='admin@company.com'
        )
        print('Admin user created successfully!')
        break

asyncio.run(create_admin())
"
```

**默认管理员账号**：
- 用户名: `admin`
- 密码: `Admin@123456`（首次登录后请立即修改）

---

## 验证部署 (Verify Deployment)

### 1. 检查容器状态

```bash
docker compose ps
```

所有容器应显示 `Up` 状态。

### 2. 测试后端 API

```bash
# 健康检查
curl http://localhost:8000/health

# 获取验证码
curl http://localhost:8000/api/v1/auth/captcha

# 查看 API 文档
open http://localhost:8000/docs
```

### 3. 测试前端访问

```bash
# 访问前端
open http://localhost/
```

---

## 故障排查 (Troubleshooting)

### 问题 1: 端口被占用

```bash
# 查看端口占用
netstat -tulpn | grep -E '80|443|5432|6379|8000'

# 停止占用端口的进程
kill -9 <PID>
```

### 问题 2: 容器无法启动

```bash
# 查看容器日志
docker compose logs <container_name>

# 重新构建镜像
docker compose build --no-cache
docker compose up -d
```

### 问题 3: 数据库连接失败

```bash
# 检查数据库容器
docker compose logs postgres

# 测试数据库连接
docker compose exec postgres psql -U qms_user -d qms_db -c "SELECT 1;"
```

---

## 下一步 (Next Steps)

1. ✅ 修改默认管理员密码
2. ✅ 配置 SSL 证书（生产环境）
3. ✅ 配置 IMS 系统集成
4. ✅ 配置 SMTP 邮件服务
5. ✅ 配置定时备份
6. ✅ 阅读完整部署文档：[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)

---

## 获取帮助 (Get Help)

- 📖 完整部署文档: [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)
- ✅ 部署检查清单: [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md)
- 📧 技术支持: support@company.com

---

**祝您部署顺利！🎉**
