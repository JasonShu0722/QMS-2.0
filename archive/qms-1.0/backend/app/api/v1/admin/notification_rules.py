"""
通知规则配置管理 API 路由
Admin Notification Rules - 管理员配置通知规则、SMTP服务器、Webhook等
"""
from typing import List, Optional
from datetime import datetime
import asyncio
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
import httpx

from app.core.database import get_db
from app.core.dependencies import get_current_active_user
from app.models.user import User
from app.models.notification_rule import NotificationRule
from app.models.smtp_config import SMTPConfig
from app.schemas.notification_rule import (
    NotificationRuleCreateSchema,
    NotificationRuleUpdateSchema,
    NotificationRuleResponseSchema,
    NotificationRuleTestRequest,
    NotificationRuleTestResponse,
    SMTPConfigCreateSchema,
    SMTPConfigUpdateSchema,
    SMTPConfigResponseSchema,
    SMTPTestResponse,
    WebhookConfigCreateSchema,
    WebhookTestResponse
)


router = APIRouter(prefix="/admin/notification-rules", tags=["Admin - Notification Rules"])


# ==================== 通知规则管理 ====================

@router.get(
    "",
    response_model=List[NotificationRuleResponseSchema],
    summary="获取所有通知规则",
    description="获取系统中配置的所有通知规则列表"
)
async def get_notification_rules(
    business_object: Optional[str] = None,
    is_active: Optional[bool] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    获取所有通知规则
    
    权限要求：管理员
    
    Query Parameters:
        business_object: 按业务对象筛选（可选）
        is_active: 按激活状态筛选（可选）
    
    Returns:
        List[NotificationRuleResponseSchema]: 通知规则列表
    """
    # 权限检查
    if current_user.user_type != "internal":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅内部员工可访问此接口"
        )
    
    # 构建查询
    query = select(NotificationRule)
    
    if business_object:
        query = query.where(NotificationRule.business_object == business_object)
    
    if is_active is not None:
        query = query.where(NotificationRule.is_active == is_active)
    
    query = query.order_by(NotificationRule.created_at.desc())
    
    result = await db.execute(query)
    rules = result.scalars().all()
    
    return rules


@router.get(
    "/{rule_id}",
    response_model=NotificationRuleResponseSchema,
    summary="获取通知规则详情",
    description="根据ID获取单个通知规则的详细信息"
)
async def get_notification_rule(
    rule_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    获取通知规则详情
    
    Args:
        rule_id: 规则ID
        
    Returns:
        NotificationRuleResponseSchema: 通知规则详情
    """
    # 权限检查
    if current_user.user_type != "internal":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅内部员工可访问此接口"
        )
    
    result = await db.execute(
        select(NotificationRule).where(NotificationRule.id == rule_id)
    )
    rule = result.scalar_one_or_none()
    
    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="通知规则不存在"
        )
    
    return rule


