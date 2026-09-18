# Backend README

`backend` 是 QMS 的 FastAPI 后端服务，负责：

- 用户认证与权限控制
- 业务 API
- 数据库访问
- 异步任务和集成能力

## 技术栈

- Python 3.10+
- FastAPI
- SQLAlchemy Async
- PostgreSQL
- Redis
- Alembic
- Celery

## 目录结构

```text
backend/
├─ app/
│  ├─ api/
│  ├─ core/
│  ├─ models/
│  ├─ schemas/
│  ├─ services/
│  └─ main.py
├─ alembic/
├─ scripts/
├─ test/
├─ doc/
├─ requirements.txt
├─ pytest.ini
└─ .env
```

## 推荐启动方式

推荐使用：

1. Docker 仅启动 `PostgreSQL + Redis`
2. 后端本地进程启动

这样日志更清晰，代码改动即时生效，适合调试。

## 本地启动

### 1. 准备基础设施

在项目根目录执行：

```bash
docker compose up -d postgres redis
```

### 2. 安装依赖

如果虚拟环境还没装依赖：

```bash
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

### 3. 配置环境变量

本地开发默认读取：

```text
backend/.env
```

当前本地开发关键配置示例：

```env
DATABASE_URL=postgresql+asyncpg://qms_user:qms_dev_password@localhost:5432/qms_db
REDIS_URL=redis://localhost:6379/0
DEBUG=True
```

### 4. 执行迁移

```bash
cd backend
.venv\Scripts\python.exe -m alembic upgrade head
```

### 5. 启动服务

```bash
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

启动后可访问：

- 健康检查：`http://localhost:8000/health`
- Swagger：`http://localhost:8000/api/docs`
- ReDoc：`http://localhost:8000/api/redoc`

## 测试

### 运行全部后端测试

```bash
cd backend
.venv\Scripts\python.exe -m pytest
```

### 运行单个测试文件

```bash
cd backend
.venv\Scripts\python.exe -m pytest test/test_login.py
```

## 数据库迁移

### 生成迁移

```bash
cd backend
.venv\Scripts\python.exe -m alembic revision --autogenerate -m "your message"
```

### 应用迁移

```bash
cd backend
.venv\Scripts\python.exe -m alembic upgrade head
```

### 回滚一版

```bash
cd backend
.venv\Scripts\python.exe -m alembic downgrade -1
```

## 管理员账号

当前本地库里已确认存在管理员账号：

- 用户名：`Admin`
- 用户类型：`internal`

密码如果不确定，不要只依赖历史文档，应以数据库当前状态或重置脚本为准。

## 开发建议

- 调试接口时优先看 `app/api` 和 `app/services`
- 配置问题优先看 `app/core/config.py` 和 `backend/.env`
- 登录、权限问题优先看 `app/core/auth_strategy.py`、`app/core/dependencies.py`
- 测试目录已统一为 `backend/test`
