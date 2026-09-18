"""
Notification Rule Schemas - 通知规则配置数据校验模型

用于通知规则的创建、更新和响应的数据校验。
"""
from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field, validator


class NotificationRuleCreateSchema(BaseModel):
    """创建通知规则请求模型"""
    rule_name: str = Field(..., min_length=1, max_length=200, description="规则名称")
    business_object: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="业务对象: scar/ppap/audit/customer_complaint等"
    )
    trigger_condition: Dict[str, Any] = Field(
        ...,
        description='触发条件JSON: {"field": "status", "operator": "equals", "value": "rejected"}'
    )
    action_type: str = Field(
        ...,
        description="动作类型: send_email/send_notification/send_webhook"
    )
    action_config: Dict[str, Any] = Field(
        ...,
        description='动作配置JSON: {"recipients": ["user_id"], "template": "rejection_notice"}'
    )
    escalation_enabled: bool = Field(default=False, description="是否启用超时升级")
    escalation_hours: Optional[int] = Field(None, ge=1, description="超时小时数（触发升级）")
    escalation_recipients: Optional[List[int]] = Field(None, description="升级抄送人ID列表")
    is_active: bool = Field(default=True, description="是否激活")

    @validator("action_type")
    def validate_action_type(cls, v):
        """验证动作类型"""
        allowed_types = ["send_email", "send_notification", "send_webhook"]
        if v not in allowed_types:
            raise ValueError(f"action_type 必须是以下之一: {', '.join(allowed_types)}")
        return v

    @validator("escalation_hours")
    def validate_escalation_hours(cls, v, values):
        """验证升级小时数"""
        if values.get("escalation_enabled") and not v:
            raise ValueError("启用升级策略时必须设置 escalation_hours")
        return v

    class Config:
        json_schema_extra = {
            "example": {
                "rule_name": "客诉单驳回通知",
                "business_object": "customer_complaint",
                "trigger_condition": {
                    "field": "status",
                    "operator": "equals",
                    "value": "rejected"
                },
                "action_type": "send_email",
                "action_config": {
                    "recipients": ["submitter"],
                    "template": "rejection_notice"
                },
                "escalation_enabled": True,
                "escalation_hours": 48,
                "escalation_recipients": [1, 2, 3],
                "is_active": True
            }
        }


class NotificationRuleUpdateSchema(BaseModel):
    """更新通知规则请求模型"""
    rule_name: Optional[str] = Field(None, min_length=1, max_length=200, description="规则名称")
    business_object: Optional[str] = Field(None, min_length=1, max_length=100, description="业务对象")
    trigger_condition: Optional[Dict[str, Any]] = Field(None, description="触发条件JSON")
    action_type: Optional[str] = Field(None, description="动作类型")
    action_config: Optional[Dict[str, Any]] = Field(None, description="动作配置JSON")
    escalation_enabled: Optional[bool] = Field(None, description="是否启用超时升级")
    escalation_hours: Optional[int] = Field(None, ge=1, description="超时小时数")
    escalation_recipients: Optional[List[int]] = Field(None, description="升级抄送人ID列表")
    is_active: Optional[bool] = Field(None, description="是否激活")

    @validator("action_type")
    def validate_action_type(cls, v):
        """验证动作类型"""
        if v is not None:
            allowed_types = ["send_email", "send_notification", "send_webhook"]
            if v not in allowed_types:
                raise ValueError(f"action_type 必须是以下之一: {', '.join(allowed_types)}")
        return v

    class Config:
        json_schema_extra = {
            "example": {
                "rule_name": "客诉单驳回通知（更新）",
                "is_active": False
            }
        }


class NotificationRuleResponseSchema(BaseModel):
    """通知规则响应模型"""
    id: int
    rule_name: str
    business_object: str
    trigger_condition: Dict[str, Any]
    action_type: str
    action_config: Dict[str, Any]
    escalation_enabled: bool
    escalation_hours: Optional[int]
    escalation_recipients: Optional[List[int]]
    is_active: bool
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int]

    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": 1,
                "rule_name": "客诉单驳回通知",
                "business_object": "customer_complaint",
                "trigger_condition": {
                    "field": "status",
                    "operator": "equals",
                    "value": "rejected"
                },
                "action_type": "send_email",
                "action_config": {
                    "recipients": ["submitter"],
                    "template": "rejection_notice"
                },
                "escalation_enabled": True,
                "escalation_hours": 48,
                "escalation_recipients": [1, 2, 3],
                "is_active": True,
                "created_at": "2024-01-15T10:00:00",
                "updated_at": "2024-01-15T10:00:00",
                "created_by": 1
            }
        }


class NotificationRuleTestRequest(BaseModel):
    """测试通知规则请求模型"""
    rule_id: int = Field(..., description="规则ID")
    test_data: Optional[Dict[str, Any]] = Field(
        None,
        description="测试数据（可选，用于模拟触发条件）"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "rule_id": 1,
                "test_data": {
                    "status": "rejected",
                    "submitter_email": "test@example.com"
                }
            }
        }


