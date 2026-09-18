"""
操作日志服务
Audit Log Service - 记录用户关键操作的审计日志
"""
from datetime import datetime
from typing import Optional, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.operation_log import OperationLog


class AuditLogService:
    """操作日志服务类"""
    
    @staticmethod
    async def log_operation(
        db: AsyncSession,
        user_id: int,
        operation_type: str,
        target_type: str,
        target_id: Optional[int] = None,
        before_data: Optional[Dict[str, Any]] = None,
        after_data: Optional[Dict[str, Any]] = None,
        description: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None
    ) -> OperationLog:
        """
        记录操作日志
        
        Args:
            db: 数据库会话
            user_id: 用户ID
            operation_type: 操作类型 (create, update, delete等)
            target_type: 目标类型 (user, permission, customer_audit等)
            target_id: 目标ID
            before_data: 操作前数据快照
            after_data: 操作后数据快照
            description: 操作描述
            ip_address: IP地址
            user_agent: 用户代理
            
        Returns:
            OperationLog: 创建的操作日志记录
        """
        log = OperationLog(
            user_id=user_id,
            operation_type=operation_type,
            target_module=target_type,
            target_id=target_id,
            before_data=before_data,
            after_data=after_data,
            ip_address=ip_address,
            user_agent=user_agent,
            created_at=datetime.utcnow()
        )
        
        db.add(log)
        await db.commit()
        await db.refresh(log)
        
        return log
