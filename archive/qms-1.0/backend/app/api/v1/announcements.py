"""
公告管理 API 路由
Announcements API - 系统公告、质量预警、文件更新通知接口
"""
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func, and_, or_

from app.core.database import get_db
from app.core.dependencies import get_current_user, get_current_active_user
from app.models.user import User, UserType
from app.models.announcement import Announcement
from app.models.announcement_read_log import AnnouncementReadLog
from app.schemas.announcement import (
    AnnouncementCreate,
    AnnouncementUpdate,
    AnnouncementResponse,
    AnnouncementListResponse,
    AnnouncementReadResponse,
    AnnouncementStatisticsResponse,
    UserReadInfo
)


router = APIRouter(prefix="/announcements", tags=["announcements"])


@router.get(
    "/unread-important",
    response_model=list[AnnouncementResponse],
    summary="获取未读重要公告",
    description="""
    获取当前用户未读的重要公告列表。
    
    功能：
    - 仅返回 importance=important 且未过期的激活公告
    - 排除当前用户已阅读的公告
    - 用于登录后弹窗强制阅读重要公告
    
    注：此接口必须放在 /{announcement_id}/read 路由之前，
    否则 FastAPI 会将 "unread-important" 当作 announcement_id 匹配。
    """
)
async def get_unread_important_announcements(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    获取当前用户未读的重要公告

    Args:
        current_user: 当前登录用户
        db: 数据库会话

    Returns:
        list[AnnouncementResponse]: 未读重要公告列表
    """
    try:
        # 查询当前用户已读的公告 ID 集合
        read_ids_query = select(AnnouncementReadLog.announcement_id).where(
            AnnouncementReadLog.user_id == current_user.id
        )
        read_ids_result = await db.execute(read_ids_query)
        read_announcement_ids = {row[0] for row in read_ids_result.all()}

        # 查询重要且未过期的激活公告
        query = select(Announcement).where(
            and_(
                Announcement.is_active == True,
                Announcement.importance == "important",
                or_(
                    Announcement.expires_at.is_(None),
                    Announcement.expires_at > datetime.utcnow()
                )
            )
        ).order_by(desc(Announcement.published_at))

        result = await db.execute(query)
        announcements = result.scalars().all()

        # 过滤掉已读的公告
        unread_announcements = [
            AnnouncementResponse(
                id=a.id,
                title=a.title,
                content=a.content,
                announcement_type=a.announcement_type,
                importance=a.importance,
                is_active=a.is_active,
                published_at=a.published_at,
                expires_at=a.expires_at,
                created_at=a.created_at,
                updated_at=a.updated_at,
                created_by=a.created_by,
                is_read=False
            )
            for a in announcements
            if a.id not in read_announcement_ids
        ]

        return unread_announcements

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取未读重要公告失败: {str(e)}"
        )

@router.get(
    "",
    response_model=AnnouncementListResponse,
    summary="获取公告列表",
    description="""
    获取系统公告列表。
    
    功能：
    - 按发布时间倒序排列
    - 自动过滤有效期内的公告（未过期或无过期时间）
    - 自动过滤已激活的公告
    - 支持分页查询
    - 返回当前用户的阅读状态
    
    公告类型：
    - system: 系统公告（维护通知）
    - quality_warning: 质量预警
    - document_update: 体系文件更新通知
    """
)
async def get_announcements(
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    获取公告列表
    
    Args:
        page: 页码（从1开始）
        page_size: 每页数量（1-100）
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        AnnouncementListResponse: 公告列表
    """
    try:
        # 构建查询：仅返回激活且未过期的公告
        query = select(Announcement).where(
            and_(
                Announcement.is_active == True,
                or_(
                    Announcement.expires_at.is_(None),
                    Announcement.expires_at > datetime.utcnow()
                )
            )
        )
        
        # 按发布时间倒序
        query = query.order_by(desc(Announcement.published_at))
        
        # 执行查询获取总数
        count_result = await db.execute(
            select(func.count()).select_from(
                query.subquery()
            )
        )
        total = count_result.scalar() or 0
        
        # 分页
        offset = (page - 1) * page_size
        query = query.offset(offset).limit(page_size)
        
        # 执行分页查询
        result = await db.execute(query)
        announcements = result.scalars().all()
        
        # 查询当前用户的阅读记录
        announcement_ids = [a.id for a in announcements]
        if announcement_ids:
            read_logs_query = select(AnnouncementReadLog).where(
                and_(
                    AnnouncementReadLog.user_id == current_user.id,
                    AnnouncementReadLog.announcement_id.in_(announcement_ids)
                )
            )
            read_logs_result = await db.execute(read_logs_query)
            read_logs = read_logs_result.scalars().all()
            read_announcement_ids = {log.announcement_id for log in read_logs}
        else:
            read_announcement_ids = set()
        
        # 转换为响应模型，添加阅读状态
        announcement_responses = []
        for announcement in announcements:
            response_dict = {
                "id": announcement.id,
                "title": announcement.title,
                "content": announcement.content,
                "announcement_type": announcement.announcement_type,
                "importance": announcement.importance,
                "is_active": announcement.is_active,
                "published_at": announcement.published_at,
                "expires_at": announcement.expires_at,
                "created_at": announcement.created_at,
                "updated_at": announcement.updated_at,
                "created_by": announcement.created_by,
                "is_read": announcement.id in read_announcement_ids
            }
            announcement_responses.append(AnnouncementResponse(**response_dict))
        
        return AnnouncementListResponse(
            total=total,
            announcements=announcement_responses
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取公告列表失败: {str(e)}"
        )


@router.post(
    "/{announcement_id}/read",
    response_model=AnnouncementReadResponse,
    summary="记录公告阅读",
    description="""
    记录用户对公告的阅读确认。
    
    功能：
    - 创建阅读记录（user_id, announcement_id, read_at）
    - 防重复：同一用户对同一公告只能记录一次
    - 用于统计阅读率和实现强制阅读机制
    """
)
async def mark_announcement_as_read(
    announcement_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    记录公告阅读
    
    Args:
        announcement_id: 公告ID
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        AnnouncementReadResponse: 记录结果
    """
    try:
        # 验证公告是否存在
        announcement_query = select(Announcement).where(Announcement.id == announcement_id)
        announcement_result = await db.execute(announcement_query)
        announcement = announcement_result.scalar_one_or_none()
        
        if not announcement:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="公告不存在"
            )
        
        # 检查是否已经阅读过
        existing_log_query = select(AnnouncementReadLog).where(
            and_(
                AnnouncementReadLog.announcement_id == announcement_id,
                AnnouncementReadLog.user_id == current_user.id
            )
        )
        existing_log_result = await db.execute(existing_log_query)
        existing_log = existing_log_result.scalar_one_or_none()
        
        if existing_log:
            return AnnouncementReadResponse(
                success=True,
                message="该公告已标记为已读"
            )
        
        # 创建阅读记录
        read_log = AnnouncementReadLog(
            announcement_id=announcement_id,
            user_id=current_user.id,
            read_at=datetime.utcnow()
        )
        db.add(read_log)
        await db.commit()
        
        return AnnouncementReadResponse(
            success=True,
            message="公告已标记为已读"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"记录阅读失败: {str(e)}"
        )


# ==================== 管理员接口 ====================

@router.post(
    "/admin/announcements",
    response_model=AnnouncementResponse,
    summary="创建公告（管理员）",
    description="""
    创建系统公告。
    
    功能：
    - 设置公告类型（system/quality_warning/document_update）
    - 设置重要性标记（normal/important）
    - 设置有效期（可选）
    - 自动记录创建人
    - 自动设置发布时间
    
    权限：仅管理员可访问
    """
)
async def create_announcement(
    announcement_data: AnnouncementCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    创建公告
    
    Args:
        announcement_data: 公告数据
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        AnnouncementResponse: 创建的公告
    """
    try:
        # TODO: 添加管理员权限检查
        # 当前简化实现，后续需要集成权限系统
        
        # 验证公告类型
        valid_types = ["system", "quality_warning", "document_update"]
        if announcement_data.announcement_type not in valid_types:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"无效的公告类型，必须是: {', '.join(valid_types)}"
            )
        
        # 验证重要性
        valid_importance = ["normal", "important"]
        if announcement_data.importance not in valid_importance:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"无效的重要性标记，必须是: {', '.join(valid_importance)}"
            )
        
        # 创建公告
        announcement = Announcement(
            title=announcement_data.title,
            content=announcement_data.content,
            announcement_type=announcement_data.announcement_type,
            importance=announcement_data.importance,
            expires_at=announcement_data.expires_at,
            is_active=True,
            published_at=datetime.utcnow(),
            created_by=current_user.id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        db.add(announcement)
        await db.commit()
        await db.refresh(announcement)
        
        # 转换为响应模型
        response_dict = {
            "id": announcement.id,
            "title": announcement.title,
            "content": announcement.content,
            "announcement_type": announcement.announcement_type,
            "importance": announcement.importance,
            "is_active": announcement.is_active,
            "published_at": announcement.published_at,
            "expires_at": announcement.expires_at,
            "created_at": announcement.created_at,
            "updated_at": announcement.updated_at,
            "created_by": announcement.created_by,
            "is_read": None  # 新创建的公告没有阅读状态
        }
        
        return AnnouncementResponse(**response_dict)
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"创建公告失败: {str(e)}"
        )