@router.post(
    "",
    response_model=NotificationRuleResponseSchema,
    status_code=status.HTTP_201_CREATED,
    summary="创建通知规则",
    description="创建新的通知规则配置"
)
async def create_notification_rule(
    request: NotificationRuleCreateSchema,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    创建通知规则
    
    操作流程：
    1. 验证权限
    2. 创建通知规则记录
    3. 返回创建的规则信息
    
    Args:
        request: 通知规则创建请求
        
    Returns:
        NotificationRuleResponseSchema: 创建的通知规则
    """
    # 权限检查
    if current_user.user_type != "internal":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅内部员工可访问此接口"
        )
    
    # 创建通知规则
    new_rule = NotificationRule(
        rule_name=request.rule_name,
        business_object=request.business_object,
        trigger_condition=request.trigger_condition,
        action_type=request.action_type,
        action_config=request.action_config,
        escalation_enabled=request.escalation_enabled,
        escalation_hours=request.escalation_hours,
        escalation_recipients=request.escalation_recipients,
        is_active=request.is_active,
        created_by=current_user.id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    
    db.add(new_rule)
    await db.commit()
    await db.refresh(new_rule)
    
    return new_rule


@router.put(
    "/{rule_id}",
    response_model=NotificationRuleResponseSchema,
    summary="更新通知规则",
    description="更新现有通知规则的配置"
)
async def update_notification_rule(
    rule_id: int,
    request: NotificationRuleUpdateSchema,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    更新通知规则
    
    操作流程：
    1. 验证权限
    2. 验证规则存在
    3. 更新规则配置
    4. 返回更新后的规则信息
    
    Args:
        rule_id: 规则ID
        request: 通知规则更新请求
        
    Returns:
        NotificationRuleResponseSchema: 更新后的通知规则
    """
    # 权限检查
    if current_user.user_type != "internal":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅内部员工可访问此接口"
        )
    
    # 查询规则
    result = await db.execute(
        select(NotificationRule).where(NotificationRule.id == rule_id)
    )
    rule = result.scalar_one_or_none()
    
    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="通知规则不存在"
        )
    
    # 更新字段
    update_data = request.model_dump(exclude_unset=True)
    update_data["updated_at"] = datetime.utcnow()
    
    await db.execute(
        update(NotificationRule)
        .where(NotificationRule.id == rule_id)
        .values(**update_data)
    )
    await db.commit()
    await db.refresh(rule)
    
    return rule


@router.delete(
    "/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除通知规则",
    description="删除指定的通知规则"
)
async def delete_notification_rule(
    rule_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    删除通知规则
    
    Args:
        rule_id: 规则ID
    """
    # 权限检查
    if current_user.user_type != "internal":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅内部员工可访问此接口"
        )
    
    # 查询规则
    result = await db.execute(
        select(NotificationRule).where(NotificationRule.id == rule_id)
    )
    rule = result.scalar_one_or_none()
    
    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="通知规则不存在"
        )
    
    # 删除规则
    await db.execute(
        delete(NotificationRule).where(NotificationRule.id == rule_id)
    )
    await db.commit()


@router.post(
    "/test",
    response_model=NotificationRuleTestResponse,
    summary="测试通知规则",
    description="测试通知规则的触发和执行逻辑"
)
async def test_notification_rule(
    request: NotificationRuleTestRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    测试通知规则
    
    操作流程：
    1. 验证权限
    2. 查询规则配置
    3. 模拟触发条件
    4. 执行通知动作（测试模式）
    5. 返回测试结果
    
    Args:
        request: 测试请求
        
    Returns:
        NotificationRuleTestResponse: 测试结果
    """
    # 权限检查
    if current_user.user_type != "internal":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅内部员工可访问此接口"
        )
    
    # 查询规则
    result = await db.execute(
        select(NotificationRule).where(NotificationRule.id == request.rule_id)
    )
    rule = result.scalar_one_or_none()
    
    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="通知规则不存在"
        )
    
    # 模拟测试
    try:
        test_details = {
            "rule_name": rule.rule_name,
            "business_object": rule.business_object,
            "action_type": rule.action_type,
            "trigger_condition": rule.trigger_condition,
            "test_data": request.test_data or {}
        }
        
        # 根据动作类型执行不同的测试
        if rule.action_type == "send_email":
            test_details["test_result"] = "邮件发送测试（模拟）- 成功"
        elif rule.action_type == "send_notification":
            test_details["test_result"] = "站内信发送测试（模拟）- 成功"
        elif rule.action_type == "send_webhook":
            test_details["test_result"] = "Webhook发送测试（模拟）- 成功"
        
        return NotificationRuleTestResponse(
            success=True,
            message="通知规则测试成功",
            details=test_details
        )
    
    except Exception as e:
        return NotificationRuleTestResponse(
            success=False,
            message=f"通知规则测试失败: {str(e)}",
            details={"error": str(e)}
        )


# ==================== SMTP配置管理 ====================

