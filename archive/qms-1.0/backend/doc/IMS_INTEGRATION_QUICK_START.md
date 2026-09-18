# IMS 数据集成服务 - 快速开始指南

## 5 分钟快速上手

### 1. 配置环境变量

编辑 `backend/.env` 文件，添加以下配置：

```bash
# IMS 系统配置
IMS_BASE_URL=http://ims.company.com/api
IMS_API_KEY=your-api-key-here
IMS_TIMEOUT=30

# Celery 配置（使用 Redis）
CELERY_BROKER_URL=redis://redis:6379/0
CELERY_RESULT_BACKEND=redis://redis:6379/0
```

### 2. 启动服务

#### 方式一：使用 Docker Compose（推荐）

```bash
# 在项目根目录
docker compose up -d
```

这将自动启动：
- PostgreSQL 数据库
- Redis 缓存
- FastAPI 后端
- Celery Worker
- Celery Beat

#### 方式二：手动启动

```bash
# 终端 1: 启动 FastAPI
cd backend
uvicorn app.main:app --reload

# 终端 2: 启动 Celery Worker
cd backend
celery -A app.core.celery_app worker --loglevel=info

# 终端 3: 启动 Celery Beat
cd backend
celery -A app.core.celery_app beat --loglevel=info
```

### 3. 测试集成

```bash
cd backend
python scripts/test_ims_integration.py
```

## 常用操作

### 手动触发同步

```python
from app.tasks.ims_sync_tasks import sync_ims_data_manual

# 同步指定日期的数据
task = sync_ims_data_manual.delay("2024-01-15")
print(f"Task ID: {task.id}")
```

### 在 API 中使用

```python
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.services.ims_integration_service import ims_integration_service
from datetime import date

router = APIRouter()

@router.post("/admin/ims/sync")
async def trigger_sync(
    target_date: date,
    db: AsyncSession = Depends(get_db)
):
    """手动触发 IMS 数据同步"""
    result = await ims_integration_service.sync_all_data(
        db=db,
        target_date=target_date
    )
    return result
```

### 查询同步历史

```python
from app.services.ims_integration_service import ims_integration_service
from app.models.ims_sync_log import SyncType

# 查询最近的同步记录
logs = await ims_integration_service.get_sync_history(
    db=db,
    sync_type=SyncType.INCOMING_INSPECTION,
    limit=10
)

for log in logs:
    print(f"{log.sync_date}: {log.status} - {log.records_count} 条记录")
```

## 定时任务配置

默认配置：每日凌晨 02:00 自动同步

修改时间：编辑 `app/core/celery_app.py`

```python
beat_schedule={
    "sync-ims-data-daily": {
        "task": "app.tasks.ims_sync_tasks.sync_ims_data_daily",
        "schedule": crontab(hour=2, minute=0),  # 修改这里
        "args": (),
    },
}
```

## 监控同步状态

### 方式一：查询数据库

```sql
SELECT * FROM ims_sync_logs 
ORDER BY created_at DESC 
LIMIT 10;
```

### 方式二：使用 Celery Flower（可选）

```bash
# 安装 Flower
pip install flower

# 启动 Flower Web UI
celery -A app.core.celery_app flower
```

访问 http://localhost:5555 查看任务状态

## 故障排查

### 问题 1: IMS_BASE_URL 未配置

```
错误: ValueError: IMS_BASE_URL 未配置
解决: 在 .env 文件中添加 IMS_BASE_URL
```

### 问题 2: 连接超时

```
错误: httpx.ConnectTimeout
解决: 
1. 检查 IMS 系统是否可访问
2. 增加 IMS_TIMEOUT 值
3. 检查网络防火墙
```

### 问题 3: 认证失败

```
错误: 401 Unauthorized
解决: 检查 IMS_API_KEY 是否正确
```

### 问题 4: Celery 任务不执行

```
检查清单:
1. Redis 是否运行: redis-cli ping
2. Celery Worker 是否启动
3. Celery Beat 是否启动
4. 查看 Celery 日志
```

## 下一步

- 阅读完整文档: [IMS_INTEGRATION_IMPLEMENTATION.md](./IMS_INTEGRATION_IMPLEMENTATION.md)
- 查看质量数据模型: [QUALITY_DATA_MODELS_IMPLEMENTATION.md](./QUALITY_DATA_MODELS_IMPLEMENTATION.md)
- 实现质量指标计算引擎（Task 9.3）

## 技术支持

如有问题，请查看：
1. 完整实现文档
2. Celery 官方文档: https://docs.celeryproject.org/
3. HTTPX 官方文档: https://www.python-httpx.org/
