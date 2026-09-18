"""
通知服务模块
Notification Service - 处理邮件通知、站内信等消息推送
"""
import secrets
import string
from typing import Optional, List
from datetime import datetime
import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.core.config import settings
from app.models.user import User
from app.models.notification import Notification, MessageType


class NotificationService:
    """
    通知服务类
    
    功能：
    - 发送邮件通知
    - 生成临时密码
    """
    
    @staticmethod
    def generate_temporary_password(length: int = 12) -> str:
        """
        生成临时密码
        
        规则：包含大写字母、小写字母、数字和特殊字符
        
        Args:
            length: 密码长度（默认12位）
            
        Returns:
            str: 临时密码
        """
        # 确保包含所有类型的字符
        uppercase = string.ascii_uppercase
        lowercase = string.ascii_lowercase
        digits = string.digits
        special = "!@#$%^&*"
        
        # 至少包含每种类型的一个字符
        password = [
            secrets.choice(uppercase),
            secrets.choice(lowercase),
            secrets.choice(digits),
            secrets.choice(special)
        ]
        
        # 填充剩余长度
        all_chars = uppercase + lowercase + digits + special
        password.extend(secrets.choice(all_chars) for _ in range(length - 4))
        
        # 打乱顺序
        secrets.SystemRandom().shuffle(password)
        
        return ''.join(password)
    
    @staticmethod
    async def send_email(
        to_email: str,
        subject: str,
        body: str,
        html_body: Optional[str] = None
    ) -> bool:
        """
        发送邮件
        
        Args:
            to_email: 收件人邮箱
            subject: 邮件主题
            body: 邮件正文（纯文本）
            html_body: 邮件正文（HTML格式，可选）
            
        Returns:
            bool: 是否发送成功
        """
        # 检查 SMTP 配置
        if not all([
            settings.SMTP_SERVER,
            settings.SMTP_USERNAME,
            settings.SMTP_PASSWORD,
            settings.SMTP_FROM_EMAIL
        ]):
            print("警告：SMTP 配置不完整，邮件发送已跳过")
            return False
        
        try:
            # 创建邮件对象
            message = MIMEMultipart("alternative")
            message["From"] = settings.SMTP_FROM_EMAIL
            message["To"] = to_email
            message["Subject"] = subject
            
            # 添加纯文本内容
            text_part = MIMEText(body, "plain", "utf-8")
            message.attach(text_part)
            
            # 添加 HTML 内容（如果提供）
            if html_body:
                html_part = MIMEText(html_body, "html", "utf-8")
                message.attach(html_part)
            
            # 发送邮件
            await aiosmtplib.send(
                message,
                hostname=settings.SMTP_SERVER,
                port=settings.SMTP_PORT,
                username=settings.SMTP_USERNAME,
                password=settings.SMTP_PASSWORD,
                use_tls=settings.SMTP_USE_TLS,
            )
            
            print(f"邮件已发送至: {to_email}")
            return True
            
        except Exception as e:
            print(f"邮件发送失败: {str(e)}")
            return False
    
    @staticmethod
    async def send_approval_notification(user: User) -> bool:
        """
        发送账号激活通知邮件
        
        Args:
            user: 用户对象
            
        Returns:
            bool: 是否发送成功
        """
        subject = "QMS 账号审核通过通知"
        
        body = f"""
尊敬的 {user.full_name}：

您好！

您的 QMS 质量管理系统账号已审核通过，现在可以登录系统了。

用户名：{user.username}
登录地址：{settings.CORS_ORIGINS[0] if settings.CORS_ORIGINS else 'http://localhost:3000'}

如有任何问题，请联系系统管理员。

此邮件由系统自动发送，请勿回复。

QMS 质量管理系统
{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
        """
        
        html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background-color: #4CAF50; color: white; padding: 20px; text-align: center; }}
        .content {{ background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; }}
        .info {{ background-color: white; padding: 15px; margin: 15px 0; border-left: 4px solid #4CAF50; }}
        .footer {{ text-align: center; margin-top: 20px; font-size: 12px; color: #666; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>账号审核通过</h2>
        </div>
        <div class="content">
            <p>尊敬的 <strong>{user.full_name}</strong>：</p>
            <p>您好！</p>
            <p>您的 QMS 质量管理系统账号已审核通过，现在可以登录系统了。</p>
            <div class="info">
                <p><strong>用户名：</strong>{user.username}</p>
                <p><strong>登录地址：</strong><a href="{settings.CORS_ORIGINS[0] if settings.CORS_ORIGINS else 'http://localhost:3000'}">{settings.CORS_ORIGINS[0] if settings.CORS_ORIGINS else 'http://localhost:3000'}</a></p>
            </div>
            <p>如有任何问题，请联系系统管理员。</p>
        </div>
        <div class="footer">
            <p>此邮件由系统自动发送，请勿回复。</p>
            <p>QMS 质量管理系统 © {datetime.now().year}</p>
        </div>
    </div>
</body>
</html>
        """
        
        return await NotificationService.send_email(
            to_email=user.email,
            subject=subject,
            body=body,
            html_body=html_body
        )
    
    @staticmethod
    async def send_rejection_notification(user: User, reason: str) -> bool:
        """
        发送账号驳回通知邮件
        
        Args:
            user: 用户对象
            reason: 驳回原因
            
        Returns:
            bool: 是否发送成功
        """
        subject = "QMS 账号审核未通过通知"
        
        body = f"""
尊敬的 {user.full_name}：

您好！

很抱歉，您的 QMS 质量管理系统账号注册申请未通过审核。

驳回原因：
{reason}

如有疑问，请联系系统管理员。

此邮件由系统自动发送，请勿回复。

QMS 质量管理系统
{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
        """
        
        html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background-color: #f44336; color: white; padding: 20px; text-align: center; }}
        .content {{ background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; }}
        .reason {{ background-color: #fff3cd; padding: 15px; margin: 15px 0; border-left: 4px solid #f44336; }}
        .footer {{ text-align: center; margin-top: 20px; font-size: 12px; color: #666; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>账号审核未通过</h2>
        </div>
        <div class="content">
            <p>尊敬的 <strong>{user.full_name}</strong>：</p>
            <p>您好！</p>
            <p>很抱歉，您的 QMS 质量管理系统账号注册申请未通过审核。</p>
            <div class="reason">
                <p><strong>驳回原因：</strong></p>
                <p>{reason}</p>
            </div>
            <p>如有疑问，请联系系统管理员。</p>
        </div>
        <div class="footer">
            <p>此邮件由系统自动发送，请勿回复。</p>
            <p>QMS 质量管理系统 © {datetime.now().year}</p>
        </div>
    </div>
</body>
</html>
        """
        
        return await NotificationService.send_email(
            to_email=user.email,
            subject=subject,
            body=body,
            html_body=html_body
        )
    
    @staticmethod
    async def send_password_reset_notification(
        user: User,
        temporary_password: str
    ) -> bool:
        """
        发送密码重置通知邮件
        
        Args:
            user: 用户对象
            temporary_password: 临时密码
            
        Returns:
            bool: 是否发送成功
        """
        subject = "QMS 密码重置通知"
        
        body = f"""
尊敬的 {user.full_name}：

您好！

您的 QMS 质量管理系统账号密码已被管理员重置。

用户名：{user.username}
临时密码：{temporary_password}

重要提示：
1. 请妥善保管此临时密码
2. 首次登录时系统将强制您修改密码
3. 新密码必须符合复杂度要求（包含大写、小写、数字、特殊字符中的至少三种，长度大于8位）

登录地址：{settings.CORS_ORIGINS[0] if settings.CORS_ORIGINS else 'http://localhost:3000'}

如有任何问题，请联系系统管理员。

此邮件由系统自动发送，请勿回复。

QMS 质量管理系统
{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
        """
        
        html_body = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background-color: #2196F3; color: white; padding: 20px; text-align: center; }}
        .content {{ background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; }}
        .credentials {{ background-color: white; padding: 15px; margin: 15px 0; border-left: 4px solid #2196F3; }}
        .warning {{ background-color: #fff3cd; padding: 15px; margin: 15px 0; border-left: 4px solid #ff9800; }}
        .password {{ font-family: 'Courier New', monospace; font-size: 18px; font-weight: bold; color: #d32f2f; }}
        .footer {{ text-align: center; margin-top: 20px; font-size: 12px; color: #666; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>密码重置通知</h2>
        </div>
        <div class="content">
            <p>尊敬的 <strong>{user.full_name}</strong>：</p>
            <p>您好！</p>
            <p>您的 QMS 质量管理系统账号密码已被管理员重置。</p>
            <div class="credentials">
                <p><strong>用户名：</strong>{user.username}</p>
                <p><strong>临时密码：</strong><span class="password">{temporary_password}</span></p>
            </div>
            <div class="warning">
                <p><strong>重要提示：</strong></p>
                <ol>
                    <li>请妥善保管此临时密码</li>
                    <li>首次登录时系统将强制您修改密码</li>
                    <li>新密码必须符合复杂度要求（包含大写、小写、数字、特殊字符中的至少三种，长度大于8位）</li>
                </ol>
            </div>
            <p><strong>登录地址：</strong><a href="{settings.CORS_ORIGINS[0] if settings.CORS_ORIGINS else 'http://localhost:3000'}">{settings.CORS_ORIGINS[0] if settings.CORS_ORIGINS else 'http://localhost:3000'}</a></p>
            <p>如有任何问题，请联系系统管理员。</p>
        </div>
        <div class="footer">
            <p>此邮件由系统自动发送，请勿回复。</p>
            <p>QMS 质量管理系统 © {datetime.now().year}</p>
        </div>
    </div>
</body>
</html>
        """
        
        return await NotificationService.send_email(
            to_email=user.email,
            subject=subject,
            body=body,
            html_body=html_body
        )



# 创建全局通知服务实例
notification_service = NotificationService()


class NotificationHub:
    """
    通知中心服务类
    
    功能：
    - 发送站内信通知
    - 发送邮件通知（支持附件）
    - 预留企业微信集成
    - 管理消息已读/未读状态
    - 统计未读消息数量
    """
    
    @staticmethod
    async def send_notification(
        db: AsyncSession,
        user_ids: List[int],
        message_type: str,
        title: str,
        content: str,
        link: Optional[str] = None
    ) -> List[Notification]:
        """
        发送站内信通知
        
        Args:
            db: 数据库会话
            user_ids: 接收用户ID列表
            message_type: 消息类型 (workflow_exception/system_alert/warning)
            title: 消息标题
            content: 消息内容
            link: 跳转链接（可选）
            
        Returns:
            List[Notification]: 创建的通知对象列表
        """
        notifications = []
        
        for user_id in user_ids:
            notification = Notification(
                user_id=user_id,
                message_type=message_type,
                title=title,
                content=content,
                link=link,
                is_read=False,
                created_at=datetime.utcnow()
            )
            db.add(notification)
            notifications.append(notification)
        
        await db.commit()
        
        # 刷新对象以获取生成的ID
        for notification in notifications:
            await db.refresh(notification)
        
        return notifications
    
    @staticmethod
    async def send_email(
        to_emails: List[str],
        subject: str,
        body: str,
        attachments: Optional[List[tuple]] = None
    ) -> bool:
        """
        发送邮件通知（支持附件）
        
        Args:
            to_emails: 收件人邮箱列表
            subject: 邮件主题
            body: 邮件正文（支持HTML）
            attachments: 附件列表，格式为 [(filename, content_bytes), ...]
            
        Returns:
            bool: 是否发送成功
        """
        # 检查 SMTP 配置
        if not all([
            settings.SMTP_SERVER,
            settings.SMTP_USERNAME,
            settings.SMTP_PASSWORD,
            settings.SMTP_FROM_EMAIL
        ]):
            print("警告：SMTP 配置不完整，邮件发送已跳过")
            return False
        
        try:
            # 创建邮件对象
            message = MIMEMultipart()
            message["From"] = settings.SMTP_FROM_EMAIL
            message["To"] = ", ".join(to_emails)
            message["Subject"] = subject
            
            # 添加邮件正文（支持HTML）
            message.attach(MIMEText(body, "html", "utf-8"))
            
            # 添加附件
            if attachments:
                for filename, content_bytes in attachments:
                    part = MIMEBase("application", "octet-stream")
                    part.set_payload(content_bytes)
                    encoders.encode_base64(part)
                    part.add_header(
                        "Content-Disposition",
                        f"attachment; filename= {filename}",
                    )
                    message.attach(part)
            
            # 发送邮件
            await aiosmtplib.send(
                message,
                hostname=settings.SMTP_SERVER,
                port=settings.SMTP_PORT,
                username=settings.SMTP_USERNAME,
                password=settings.SMTP_PASSWORD,
                use_tls=settings.SMTP_USE_TLS,
            )
            
            print(f"邮件已发送至: {', '.join(to_emails)}")
            return True
            
        except Exception as e:
            print(f"邮件发送失败: {str(e)}")
            return False
    
    @staticmethod
    async def send_wechat_work(
        user_ids: List[int],
        message: str
    ) -> bool:
        """
        发送企业微信通知（预留功能）
        
        Args:
            user_ids: 接收用户ID列表
            message: 消息内容
            
        Returns:
            bool: 是否发送成功
            
        Note:
            此功能为预留接口，Phase 1 阶段暂不实现。
            后续可集成企业微信 Webhook API。
        """
        # TODO: 集成企业微信 API
        print(f"企业微信通知功能预留中，目标用户: {user_ids}, 消息: {message}")
        return False
    
    @staticmethod
    async def mark_as_read(
        db: AsyncSession,
        notification_id: int,
        user_id: int
    ) -> bool:
        """
        标记单条消息为已读
        
        Args:
            db: 数据库会话
            notification_id: 通知ID
            user_id: 用户ID（用于权限验证）
            
        Returns:
            bool: 是否标记成功
        """
        # 查询通知
        result = await db.execute(
            select(Notification).where(
                Notification.id == notification_id,
                Notification.user_id == user_id
            )
        )
        notification = result.scalar_one_or_none()
        
        if not notification:
            return False
        
        # 更新已读状态
        notification.is_read = True
        notification.read_at = datetime.utcnow()
        
        await db.commit()
        return True
    
    @staticmethod
    async def mark_all_as_read(
        db: AsyncSession,
        user_id: int
    ) -> int:
        """
        一键标记全部消息为已读
        
        Args:
            db: 数据库会话
            user_id: 用户ID
            
        Returns:
            int: 标记的消息数量
        """
        # 批量更新未读消息
        result = await db.execute(
            update(Notification)
            .where(
                Notification.user_id == user_id,
                Notification.is_read == False
            )
            .values(
                is_read=True,
                read_at=datetime.utcnow()
            )
        )
        
        await db.commit()
        
        return result.rowcount
    
    @staticmethod
    async def get_unread_count(
        db: AsyncSession,
        user_id: int
    ) -> int:
        """
        获取未读消息数量
        
        Args:
            db: 数据库会话
            user_id: 用户ID
            
        Returns:
            int: 未读消息数量
        """
        result = await db.execute(
            select(Notification).where(
                Notification.user_id == user_id,
                Notification.is_read == False
            )
        )
        
        notifications = result.scalars().all()
        return len(notifications)


# 创建全局通知中心实例
notification_hub = NotificationHub()
