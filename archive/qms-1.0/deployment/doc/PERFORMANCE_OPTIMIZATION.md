# Performance Optimization Guide

## 性能优化指南

本文档详细说明 QMS 系统的性能优化策略和配置。

## 优化概览

QMS 系统采用多层次的性能优化策略：

1. **应用层优化** - Redis 缓存、数据库连接池
2. **数据库优化** - 索引优化、查询优化
3. **网关层优化** - Nginx 缓存、压缩、连接复用
4. **前端优化** - 静态资源缓存、代码分割、懒加载

## 1. Redis 缓存策略

### 缓存配置

参考 `backend/app/core/cache.py` 中的实现。

### 缓存键命名规范

```
{namespace}:{entity}:{identifier}
```

示例：
- `permissions:user:123` - 用户 123 的权限
- `feature_flags:all` - 所有功能开关
- `metrics:dashboard:user:456` - 用户 456 的仪表盘数据

### 缓存 TTL 配置

在 `.env.production` 中配置：

```bash
# 用户权限缓存（1小时）
CACHE_USER_PERMISSIONS_TTL=3600

# 功能开关缓存（5分钟）
CACHE_FEATURE_FLAGS_TTL=300

# 系统配置缓存（10分钟）
CACHE_SYSTEM_CONFIG_TTL=600

# 指标数据缓存（30分钟）
CACHE_METRICS_TTL=1800
```

### 缓存失效策略

**主动失效**：
- 用户权限变更时，立即失效该用户的权限缓存
- 功能开关更新时，失效所有功能开关缓存
- 系统配置修改时，失效对应配置缓存

**被动失效**：
- 通过 TTL 自动过期
- 适用于不需要实时更新的数据

### 缓存使用示例

```python
from app.core.cache import cache_service, CacheKey, cached

# 方式一：直接使用缓存服务
async def get_user_permissions(user_id: int):
    cache_key = CacheKey.user_permissions(user_id)
    
    # 尝试从缓存获取
    cached_permissions = await cache_service.get(cache_key)
    if cached_permissions:
        return cached_permissions
    
    # 从数据库查询
    permissions = await db.query(Permission).filter(
        Permission.user_id == user_id
    ).all()
    
    # 写入缓存
    await cache_service.set(
        cache_key,
        permissions,
        ttl=settings.CACHE_USER_PERMISSIONS_TTL
    )
    
    return permissions

# 方式二：使用装饰器
@cached(
    key_func=lambda user_id: f"user:{user_id}",
    ttl=3600
)
async def get_user(user_id: int):
    return await db.query(User).filter(User.id == user_id).first()
```

### 缓存监控

```bash
# 连接到 Redis
docker compose exec redis redis-cli

# 查看缓存键数量
DBSIZE

# 查看内存使用
INFO memory

# 查看命中率
INFO stats

# 查看所有权限相关的键
KEYS permissions:*

# 清空所有缓存（谨慎使用）
FLUSHDB
```

## 2. 数据库优化

### 索引策略

参考 `backend/alembic/versions/add_performance_indexes.py`。

#### 索引类型

1. **单列索引** - 高频查询字段
   ```sql
   CREATE INDEX idx_users_username ON users(username);
   ```

2. **组合索引** - 多字段联合查询
   ```sql
   CREATE INDEX idx_users_type_status ON users(user_type, status);
   ```

3. **唯一索引** - 保证数据唯一性
   ```sql
   CREATE UNIQUE INDEX idx_suppliers_code ON suppliers(code);
   ```

4. **全文索引** - 文本搜索（PostgreSQL GIN）
   ```sql
   CREATE INDEX idx_suppliers_name_gin 
   ON suppliers USING gin(to_tsvector('simple', name));
   ```

#### 索引维护

```sql
-- 查看表的索引
SELECT * FROM pg_indexes WHERE tablename = 'users';

-- 查看索引大小
SELECT
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC;

-- 查看未使用的索引
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
AND indexrelname NOT LIKE '%_pkey';

-- 重建索引（如果索引碎片化）
REINDEX INDEX idx_users_username;
```

### 查询优化

#### 使用 EXPLAIN ANALYZE

```sql
-- 分析查询性能
EXPLAIN ANALYZE
SELECT * FROM users
WHERE user_type = 'internal'
AND status = 'active';

-- 查看慢查询
SELECT
    query,
    calls,
    total_time,
    mean_time,
    max_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;
```

#### 优化建议

1. **避免 SELECT ***
   ```python
   # ❌ 不推荐
   users = await db.query(User).all()
   
   # ✅ 推荐
   users = await db.query(User.id, User.username, User.email).all()
   ```

