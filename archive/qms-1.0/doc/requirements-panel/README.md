# Requirements Panel README

## 1. 面板定位

需求看板是挂载在 QMS 子路径下的独立页面，用于：

- 汇总 QMS 项目功能需求条目
- 按模块和整体优先级可视化展示开发状态
- 在联调和验收完成后，在线维护功能状态

这套面板账号体系独立于 QMS 主系统：

- 不复用 QMS 员工账号
- 不复用 QMS 供应商账号
- 使用专门的需求看板账号登录

## 2. 访问入口

线上访问入口：

- 正式版：[https://qms.bigshuaibee.cn/requirements-panel](https://qms.bigshuaibee.cn/requirements-panel)
- 预览版：[https://preview.qms.bigshuaibee.cn/requirements-panel](https://preview.qms.bigshuaibee.cn/requirements-panel)

本地开发入口：

- `/requirements-panel`

## 3. 账号体系

需求看板使用独立账号表：

- `requirements_panel_users`

账号角色只有两类：

- `admin`
  可登录、可查看、可在线更新需求状态
- `viewer`
  可登录、可查看、不可修改需求状态

状态维护表：

- `requirements_panel_statuses`

状态表中的 `updated_by` 外键使用 `ON DELETE SET NULL`。  
这意味着删除旧账号后，不会删除历史状态记录，只会把该记录的更新人置空。

## 4. 环境变量

需求看板账号支持通过环境变量覆盖默认值：

```env
REQ_PANEL_ADMIN_USERNAME=requirements_admin
REQ_PANEL_ADMIN_PASSWORD=ReqPanelAdmin@2026
REQ_PANEL_ADMIN_FULL_NAME=需求面板管理员

REQ_PANEL_VIEWER_USERNAME=requirements_viewer
REQ_PANEL_VIEWER_PASSWORD=ReqPanelViewer@2026
REQ_PANEL_VIEWER_FULL_NAME=需求面板查阅账号
```

这些变量需要写入服务器的：

- `/.env.production`

注意：

- 修改 `.env.production` 后，账号信息不会自动同步到数据库
- 必须让后端容器重新读取新环境变量
- 然后重新执行账号初始化脚本，数据库中的账号信息才会更新

## 5. 文件结构

### 5.1 文档与原型

目录：[doc/requirements-panel](.)

- [README.md](README.md)
- [QMS_FUNCTION_REQUIREMENTS.md](QMS_FUNCTION_REQUIREMENTS.md)
- [qms-requirements-data.js](qms-requirements-data.js)
- [qms-requirements-panel.html](qms-requirements-panel.html)

### 5.2 前端功能代码

目录：[frontend/src/features/requirements-panel](../../frontend/src/features/requirements-panel)

- [RequirementsPanel.vue](../../frontend/src/features/requirements-panel/RequirementsPanel.vue)
- [api.ts](../../frontend/src/features/requirements-panel/api.ts)
- [request.ts](../../frontend/src/features/requirements-panel/request.ts)
- [types.ts](../../frontend/src/features/requirements-panel/types.ts)
- [catalog.ts](../../frontend/src/features/requirements-panel/catalog.ts)

### 5.3 后端实现

核心文件：

- [requirements_panel.py](../../backend/app/api/v1/requirements_panel.py)
- [requirements_panel_auth.py](../../backend/app/api/v1/requirements_panel_auth.py)
- [requirements_panel_auth.py](../../backend/app/core/requirements_panel_auth.py)
- [requirements_panel_user.py](../../backend/app/models/requirements_panel_user.py)
- [requirements_panel_status.py](../../backend/app/models/requirements_panel_status.py)
- [requirements_panel.py](../../backend/app/schemas/requirements_panel.py)
- [create_requirements_panel_users.py](../../backend/scripts/create_requirements_panel_users.py)
- [2026_03_30_1730-9c4d8e7a2b11_add_requirements_panel_statuses.py](../../backend/alembic/versions/2026_03_30_1730-9c4d8e7a2b11_add_requirements_panel_statuses.py)

## 6. 常用运维命令

以下命令默认在服务器上执行：

```bash
cd /www/qms/QMS
```

### 6.1 重新加载需求看板账号环境变量

当你修改了 `/.env.production` 里的 `REQ_PANEL_*` 变量后，先让后端容器重建：

```bash
docker compose --env-file .env.production up -d --force-recreate backend-stable backend-preview
```

### 6.2 确认容器已经读到 REQ_PANEL 变量

```bash
docker compose --env-file .env.production exec -T backend-stable sh -lc 'env | grep REQ_PANEL'
```

如果这里没有输出，说明后端容器没有拿到需求看板账号相关环境变量。

### 6.3 初始化或更新需求看板账号

```bash
docker compose --env-file .env.production exec -T backend-stable python -m scripts.create_requirements_panel_users
```

行为说明：

- 如果用户名不存在，会创建新账号
- 如果用户名已存在，会更新密码、姓名、角色
- 如果你改了用户名，旧账号不会自动删除

### 6.4 查看当前需求看板账号

```bash
docker compose --env-file .env.production exec -T postgres psql -U qms_user -d qms_db -c "SELECT id, username, full_name, role, is_active, last_login_at FROM requirements_panel_users ORDER BY id;"
```

### 6.5 直测需求看板登录接口

用正式版后端直测：

```bash
curl -X POST http://127.0.0.1:8000/api/v1/requirements-panel-auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"你的需求看板用户名","password":"你的需求看板密码"}'
```

如果返回 `access_token`，说明账号和密码在后端是有效的。

### 6.6 查看当前登录账号信息

先把登录返回的 token 替换进去：

```bash
curl http://127.0.0.1:8000/api/v1/requirements-panel-auth/me \
  -H "Authorization: Bearer 你的access_token"
```

### 6.7 查看需求状态覆盖记录

```bash
docker compose --env-file .env.production exec -T postgres psql -U qms_user -d qms_db -c "SELECT id, item_id, status, updated_by, updated_at FROM requirements_panel_statuses ORDER BY id;"
```

### 6.8 删除旧账号前检查是否被状态记录引用

```bash
docker compose --env-file .env.production exec -T postgres psql -U qms_user -d qms_db -c "SELECT id, item_id, status, updated_by, updated_at FROM requirements_panel_statuses WHERE updated_by IN (1,2) ORDER BY id;"
```

### 6.9 删除旧账号

建议优先按用户名删除：

```bash
docker compose --env-file .env.production exec -T postgres psql -U qms_user -d qms_db -c "DELETE FROM requirements_panel_users WHERE username IN ('requirements_admin','requirements_viewer');"
```

也可以按 ID 删除：

```bash
docker compose --env-file .env.production exec -T postgres psql -U qms_user -d qms_db -c "DELETE FROM requirements_panel_users WHERE id IN (1,2);"
```

### 6.10 删除后再次确认账号列表

```bash
docker compose --env-file .env.production exec -T postgres psql -U qms_user -d qms_db -c "SELECT id, username, full_name, role, is_active, last_login_at FROM requirements_panel_users ORDER BY id;"
```

## 7. 推荐维护流程

### 7.1 首次配置或变更账号

1. 修改 `/.env.production` 中的 `REQ_PANEL_*`
2. 重建后端容器
3. 检查容器环境变量是否生效
4. 重新执行账号初始化脚本
5. 查询数据库确认账号结果
6. 直测登录接口
7. 最后再在浏览器登录

推荐命令顺序：

```bash
cd /www/qms/QMS
docker compose --env-file .env.production up -d --force-recreate backend-stable backend-preview
docker compose --env-file .env.production exec -T backend-stable sh -lc 'env | grep REQ_PANEL'
docker compose --env-file .env.production exec -T backend-stable python -m scripts.create_requirements_panel_users
docker compose --env-file .env.production exec -T postgres psql -U qms_user -d qms_db -c "SELECT id, username, full_name, role, is_active, last_login_at FROM requirements_panel_users ORDER BY id;"
```

### 7.2 浏览器登录失败时的排查顺序

先不要直接猜密码，按下面顺序排查：

1. 检查后端容器是否拿到 `REQ_PANEL_*`
2. 检查数据库中实际有哪些账号
3. 用 `curl` 直测登录接口
4. 如果接口成功，再看浏览器本地缓存或登录态

## 8. 当前维护建议

- 需求看板账号应始终通过 `REQ_PANEL_*` 管理，不要直接改数据库密码哈希
- 账号改动后，必须执行“重建容器 + 重新初始化脚本”
- 如果只改用户名，不会自动删除旧账号，需人工确认后删除
- 如果只改 `USERNAME/PASSWORD`，建议同步维护 `FULL_NAME`，避免页面里显示旧默认名称

## 9. 备注

当前这套组织方式适合持续维护：

- 文档集中在 `doc/requirements-panel`
- 前端功能集中在 `frontend/src/features/requirements-panel`
- 后端保持现有分层，不为了“看起来统一”强行破坏项目主结构

如果后续需求看板继续扩展成完整子系统，再考虑把后端也升级成模块化目录。
