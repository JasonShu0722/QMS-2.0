"""
Redis Cache Service
Redis 缓存服务

提供统一的缓存接口，用于性能优化
"""

import json
import pickle
from typing import Any, Optional, Callable
from functools import wraps
import redis.asyncio as redis
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)


class CacheService:
    """Redis 缓存服务"""
    
    def __init__(self):
        self.redis_client: Optional[redis.Redis] = None
        self._initialized = False
    
    async def initialize(self):
        """初始化 Redis 连接"""
        if self._initialized:
            return
        
        try:
            self.redis_client = await redis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=False,  # 使用 pickle 序列化
                max_connections=50
            )
            # 测试连接
            await self.redis_client.ping()
            self._initialized = True
            logger.info("Redis 缓存服务初始化成功")
        except Exception as e:
            logger.error(f"Redis 连接失败: {e}")
            self.redis_client = None
    
    async def close(self):
        """关闭 Redis 连接"""
        if self.redis_client:
            await self.redis_client.close()
            self._initialized = False
            logger.info("Redis 连接已关闭")
    
    async def get(self, key: str) -> Optional[Any]:
        """
        获取缓存值
        
        Args:
            key: 缓存键
            
        Returns:
            缓存值，如果不存在返回 None
        """
        if not self.redis_client:
            return None
        
        try:
            value = await self.redis_client.get(key)
            if value:
                return pickle.loads(value)
            return None
        except Exception as e:
            logger.warning(f"缓存读取失败 [{key}]: {e}")
            return None
    
    async def set(
        self,
        key: str,
        value: Any,
        ttl: Optional[int] = None
    ) -> bool:
        """
        设置缓存值
        
        Args:
            key: 缓存键
            value: 缓存值
            ttl: 过期时间（秒），None 表示永不过期
            
        Returns:
            是否设置成功
        """
        if not self.redis_client:
            return False
        
        try:
            serialized_value = pickle.dumps(value)
            if ttl:
                await self.redis_client.setex(key, ttl, serialized_value)
            else:
                await self.redis_client.set(key, serialized_value)
            return True
        except Exception as e:
            logger.warning(f"缓存写入失败 [{key}]: {e}")
            return False
    
    async def delete(self, key: str) -> bool:
        """
        删除缓存
        
        Args:
            key: 缓存键
            
        Returns:
            是否删除成功
        """
        if not self.redis_client:
            return False
        
        try:
            await self.redis_client.delete(key)
            return True
        except Exception as e:
            logger.warning(f"缓存删除失败 [{key}]: {e}")
            return False
    
    async def delete_pattern(self, pattern: str) -> int:
        """
        批量删除匹配模式的缓存
        
        Args:
            pattern: 匹配模式（如 "user:*"）
            
        Returns:
            删除的键数量
        """
        if not self.redis_client:
            return 0
        
        try:
            keys = []
            async for key in self.redis_client.scan_iter(match=pattern):
                keys.append(key)
            
            if keys:
                await self.redis_client.delete(*keys)
                logger.info(f"批量删除缓存: {len(keys)} 个键 (模式: {pattern})")
                return len(keys)
            return 0
        except Exception as e:
            logger.warning(f"批量删除缓存失败 [{pattern}]: {e}")
            return 0
    
    async def exists(self, key: str) -> bool:
        """
        检查缓存是否存在
        
        Args:
            key: 缓存键
            
        Returns:
            是否存在
        """
        if not self.redis_client:
            return False
        
        try:
            return await self.redis_client.exists(key) > 0
        except Exception as e:
            logger.warning(f"缓存检查失败 [{key}]: {e}")
            return False
    
    async def increment(self, key: str, amount: int = 1) -> Optional[int]:
        """
        递增计数器
        
        Args:
            key: 缓存键
            amount: 递增量
            
        Returns:
            递增后的值
        """
        if not self.redis_client:
            return None
        
        try:
            return await self.redis_client.incrby(key, amount)
        except Exception as e:
            logger.warning(f"计数器递增失败 [{key}]: {e}")
            return None
    
    async def expire(self, key: str, ttl: int) -> bool:
        """
        设置缓存过期时间
        
        Args:
            key: 缓存键
            ttl: 过期时间（秒）
            
        Returns:
            是否设置成功
        """
        if not self.redis_client:
            return False
        
        try:
            await self.redis_client.expire(key, ttl)
            return True
        except Exception as e:
            logger.warning(f"设置过期时间失败 [{key}]: {e}")
            return False


