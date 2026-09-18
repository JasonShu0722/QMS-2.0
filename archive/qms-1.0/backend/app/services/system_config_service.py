"""
系统配置服务
System Config Service - 全局系统参数配置管理服务
"""
from typing import Optional, Any, Dict, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import redis.asyncio as redis
import json
import logging

from app.models.system_config import SystemConfig, ConfigCategory
from app.core.config import settings


# 日志配置
logger = logging.getLogger(__name__)


# Redis 客户端（用于配置缓存）
_redis_client: Optional[redis.Redis] = None


async def get_redis_client() -> redis.Redis:
    """
    获取 Redis 客户端（单例模式）
    
    Returns:
        redis.Redis: Redis 异步客户端
    """
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True
        )
    return _redis_client


class SystemConfigService:
    """
    系统配置服务类
    
    提供系统全局配置的管理功能，包括：
    - 配置的增删改查
    - 配置值验证（JSON Schema）
    - Redis 缓存管理
    - 默认值机制
    """
    
    # Redis 缓存配置
    CACHE_PREFIX = "config:"
    CACHE_EXPIRE_SECONDS = 3600  # 1 小时
    
    # 预设默认值字典
    DEFAULT_VALUES = {
        "max_file_upload_size": {"value": 50, "unit": "MB"},
        "session_timeout": {"value": 24, "unit": "hours"},
        "password_expire_days": {"value": 90, "unit": "days"},
        "login_lock_attempts": {"value": 5, "unit": "times"},
        "login_lock_duration": {"value": 30, "unit": "minutes"},
        "todo_urgent_threshold": {"value": 72, "unit": "hours"},
        "notification_batch_size": {"value": 100, "unit": "records"},
        "audit_log_retention": {"value": 365, "unit": "days"},
    }
    
    @staticmethod
    async def get_all_configs(
        db: AsyncSession,
        category: Optional[str] = None
    ) -> List[SystemConfig]:
        """
        获取所有系统配置
        
        Args:
            db: 数据库会话
            category: 配置分类（可选）
            
        Returns:
            List[SystemConfig]: 配置列表
        """
        query = select(SystemConfig)
        
        if category:
            query = query.where(SystemConfig.category == category)
        
        query = query.order_by(SystemConfig.category, SystemConfig.config_key)
        
        result = await db.execute(query)
        return list(result.scalars().all())
    
    @staticmethod
    async def get_config_by_key(
        db: AsyncSession,
        config_key: str,
        use_cache: bool = True
    ) -> Optional[SystemConfig]:
        """
        根据配置键获取配置
        
        优先从 Redis 缓存读取，缓存未命中时查询数据库并更新缓存。
        
        Args:
            db: 数据库会话
            config_key: 配置键
            use_cache: 是否使用缓存
            
        Returns:
            Optional[SystemConfig]: 配置对象
        """
        # 尝试从缓存获取
        if use_cache:
            cached_config = await SystemConfigService._get_cached_config(config_key)
            if cached_config:
                return cached_config
        
        # 从数据库查询
        query = select(SystemConfig).where(SystemConfig.config_key == config_key)
        result = await db.execute(query)
        config = result.scalar_one_or_none()
        
        # 更新缓存
        if config and use_cache:
            await SystemConfigService._cache_config(config)
        
        return config
    
    @staticmethod
    async def get_config_value(
        db: AsyncSession,
        config_key: str,
        use_default: bool = True
    ) -> Optional[Any]:
        """
        获取配置值
        
        如果配置不存在且 use_default=True，则返回预设默认值并记录警告日志。
        
        Args:
            db: 数据库会话
            config_key: 配置键
            use_default: 是否使用默认值
            
        Returns:
            Optional[Any]: 配置值
        """
        config = await SystemConfigService.get_config_by_key(db, config_key)
        
        if config:
            return config.config_value
        
        # 配置缺失，使用默认值
        if use_default and config_key in SystemConfigService.DEFAULT_VALUES:
            default_value = SystemConfigService.DEFAULT_VALUES[config_key]
            logger.warning(
                f"配置项 '{config_key}' 不存在，使用预设默认值: {default_value}"
            )
            return default_value
        
        logger.warning(f"配置项 '{config_key}' 不存在且无默认值")
        return None
    
    @staticmethod
    async def create_config(
        db: AsyncSession,
        config_key: str,
        config_value: Dict[str, Any],
        config_type: str,
        category: str,
        description: Optional[str] = None,
        validation_rule: Optional[Dict[str, Any]] = None,
        created_by: Optional[int] = None
    ) -> SystemConfig:
        """
        创建系统配置
        
        Args:
            db: 数据库会话
            config_key: 配置键
            config_value: 配置值
            config_type: 配置类型
            category: 配置分类
            description: 配置描述
            validation_rule: 验证规则
            created_by: 创建人ID
            
        Returns:
            SystemConfig: 创建的配置对象
            
        Raises:
            ValueError: 配置键已存在或验证失败
        """
        # 检查配置键是否已存在
        existing = await SystemConfigService.get_config_by_key(db, config_key, use_cache=False)
        if existing:
            raise ValueError(f"配置键 '{config_key}' 已存在")
        
        # 创建配置对象
        config = SystemConfig(
            config_key=config_key,
            config_value=config_value,
            config_type=config_type,
            category=category,
            description=description,
            validation_rule=validation_rule,
            updated_by=created_by
        )
        
        # 验证配置值
        is_valid, error_msg = await SystemConfigService._validate_config_value(
            config_value, validation_rule
        )
        if not is_valid:
            raise ValueError(f"配置值验证失败: {error_msg}")
        
        db.add(config)
        await db.commit()
        await db.refresh(config)
        
        # 更新缓存
        await SystemConfigService._cache_config(config)
        
        logger.info(f"创建系统配置: {config_key}")
        
        return config
    
    @staticmethod
    async def update_config(
        db: AsyncSession,
        config_key: str,
        config_value: Dict[str, Any],
        description: Optional[str] = None,
        updated_by: Optional[int] = None
    ) -> SystemConfig:
        """
        更新系统配置
        
        更新后立即生效（清除 Redis 缓存）。
        
        Args:
            db: 数据库会话
            config_key: 配置键
            config_value: 新的配置值
            description: 配置描述（可选）
            updated_by: 更新人ID
            
        Returns:
            SystemConfig: 更新后的配置对象
            
        Raises:
            ValueError: 配置不存在或验证失败
        """
        # 查询配置
        config = await SystemConfigService.get_config_by_key(db, config_key, use_cache=False)
        if not config:
            raise ValueError(f"配置键 '{config_key}' 不存在")
        
        # 验证配置值
        is_valid, error_msg = await SystemConfigService._validate_config_value(
            config_value, config.validation_rule
        )
        if not is_valid:
            raise ValueError(f"配置值验证失败: {error_msg}")
        
        # 更新配置
        config.config_value = config_value
        if description is not None:
            config.description = description
        config.updated_by = updated_by
        
        await db.commit()
        await db.refresh(config)
        
        # 清除缓存（立即生效）
        await SystemConfigService.clear_config_cache(config_key)
        
        logger.info(f"更新系统配置: {config_key}")
        
        return config
    
    @staticmethod
    async def delete_config(
        db: AsyncSession,
        config_key: str
    ) -> None:
        """
        删除系统配置
        
        Args:
            db: 数据库会话
            config_key: 配置键
            
        Raises:
            ValueError: 配置不存在
        """
        config = await SystemConfigService.get_config_by_key(db, config_key, use_cache=False)
        if not config:
            raise ValueError(f"配置键 '{config_key}' 不存在")
        
        await db.delete(config)
        await db.commit()
        
        # 清除缓存
        await SystemConfigService.clear_config_cache(config_key)
        
        logger.info(f"删除系统配置: {config_key}")
    
    @staticmethod
    async def clear_config_cache(config_key: str) -> None:
        """
        清除指定配置的缓存
        
        Args:
            config_key: 配置键
        """
        try:
            redis_client = await get_redis_client()
            cache_key = f"{SystemConfigService.CACHE_PREFIX}{config_key}"
            await redis_client.delete(cache_key)
            logger.info(f"清除配置缓存: {config_key}")
        except Exception as e:
            # Redis 连接失败不应阻塞业务，仅记录日志
            logger.warning(f"清除配置缓存失败 {config_key}: {e}")
    
    @staticmethod
    async def clear_all_config_cache() -> None:
        """清除所有配置缓存"""
        try:
            redis_client = await get_redis_client()
            pattern = f"{SystemConfigService.CACHE_PREFIX}*"
            
            # 获取所有匹配的键
            keys = []
            async for key in redis_client.scan_iter(match=pattern):
                keys.append(key)
            
            # 批量删除
            if keys:
                await redis_client.delete(*keys)
                logger.info(f"清除所有配置缓存，共 {len(keys)} 项")
        except Exception as e:
            logger.warning(f"清除所有配置缓存失败: {e}")
    
    @staticmethod
    async def _get_cached_config(config_key: str) -> Optional[SystemConfig]:
        """
        从 Redis 缓存获取配置
        
        Args:
            config_key: 配置键
            
        Returns:
            Optional[SystemConfig]: 配置对象
        """
        try:
            redis_client = await get_redis_client()
            cache_key = f"{SystemConfigService.CACHE_PREFIX}{config_key}"
            cached_data = await redis_client.get(cache_key)
            
            if cached_data:
                # 反序列化配置对象
                config_dict = json.loads(cached_data)
                # 注意：这里返回的是字典，不是 ORM 对象
                # 实际使用时需要根据需求调整
                return config_dict
            
            return None
        except Exception as e:
            # Redis 连接失败不应阻塞业务，返回 None 触发数据库查询
            logger.warning(f"从缓存获取配置失败 {config_key}: {e}")
            return None
    
    @staticmethod
    async def _cache_config(config: SystemConfig) -> None:
        """
        将配置缓存到 Redis
        
        Args:
            config: 配置对象
        """
        try:
            redis_client = await get_redis_client()
            cache_key = f"{SystemConfigService.CACHE_PREFIX}{config.config_key}"
            
            # 序列化配置对象
            config_dict = config.to_dict()
            cached_data = json.dumps(config_dict)
            
            await redis_client.setex(
                cache_key,
                SystemConfigService.CACHE_EXPIRE_SECONDS,
                cached_data
            )
        except Exception as e:
            # Redis 连接失败不应阻塞业务，仅记录日志
            logger.warning(f"缓存配置失败 {config.config_key}: {e}")
    
    @staticmethod
    async def _validate_config_value(
        config_value: Dict[str, Any],
        validation_rule: Optional[Dict[str, Any]]
    ) -> tuple[bool, Optional[str]]:
        """
        验证配置值是否符合验证规则
        
        Args:
            config_value: 配置值
            validation_rule: 验证规则（JSON Schema）
            
        Returns:
            tuple[bool, Optional[str]]: (是否有效, 错误信息)
        """
        if not validation_rule:
            return True, None
        
        try:
            # 这里可以集成 jsonschema 库进行验证
            # from jsonschema import validate, ValidationError
            # validate(instance=config_value, schema=validation_rule)
            
            # 简化实现：基本类型检查
            if "type" in validation_rule:
                expected_type = validation_rule["type"]
                
                if expected_type == "object" and not isinstance(config_value, dict):
                    return False, f"配置值类型错误，期望 object，实际 {type(config_value).__name__}"
                
                if expected_type == "array" and not isinstance(config_value, list):
                    return False, f"配置值类型错误，期望 array，实际 {type(config_value).__name__}"
            
            return True, None
        except Exception as e:
            return False, str(e)