@router.get(
    "/admin/announcements/{announcement_id}/statistics",
    response_model=AnnouncementStatisticsResponse,
    summary="查看公告阅读统计（管理员）",
    description="""
    查看公告的阅读统计信息。
    
    功能：
    - 统计已读人数、未读人数
    - 计算阅读率
    - 返回已读用户清单（包含用户名、姓名、阅读时间）
    
    权限：仅管理员可访问
    """
)
async def get_announcement_statistics(
    announcement_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    查看公告阅读统计
    
    Args:
        announcement_id: 公告ID
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        AnnouncementStatisticsResponse: 阅读统计
    """
    try:
        # TODO: 添加管理员权限检查
        
        # 验证公告是否存在
        announcement_query = select(Announcement).where(Announcement.id == announcement_id)
        announcement_result = await db.execute(announcement_query)
        announcement = announcement_result.scalar_one_or_none()
        
        if not announcement:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="公告不存在"
            )
        
        # 统计总用户数（激活状态的用户）
        from app.models.user import UserStatus
        total_users_query = select(func.count(User.id)).where(
            User.status == UserStatus.ACTIVE
        )
        total_users_result = await db.execute(total_users_query)
        total_users = total_users_result.scalar() or 0
        
        # 查询已读用户清单
        read_logs_query = select(
            AnnouncementReadLog,
            User
        ).join(
            User,
            AnnouncementReadLog.user_id == User.id
        ).where(
            AnnouncementReadLog.announcement_id == announcement_id
        ).order_by(
            desc(AnnouncementReadLog.read_at)
        )
        
        read_logs_result = await db.execute(read_logs_query)
        read_logs_with_users = read_logs_result.all()
        
        # 构建已读用户清单
        read_users = []
        for read_log, user in read_logs_with_users:
            read_users.append({
                "user_id": user.id,
                "username": user.username,
                "full_name": user.full_name,
                "read_at": read_log.read_at
            })
        
        # 计算统计数据
        read_count = len(read_users)
        unread_count = total_users - read_count
        read_rate = (read_count / total_users * 100) if total_users > 0 else 0.0
        
        return AnnouncementStatisticsResponse(
            announcement_id=announcement.id,
            announcement_title=announcement.title,
            total_users=total_users,
            read_count=read_count,
            unread_count=unread_count,
            read_rate=round(read_rate, 2),
            read_users=read_users
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取阅读统计失败: {str(e)}"
        )
