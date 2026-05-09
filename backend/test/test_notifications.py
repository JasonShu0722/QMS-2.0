"""
测试通知服务和 API
Test Notification Service and API
"""
import pytest
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.notification import Notification, MessageType
from app.models.user import User, UserType, UserStatus
from app.services.notification_service import notification_hub


@pytest.mark.asyncio
async def test_send_notification(db_session: AsyncSession):
    """测试发送站内信通知"""
    # 创建测试用户
    user = User(
        username="test_notify_user",
        password_hash="hashed_password",
        full_name="Test Notify User",
        email="notify@test.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    
    # 发送通知
    notifications = await notification_hub.send_notification(
        db=db_session,
        user_ids=[user.id],
        message_type=MessageType.SYSTEM_ALERT,
        title="测试通知",
        content="这是一条测试通知",
        link="/test/link"
    )
    
    # 验证通知创建成功
    assert len(notifications) == 1
    notification = notifications[0]
    assert notification.user_id == user.id
    assert notification.message_type == MessageType.SYSTEM_ALERT
    assert notification.title == "测试通知"
    assert notification.content == "这是一条测试通知"
    assert notification.link == "/test/link"
    assert notification.is_read is False
    assert notification.read_at is None


@pytest.mark.asyncio
async def test_send_notification_multiple_users(db_session: AsyncSession):
    """测试向多个用户发送通知"""
    # 创建多个测试用户
    users = []
    for i in range(3):
        user = User(
            username=f"test_user_{i}",
            password_hash="hashed_password",
            full_name=f"Test User {i}",
            email=f"user{i}@test.com",
            user_type=UserType.INTERNAL,
            status=UserStatus.ACTIVE
        )
        db_session.add(user)
        users.append(user)
    
    await db_session.commit()
    for user in users:
        await db_session.refresh(user)
    
    # 发送通知给所有用户
    user_ids = [user.id for user in users]
    notifications = await notification_hub.send_notification(
        db=db_session,
        user_ids=user_ids,
        message_type=MessageType.WARNING,
        title="批量通知",
        content="这是一条批量通知"
    )
    
    # 验证所有用户都收到通知
    assert len(notifications) == 3
    for notification in notifications:
        assert notification.user_id in user_ids
        assert notification.message_type == MessageType.WARNING


@pytest.mark.asyncio
async def test_mark_as_read(db_session: AsyncSession):
    """测试标记单条消息为已读"""
    # 创建测试用户和通知
    user = User(
        username="test_read_user",
        password_hash="hashed_password",
        full_name="Test Read User",
        email="read@test.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    
    # 创建通知
    notifications = await notification_hub.send_notification(
        db=db_session,
        user_ids=[user.id],
        message_type=MessageType.SYSTEM_ALERT,
        title="待读通知",
        content="请标记为已读"
    )
    notification = notifications[0]
    
    # 标记为已读
    success = await notification_hub.mark_as_read(
        db=db_session,
        notification_id=notification.id,
        user_id=user.id
    )
    
    # 验证标记成功
    assert success is True
    
    # 重新查询验证状态
    result = await db_session.execute(
        select(Notification).where(Notification.id == notification.id)
    )
    updated_notification = result.scalar_one()
    assert updated_notification.is_read is True
    assert updated_notification.read_at is not None


@pytest.mark.asyncio
async def test_mark_as_read_wrong_user(db_session: AsyncSession):
    """测试标记其他用户的消息（应该失败）"""
    # 创建两个测试用户
    user1 = User(
        username="user1",
        password_hash="hashed_password",
        full_name="User 1",
        email="user1@test.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE
    )
    user2 = User(
        username="user2",
        password_hash="hashed_password",
        full_name="User 2",
        email="user2@test.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE
    )
    db_session.add(user1)
    db_session.add(user2)
    await db_session.commit()
    await db_session.refresh(user1)
    await db_session.refresh(user2)
    
    # 给 user1 创建通知
    notifications = await notification_hub.send_notification(
        db=db_session,
        user_ids=[user1.id],
        message_type=MessageType.SYSTEM_ALERT,
        title="User1 的通知",
        content="只有 User1 能读"
    )
    notification = notifications[0]
    
    # user2 尝试标记 user1 的消息（应该失败）
    success = await notification_hub.mark_as_read(
        db=db_session,
        notification_id=notification.id,
        user_id=user2.id
    )
    
    # 验证标记失败
    assert success is False


@pytest.mark.asyncio
async def test_mark_all_as_read(db_session: AsyncSession):
    """测试一键标记全部已读"""
    # 创建测试用户
    user = User(
        username="test_readall_user",
        password_hash="hashed_password",
        full_name="Test ReadAll User",
        email="readall@test.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    
    # 创建多条未读通知
    for i in range(5):
        await notification_hub.send_notification(
            db=db_session,
            user_ids=[user.id],
            message_type=MessageType.SYSTEM_ALERT,
            title=f"通知 {i}",
            content=f"内容 {i}"
        )
    
    # 一键标记全部已读
    affected_count = await notification_hub.mark_all_as_read(
        db=db_session,
        user_id=user.id
    )
    
    # 验证标记数量
    assert affected_count == 5
    
    # 验证所有通知都已读
    result = await db_session.execute(
        select(Notification).where(Notification.user_id == user.id)
    )
    notifications = result.scalars().all()
    assert len(notifications) == 5
    for notification in notifications:
        assert notification.is_read is True
        assert notification.read_at is not None


@pytest.mark.asyncio
async def test_get_unread_count(db_session: AsyncSession):
    """测试获取未读消息数量"""
    # 创建测试用户
    user = User(
        username="test_count_user",
        password_hash="hashed_password",
        full_name="Test Count User",
        email="count@test.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    
    # 初始未读数量应为 0
    unread_count = await notification_hub.get_unread_count(db_session, user.id)
    assert unread_count == 0
    
    # 创建 3 条未读通知
    for i in range(3):
        await notification_hub.send_notification(
            db=db_session,
            user_ids=[user.id],
            message_type=MessageType.SYSTEM_ALERT,
            title=f"通知 {i}",
            content=f"内容 {i}"
        )
    
    # 验证未读数量
    unread_count = await notification_hub.get_unread_count(db_session, user.id)
    assert unread_count == 3
    
    # 标记 1 条为已读
    result = await db_session.execute(
        select(Notification).where(Notification.user_id == user.id).limit(1)
    )
    notification = result.scalar_one()
    await notification_hub.mark_as_read(db_session, notification.id, user.id)
    
    # 验证未读数量减少
    unread_count = await notification_hub.get_unread_count(db_session, user.id)
    assert unread_count == 2


@pytest.mark.asyncio
async def test_send_email_without_smtp_config():
    """测试在没有 SMTP 配置时发送邮件（应该返回 False）"""
    # 不配置 SMTP，直接调用发送邮件
    result = await notification_hub.send_email(
        to_emails=["test@example.com"],
        subject="测试邮件",
        body="<p>这是测试邮件</p>"
    )
    
    # 应该返回 False（因为 SMTP 未配置）
    assert result is False


@pytest.mark.asyncio
async def test_send_wechat_work_reserved():
    """测试企业微信通知（预留功能，应该返回 False）"""
    result = await notification_hub.send_wechat_work(
        user_ids=[1, 2, 3],
        message="测试企业微信通知"
    )
    
    # 预留功能，应该返回 False
    assert result is False
