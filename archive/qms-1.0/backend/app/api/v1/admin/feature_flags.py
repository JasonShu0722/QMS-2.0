"""
功能特性开关管理 API 路由（管理员）
Feature Flags Admin API - 灰度发布与功能控制管理接口
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.platform_admin import get_current_platform_admin
from app.models.user import User
from app.services.feature_flag_service import FeatureFlagService
from app.schemas.feature_flag import (
    FeatureFlagCreate,
    FeatureFlagUpdate,
    FeatureFlagResponse,
    FeatureFlagListResponse
)


router = APIRouter(prefix="/admin/feature-flags", tags=["admin-feature-flags"])


@router.get(
    "",
    response_model=FeatureFlagListResponse,
    summary="获取功能开关列表（管理员）",
    description="""
    获取所有功能开关配置列表。
    
    功能：
    - 查看所有功能开关的配置状态
    - 支持按环境过滤（stable/preview）
    - 显示开关状态、作用域、白名单配置
    
    权限：仅管理员可访问
    """
)
async def get_feature_flags(
    environment: Optional[str] = Query(None, description="环境标识（stable/preview）"),
    current_user: User = Depends(get_current_platform_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    获取功能开关列表
    
    Args:
        environment: 环境标识（可选）
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        FeatureFlagListResponse: 功能开关列表
    """
    try:
        # TODO: 添加管理员权限检查
        # 当前简化实现，后续需要集成权限系统
        
        # 获取所有功能开关
        flags = await FeatureFlagService.get_all_feature_flags(db, environment)
        
        # 转换为响应模型
        flag_responses = [
            FeatureFlagResponse.model_validate(flag)
            for flag in flags
        ]
        
        return FeatureFlagListResponse(
            total=len(flag_responses),
            feature_flags=flag_responses
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取功能开关列表失败: {str(e)}"
        )


@router.post(
    "",
    response_model=FeatureFlagResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建功能开关（管理员）",
    description="""
    创建新的功能开关配置。
    
    功能：
    - 定义新功能的开关配置
    - 设置作用域（全局/白名单）
    - 配置白名单用户/供应商
    - 指定环境（stable/preview）
    
    权限：仅管理员可访问
    """
)
async def create_feature_flag(
    flag_data: FeatureFlagCreate,
    current_user: User = Depends(get_current_platform_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    创建功能开关
    
    Args:
        flag_data: 功能开关数据
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        FeatureFlagResponse: 创建的功能开关
    """
    try:
        # TODO: 添加管理员权限检查
        
        # 创建功能开关
        flag = await FeatureFlagService.create_feature_flag(
            db=db,
            feature_key=flag_data.feature_key,
            feature_name=flag_data.feature_name,
            description=flag_data.description,
            is_enabled=flag_data.is_enabled,
            scope=flag_data.scope,
            whitelist_user_ids=flag_data.whitelist_user_ids,
            whitelist_supplier_ids=flag_data.whitelist_supplier_ids,
            environment=flag_data.environment,
            created_by=current_user.id
        )
        
        return FeatureFlagResponse.model_validate(flag)
        
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"创建功能开关失败: {str(e)}"
        )


@router.get(
    "/{feature_flag_id}",
    response_model=FeatureFlagResponse,
    summary="获取功能开关详情（管理员）",
    description="""
    获取指定功能开关的详细配置。
    
    权限：仅管理员可访问
    """
)
async def get_feature_flag(
    feature_flag_id: int,
    current_user: User = Depends(get_current_platform_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    获取功能开关详情
    
    Args:
        feature_flag_id: 功能开关ID
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        FeatureFlagResponse: 功能开关详情
    """
    try:
        # TODO: 添加管理员权限检查
        
        from sqlalchemy import select
        from app.models.feature_flag import FeatureFlag
        
        # 查询功能开关
        query = select(FeatureFlag).where(FeatureFlag.id == feature_flag_id)
        result = await db.execute(query)
        flag = result.scalar_one_or_none()
        
        if not flag:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="功能开关不存在"
            )
        
        return FeatureFlagResponse.model_validate(flag)
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取功能开关详情失败: {str(e)}"
        )


@router.put(
    "/{feature_flag_id}",
    response_model=FeatureFlagResponse,
    summary="更新功能开关（管理员）",
    description="""
    更新功能开关配置。
    
    功能：
    - 启用/禁用功能
    - 切换作用域（全局/白名单）
    - 更新白名单配置
    - 切换环境（stable/preview）
    - 立即生效，无需重启服务
    
    权限：仅管理员可访问
    """
)
async def update_feature_flag(
    feature_flag_id: int,
    flag_data: FeatureFlagUpdate,
    current_user: User = Depends(get_current_platform_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    更新功能开关
    
    Args:
        feature_flag_id: 功能开关ID
        flag_data: 更新数据
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        FeatureFlagResponse: 更新后的功能开关
    """
    try:
        # TODO: 添加管理员权限检查
        
        from sqlalchemy import select
        from app.models.feature_flag import FeatureFlag
        
        # 查询功能开关
        query = select(FeatureFlag).where(FeatureFlag.id == feature_flag_id)
        result = await db.execute(query)
        flag = result.scalar_one_or_none()
        
        if not flag:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="功能开关不存在"
            )
        
        # 更新功能开关
        updated_flag = await FeatureFlagService.update_feature_flag(
            db=db,
            feature_key=flag.feature_key,
            is_enabled=flag_data.is_enabled,
            scope=flag_data.scope,
            whitelist_user_ids=flag_data.whitelist_user_ids,
            whitelist_supplier_ids=flag_data.whitelist_supplier_ids,
            environment=flag_data.environment,
            updated_by=current_user.id
        )
        
        return FeatureFlagResponse.model_validate(updated_flag)
        
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"更新功能开关失败: {str(e)}"
        )


@router.delete(
    "/{feature_flag_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除功能开关（管理员）",
    description="""
    删除功能开关配置。
    
    注意：删除后该功能将对所有用户不可见。
    
    权限：仅管理员可访问
    """
)
async def delete_feature_flag(
    feature_flag_id: int,
    current_user: User = Depends(get_current_platform_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    删除功能开关
    
    Args:
        feature_flag_id: 功能开关ID
        current_user: 当前登录用户
        db: 数据库会话
    """
    try:
        # TODO: 添加管理员权限检查
        
        from sqlalchemy import select, delete
        from app.models.feature_flag import FeatureFlag
        
        # 查询功能开关
        query = select(FeatureFlag).where(FeatureFlag.id == feature_flag_id)
        result = await db.execute(query)
        flag = result.scalar_one_or_none()
        
        if not flag:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="功能开关不存在"
            )
        
        # 删除功能开关
        delete_query = delete(FeatureFlag).where(FeatureFlag.id == feature_flag_id)
        await db.execute(delete_query)
        await db.commit()
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"删除功能开关失败: {str(e)}"
        )