@router.get(
    "/smtp-configs",
    response_model=List[SMTPConfigResponseSchema],
    summary="获取所有SMTP配置",
    description="获取系统中配置的所有SMTP服务器列表"
)
async def get_smtp_configs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    获取所有SMTP配置
    
    权限要求：管理员
    
    Returns:
        List[SMTPConfigResponseSchema]: SMTP配置列表（不包含密码）
    """
    # 权限检查
    if current_user.user_type != "internal":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅内部员工可访问此接口"
        )
    
    result = await db.execute(
        select(SMTPConfig).order_by(SMTPConfig.created_at.desc())
    )
    configs = result.scalars().all()
    
    return configs


@router.post(
    "/smtp-config",
    response_model=SMTPConfigResponseSchema,
    status_code=status.HTTP_201_CREATED,
    summary="配置SMTP服务器",
    description="创建新的SMTP服务器配置并验证连接有效性"
)
async def create_smtp_config(
    request: SMTPConfigCreateSchema,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    配置SMTP服务器
    
    操作流程：
    1. 验证权限
    2. 测试SMTP连接
    3. 加密存储密码
    4. 创建配置记录
    5. 如果设置为激活，则停用其他配置
    
    Args:
        request: SMTP配置创建请求
        
    Returns:
        SMTPConfigResponseSchema: 创建的SMTP配置
    """
    # 权限检查
    if current_user.user_type != "internal":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅内部员工可访问此接口"
        )
    
    # 检查配置名称是否已存在
    result = await db.execute(
        select(SMTPConfig).where(SMTPConfig.config_name == request.config_name)
    )
    existing_config = result.scalar_one_or_none()
    
    if existing_config:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"配置名称 '{request.config_name}' 已存在"
        )
    
    # 测试SMTP连接
    test_result = await _test_smtp_connection(
        smtp_host=request.smtp_host,
        smtp_port=request.smtp_port,
        smtp_user=request.smtp_user,
        smtp_password=request.smtp_password,
        use_tls=request.use_tls
    )
    
    if not test_result["success"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"SMTP连接测试失败: {test_result['message']}"
        )
    
    # 简单加密密码（实际生产环境应使用更安全的加密方式）
    # TODO: 使用 cryptography 库进行加密
    encrypted_password = _encrypt_password(request.smtp_password)
    
    # 如果设置为激活，则停用其他配置
    if request.is_active:
        await db.execute(
            update(SMTPConfig)
            .where(SMTPConfig.is_active == True)
            .values(is_active=False, updated_at=datetime.utcnow())
        )
    
    # 创建SMTP配置
    new_config = SMTPConfig(
        config_name=request.config_name,
        smtp_host=request.smtp_host,
        smtp_port=request.smtp_port,
        smtp_user=request.smtp_user,
        smtp_password_encrypted=encrypted_password,
        use_tls=request.use_tls,
        from_email=request.from_email,
        from_name=request.from_name,
        is_active=request.is_active,
        last_test_at=datetime.utcnow(),
        last_test_result="success",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    
    db.add(new_config)
    await db.commit()
    await db.refresh(new_config)
    
    return new_config


@router.put(
    "/smtp-config/{config_id}",
    response_model=SMTPConfigResponseSchema,
    summary="更新SMTP配置",
    description="更新现有SMTP服务器配置"
)
async def update_smtp_config(
    config_id: int,
    request: SMTPConfigUpdateSchema,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    更新SMTP配置
    
    Args:
        config_id: 配置ID
        request: SMTP配置更新请求
        
    Returns:
        SMTPConfigResponseSchema: 更新后的SMTP配置
    """
    # 权限检查
    if current_user.user_type != "internal":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅内部员工可访问此接口"
        )
    
    # 查询配置
    result = await db.execute(
        select(SMTPConfig).where(SMTPConfig.id == config_id)
    )
    config = result.scalar_one_or_none()
    
    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="SMTP配置不存在"
        )
    
    # 更新字段
    update_data = request.model_dump(exclude_unset=True)
    
    # 如果更新了密码，需要加密
    if "smtp_password" in update_data:
        update_data["smtp_password_encrypted"] = _encrypt_password(update_data.pop("smtp_password"))
    
    # 如果设置为激活，则停用其他配置
    if update_data.get("is_active"):
        await db.execute(
            update(SMTPConfig)
            .where(SMTPConfig.is_active == True)
            .where(SMTPConfig.id != config_id)
            .values(is_active=False, updated_at=datetime.utcnow())
        )
    
    update_data["updated_at"] = datetime.utcnow()
    
    await db.execute(
        update(SMTPConfig)
        .where(SMTPConfig.id == config_id)
        .values(**update_data)
    )
    await db.commit()
    await db.refresh(config)
    
    return config


@router.post(
    "/smtp-config/{config_id}/test",
    response_model=SMTPTestResponse,
    summary="测试SMTP连接",
    description="测试指定SMTP配置的连接有效性"
)
async def test_smtp_config(
    config_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    测试SMTP连接
    
    操作流程：
    1. 验证权限
    2. 查询SMTP配置
    3. 解密密码
    4. 测试连接
    5. 更新测试结果
    
    Args:
        config_id: 配置ID
        
    Returns:
        SMTPTestResponse: 测试结果
    """
    # 权限检查
    if current_user.user_type != "internal":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅内部员工可访问此接口"
        )
    
    # 查询配置
    result = await db.execute(
        select(SMTPConfig).where(SMTPConfig.id == config_id)
    )
    config = result.scalar_one_or_none()
    
    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="SMTP配置不存在"
        )
    
    # 解密密码
    decrypted_password = _decrypt_password(config.smtp_password_encrypted)
    
    # 测试连接
    test_result = await _test_smtp_connection(
        smtp_host=config.smtp_host,
        smtp_port=config.smtp_port,
        smtp_user=config.smtp_user,
        smtp_password=decrypted_password,
        use_tls=config.use_tls
    )
    
    # 更新测试结果
    await db.execute(
        update(SMTPConfig)
        .where(SMTPConfig.id == config_id)
        .values(
            last_test_at=datetime.utcnow(),
            last_test_result="success" if test_result["success"] else "failed",
            updated_at=datetime.utcnow()
        )
    )
    await db.commit()
    
    return SMTPTestResponse(
        success=test_result["success"],
        message=test_result["message"],
        details=test_result.get("details")
    )