2. **使用分页**
   ```python
   # 分页查询
   users = await db.query(User)\
       .offset((page - 1) * page_size)\
       .limit(page_size)\
       .all()
   ```

3. **批量操作**
   ```python
   # ❌ 不推荐：循环插入
   for user in users:
       db.add(user)
       await db.commit()
   
   # ✅ 推荐：批量插入
   db.add_all(users)
   await db.commit()
   ```

4. **使用 JOIN 代替多次查询**
   ```python
   # ❌ 不推荐：N+1 查询
   users = await db.query(User).all()
   for user in users:
       permissions = await db.query(Permission)\
           .filter(Permission.user_id == user.id).all()
   
   # ✅ 推荐：JOIN 查询
   results = await db.query(User, Permission)\
       .join(Permission, User.id == Permission.user_id)\
       .all()
   ```

### 连接池配置

在 `.env.production` 中配置：

```bash
# 连接池大小
DB_POOL_SIZE=20

# 最大溢出连接数
DB_MAX_OVERFLOW=10

# 连接超时（秒）
DB_POOL_TIMEOUT=30

# 连接回收时间（秒）
DB_POOL_RECYCLE=3600
```

### 数据库维护

```bash
# 定期执行 VACUUM（清理死元组）
docker compose exec postgres psql -U qms_user -d qms_db -c "VACUUM ANALYZE;"

# 查看表膨胀情况
docker compose exec postgres psql -U qms_user -d qms_db -c "
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) AS external_size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
"
```

## 3. Nginx 优化

### 缓存配置

Nginx 已配置代理缓存，缓存路径：`/var/cache/nginx/qms`

#### 缓存策略

- **API 响应**：不缓存（动态数据）
- **静态资源**：缓存 7 天（正式环境）/ 1 天（预览环境）
- **HTML 文件**：不缓存（确保获取最新版本）

#### 缓存管理

```bash
# 查看缓存大小
docker compose exec nginx du -sh /var/cache/nginx/qms

# 清空缓存
docker compose exec nginx rm -rf /var/cache/nginx/qms/*

# 查看缓存命中率（需要查看日志）
docker compose exec nginx grep "HIT" /var/log/nginx/access.log | wc -l
docker compose exec nginx grep "MISS" /var/log/nginx/access.log | wc -l
```

### 压缩配置

#### Gzip 压缩

已启用，压缩级别：6（平衡压缩率和 CPU 使用）

#### Brotli 压缩（可选）

如果 Nginx 编译时启用了 Brotli 模块，可以获得更好的压缩率：

```nginx
brotli on;
brotli_comp_level 6;
brotli_types text/plain text/css text/xml text/javascript 
             application/json application/javascript application/xml+rss;
```

### 连接优化

- **Keepalive 连接**：复用 TCP 连接，减少握手开销
- **HTTP/2**：多路复用，减少延迟
- **连接池**：上游服务器连接池（32 个连接）

### SSL/TLS 优化

```nginx
# SSL 会话缓存
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 10m;

# 启用 OCSP Stapling（可选）
ssl_stapling on;
ssl_stapling_verify on;
resolver 8.8.8.8 8.8.4.4 valid=300s;
resolver_timeout 5s;
```

## 4. 前端优化

### 构建优化

#### Vite 配置

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    // 代码分割
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['vue', 'vue-router', 'pinia'],
          'element-plus': ['element-plus'],
          'echarts': ['echarts']
        }
      }
    },
    // 压缩
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,  // 生产环境移除 console
        drop_debugger: true
      }
    },
    // 资源内联阈值
    assetsInlineLimit: 4096,
    // 启用 CSS 代码分割
    cssCodeSplit: true
  }
})
```

### 路由懒加载

```typescript
// router/index.ts
const routes = [
  {
    path: '/workbench',
    component: () => import('@/views/Workbench.vue')  // 懒加载
  },
  {
    path: '/supplier',
    component: () => import('@/views/SupplierDashboard.vue')
  }
]
```

### 组件懒加载

```vue
<script setup lang="ts">
import { defineAsyncComponent } from 'vue'

// 异步组件
const HeavyChart = defineAsyncComponent(() =>
  import('@/components/HeavyChart.vue')
)
</script>
```

### 图片优化

```vue
<template>
  <!-- 使用 WebP 格式 -->
  <picture>
    <source srcset="image.webp" type="image/webp">
    <img src="image.jpg" alt="描述" loading="lazy">
  </picture>
