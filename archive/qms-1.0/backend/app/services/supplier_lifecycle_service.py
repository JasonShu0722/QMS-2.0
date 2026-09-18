"""
供应商生命周期管理服务
Supplier Lifecycle Management Service
"""
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from sqlalchemy import select, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.supplier import Supplier
from app.models.supplier_document import SupplierDocument
from app.models.supplier_pcn import SupplierPCN
from app.models.supplier_audit import SupplierAuditPlan, SupplierAudit, SupplierAuditNC
from app.schemas.supplier_lifecycle import (
    SupplierDocumentUpload,
    SupplierPCNCreate,
    SupplierPCNUpdate,
    SupplierAuditPlanCreate,
    SupplierAuditCreate,
    SupplierAuditNCCreate,
    SupplierAuditNCUpdate,
    CertificateExpiryWarning
)


class SupplierLifecycleService:
    """供应商生命周期管理服务"""
    
    # ==================== 供应商准入审核 ====================
    
    @staticmethod
    async def qualify_supplier(
        db: AsyncSession,
        supplier_id: int,
        qualification_type: str,
        review_comment: Optional[str],
        reviewed_by: int
    ) -> Supplier:
        """
        供应商准入审核
        
        Args:
            db: 数据库会话
            supplier_id: 供应商ID
            qualification_type: 准入类型
            review_comment: 审核意见
            reviewed_by: 审核人ID
        
        Returns:
            更新后的供应商对象
        """
        # 获取供应商
        result = await db.execute(
            select(Supplier).where(Supplier.id == supplier_id)
        )
        supplier = result.scalar_one_or_none()
        
        if not supplier:
            raise ValueError(f"Supplier with id {supplier_id} not found")
        
        # 更新供应商状态为激活
        supplier.status = "active"
        supplier.updated_by = reviewed_by
        supplier.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(supplier)
        
        return supplier
    
    # ==================== 资质文件管理 ====================
    
    @staticmethod
    async def upload_document(
        db: AsyncSession,
        document_data: SupplierDocumentUpload,
        uploaded_by: int
    ) -> SupplierDocument:
        """
        上传供应商资质文件
        
        Args:
            db: 数据库会话
            document_data: 文件数据
            uploaded_by: 上传人ID
        
        Returns:
            创建的文件记录
        """
        document = SupplierDocument(
            supplier_id=document_data.supplier_id,
            document_type=document_data.document_type,
            document_name=document_data.document_name,
            file_path=document_data.file_path,
            file_size=document_data.file_size,
            issue_date=document_data.issue_date,
            expiry_date=document_data.expiry_date,
            review_status="pending",
            uploaded_by=uploaded_by,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        db.add(document)
        await db.commit()
        await db.refresh(document)
        
        return document
    
    @staticmethod
    async def review_document(
        db: AsyncSession,
        document_id: int,
        review_status: str,
        review_comment: Optional[str],
        reviewed_by: int
    ) -> SupplierDocument:
        """
        审核供应商资质文件
        
        Args:
            db: 数据库会话
            document_id: 文件ID
            review_status: 审核状态
            review_comment: 审核意见
            reviewed_by: 审核人ID
        
        Returns:
            更新后的文件记录
        """
        result = await db.execute(
            select(SupplierDocument).where(SupplierDocument.id == document_id)
        )
        document = result.scalar_one_or_none()
        
        if not document:
            raise ValueError(f"Document with id {document_id} not found")
        
        document.review_status = review_status
        document.review_comment = review_comment
        document.reviewed_by = reviewed_by
        document.reviewed_at = datetime.utcnow()
        document.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(document)
        
        return document
    
    @staticmethod
    async def get_expiring_certificates(
        db: AsyncSession,
        days_threshold: int = 30
    ) -> List[CertificateExpiryWarning]:
        """
        获取即将到期的证书列表
        
        Args:
            db: 数据库会话
            days_threshold: 天数阈值（默认30天）
        
        Returns:
            到期预警列表
        """
        threshold_date = datetime.utcnow() + timedelta(days=days_threshold)
        
        result = await db.execute(
            select(SupplierDocument, Supplier)
            .join(Supplier, SupplierDocument.supplier_id == Supplier.id)
            .where(
                and_(
                    SupplierDocument.expiry_date.isnot(None),
                    SupplierDocument.expiry_date <= threshold_date,
                    SupplierDocument.review_status == "approved"
                )
            )
            .order_by(SupplierDocument.expiry_date)
        )
        
        warnings = []
        for document, supplier in result.all():
            days_until_expiry = (document.expiry_date - datetime.utcnow()).days
            
            # 确定预警级别
            if days_until_expiry < 0:
                warning_level = "critical"  # 已过期
            elif days_until_expiry <= 7:
                warning_level = "critical"  # 7天内
            elif days_until_expiry <= 30:
                warning_level = "warning"   # 30天内
            else:
                warning_level = "info"
            
            warnings.append(CertificateExpiryWarning(
                supplier_id=supplier.id,
                supplier_name=supplier.name,
                document_id=document.id,
                document_type=document.document_type,
                document_name=document.document_name,
                expiry_date=document.expiry_date,
                days_until_expiry=days_until_expiry,
                warning_level=warning_level
            ))
        
        return warnings
    
    # ==================== 供应商变更管理 (PCN) ====================
    
    @staticmethod
    async def create_pcn(
        db: AsyncSession,
        pcn_data: SupplierPCNCreate,
        submitted_by: int
    ) -> SupplierPCN:
        """
        创建供应商变更申请
        
        Args:
            db: 数据库会话
            pcn_data: PCN数据
            submitted_by: 提交人ID
        
        Returns:
            创建的PCN记录
        """
        # 生成PCN编号
        pcn_number = await SupplierLifecycleService._generate_pcn_number(db)
        
        pcn = SupplierPCN(
            pcn_number=pcn_number,
            supplier_id=pcn_data.supplier_id,
            change_type=pcn_data.change_type,
            material_code=pcn_data.material_code,
            change_description=pcn_data.change_description,
            change_reason=pcn_data.change_reason,
            impact_assessment=pcn_data.impact_assessment,
            risk_level=pcn_data.risk_level,
            planned_implementation_date=pcn_data.planned_implementation_date,
            attachments=pcn_data.attachments,
            status="submitted",
            submitted_by=submitted_by,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        db.add(pcn)
        await db.commit()
        await db.refresh(pcn)
        
        return pcn
    
    @staticmethod
    async def update_pcn(
        db: AsyncSession,
        pcn_id: int,
        pcn_update: SupplierPCNUpdate,
        updated_by: int
    ) -> SupplierPCN:
        """
        更新供应商变更申请
        
        Args:
            db: 数据库会话
            pcn_id: PCN ID
            pcn_update: 更新数据
            updated_by: 更新人ID
        
        Returns:
            更新后的PCN记录
        """
        result = await db.execute(
            select(SupplierPCN).where(SupplierPCN.id == pcn_id)
        )
        pcn = result.scalar_one_or_none()
        
        if not pcn:
            raise ValueError(f"PCN with id {pcn_id} not found")
        
        # 更新字段
        if pcn_update.status:
            pcn.status = pcn_update.status
            if pcn_update.status == "approved":
                pcn.approved_by = updated_by
                pcn.approved_at = datetime.utcnow()
        
        if pcn_update.actual_implementation_date:
            pcn.actual_implementation_date = pcn_update.actual_implementation_date
        
        if pcn_update.cutoff_info:
            pcn.cutoff_info = pcn_update.cutoff_info
        
        if pcn_update.review_comment:
            # 添加审核意见到历史记录
            if not pcn.review_comments:
                pcn.review_comments = {}
            pcn.review_comments[datetime.utcnow().isoformat()] = {
                "reviewer_id": updated_by,
                "comment": pcn_update.review_comment
            }
        
        pcn.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(pcn)
        
        return pcn
    
    @staticmethod
    async def _generate_pcn_number(db: AsyncSession) -> str:
        """生成PCN编号"""
        # 获取今天的日期
        today = datetime.utcnow().strftime("%Y%m%d")
        
        # 查询今天已有的PCN数量
        result = await db.execute(
            select(func.count(SupplierPCN.id))
            .where(SupplierPCN.pcn_number.like(f"PCN-{today}-%"))
        )
        count = result.scalar() or 0
        
        # 生成编号: PCN-YYYYMMDD-XXXX
        return f"PCN-{today}-{count + 1:04d}"
    
    # ==================== 审核计划管理 ====================
    
    @staticmethod
    async def create_audit_plan(
        db: AsyncSession,
        plan_data: SupplierAuditPlanCreate,
        created_by: int
    ) -> SupplierAuditPlan:
        """
        创建供应商审核计划
        
        Args:
            db: 数据库会话
            plan_data: 计划数据
            created_by: 创建人ID
        
        Returns:
            创建的审核计划
        """
        plan = SupplierAuditPlan(
            supplier_id=plan_data.supplier_id,
            audit_year=plan_data.audit_year,
            audit_month=plan_data.audit_month,
            audit_type=plan_data.audit_type,
            auditor_id=plan_data.auditor_id,
            notes=plan_data.notes,
            status="planned",
            created_by=created_by,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        db.add(plan)
        await db.commit()
        await db.refresh(plan)
        
        return plan
    
    @staticmethod
    async def get_audit_plans(
        db: AsyncSession,
        audit_year: Optional[int] = None,
        supplier_id: Optional[int] = None,
        auditor_id: Optional[int] = None
    ) -> List[SupplierAuditPlan]:
        """
        获取审核计划列表
        
        Args:
            db: 数据库会话
            audit_year: 审核年度（可选）
            supplier_id: 供应商ID（可选）
            auditor_id: 审核员ID（可选）
        
        Returns:
            审核计划列表
        """
        query = select(SupplierAuditPlan)
        
        conditions = []
        if audit_year:
            conditions.append(SupplierAuditPlan.audit_year == audit_year)
        if supplier_id:
            conditions.append(SupplierAuditPlan.supplier_id == supplier_id)
        if auditor_id:
            conditions.append(SupplierAuditPlan.auditor_id == auditor_id)
        
        if conditions:
            query = query.where(and_(*conditions))
        
        query = query.order_by(
            SupplierAuditPlan.audit_year.desc(),
            SupplierAuditPlan.audit_month
        )
        
        result = await db.execute(query)
        return result.scalars().all()
    
    # ==================== 审核记录管理 ====================
    
    @staticmethod
    async def create_audit(
        db: AsyncSession,
        audit_data: SupplierAuditCreate,
        created_by: int
    ) -> SupplierAudit:
        """
        创建供应商审核记录
        
        Args:
            db: 数据库会话
            audit_data: 审核数据
            created_by: 创建人ID
        
        Returns:
            创建的审核记录
        """
        # 生成审核编号
        audit_number = await SupplierLifecycleService._generate_audit_number(db)
        
        audit = SupplierAudit(
            audit_plan_id=audit_data.audit_plan_id,
            supplier_id=audit_data.supplier_id,
            audit_number=audit_number,
            audit_type=audit_data.audit_type,
            audit_date=audit_data.audit_date,
            auditor_id=audit_data.auditor_id,
            audit_team=audit_data.audit_team,
            audit_result=audit_data.audit_result,
            score=audit_data.score,
            nc_major_count=audit_data.nc_major_count,
            nc_minor_count=audit_data.nc_minor_count,
            nc_observation_count=audit_data.nc_observation_count,
            audit_report_path=audit_data.audit_report_path,
            summary=audit_data.summary,
            status="completed" if audit_data.nc_major_count == 0 and audit_data.nc_minor_count == 0 else "nc_open",
            created_by=created_by,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        db.add(audit)
        await db.commit()
        await db.refresh(audit)
        
        # 如果关联了审核计划，更新计划状态
        if audit_data.audit_plan_id:
            plan_result = await db.execute(
                select(SupplierAuditPlan).where(SupplierAuditPlan.id == audit_data.audit_plan_id)
            )
            plan = plan_result.scalar_one_or_none()
            if plan:
                plan.status = "completed"
                await db.commit()
        
        return audit
    
    @staticmethod
    async def _generate_audit_number(db: AsyncSession) -> str:
        """生成审核编号"""
        today = datetime.utcnow().strftime("%Y%m%d")
        
        result = await db.execute(
            select(func.count(SupplierAudit.id))
            .where(SupplierAudit.audit_number.like(f"AUDIT-{today}-%"))
        )
        count = result.scalar() or 0
        
        return f"AUDIT-{today}-{count + 1:04d}"
    
    # ==================== 不符合项管理 ====================
    
    @staticmethod
    async def create_audit_nc(
        db: AsyncSession,
        nc_data: SupplierAuditNCCreate,
        created_by: int
    ) -> SupplierAuditNC:
        """
        创建审核不符合项
        
        Args:
            db: 数据库会话
            nc_data: NC数据
            created_by: 创建人ID
        
        Returns:
            创建的NC记录
        """
        # 生成NC编号
        nc_number = await SupplierLifecycleService._generate_nc_number(db, nc_data.audit_id)
        
        nc = SupplierAuditNC(
            audit_id=nc_data.audit_id,
            nc_number=nc_number,
            nc_type=nc_data.nc_type,
            nc_item=nc_data.nc_item,
            nc_description=nc_data.nc_description,
            evidence_photos=nc_data.evidence_photos,
            responsible_dept=nc_data.responsible_dept,
            assigned_to=nc_data.assigned_to,
            deadline=nc_data.deadline,
            verification_status="open",
            created_by=created_by,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        db.add(nc)
        await db.commit()
        await db.refresh(nc)
        
        return nc
    
    @staticmethod
    async def update_audit_nc(
        db: AsyncSession,
        nc_id: int,
        nc_update: SupplierAuditNCUpdate,
        updated_by: int
    ) -> SupplierAuditNC:
        """
        更新审核不符合项
        
        Args:
            db: 数据库会话
            nc_id: NC ID
            nc_update: 更新数据
            updated_by: 更新人ID
        
        Returns:
            更新后的NC记录
        """
        result = await db.execute(
            select(SupplierAuditNC).where(SupplierAuditNC.id == nc_id)
        )
        nc = result.scalar_one_or_none()
        
        if not nc:
            raise ValueError(f"NC with id {nc_id} not found")
        
        # 更新字段
        if nc_update.assigned_to is not None:
            nc.assigned_to = nc_update.assigned_to
        
        if nc_update.root_cause:
            nc.root_cause = nc_update.root_cause
        
        if nc_update.corrective_action:
            nc.corrective_action = nc_update.corrective_action
        
        if nc_update.corrective_evidence:
            nc.corrective_evidence = nc_update.corrective_evidence
        
        if nc_update.verification_status:
            nc.verification_status = nc_update.verification_status
            if nc_update.verification_status == "verified":
                nc.verified_by = updated_by
                nc.verified_at = datetime.utcnow()
            elif nc_update.verification_status == "closed":
                nc.closed_at = datetime.utcnow()
        
        if nc_update.verification_comment:
            nc.verification_comment = nc_update.verification_comment
        
        nc.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(nc)
        
        # 检查审核记录的所有NC是否都已关闭
        await SupplierLifecycleService._check_audit_nc_status(db, nc.audit_id)
        
        return nc
    
    @staticmethod
    async def _generate_nc_number(db: AsyncSession, audit_id: int) -> str:
        """生成NC编号"""
        # 获取审核记录
        result = await db.execute(
            select(SupplierAudit).where(SupplierAudit.id == audit_id)
        )
        audit = result.scalar_one_or_none()
        
        if not audit:
            raise ValueError(f"Audit with id {audit_id} not found")
        
        # 查询该审核下已有的NC数量
        nc_result = await db.execute(
            select(func.count(SupplierAuditNC.id))
            .where(SupplierAuditNC.audit_id == audit_id)
        )
        count = nc_result.scalar() or 0
        
        return f"{audit.audit_number}-NC-{count + 1:03d}"
    
    @staticmethod
    async def _check_audit_nc_status(db: AsyncSession, audit_id: int):
        """检查审核记录的NC状态，如果全部关闭则更新审核状态"""
        # 查询该审核下所有未关闭的NC
        result = await db.execute(
            select(func.count(SupplierAuditNC.id))
            .where(
                and_(
                    SupplierAuditNC.audit_id == audit_id,
                    SupplierAuditNC.verification_status != "closed"
                )
            )
        )
        open_nc_count = result.scalar() or 0
        
        # 如果没有未关闭的NC，更新审核状态
        if open_nc_count == 0:
            audit_result = await db.execute(
                select(SupplierAudit).where(SupplierAudit.id == audit_id)
            )
            audit = audit_result.scalar_one_or_none()
            if audit and audit.status == "nc_open":
                audit.status = "nc_closed"
                await db.commit()


# 创建服务实例
supplier_lifecycle_service = SupplierLifecycleService()