# ==================== Webhook配置管理 ====================

@router.post(
    "/webhook-config",
    response_model=WebhookTestResponse,
    summary="配置企业微信/钉钉Webhook",
    description="配置并验证Webhook地址的可达性"
)
async def create_webhook_config(
    request: WebhookConfigCreateSchema,
    current_user: User = Depends(get_current_active_user)
):
    """
    配置Webhook
    
    操作流程：
    1. 验证权限
    2. 测试Webhook可达性
    3. 返回测试结果
    
    注：当前版本仅测试连接，不存储配置（预留功能）
    
    Args:
        request: Webhook配置创建请求
        
    Returns:
        WebhookTestResponse: 测试结果
    """
    # 权限检查
    if current_user.user_type != "internal":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅内部员工可访问此接口"
        )
    
    # 测试Webhook连接
    test_result = await _test_webhook_connection(
        webhook_type=request.webhook_type,
        webhook_url=request.webhook_url
    )
    
    return WebhookTestResponse(
        success=test_result["success"],
        message=test_result["message"],
        details=test_result.get("details")
    )


# ==================== 辅助函数 ====================

async def _test_smtp_connection(
    smtp_host: str,
    smtp_port: int,
    smtp_user: str,
    smtp_password: str,
    use_tls: bool
) -> dict:
    """
    测试SMTP连接
    
    Args:
        smtp_host: SMTP服务器地址
        smtp_port: SMTP端口
        smtp_user: SMTP用户名
        smtp_password: SMTP密码
        use_tls: 是否使用TLS
        
    Returns:
        dict: 测试结果 {"success": bool, "message": str, "details": dict}
    """
    try:
        # 在异步环境中运行同步SMTP代码
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            _sync_test_smtp,
            smtp_host,
            smtp_port,
            smtp_user,
            smtp_password,
            use_tls
        )
        return result
    except Exception as e:
        return {
            "success": False,
            "message": f"SMTP连接测试失败: {str(e)}",
            "details": {"error": str(e)}
        }


