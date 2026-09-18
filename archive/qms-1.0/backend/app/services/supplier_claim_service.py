"""
Supplier Claim Service
供应商索赔业务逻辑服务
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from typing import Optional, List
from datetime import datetime, date
from decimal import Decimal

from app.models.supplier_claim import SupplierClaim, SupplierClaimStatus
from app.models.customer_complaint import CustomerComplaint
from app.models.supplier import Supplier
from app.schemas.supplier_claim import (
    SupplierClaimCreate,
    SupplierClaimFromComplaint,
    SupplierClaimUpdate,
    SupplierClaimStatistics
)


class SupplierClaimService:
    """供应商索赔服务类"""

    @staticmethod
    async def create_claim(
        db: AsyncSession,
        claim_data: SupplierClaimCreate,
        created_by: int
    ) -> SupplierClaim:
        """
        创建供应商索赔记录
        
        Args:
            db: 数据库会话
            claim_data: 索赔数据
            created_by: 创建人ID
            
        Returns:
            创建的索赔记录
            
        Raises:
            ValueError: 如果供应商不存在或客诉单不存在
        """
        # 验证供应商是否存在
        supplier = await db.get(Supplier, claim_data.supplier_id)
        if not supplier:
            raise ValueError(f"供应商ID {claim_data.supplier_id} 不存在")
        
        # 如果关联了客诉单，验证客诉单是否存在
        if claim_data.complaint_id:
            complaint = await db.get(CustomerComplaint, claim_data.complaint_id)
            if not complaint:
                raise ValueError(f"客诉单ID {claim_data.complaint_id} 不存在")
        
        # 创建索赔记录
        claim = SupplierClaim(
            **claim_data.model_dump(),
            status=SupplierClaimStatus.DRAFT,
            created_by=created_by
        )
        
        db.add(claim)
        await db.commit()
        await db.refresh(claim)
        
        return claim

    @staticmethod
    async def create_claim_from_complaint(
        db: AsyncSession,
        claim_data: SupplierClaimFromComplaint,
        created_by: int
    ) -> SupplierClaim:
        """
        从客诉单一键转嫁生成供应商索赔
        
        核心逻辑：当8D报告判定根本原因为"供应商来料问题"时，
        可一键将客诉成本转嫁给供应商
        
        Args:
            db: 数据库会话
            claim_data: 转嫁数据
            created_by: 创建人ID
            
        Returns:
            创建的供应商索赔记录
            
        Raises:
            ValueError: 如果客诉单或供应商不存在
        """
        # 验证客诉单是否存在
        complaint = await db.get(CustomerComplaint, claim_data.complaint_id)
        if not complaint:
            raise ValueError(f"客诉单ID {claim_data.complaint_id} 不存在")
        
        # 验证供应商是否存在
        supplier = await db.get(Supplier, claim_data.supplier_id)
        if not supplier:
            raise ValueError(f"供应商ID {claim_data.supplier_id} 不存在")
        
        # 自动生成索赔说明（如果未提供）
        description = claim_data.claim_description
        if not description:
            description = f"客诉单 {complaint.complaint_number} 转嫁索赔 - {complaint.defect_description[:100]}"
        
        # 创建供应商索赔记录
        claim = SupplierClaim(
            complaint_id=claim_data.complaint_id,
            supplier_id=claim_data.supplier_id,
            claim_amount=claim_data.claim_amount,
            claim_currency=claim_data.claim_currency,
            claim_date=date.today(),
            claim_description=description,
            material_code=claim_data.material_code,
            defect_qty=claim_data.defect_qty,
            status=SupplierClaimStatus.DRAFT,
            created_by=created_by
        )
        
        db.add(claim)
        await db.commit()
        await db.refresh(claim)
        
        return claim

    @staticmethod
    async def get_claim_by_id(
        db: AsyncSession,
        claim_id: int
    ) -> Optional[SupplierClaim]:
        """
        根据ID获取供应商索赔记录
        
        Args:
            db: 数据库会话
            claim_id: 索赔ID
            
        Returns:
            索赔记录或None
        """
        result = await db.execute(
            select(SupplierClaim)
            .options(
                selectinload(SupplierClaim.complaint),
                selectinload(SupplierClaim.supplier)
            )
            .where(SupplierClaim.id == claim_id)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def list_claims(
        db: AsyncSession,
        supplier_id: Optional[int] = None,
        complaint_id: Optional[int] = None,
        status: Optional[SupplierClaimStatus] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        skip: int = 0,
        limit: int = 100
    ) -> tuple[List[SupplierClaim], int]:
        """
        获取供应商索赔列表（支持筛选）
        
        Args:
            db: 数据库会话
            supplier_id: 供应商ID筛选
            complaint_id: 客诉单ID筛选
            status: 状态筛选
            start_date: 开始日期
            end_date: 结束日期
            skip: 跳过记录数
            limit: 返回记录数
            
        Returns:
            (索赔列表, 总数)
        """
        # 构建查询
        query = select(SupplierClaim).options(
            selectinload(SupplierClaim.complaint),
            selectinload(SupplierClaim.supplier)
        )
        
        # 应用筛选条件
        if supplier_id:
            query = query.where(SupplierClaim.supplier_id == supplier_id)
        if complaint_id:
            query = query.where(SupplierClaim.complaint_id == complaint_id)
        if status:
            query = query.where(SupplierClaim.status == status)
        if start_date:
            query = query.where(SupplierClaim.claim_date >= start_date)
        if end_date:
            query = query.where(SupplierClaim.claim_date <= end_date)
        
        # 获取总数
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar_one()
        
        # 获取分页数据
        query = query.order_by(SupplierClaim.claim_date.desc()).offset(skip).limit(limit)
        result = await db.execute(query)
        claims = result.scalars().all()
        
        return list(claims), total

    @staticmethod
    async def update_claim(
        db: AsyncSession,
        claim_id: int,
        claim_data: SupplierClaimUpdate
    ) -> Optional[SupplierClaim]:
        """
        更新供应商索赔记录
        
        Args:
            db: 数据库会话
            claim_id: 索赔ID
            claim_data: 更新数据
            
        Returns:
            更新后的索赔记录或None
        """
        claim = await db.get(SupplierClaim, claim_id)
        if not claim:
            return None
        
        # 更新字段
        update_data = claim_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(claim, field, value)
        
        claim.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(claim)
        
        return claim

    @staticmethod
    async def delete_claim(
        db: AsyncSession,
        claim_id: int
    ) -> bool:
        """
        删除供应商索赔记录
        
        Args:
            db: 数据库会话
            claim_id: 索赔ID
            
        Returns:
            是否删除成功
        """
        claim = await db.get(SupplierClaim, claim_id)
        if not claim:
            return False
        
        await db.delete(claim)
        await db.commit()
        
        return True

    @staticmethod
    async def get_statistics(
        db: AsyncSession,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None
    ) -> SupplierClaimStatistics:
        """
        获取供应商索赔统计数据
        
        Args:
            db: 数据库会话
            start_date: 开始日期
            end_date: 结束日期
            
        Returns:
            统计数据
        """
        # 构建基础查询
        query = select(SupplierClaim).options(selectinload(SupplierClaim.supplier))
        
        if start_date:
            query = query.where(SupplierClaim.claim_date >= start_date)
        if end_date:
            query = query.where(SupplierClaim.claim_date <= end_date)
        
        result = await db.execute(query)
        claims = result.scalars().all()
        
        # 计算统计数据
        total_claims = len(claims)
        total_amount = sum(claim.claim_amount for claim in claims)
        
        # 按供应商统计
        by_supplier = {}
        for claim in claims:
            supplier_name = claim.supplier.name if claim.supplier else "未知供应商"
            by_supplier[supplier_name] = by_supplier.get(supplier_name, Decimal(0)) + claim.claim_amount
        
        # 按状态统计
        by_status = {}
        for claim in claims:
            status = claim.status.value
            by_status[status] = by_status.get(status, 0) + 1
        
        # 按月份统计
        by_month = {}
        for claim in claims:
            month_key = claim.claim_date.strftime("%Y-%m")
            by_month[month_key] = by_month.get(month_key, Decimal(0)) + claim.claim_amount
        
        # 按币种统计
        by_currency = {}
        for claim in claims:
            currency = claim.claim_currency
            by_currency[currency] = by_currency.get(currency, Decimal(0)) + claim.claim_amount
        
        return SupplierClaimStatistics(
            total_claims=total_claims,
            total_amount=total_amount,
            by_supplier=by_supplier,
            by_status=by_status,
            by_month=by_month,
            by_currency=by_currency
        )
