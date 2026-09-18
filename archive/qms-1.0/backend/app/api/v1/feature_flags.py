"""
功能特性开关 API 路由（用户）
Feature Flags User API - 用户查询可用功能接口
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User, UserType
from app.services.feature_flag_service import FeatureFlagService
from app.schemas.feature_flag import (
    UserEnabledFeaturesResponse,
    FeatureFlagCheckRequest,
    FeatureFlagCheckResponse
)


router = APIRouter(prefix="/feature-flags", tags=["feature-flags"])


@router.get(
    "/my-features",
    response_model=UserEnabledFeaturesResponse,
    summary="获取当前用户可用功能列表",
    description="""
    获取当前登录用户可以访问的功能列表。
    
    功能：
    - 根据用户ID和供应商ID检查所有功能开关
    - 返回启用的功能键列表
    - 前端根据此列表动态渲染菜单和功能按钮
    
    应用场景：
    - 前端初始化时调用，获取用户权限范围
    - 灰度发布：仅白名单用户看到新功能
    - 功能降级：紧急情况下快速关闭某功能
    """
)
async def get_my_features(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    获取当前用户可用功能列表
    
    Args:
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        UserEnabledFeaturesResponse: 用户可用功能列表
    """
    try:
        # 获取供应商ID（如果是供应商用户）
        supplier_id = None
        if current_user.user_type == UserType.SUPPLIER:
            supplier_id = current_user.supplier_id
        
        # 获取启用的功能列表
        enabled_features = await FeatureFlagService.get_user_enabled_features(
            db=db,
            user_id=current_user.id,
            supplier_id=supplier_id,
            environment=settings.ENVIRONMENT,
        )
        
        return UserEnabledFeaturesResponse(
            user_id=current_user.id,
            enabled_features=enabled_features
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取可用功能列表失败: {str(e)}"
        )


@router.post(
    "/check",
    response_model=FeatureFlagCheckResponse,
    summary="检查功能是否启用",
    description="""
    检查指定功能是否对当前用户启用。
    
    功能：
    - 实时检查功能开关状态
    - 支持指定用户ID和供应商ID
    - 支持指定环境（stable/preview）
    
    应用场景：
    - 前端在访问特定功能前进行权限检查
    - 后端在执行敏感操作前进行二次验证
    """
)
async def check_feature_enabled(
    check_request: FeatureFlagCheckRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    检查功能是否启用
    
    Args:
        check_request: 检查请求
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        FeatureFlagCheckResponse: 检查结果
    """
    try:
        # 使用请求中的用户ID，如果未提供则使用当前用户ID
        user_id = check_request.user_id or current_user.id
        
        # 使用请求中的供应商ID，如果未提供且当前用户是供应商则使用当前用户的供应商ID
        supplier_id = check_request.supplier_id
        if supplier_id is None and current_user.user_type == UserType.SUPPLIER:
            supplier_id = current_user.supplier_id
        
        # 检查功能是否启用
        is_enabled = await FeatureFlagService.is_feature_enabled(
            db=db,
            feature_key=check_request.feature_key,
            user_id=user_id,
            supplier_id=supplier_id,
            environment=check_request.environment
        )
        
        return FeatureFlagCheckResponse(
            feature_key=check_request.feature_key,
            is_enabled=is_enabled
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"检查功能状态失败: {str(e)}"
        )