def _sync_test_smtp(
    smtp_host: str,
    smtp_port: int,
    smtp_user: str,
    smtp_password: str,
    use_tls: bool
) -> dict:
    """同步SMTP测试函数"""
    import time
    start_time = time.time()
    
    try:
        if use_tls:
            context = ssl.create_default_context()
            server = smtplib.SMTP(smtp_host, smtp_port, timeout=10)
            server.starttls(context=context)
        else:
            server = smtplib.SMTP(smtp_host, smtp_port, timeout=10)
        
        server.login(smtp_user, smtp_password)
        server.quit()
        
        connection_time = int((time.time() - start_time) * 1000)
        
        return {
            "success": True,
            "message": "SMTP连接测试成功",
            "details": {
                "smtp_host": smtp_host,
                "smtp_port": smtp_port,
                "connection_time_ms": connection_time
            }
        }
    except smtplib.SMTPAuthenticationError:
        return {
            "success": False,
            "message": "SMTP认证失败，请检查用户名和密码",
            "details": {"error": "Authentication failed"}
        }
    except smtplib.SMTPConnectError:
        return {
            "success": False,
            "message": "无法连接到SMTP服务器，请检查主机和端口",
            "details": {"error": "Connection failed"}
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"SMTP连接测试失败: {str(e)}",
            "details": {"error": str(e)}
        }


async def _test_webhook_connection(webhook_type: str, webhook_url: str) -> dict:
    """
    测试Webhook连接
    
    Args:
        webhook_type: Webhook类型
        webhook_url: Webhook地址
        
    Returns:
        dict: 测试结果 {"success": bool, "message": str, "details": dict}
    """
    try:
        # 构建测试消息
        test_message = {
            "msgtype": "text",
            "text": {
                "content": "QMS系统Webhook连接测试"
            }
        }
        
        # 发送测试请求
        async with httpx.AsyncClient(timeout=10.0) as client:
            import time
            start_time = time.time()
            
            response = await client.post(webhook_url, json=test_message)
            
            response_time = int((time.time() - start_time) * 1000)
            
            if response.status_code == 200:
                return {
                    "success": True,
                    "message": "Webhook连接测试成功",
                    "details": {
                        "webhook_type": webhook_type,
                        "response_code": response.status_code,
                        "response_time_ms": response_time
                    }
                }
            else:
                return {
                    "success": False,
                    "message": f"Webhook返回错误状态码: {response.status_code}",
                    "details": {
                        "webhook_type": webhook_type,
                        "response_code": response.status_code,
                        "response_body": response.text[:200]
                    }
                }
    
    except httpx.TimeoutException:
        return {
            "success": False,
            "message": "Webhook连接超时",
            "details": {"error": "Connection timeout"}
        }
    except httpx.RequestError as e:
        return {
            "success": False,
            "message": f"Webhook连接失败: {str(e)}",
            "details": {"error": str(e)}
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"Webhook测试失败: {str(e)}",
            "details": {"error": str(e)}
        }


def _encrypt_password(password: str) -> str:
    """
    加密密码（简单实现）
    
    注：实际生产环境应使用 cryptography 库进行加密
    
    Args:
        password: 明文密码
        
    Returns:
        str: 加密后的密码
    """
    # TODO: 使用 cryptography 库进行加密
    # 当前简单实现：Base64编码（不安全，仅用于演示）
    import base64
    return base64.b64encode(password.encode()).decode()


def _decrypt_password(encrypted_password: str) -> str:
    """
    解密密码（简单实现）
    
    Args:
        encrypted_password: 加密后的密码
        
    Returns:
        str: 明文密码
    """
    # TODO: 使用 cryptography 库进行解密
    # 当前简单实现：Base64解码（不安全，仅用于演示）
    import base64
    return base64.b64decode(encrypted_password.encode()).decode()
