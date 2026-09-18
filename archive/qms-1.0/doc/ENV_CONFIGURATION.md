# 环境配置说明

这份文档专门说明项目里几套环境文件的职责，避免把“本地 / 服务器部署”和“正式版 / 预览版”混在一起。

## 一、先分清两层概念

### 1. 运行位置

- 本地开发
- 云服务器部署

这一层决定主要使用哪份配置文件。

### 2. 运行入口 / 发布环境

- `stable`：正式版
- `preview`：预览版

这一层决定网关把请求转发到哪套前后端服务，也决定后端登录时使用哪个运行环境做准入校验。

`.env` 和 `.env.production` 不是拿来切换运行入口本身的。
它们更像是“系统运行参数”和“部署参数”。

## 二、项目里的关键规则

### 1. 双域名入口

当前线上部署按两套域名入口运行：

- 正式版：`qms.bigshuaibee.cn`
- 预览版：`preview.qms.bigshuaibee.cn`

Nginx 会根据域名把请求转发到：

- `frontend-stable` / `backend-stable`
- `frontend-preview` / `backend-preview`

### 2. 登录页不再提供环境选择

正式 / 预览属于发布入口，不属于普通用户登录前需要选择的业务参数。

- 登录页只保留内部员工 / 供应商身份切换
- 线上环境由当前域名决定进入正式版还是预览版
- 登录后的桌面 / 移动布局仍可为具备权限的用户提供入口切换

### 3. 登录请求不携带 environment

登录请求只提交身份认证所需字段：

- `username`
- `password`
- `user_type`
- 供应商登录额外提交 `captcha` 与 `captcha_id`

后端使用当前实例的 `settings.ENVIRONMENT` 与用户 `allowed_environments` 做运行环境准入校验。旧客户端如果仍提交 `environment` 字段，后端会兼容接收，但不会把它作为登录目标。

## 三、几份环境文件分别做什么

### 1. 根目录 `.env`

路径：

```text
.env
```

用途：

- 主要给根目录 `docker-compose.yml` 在本地运行时做变量替换
- 适合本机 Docker 启动基础设施或整套容器时使用

典型内容：

- 数据库密码
- Redis 密码
- 本地域名 / CORS
- Nginx 模板变量

说明：

- 它服务的是“本地运行方式”
- 不代表正式版或预览版

### 2. 根目录 `.env.production`

路径：

```text
.env.production
```

用途：

- 给云服务器上的 `docker compose --env-file .env.production ...` 使用
- 给部署脚本和校验脚本读取

当前会影响：

- Docker Compose 变量替换
- 服务器部署脚本
- Nginx 域名模板渲染
- 生产 CORS 配置

说明：

- 它代表“服务器部署参数”
- 不是正式版 / 预览版切换开关

### 3. `backend/.env`

路径：

```text
backend/.env
```

用途：

- 后端本地直接运行时读取
- 由 `backend/app/core/config.py` 中的 `env_file=".env"` 加载

适用场景：

- 在 `backend` 目录执行 `uvicorn`
- 在 `backend` 目录执行 `alembic`
- 在 `backend` 目录执行本地调试脚本

### 4. `frontend/.env.development`

路径：

```text
frontend/.env.development
```

用途：

- 前端本地 `npm run dev` 时读取

当前推荐值：

```env
VITE_API_BASE_URL=/api
VITE_ENVIRONMENT=stable
```

说明：

- `VITE_API_BASE_URL=/api`
  让 Vite 代理请求到本地后端，避免浏览器跨域
- `VITE_ENVIRONMENT=stable`
  只是保留的构建期语义，不再驱动登录页环境选择

## 四、正式版 / 预览版到底由什么决定

### 1. Docker Compose 服务拆分

在 [docker-compose.yml](../docker-compose.yml) 中已拆成：

- `backend-stable`
- `backend-preview`
- `frontend-stable`
- `frontend-preview`

其中：

- `backend-stable` 注入 `ENVIRONMENT=stable`
- `backend-preview` 注入 `ENVIRONMENT=preview`
- 两套前端镜像分别构建正式版和预览版入口

### 2. 网关按域名路由

在 [nginx.conf.template](../deployment/nginx/nginx.conf.template) 中：

- `PRIMARY_DOMAIN` 路由到稳定环境
- `PREVIEW_DOMAIN` 路由到预览环境

### 3. 后端运行环境

后端登录接口使用 `settings.ENVIRONMENT` 判断当前运行环境。

相关代码：

- [auth.py](../backend/app/api/v1/auth.py)
- [user.py](../backend/app/schemas/user.py)

### 4. 用户本身的环境权限

数据库用户有 `allowed_environments` 字段，用于控制其可登录的运行入口。普通用户通常只需要 `stable`，Key User 或管理员可额外具备 `preview`。

相关代码：

- [user.py](../backend/app/models/user.py)
- [create_admin.py](../backend/scripts/create_admin.py)

### 5. 前端运行时环境状态

前端当前运行环境统一由以下规则决定：

- 线上：优先看当前域名
- 本地：看 `localStorage.current_environment`

相关代码：

- [useEnvironment.ts](../frontend/src/composables/useEnvironment.ts)
- [auth.ts](../frontend/src/stores/auth.ts)
- [MainLayout.vue](../frontend/src/layouts/MainLayout.vue)
- [MobileLayout.vue](../frontend/src/layouts/MobileLayout.vue)

## 五、推荐使用方式

### 本地开发

- 根目录 `.env`：给 Docker Compose 用
- `backend/.env`：给后端本地进程用
- `frontend/.env.development`：给前端本地开发服务器用

### 云服务器部署

- 根目录 `.env.production`：给 Compose、部署脚本、Nginx 模板统一使用

## 六、当前已经统一的约定

- 本地前端默认使用 `VITE_API_BASE_URL=/api`
- 本地前端可保留 `VITE_ENVIRONMENT=stable` 作为构建期标识
- 服务器部署必须显式使用 `docker compose --env-file .env.production`
- 正式版与预览版在线上由双域名入口和后端 `ENVIRONMENT` 共同决定
- 前端登录页不展示环境切换；登录后的桌面布局和移动布局可展示当前环境及授权切换入口
