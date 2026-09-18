# 数据库迁移验证文档

## 任务概述

本文档记录了任务 2.5 "执行数据库迁移（兼容双轨环境）" 的实施情况。

## 完成的工作

### 1. 创建缺失的数据模型

为了完成初始数据库架构，创建了以下新模型：

#### 核心功能模型
- `AnnouncementReadLog` - 公告阅读记录模型
- `NotificationRule` - 通知规则配置模型
- `SMTPConfig` - 邮件服务器配置模型

#### 预留功能模型（所有字段 Nullable）
- `InstrumentCalibration` - 仪器校准管理模型
- `QualityCost` - 质量成本管理模型

### 2. 更新模型导入

更新了 `backend/app/models/__init__.py`，导入所有新创建的模型和枚举类型。

### 3. 创建数据库连接模块

创建了 `backend/app/core/database.py`，提供：
- 异步数据库引擎配置
- 异步会话工厂
- FastAPI 依赖注入函数 `get_db()`

### 4. 生成初始迁移脚本

创建了 `backend/alembic/versions/2026_02_11_1330-001_initial_schema.py`，包含：

#### 创建的表结构
1. **suppliers** - 供应商表
2. **users** - 用户表
3. **permissions** - 权限表
4. **notifications** - 通知表
5. **announcements** - 公告表
6. **announcement_read_logs** - 公告阅读记录表
7. **operation_logs** - 操作日志表
8. **feature_flags** - 功能特性开关表
9. **system_configs** - 系统配置表（含默认配置数据）
10. **notification_rules** - 通知规则表
11. **smtp_configs** - SMTP配置表
12. **instrument_calibrations** - 仪器校准表（预留功能）
13. **quality_costs** - 质量成本表（预留功能）

#### 创建的索引

为所有表创建了必要的索引以优化查询性能：
- 主键索引
- 外键索引
- 状态字段索引
- 时间字段索引
- 唯一约束索引

## 双轨环境兼容性验证

### 非破坏性原则遵循情况

✅ **所有新增字段均符合要求**：

1. **核心功能表字段**：
   - 所有必填字段都设置了 `server_default` 值
   - 可选字段设置为 `nullable=True`

2. **预留功能表字段**：
   - `instrument_calibrations` 表：所有字段 `nullable=True`
   - `quality_costs` 表：所有字段 `nullable=True`

3. **禁止操作检查**：
   - ❌ 无删除字段操作
   - ❌ 无重命名字段操作
   - ❌ 无修改字段类型操作
   - ❌ 无删除表操作

### 迁移脚本特点

```python
# 示例：所有新增字段都有默认值或可为空
sa.Column('status', sa.String(length=20), nullable=False, 
          server_default='pending', comment='状态')

sa.Column('digital_signature', sa.String(length=500), 
          nullable=True, comment='电子签名路径')

# 预留功能表：所有字段可为空
sa.Column('instrument_code', sa.String(length=100), 
          nullable=True, comment='仪器编码')
```

## 如何执行迁移

### 前置条件

1. 确保 PostgreSQL 数据库已启动并可访问
2. 确保 `.env` 文件中的 `DATABASE_URL` 配置正确
3. 确保已安装所有 Python 依赖：
   ```bash
   pip install -r requirements.txt
   ```

### 执行步骤

#### 方式一：使用 Docker Compose（推荐）

```bash
# 1. 启动所有服务（包括数据库）
docker-compose up -d

# 2. 在后端容器中执行迁移
docker-compose exec backend-stable alembic upgrade head

# 3. 验证迁移结果
docker-compose exec backend-stable alembic current
```

#### 方式二：本地开发环境

```bash
# 1. 进入后端目录
cd backend

# 2. 执行迁移
alembic upgrade head

# 3. 验证迁移结果
alembic current

# 4. 查看迁移历史
alembic history
```

### 验证迁移成功

执行以下 SQL 查询验证表结构：

```sql
-- 查看所有表
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- 验证表数量（应该有 13 个表）
SELECT COUNT(*) 
FROM information_schema.tables 
WHERE table_schema = 'public';

-- 查看 system_configs 表的默认数据
SELECT config_key, config_value, value_type, category 
FROM system_configs 
ORDER BY config_key;

-- 验证索引创建
SELECT tablename, indexname 
FROM pg_indexes 
WHERE schemaname = 'public' 
ORDER BY tablename, indexname;
```

## 数据库关系图

```
suppliers (供应商)
    ↓ (1:N)
users (用户)
    ↓ (1:N)
    ├── permissions (权限)
    ├── notifications (通知)
    ├── announcement_read_logs (公告阅读记录)
    ├── operation_logs (操作日志)
    └── [创建者关系]
        ├── announcements (公告)
        ├── feature_flags (功能开关)
        ├── system_configs (系统配置)
        └── notification_rules (通知规则)
```

## 性能优化索引

### 高频查询索引
- `users.username` - 登录查询
- `users.status` - 用户状态筛选
- `permissions.user_id` - 权限检查
- `notifications.user_id + is_read` - 未读消息查询
- `announcements.published_at` - 公告列表排序

### 关联查询索引
- `users.supplier_id` - 供应商用户关联
- `announcement_read_logs.announcement_id` - 阅读统计
- `operation_logs.user_id + created_at` - 审计日志查询

## 回滚策略

⚠️ **警告**：生产环境禁止执行 downgrade 操作！

仅在开发环境测试时可以回滚：

```bash
# 回滚到上一个版本
alembic downgrade -1

# 回滚到初始状态
alembic downgrade base
```

## 后续步骤

1. ✅ 数据库迁移脚本已创建
2. ⏭️ 执行迁移：`alembic upgrade head`
3. ⏭️ 验证表结构和关系完整性
4. ⏭️ 测试数据库连接和基本 CRUD 操作
5. ⏭️ 继续实现任务 3.1：认证授权模块

## 注意事项

### 双轨环境部署顺序

1. **预览环境部署**：
   - 部署新代码（包含新字段的读写逻辑）
   - 执行迁移脚本（新增字段）
   - 验证功能正常

2. **正式环境部署**：
   - 等待预览环境稳定运行 24-48 小时
   - 部署新代码到正式环境
   - 正式环境自动识别新字段（因为已经存在）

### 字段清理策略

如果未来需要删除旧字段：

1. 先在两个环境都部署移除字段引用的代码
2. 等待至少一个发布周期
3. 再创建删除字段的迁移脚本
4. 在低峰期执行删除操作

## 相关文件

- 迁移脚本：`backend/alembic/versions/2026_02_11_1330-001_initial_schema.py`
- 数据模型：`backend/app/models/*.py`
- 数据库配置：`backend/app/core/database.py`
- Alembic 配置：`backend/alembic.ini`
- 环境变量：`backend/.env`

## 参考文档

- [Alembic 官方文档](https://alembic.sqlalchemy.org/)
- [SQLAlchemy 2.0 文档](https://docs.sqlalchemy.org/en/20/)
- [PostgreSQL 数据类型](https://www.postgresql.org/docs/current/datatype.html)
- 设计文档：`.kiro/specs/qms-foundation-and-auth/design.md`
- 需求文档：`.kiro/specs/qms-foundation-and-auth/requirements.md`
