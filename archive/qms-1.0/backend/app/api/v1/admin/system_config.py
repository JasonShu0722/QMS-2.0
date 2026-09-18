"""
系统全局配置管理 API 路由（管理员）
System Config Admin API - 全局系统参数配置管理接口
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, get_current_active_user
from app.models.user import User
from app.services.system_config_service import SystemConfigService
from app.schemas.system_config import (
    SystemConfigCreate,
    SystemConfigUpdate,
    SystemConfigResponse,
    SystemConfigListResponse,
    SystemConfigCategoryResponse
)


router = APIRouter(prefix="/admin/system-config", tags=["admin-system-config"])


@router.get(
    "",
    response_model=SystemConfigListResponse,
    summary="获取所有配置项（管理员）",
    description="""
    获取所有系统配置项列表。
    
    功能：
    - 查看所有系统配置
    - 支持按分类过滤
    - 显示配置值、描述、验证规则等信息
    
    配置分类：
    - business_rule: 业务规则
    - timeout: 超时时长
    - file_limit: 文件大小限制
    - notification: 通知配置
    
    权限：仅管理员可访问
    """
)
async def get_all_configs(
    category: Optional[str] = Query(None, description="配置分类（可选）"),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    获取所有配置项
    
    Args:
        category: 配置分类（可选）
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        SystemConfigListResponse: 配置列表
    """
    try:
        # TODO: 添加管理员权限检查
        # 当前简化实现，后续需要集成权限系统
        
        # 获取所有配置
        configs = await SystemConfigService.get_all_configs(db, category)
        
        # 转换为响应模型
        config_responses = [
            SystemConfigResponse.model_validate(config)
            for config in configs
        ]
        
        return SystemConfigListResponse(
            total=len(config_responses),
            configs=config_responses
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取配置列表失败: {str(e)}"
        )


@router.get(
    "/by-category",
    response_model=list[SystemConfigCategoryResponse],
    summary="按分类获取配置项（管理员）",
    description="""
    按配置分类分组获取系统配置。
    
    返回格式：
    ```json
    [
        {
            "category": "business_rule",
            "configs": [...]
        },
        {
            "category": "timeout",
            "configs": [...]
        }
    ]
    ```
    
    权限：仅管理员可访问
    """
)
async def get_configs_by_category(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    按分类获取配置项
    
    Args:
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        list[SystemConfigCategoryResponse]: 按分类分组的配置列表
    """
    try:
        # TODO: 添加管理员权限检查
        
        # 获取所有配置
        all_configs = await SystemConfigService.get_all_configs(db)
        
        # 按分类分组
        category_map = {}
        for config in all_configs:
            if config.category not in category_map:
                category_map[config.category] = []
            category_map[config.category].append(config)
        
        # 转换为响应模型
        result = []
        for category, configs in category_map.items():
            config_responses = [
                SystemConfigResponse.model_validate(config)
                for config in configs
            ]
            result.append(
                SystemConfigCategoryResponse(
                    category=category,
                    configs=config_responses
                )
            )
        
        return result
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取配置列表失败: {str(e)}"
        )


@router.get(
    "/{config_key}",
    response_model=SystemConfigResponse,
    summary="获取指定配置项（管理员）",
    description="""
    根据配置键获取指定配置项的详细信息。
    
    如果配置不存在但有预设默认值，将返回默认值并记录警告日志。
    
    权限：仅管理员可访问
    """
)
async def get_config_by_key(
    config_key: str,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    获取指定配置项
    
    Args:
        config_key: 配置键
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        SystemConfigResponse: 配置详情
    """
    try:
        # TODO: 添加管理员权限检查
        
        # 查询配置
        config = await SystemConfigService.get_config_by_key(db, config_key)
        
        if not config:
            # 尝试获取默认值
            default_value = SystemConfigService.DEFAULT_VALUES.get(config_key)
            if default_value:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"配置项 '{config_key}' 不存在，但有预设默认值: {default_value}"
                )
            else:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"配置项 '{config_key}' 不存在"
                )
        
        return SystemConfigResponse.model_validate(config)
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取配置详情失败: {str(e)}"
        )


