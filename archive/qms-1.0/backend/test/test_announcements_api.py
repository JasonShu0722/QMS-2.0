"""
测试公告管理 API
Test Announcements API
"""
import pytest
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.announcement import Announcement
from app.models.announcement_read_log import AnnouncementReadLog
from app.models.user import User, UserType, UserStatus


@pytest.mark.asyncio
async def test_create_announcement(db_session: AsyncSession):
    """测试创建公告"""
    # 创建管理员用户
    admin_user = User(
        username="admin_user",
        hashed_password="hashed_password",
        full_name="Admin User",
        email="admin@test.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE
    )
    db_session.add(admin_user)
    await db_session.commit()
    await db_session.refresh(admin_user)
    
    # 创建公告
    announcement = Announcement(
        title="系统维护通知",
        content="系统将于今晚22:00进行维护",
        announcement_type="system",
        importance="important",
        expires_at=datetime.utcnow() + timedelta(days=7),
        is_active=True,
        published_at=datetime.utcnow(),
        created_by=admin_user.id
    )
    db_session.add(announcement)
    await db_session.commit()
    await db_session.refresh(announcement)
    
    # 验证公告创建成功
    assert announcement.id is not None
    assert announcement.title == "系统维护通知"
    assert announcement.announcement_type == "system"
    assert announcement.importance == "important"
    assert announcement.is_active is True