# 全局缓存实例
cache_service = CacheService()


# 缓存键生成器
class CacheKey:
    """缓存键命名空间"""
    
    @staticmethod
    def user_permissions(user_id: int) -> str:
        """用户权限缓存键"""
        return f"permissions:user:{user_id}"
    
    @staticmethod
    def feature_flags() -> str:
        """功能开关缓存键"""
        return "feature_flags:all"
    
    @staticmethod
    def feature_flag(feature_key: str) -> str:
        """单个功能开关缓存键"""
        return f"feature_flags:{feature_key}"
    
    @staticmethod
    def system_config(config_key: str) -> str:
        """系统配置缓存键"""
        return f"system_config:{config_key}"
    
    @staticmethod
    def metrics_dashboard(user_id: int) -> str:
        """指标仪表盘缓存键"""
        return f"metrics:dashboard:user:{user_id}"
    
    @staticmethod
    def supplier_performance(supplier_id: int, month: str) -> str:
        """供应商绩效缓存键"""
        return f"supplier:performance:{supplier_id}:{month}"
    
    @staticmethod
    def user_todos(user_id: int) -> str:
        """用户待办任务缓存键"""
        return f"todos:user:{user_id}"
    
    @staticmethod
    def notification_count(user_id: int) -> str:
        """未读消息数量缓存键"""
        return f"notifications:unread:user:{user_id}"


# 缓存装饰器
def cached(
    key_func: Callable,
    ttl: Optional[int] = None,
    key_prefix: str = ""
):
    """
    缓存装饰器
    
    Args:
        key_func: 生成缓存键的函数
        ttl: 过期时间（秒）
        key_prefix: 缓存键前缀
        
    Example:
        @cached(
            key_func=lambda user_id: f"user:{user_id}",
            ttl=3600
        )
        async def get_user(user_id: int):
            return await db.query(User).filter(User.id == user_id).first()
    """
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # 生成缓存键
            cache_key = key_prefix + key_func(*args, **kwargs)
            
            # 尝试从缓存获取
            cached_value = await cache_service.get(cache_key)
            if cached_value is not None:
                logger.debug(f"缓存命中: {cache_key}")
                return cached_value
            
            # 执行原函数
            result = await func(*args, **kwargs)
            
            # 写入缓存
            if result is not None:
                await cache_service.set(cache_key, result, ttl)
                logger.debug(f"缓存写入: {cache_key}")
            
            return result
        
        return wrapper
    return decorator


# 缓存失效辅助函数
async def invalidate_user_cache(user_id: int):
    """使用户相关缓存失效"""
    await cache_service.delete_pattern(f"*:user:{user_id}*")
    logger.info(f"用户缓存已失效: user_id={user_id}")


async def invalidate_supplier_cache(supplier_id: int):
    """使供应商相关缓存失效"""
    await cache_service.delete_pattern(f"supplier:*:{supplier_id}*")
    logger.info(f"供应商缓存已失效: supplier_id={supplier_id}")


async def invalidate_feature_flags_cache():
    """使功能开关缓存失效"""
    await cache_service.delete_pattern("feature_flags:*")
    logger.info("功能开关缓存已失效")


async def invalidate_system_config_cache():
    """使系统配置缓存失效"""
    await cache_service.delete_pattern("system_config:*")
    logger.info("系统配置缓存已失效")
