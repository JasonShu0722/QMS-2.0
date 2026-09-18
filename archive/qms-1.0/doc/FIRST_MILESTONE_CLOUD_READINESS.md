# 第一里程碑上云前检查清单

这份清单用于把“本地功能已完成”收敛成“可以开始上云联调”。

## 1. 后端基础回归

在 `backend` 目录执行：

```powershell
..\.venv\Scripts\python.exe .\scripts\run_foundation_smoke.py
```

预期：

- 第一里程碑核心接口回归全绿
- 覆盖认证链、账号治理、权限矩阵、工作台、个人中心、feature flag

当前 smoke 标记已覆盖：

- `test_foundation_milestone_api.py`
- `test_feature_flags.py`
- `test_admin_users_api.py`
- `test_profile_api.py`
- `test_login.py`
- `test_admin_permissions_api.py`

## 2. 前端最小回归

在 `frontend` 目录执行：

```powershell
npm run test:foundation
npm run build
```

预期：

- `auth` store 能正确持久化统一登录会话
- 环境切换逻辑能区分 `stable / preview`
- 权限矩阵页面能消费 `modules + rows` 契约
- 构建产物可成功生成

## 3. 部署配置静态校验

在仓库根目录执行：

```powershell
docker compose config
```

预期：

- `docker-compose.yml` 可被完整解析
- `backend-stable / backend-preview`
- `frontend-stable / frontend-preview`
- `nginx`
- `postgres / redis`

都能进入最终配置输出

## 4. 数据库迁移

在 `backend` 目录执行：

```powershell
..\.venv\Scripts\python.exe -m alembic upgrade head
```

预期：

- 迁移执行成功
- `feature_flags` 的 `(feature_key, environment)` 复合唯一约束生效

## 5. 本地容器启动验收

在仓库根目录执行：

```powershell
docker compose up -d postgres redis backend-stable backend-preview frontend-stable frontend-preview nginx
docker compose ps
```

预期：

- `stable` 和 `preview` 两套前后端容器都处于 `Up`
- `nginx` 已暴露 `QMS_NGINX_PORT`
- 两个后端都能读取各自 `ENVIRONMENT`

注意：

- 如果本机 Docker 镜像源无法拉取 `node:20-alpine` 或 `nginx:alpine`，会导致前端容器与 `nginx` 起栈失败
- 这类报错通常表现为 Docker Hub 镜像代理 `EOF`
- 这属于本机 Docker 网络 / 镜像源问题，不等同于项目代码或 `docker-compose.yml` 配置错误

## 6. 上云前必须人工确认

- `.env.production` 已填写正式数据库、Redis、JWT 密钥、域名、CORS
- `PRIMARY_DOMAIN` 与 `PREVIEW_DOMAIN` 已指向服务器
- `REQ_PANEL_ADMIN_*` 与 `REQ_PANEL_VIEWER_*` 已替换为可控正式值
- 服务器部署后会执行 `alembic upgrade head`
- 平台管理员账号具备 `stable / preview` 登录权限

## 7. 可以开始上云的退出条件

满足下面条件后，可以结束本地阶段并转入云上联调：

- 后端 smoke 回归全绿
- 前端 `npm run test:foundation` 与 `npm run build` 全绿
- `docker compose config` 通过
- 数据库迁移已在本地目标库演练成功
- 双环境容器可启动