@pytest.mark.asyncio
async def test_get_announcements_list(db_session: AsyncSession):
    """测试获取公告列表"""
    # 创建测试用户
    user = User(
        username="test_user",
        hashed_password="hashed_password",
        full_name="Test User",
        email="test@test.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    
    # 创建多个公告
    announcements_data = [
        {
            "title": "质量预警",
            "content": "供应商A的不良率超标",
            "announcement_type": "quality_warning",
            "importance": "important"
        },
        {
            "title": "文件更新",
            "content": "质量手册已更新",
            "announcement_type": "document_update",
            "importance": "normal"
        },
        {
            "title": "系统公告",
            "content": "新功能上线",
            "announcement_type": "system",
            "importance": "normal"
        }
    ]
    
    for data in announcements_data:
        announcement = Announcement(
            title=data["title"],
            content=data["content"],
            announcement_type=data["announcement_type"],
            importance=data["importance"],
            is_active=True,
            published_at=datetime.utcnow(),
            created_by=user.id
        )
        db_session.add(announcement)
    
    await db_session.commit()
    
    # 查询公告列表
    result = await db_session.execute(
        select(Announcement).where(Announcement.is_active == True)
    )
    announcements = result.scalars().all()
    
    # 验证公告数量
    assert len(announcements) >= 3


@pytest.mark.asyncio
async def test_filter_expired_announcements(db_session: AsyncSession):
    """测试过滤过期公告"""
    # 创建测试用户
    user = User(
        username="test_user_expire",
        hashed_password="hashed_password",
        full_name="Test User",
        email="expire@test.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    
    # 创建已过期的公告
    expired_announcement = Announcement(
        title="已过期公告",
        content="这是一个已过期的公告",
        announcement_type="system",
        importance="normal",
        is_active=True,
        published_at=datetime.utcnow() - timedelta(days=10),
        expires_at=datetime.utcnow() - timedelta(days=1),  # 昨天过期
        created_by=user.id
    )
    db_session.add(expired_announcement)
    
    # 创建未过期的公告
    active_announcement = Announcement(
        title="有效公告",
        content="这是一个有效的公告",
        announcement_type="system",
        importance="normal",
        is_active=True,
        published_at=datetime.utcnow(),
        expires_at=datetime.utcnow() + timedelta(days=7),  # 7天后过期
        created_by=user.id
    )
    db_session.add(active_announcement)
    
    await db_session.commit()
    
    # 查询有效公告（过滤过期的）
    from sqlalchemy import and_, or_
    result = await db_session.execute(
        select(Announcement).where(
            and_(
                Announcement.is_active == True,
                or_(
                    Announcement.expires_at.is_(None),
                    Announcement.expires_at > datetime.utcnow()
                )
            )
        )
    )
    valid_announcements = result.scalars().all()
    
    # 验证只返回未过期的公告
    announcement_titles = [a.title for a in valid_announcements]
    assert "有效公告" in announcement_titles
    assert "已过期公告" not in announcement_titles


@pytest.mark.asyncio
async def test_mark_announcement_as_read(db_session: AsyncSession):
    """测试标记公告为已读"""
    # 创建测试用户
    user = User(
        username="test_read_user",
        hashed_password="hashed_password",
        full_name="Test Read User",
        email="read@test.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    
    # 创建公告
    announcement = Announcement(
        title="待读公告",
        content="请标记为已读",
        announcement_type="system",
        importance="important",
        is_active=True,
        published_at=datetime.utcnow(),
        created_by=user.id
    )
    db_session.add(announcement)
    await db_session.commit()
    await db_session.refresh(announcement)
    
    # 创建阅读记录
    read_log = AnnouncementReadLog(
        announcement_id=announcement.id,
        user_id=user.id,
        read_at=datetime.utcnow()
    )
    db_session.add(read_log)
    await db_session.commit()
    
    # 验证阅读记录创建成功
    result = await db_session.execute(
        select(AnnouncementReadLog).where(
            and_(
                AnnouncementReadLog.announcement_id == announcement.id,
                AnnouncementReadLog.user_id == user.id
            )
        )
    )
    saved_log = result.scalar_one_or_none()
    assert saved_log is not None
    assert saved_log.announcement_id == announcement.id
    assert saved_log.user_id == user.id


@pytest.mark.asyncio
async def test_prevent_duplicate_read_log(db_session: AsyncSession):
    """测试防止重复阅读记录"""
    # 创建测试用户
    user = User(
        username="test_dup_user",
        hashed_password="hashed_password",
        full_name="Test Dup User",
        email="dup@test.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    
    # 创建公告
    announcement = Announcement(
        title="测试公告",
        content="测试重复阅读",
        announcement_type="system",
        importance="normal",
        is_active=True,
        published_at=datetime.utcnow(),
        created_by=user.id
    )
    db_session.add(announcement)
    await db_session.commit()
    await db_session.refresh(announcement)
    
    # 第一次创建阅读记录
    read_log1 = AnnouncementReadLog(
        announcement_id=announcement.id,
        user_id=user.id,
        read_at=datetime.utcnow()
    )
    db_session.add(read_log1)
    await db_session.commit()
    
    # 尝试创建重复的阅读记录（应该失败）
    read_log2 = AnnouncementReadLog(
        announcement_id=announcement.id,
        user_id=user.id,
        read_at=datetime.utcnow()
    )
    db_session.add(read_log2)
    
    # 验证唯一约束生效
    with pytest.raises(Exception):  # 应该抛出唯一约束异常
        await db_session.commit()


@pytest.mark.asyncio
async def test_announcement_statistics(db_session: AsyncSession):
    """测试公告阅读统计"""
    # 创建多个测试用户
    users = []
    for i in range(5):
        user = User(
            username=f"stat_user_{i}",
            hashed_password="hashed_password",
            full_name=f"Stat User {i}",
            email=f"stat{i}@test.com",
            user_type=UserType.INTERNAL,
            status=UserStatus.ACTIVE
        )
        db_session.add(user)
        users.append(user)
    
    await db_session.commit()
    for user in users:
        await db_session.refresh(user)
    
    # 创建公告
    announcement = Announcement(
        title="统计测试公告",
        content="测试阅读统计",
        announcement_type="system",
        importance="important",
        is_active=True,
        published_at=datetime.utcnow(),
        created_by=users[0].id
    )
    db_session.add(announcement)
    await db_session.commit()
    await db_session.refresh(announcement)
    
    # 3个用户阅读公告
    for i in range(3):
        read_log = AnnouncementReadLog(
            announcement_id=announcement.id,
            user_id=users[i].id,
            read_at=datetime.utcnow()
        )
        db_session.add(read_log)
    
    await db_session.commit()
    
    # 统计阅读情况
    from sqlalchemy import func
    read_count_result = await db_session.execute(
        select(func.count(AnnouncementReadLog.id)).where(
            AnnouncementReadLog.announcement_id == announcement.id
        )
    )
    read_count = read_count_result.scalar()
    
    total_users_result = await db_session.execute(
        select(func.count(User.id)).where(User.status == UserStatus.ACTIVE)
    )
    total_users = total_users_result.scalar()
    
    # 验证统计数据
    assert read_count == 3
    assert total_users >= 5
    
    # 计算阅读率
    read_rate = (read_count / total_users * 100) if total_users > 0 else 0
    assert read_rate > 0


@pytest.mark.asyncio
async def test_announcement_ordering(db_session: AsyncSession):
    """测试公告按发布时间倒序排列"""
    # 创建测试用户
    user = User(
        username="order_user",
        hashed_password="hashed_password",
        full_name="Order User",
        email="order@test.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    
    # 创建多个公告，时间不同
    import time
    for i in range(3):
        announcement = Announcement(
            title=f"公告 {i}",
            content=f"内容 {i}",
            announcement_type="system",
            importance="normal",
            is_active=True,
            published_at=datetime.utcnow(),
            created_by=user.id
        )
        db_session.add(announcement)
        await db_session.commit()
        time.sleep(0.1)  # 确保时间不同
    
    # 查询公告列表（按发布时间倒序）
    from sqlalchemy import desc
    result = await db_session.execute(
        select(Announcement).where(
            Announcement.is_active == True
        ).order_by(desc(Announcement.published_at))
    )
    announcements = result.scalars().all()
    
    # 验证排序（最新的在前）
    if len(announcements) >= 3:
        # 验证时间是递减的
        for i in range(len(announcements) - 1):
            assert announcements[i].published_at >= announcements[i + 1].published_at
