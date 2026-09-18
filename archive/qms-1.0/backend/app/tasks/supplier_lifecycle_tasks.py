"""
供应商生命周期管理 Celery 任务
Supplier Lifecycle Management Celery Tasks
"""
from datetime import datetime
from celery import shared_task
from sqlalchemy.ext.asyncio import AsyncSession
import asyncio

from app.core.database import async_session_maker
from app.services.supplier_lifecycle_service import supplier_lifecycle_service
from app.services.notification_service import notification_service


@shared_task(name="check_certificate_expiry")
def check_certificate_expiry():
    """
    检查证书到期情况并发送预警通知
    
    定时任务：每日凌晨02:00执行
    检查即将到期的供应商资质证书并发送通知
    """
    asyncio.run(_check_certificate_expiry_async())


async def _check_certificate_expiry_async():
    """异步执行证书到期检查"""
    async with async_session_maker() as db:
        try:
            # 获取30天内到期的证书
            warnings = await supplier_lifecycle_service.get_expiring_certificates(
                db=db,
                days_threshold=30
            )
            
            if not warnings:
                print(f"[{datetime.utcnow()}] 证书到期检查: 无即将到期的证书")
                return
            
            print(f"[{datetime.utcnow()}] 证书到期检查: 发现 {len(warnings)} 个即将到期的证书")
            
            # 按预警级别分组
            critical_warnings = [w for w in warnings if w.warning_level == "critical"]
            warning_level_warnings = [w for w in warnings if w.warning_level == "warning"]
            info_warnings = [w for w in warnings if w.warning_level == "info"]
            
            # 发送关键预警（已过期或7天内到期）
            if critical_warnings:
                await _send_critical_warnings(db, critical_warnings)
            
            # 发送一般预警（30天内到期）
            if warning_level_warnings:
                await _send_warning_notifications(db, warning_level_warnings)
            
            # 记录信息级预警
            if info_warnings:
                print(f"  - 信息级预警: {len(info_warnings)} 个证书在30天后到期")
            
        except Exception as e:
            print(f"[{datetime.utcnow()}] 证书到期检查失败: {str(e)}")
            raise


async def _send_critical_warnings(db: AsyncSession, warnings: list):
    """
    发送关键预警通知
    
    Args:
        db: 数据库会话
        warnings: 预警列表
    """
    for warning in warnings:
        # 构建通知内容
        if warning.days_until_expiry < 0:
            title = f"【紧急】供应商证书已过期"
            content = (
                f"供应商 {warning.supplier_name} 的 {warning.document_type} 证书已过期 "
                f"{abs(warning.days_until_expiry)} 天，请立即处理！"
            )
        else:
            title = f"【紧急】供应商证书即将到期"
            content = (
                f"供应商 {warning.supplier_name} 的 {warning.document_type} 证书将在 "
                f"{warning.days_until_expiry} 天后到期，请尽快更新！"
            )
        
        # TODO: 获取需要通知的用户列表（SQE、采购工程师）
        # 这里需要根据实际业务逻辑确定通知对象
        # user_ids = await get_responsible_users(db, warning.supplier_id)
        
        # 暂时打印日志
        print(f"  - 关键预警: {warning.supplier_name} - {warning.document_type} - {warning.days_until_expiry}天")
        
        # TODO: 发送通知
        # await notification_service.send_notification(
        #     db=db,
        #     user_ids=user_ids,
        #     title=title,
        #     content=content,
        #     notification_type="alert",
        #     link=f"/suppliers/{warning.supplier_id}/documents"
        # )


async def _send_warning_notifications(db: AsyncSession, warnings: list):
    """
    发送一般预警通知
    
    Args:
        db: 数据库会话
        warnings: 预警列表
    """
    for warning in warnings:
        title = f"供应商证书到期提醒"
        content = (
            f"供应商 {warning.supplier_name} 的 {warning.document_type} 证书将在 "
            f"{warning.days_until_expiry} 天后到期，请及时更新。"
        )
        
        # 暂时打印日志
        print(f"  - 一般预警: {warning.supplier_name} - {warning.document_type} - {warning.days_until_expiry}天")
        
        # TODO: 发送通知
        # await notification_service.send_notification(
        #     db=db,
        #     user_ids=user_ids,
        #     title=title,
        #     content=content,
        #     notification_type="system",
        #     link=f"/suppliers/{warning.supplier_id}/documents"
        # )


@shared_task(name="check_audit_plan_reminders")
def check_audit_plan_reminders():
    """
    检查审核计划并发送提醒
    
    定时任务：每日凌晨03:00执行
    检查即将到来的审核计划并提前7天通知审核员
    """
    asyncio.run(_check_audit_plan_reminders_async())


async def _check_audit_plan_reminders_async():
    """异步执行审核计划提醒检查"""
    async with async_session_maker() as db:
        try:
            from sqlalchemy import select, and_
            from app.models.supplier_audit import SupplierAuditPlan
            from app.models.supplier import Supplier
            
            # 获取当前年月
            now = datetime.utcnow()
            current_year = now.year
            current_month = now.month
            
            # 计算下个月（用于提前7天提醒）
            next_month = current_month + 1 if current_month < 12 else 1
            next_year = current_year if current_month < 12 else current_year + 1
            
            # 查询下个月的审核计划
            result = await db.execute(
                select(SupplierAuditPlan, Supplier)
                .join(Supplier, SupplierAuditPlan.supplier_id == Supplier.id)
                .where(
                    and_(
                        SupplierAuditPlan.audit_year == next_year,
                        SupplierAuditPlan.audit_month == next_month,
                        SupplierAuditPlan.status == "planned"
                    )
                )
            )
            
            plans = result.all()
            
            if not plans:
                print(f"[{datetime.utcnow()}] 审核计划提醒: 无即将到来的审核计划")
                return
            
            print(f"[{datetime.utcnow()}] 审核计划提醒: 发现 {len(plans)} 个即将到来的审核计划")
            
            for plan, supplier in plans:
                title = f"供应商审核计划提醒"
                content = (
                    f"供应商 {supplier.name} 的 {plan.audit_type} 审核计划将在下个月执行，"
                    f"请提前准备审核资料。"
                )
                
                # 暂时打印日志
                print(f"  - 审核提醒: {supplier.name} - {plan.audit_type} - {next_year}年{next_month}月")
                
                # TODO: 发送通知给审核员
                # await notification_service.send_notification(
                #     db=db,
                #     user_ids=[plan.auditor_id],
                #     title=title,
                #     content=content,
                #     notification_type="system",
                #     link=f"/suppliers/audits/plan?supplier_id={supplier.id}"
                # )
            
        except Exception as e:
            print(f"[{datetime.utcnow()}] 审核计划提醒失败: {str(e)}")
            raise