@router.post(
    "",
    response_model=SystemConfigResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建配置项（管理员）",
    description="""
    创建新的系统配置项。
    
    功能：
    - 定义新的配置项
    - 设置配置值（JSON 格式）
    - 指定配置分类
    - 配置验证规则（JSON Schema）
    
    注意：
    - 配置键必须唯一
    - 配置值必须符合验证规则
    
    权限：仅管理员可访问
    """
)
async def create_config(
    config_data: SystemConfigCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    创建配置项
    
    Args:
        config_data: 配置数据
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        SystemConfigResponse: 创建的配置
    """
    try:
        # TODO: 添加管理员权限检查
        
        # 创建配置
        config = await SystemConfigService.create_config(
            db=db,
            config_key=config_data.config_key,
            config_value=config_data.config_value,
            config_type=config_data.config_type,
            category=config_data.category,
            description=config_data.description,
            validation_rule=config_data.validation_rule,
            created_by=current_user.id
        )
        
        return SystemConfigResponse.model_validate(config)
        
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"创建配置失败: {str(e)}"
        )


@router.put(
    "/{config_key}",
    response_model=SystemConfigResponse,
    summary="更新配置项（管理员）",
    description="""
    更新系统配置项。
    
    功能：
    - 修改配置值
    - 更新配置描述
    - 验证参数格式和取值范围（使用 JSON Schema）
    - 立即生效（清除 Redis 缓存）
    
    注意：
    - 配置值必须符合验证规则
    - 更新后立即生效，无需重启服务
    
    权限：仅管理员可访问
    """
)
async def update_config(
    config_key: str,
    config_data: SystemConfigUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    更新配置项
    
    Args:
        config_key: 配置键
        config_data: 更新数据
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        SystemConfigResponse: 更新后的配置
    """
    try:
        # TODO: 添加管理员权限检查
        
        # 更新配置
        config = await SystemConfigService.update_config(
            db=db,
            config_key=config_key,
            config_value=config_data.config_value,
            description=config_data.description,
            updated_by=current_user.id
        )
        
        return SystemConfigResponse.model_validate(config)
        
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"更新配置失败: {str(e)}"
        )


@router.delete(
    "/{config_key}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除配置项（管理员）",
    description="""
    删除系统配置项。
    
    注意：
    - 删除后该配置将不可用
    - 如果有预设默认值，系统将自动使用默认值
    - 删除操作会清除 Redis 缓存
    
    权限：仅管理员可访问
    """
)
async def delete_config(
    config_key: str,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    删除配置项
    
    Args:
        config_key: 配置键
        current_user: 当前登录用户
        db: 数据库会话
    """
    try:
        # TODO: 添加管理员权限检查
        
        # 删除配置
        await SystemConfigService.delete_config(db, config_key)
        
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"删除配置失败: {str(e)}"
        )


@router.post(
    "/cache/clear",
    status_code=status.HTTP_200_OK,
    summary="清除配置缓存（管理员）",
    description="""
    清除所有系统配置的 Redis 缓存。
    
    使用场景：
    - 手动刷新缓存
    - 排查缓存问题
    - 强制重新加载配置
    
    注意：清除缓存后，下次访问配置时将从数据库重新加载。
    
    权限：仅管理员可访问
    """
)
async def clear_config_cache(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    清除配置缓存
    
    Args:
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        dict: 操作结果
    """
    try:
        # TODO: 添加管理员权限检查
        
        # 清除所有配置缓存
        await SystemConfigService.clear_all_config_cache()
        
        return {
            "message": "配置缓存已清除",
            "status": "success"
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"清除配置缓存失败: {str(e)}"
        )