class NotificationRuleTestResponse(BaseModel):
    """测试通知规则响应模型"""
    success: bool
    message: str
    details: Optional[Dict[str, Any]] = None

    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "message": "通知规则测试成功",
                "details": {
                    "rule_name": "客诉单驳回通知",
                    "action_type": "send_email",
                    "test_result": "邮件发送成功"
                }
            }
        }


class SMTPConfigCreateSchema(BaseModel):
    """创建SMTP配置请求模型"""
    config_name: str = Field(..., min_length=1, max_length=100, description="配置名称")
    smtp_host: str = Field(..., min_length=1, max_length=255, description="SMTP服务器地址")
    smtp_port: int = Field(..., ge=1, le=65535, description="SMTP端口")
    smtp_user: str = Field(..., min_length=1, max_length=255, description="SMTP用户名")
    smtp_password: str = Field(..., min_length=1, description="SMTP密码")
    use_tls: bool = Field(default=True, description="是否使用TLS加密")
    from_email: str = Field(..., min_length=1, max_length=255, description="发件人邮箱地址")
    from_name: Optional[str] = Field(None, max_length=100, description="发件人显示名称")
    is_active: bool = Field(default=True, description="是否为当前激活配置")

    class Config:
        json_schema_extra = {
            "example": {
                "config_name": "公司邮件服务器",
                "smtp_host": "smtp.company.com",
                "smtp_port": 587,
                "smtp_user": "qms@company.com",
                "smtp_password": "password123",
                "use_tls": True,
                "from_email": "qms@company.com",
                "from_name": "QMS质量管理系统",
                "is_active": True
            }
        }


class SMTPConfigUpdateSchema(BaseModel):
    """更新SMTP配置请求模型"""
    config_name: Optional[str] = Field(None, min_length=1, max_length=100, description="配置名称")
    smtp_host: Optional[str] = Field(None, min_length=1, max_length=255, description="SMTP服务器地址")
    smtp_port: Optional[int] = Field(None, ge=1, le=65535, description="SMTP端口")
    smtp_user: Optional[str] = Field(None, min_length=1, max_length=255, description="SMTP用户名")
    smtp_password: Optional[str] = Field(None, min_length=1, description="SMTP密码")
    use_tls: Optional[bool] = Field(None, description="是否使用TLS加密")
    from_email: Optional[str] = Field(None, min_length=1, max_length=255, description="发件人邮箱地址")
    from_name: Optional[str] = Field(None, max_length=100, description="发件人显示名称")
    is_active: Optional[bool] = Field(None, description="是否为当前激活配置")

    class Config:
        json_schema_extra = {
            "example": {
                "smtp_host": "smtp.newserver.com",
                "smtp_port": 465,
                "use_tls": True
            }
        }


class SMTPConfigResponseSchema(BaseModel):
    """SMTP配置响应模型（不包含密码）"""
    id: int
    config_name: str
    smtp_host: str
    smtp_port: int
    smtp_user: str
    use_tls: bool
    from_email: str
    from_name: Optional[str]
    is_active: bool
    last_test_at: Optional[datetime]
    last_test_result: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": 1,
                "config_name": "公司邮件服务器",
                "smtp_host": "smtp.company.com",
                "smtp_port": 587,
                "smtp_user": "qms@company.com",
                "use_tls": True,
                "from_email": "qms@company.com",
                "from_name": "QMS质量管理系统",
                "is_active": True,
                "last_test_at": "2024-01-15T10:00:00",
                "last_test_result": "success",
                "created_at": "2024-01-15T09:00:00",
                "updated_at": "2024-01-15T10:00:00"
            }
        }


class SMTPTestResponse(BaseModel):
    """SMTP测试响应模型"""
    success: bool
    message: str
    details: Optional[Dict[str, Any]] = None

    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "message": "SMTP连接测试成功",
                "details": {
                    "smtp_host": "smtp.company.com",
                    "smtp_port": 587,
                    "connection_time_ms": 234
                }
            }
        }


class WebhookConfigCreateSchema(BaseModel):
    """创建Webhook配置请求模型"""
    config_name: str = Field(..., min_length=1, max_length=100, description="配置名称")
    webhook_type: str = Field(
        ...,
        description="Webhook类型: wechat_work/dingtalk/feishu"
    )
    webhook_url: str = Field(..., min_length=1, description="Webhook地址")
    is_active: bool = Field(default=True, description="是否激活")

    @validator("webhook_type")
    def validate_webhook_type(cls, v):
        """验证Webhook类型"""
        allowed_types = ["wechat_work", "dingtalk", "feishu"]
        if v not in allowed_types:
            raise ValueError(f"webhook_type 必须是以下之一: {', '.join(allowed_types)}")
        return v

    class Config:
        json_schema_extra = {
            "example": {
                "config_name": "企业微信通知",
                "webhook_type": "wechat_work",
                "webhook_url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxxx",
                "is_active": True
            }
        }


class WebhookTestResponse(BaseModel):
    """Webhook测试响应模型"""
    success: bool
    message: str
    details: Optional[Dict[str, Any]] = None

    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "message": "Webhook连接测试成功",
                "details": {
                    "webhook_type": "wechat_work",
                    "response_code": 200,
                    "response_time_ms": 156
                }
            }
        }