</template>
```

### 虚拟滚动

对于长列表，使用虚拟滚动：

```vue
<script setup lang="ts">
import { ElTableV2 } from 'element-plus'

// 使用 Element Plus 的虚拟表格
</script>
```

## 5. 性能监控

### 应用性能监控（APM）

#### Sentry 集成

在 `.env.production` 中配置：

```bash
SENTRY_DSN=https://your-sentry-dsn
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
```

#### 自定义监控

```python
import time
from functools import wraps

def monitor_performance(func):
    @wraps(func)
    async def wrapper(*args, **kwargs):
        start_time = time.time()
        result = await func(*args, **kwargs)
        duration = time.time() - start_time
        
        if duration > 1.0:  # 超过 1 秒记录警告
            logger.warning(f"{func.__name__} 执行时间: {duration:.2f}s")
        
        return result
    return wrapper
```

### 数据库性能监控

```sql
-- 启用 pg_stat_statements 扩展
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- 查看慢查询
SELECT
    query,
    calls,
    total_time,
    mean_time,
    max_time
FROM pg_stat_statements
WHERE mean_time > 100  -- 平均执行时间超过 100ms
ORDER BY mean_time DESC
LIMIT 20;
```

### Nginx 性能监控

```bash
# 查看连接数
docker compose exec nginx cat /var/run/nginx.pid | xargs ps -p

# 查看请求统计
docker compose exec nginx tail -f /var/log/nginx/access.log | \
    awk '{print $9}' | sort | uniq -c | sort -rn
```

## 6. 性能测试

### 压力测试

使用 Apache Bench (ab) 或 wrk：

```bash
# 安装 ab
sudo apt-get install apache2-utils

# 测试 API 性能
ab -n 1000 -c 10 https://qms.company.com/api/v1/health

# 使用 wrk（更强大）
wrk -t12 -c400 -d30s https://qms.company.com/api/v1/health
```

### 前端性能测试

使用 Lighthouse：

```bash
# 安装 Lighthouse
npm install -g lighthouse

# 运行测试
lighthouse https://qms.company.com --output html --output-path ./report.html
```

## 7. 性能优化检查清单

### 部署前检查

- [ ] Redis 缓存已启用
- [ ] 数据库索引已创建
- [ ] Nginx 压缩已启用
- [ ] 静态资源缓存已配置
- [ ] 前端代码已压缩
- [ ] 图片已优化
- [ ] SSL/TLS 已配置
- [ ] 连接池已优化
- [ ] 日志级别设置为 INFO 或 WARNING

### 运行时监控

- [ ] 监控 Redis 内存使用
- [ ] 监控数据库连接数
- [ ] 监控 API 响应时间
- [ ] 监控错误率
- [ ] 监控磁盘空间
- [ ] 监控 CPU 和内存使用

### 定期维护

- [ ] 每周检查慢查询日志
- [ ] 每月执行数据库 VACUUM
- [ ] 每季度审查未使用的索引
- [ ] 每季度进行性能测试
- [ ] 每半年审查缓存策略

## 8. 故障排查

### 性能问题诊断

#### API 响应慢

1. 检查数据库查询时间
2. 检查是否有 N+1 查询
3. 检查缓存是否生效
4. 检查网络延迟

#### 数据库连接耗尽

```bash
# 查看当前连接数
docker compose exec postgres psql -U qms_user -d qms_db -c "
SELECT count(*) FROM pg_stat_activity;
"

# 查看连接详情
docker compose exec postgres psql -U qms_user -d qms_db -c "
SELECT pid, usename, application_name, client_addr, state, query
FROM pg_stat_activity
WHERE datname = 'qms_db';
"

# 终止空闲连接
docker compose exec postgres psql -U qms_user -d qms_db -c "
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'qms_db'
AND state = 'idle'
AND state_change < current_timestamp - INTERVAL '10 minutes';
"
```

#### Redis 内存不足

```bash
# 查看内存使用
docker compose exec redis redis-cli INFO memory

# 清理过期键
docker compose exec redis redis-cli --scan --pattern "*" | \
    xargs docker compose exec redis redis-cli DEL

# 调整最大内存（redis.conf）
maxmemory 2gb
maxmemory-policy allkeys-lru
```

## 参考资料

- [PostgreSQL Performance Tuning](https://wiki.postgresql.org/wiki/Performance_Optimization)
- [Nginx Performance Tuning](https://www.nginx.com/blog/tuning-nginx/)
- [Redis Best Practices](https://redis.io/docs/manual/patterns/)
- [Vue.js Performance](https://vuejs.org/guide/best-practices/performance.html)
