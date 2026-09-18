"""
通知管理 API 路由
Notifications API - 站内信通知查询与管理接口
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.models.notification import Notification
from app.schemas.notification import (
    NotificationListResponse,
    NotificationResponse,
    UnreadCountResponse,
    MarkReadResponse
)
from app.services.notification_service import notification_hub


router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get(
    "",
    response_model=NotificationListResponse,
    summary="获取站内信列表",
    description="""
    获取当前用户的站内信通知列表。
    
    功能：
    - 支持按消息类型筛选
    - 支持分页查询
    - 按创建时间倒序排列（最新的在前）
    
    消息类型：
    - workflow_exception: 流程异常通知
    - system_alert: 系统提醒
    - warning: 预警通知
    """
)
async def get_notifications(
    message_type: Optional[str] = Query(None, description="消息类型筛选"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    获取站内信列表
    
    Args:
        message_type: 消息类型筛选（可选）
        page: 页码（从1开始）
        page_size: 每页数量（1-100）
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        NotificationListResponse: 通知列表
    """
    try:
        # 构建查询
        query = select(Notification).where(
            Notification.user_id == current_user.id
        )
        
        # 按消息类型筛选
        if message_type:
            query = query.where(Notification.message_type == message_type)
        
        # 按创建时间倒序
        query = query.order_by(desc(Notification.created_at))
        
        # 执行查询获取总数
        count_result = await db.execute(query)
        all_notifications = count_result.scalars().all()
        total = len(all_notifications)
        
        # 分页
        offset = (page - 1) * page_size
        query = query.offset(offset).limit(page_size)
        
        # 执行分页查询
        result = await db.execute(query)
        notifications = result.scalars().all()
        
        # 转换为响应模型
        notification_responses = [
            NotificationResponse.model_validate(notification)
            for notification in notifications
        ]
        
        return NotificationListResponse(
            total=total,
            notifications=notification_responses
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取通知列表失败: {str(e)}"
        )


@router.get(
    "/unread-count",
    response_model=UnreadCountResponse,
    summary="获取未读消息数量",
    description="""
    获取当前用户的未读消息数量。
    
    用途：
    - 右上角铃铛图标红点数字显示
    - 个人中心未读消息提醒
    """
)
async def get_unread_count(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    获取未读消息数量
    
    Args:
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        UnreadCountResponse: 未读消息数量
    """
    try:
        unread_count = await notification_hub.get_unread_count(db, current_user.id)
        
        return UnreadCountResponse(unread_count=unread_count)
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取未读消息数量失败: {str(e)}"
        )


@router.put(
    "/{notification_id}/read",
    response_model=MarkReadResponse,
    summary="标记单条消息为已读",
    description="""
    标记指定的站内信为已读状态。
    
    功能：
    - 更新 is_read 为 true
    - 记录 read_at 时间戳
    - 权限验证：只能标记自己的消息
    """
)
async def mark_notification_as_read(
    notification_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    标记单条消息为已读
    
    Args:
        notification_id: 通知ID
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        MarkReadResponse: 标记结果
    """
    try:
        success = await notification_hub.mark_as_read(
            db,
            notification_id,
            current_user.id
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="通知不存在或无权访问"
            )
        
        return MarkReadResponse(
            success=True,
            message="消息已标记为已读",
            affected_count=1
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"标记消息失败: {str(e)}"
        )


@router.put(
    "/read-all",
    response_model=MarkReadResponse,
    summary="一键标记全部已读",
    description="""
    将当前用户的所有未读消息标记为已读。
    
    功能：
    - 批量更新所有未读消息
    - 返回影响的消息数量
    - 用于"一键清空"功能
    """
)
async def mark_all_as_read(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    一键标记全部已读
    
    Args:
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        MarkReadResponse: 标记结果
    """
    try:
        affected_count = await notification_hub.mark_all_as_read(
            db,
            current_user.id
        )
        
        return MarkReadResponse(
            success=True,
            message=f"已标记 {affected_count} 条消息为已读",
            affected_count=affected_count
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"批量标记失败: {str(e)}"
        )
