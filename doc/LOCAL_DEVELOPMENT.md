# 本地开发说明

这份文档用于统一本地开发、调试、登录验证和常见问题排查流程。

## 推荐启动方式

推荐使用下面这套组合：

1. Docker 启动 `PostgreSQL` 和 `Redis`
2. 后端本地运行
3. 前端本地运行

这样最适合日常调试，启动快，日志清晰，修改能即时生效。

## 一、启动顺序

### 1. 启动基础服务

在项目根目录执行：

```bash
docker compose up -d postgres redis
```

检查状态：

```bash
docker compose ps
```

预期端口：

- PostgreSQL：`5432`
- Redis：`6379`

### 2. 启动后端

```bash
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

验证：

- 健康检查：`http://localhost:8000/health`
- Swagger：`http://localhost:8000/api/docs`

### 3. 启动前端

```bash
cd frontend
npm run dev
```

访问地址：

```text
http://localhost:5173
```

## 二、关键配置

### 后端配置

文件：

```text
backend/.env
```

当前本地关键项：

```env
DATABASE_URL=postgresql+asyncpg://qms_user:qms_dev_password@localhost:5432/qms_db
REDIS_URL=redis://localhost:6379/0
DEBUG=True
```

### 前端配置

文件：

```text
frontend/.env.development
```

关键项：

```env
VITE_API_BASE_URL=/api
VITE_ENVIRONMENT=stable
```

这里必须使用 `/api`，让 Vite 代理请求到后端，避免本地跨域问题。

这里的 `stable` 只是本地默认运行入口语义。项目本身仍然支持 `stable / preview` 双运行入口，但登录目标环境由后端当前 `ENVIRONMENT` 决定，登录页和登录请求不再提交目标环境。

### 根目录 Compose 配置

文件：

```text
.env
```

这份文件主要给根目录 `docker-compose.yml` 在本地做变量替换使用，比如数据库密码、Redis 密码、域名和 CORS。它和 `backend/.env` 不是同一份职责。

更完整的说明见：

- [ENV_CONFIGURATION.md](/E:/WorkSpace/QMS/doc/ENV_CONFIGURATION.md)

## 三、管理员登录

当前本地数据库中已确认存在管理员账号：

- 用户名：`Admin`
- 用户类型：`internal`
- 状态：`active`

如果登录失败，不要先怀疑账号，先检查下面两点：

1. 后端是否运行在 `8000`
2. 前端开发环境是否使用 `VITE_API_BASE_URL=/api`

## 四、常见问题

### 1. 登录页提示“网络连接失败”

优先检查：

- 后端是否启动成功
- 浏览器是否访问的是 `http://localhost:5173`
- `frontend/.env.development` 是否配置为 `/api`
- Vite 是否在修改 `.env.development` 后重启

### 2. 登录页提示“用户名和密码错误”

先直接调用后端接口验证账号：

```bash
curl -X POST http://localhost:8000/api/v1/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"username\":\"Admin\",\"password\":\"你的密码\",\"user_type\":\"internal\"}"
```

如果接口能成功返回 token，问题通常在前端请求链路，不在账号本身。

### 3. 前端能打开，接口报错

排查顺序：

1. 看浏览器 Network 面板
2. 看后端日志
3. 看 `frontend/src/utils/request.ts`
4. 看 `frontend/vite.config.ts` 代理配置

### 4. 后端启动成功但业务报数据库错误

执行迁移：

```bash
cd backend
.venv\Scripts\python.exe -m alembic upgrade head
```

## 五、测试

### 后端测试

```bash
cd backend
.venv\Scripts\python.exe -m pytest
```

### 前端测试

```bash
cd frontend
npm run test
```

## 六、建议的调试入口

如果要开始功能优化，建议按下面顺序排查：

1. 登录流程
2. 工作台首页
3. 一个明确的业务模块
4. 接口性能或页面交互问题

这样定位效率最高。
