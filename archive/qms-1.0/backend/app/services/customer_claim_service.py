"""
Customer Claim Service
客户索赔业务逻辑服务
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, extract
from sqlalchemy.orm import selectinload
from typing import Optional, List
from datetime import datetime, date
from decimal import Decimal

from app.models.customer_claim import CustomerClaim
from app.models.customer_complaint import CustomerComplaint
from app.schemas.customer_claim import (
    CustomerClaimCreate,
    CustomerClaimUpdate,
    CustomerClaimStatistics
)


class CustomerClaimService:
    """客户索赔服务类"""

    @staticmethod
    async def create_claim(
        db: AsyncSession,
        claim_data: CustomerClaimCreate,
        created_by: int
    ) -> CustomerClaim:
        """
        创建客户索赔记录
        
        Args:
            db: 数据库会话
            claim_data: 索赔数据
            created_by: 创建人ID
            
        Returns:
            创建的索赔记录
            
        Raises:
            ValueError: 如果客诉单不存在
        """
        # 验证客诉单是否存在
        complaint = await db.get(CustomerComplaint, claim_data.complaint_id)
        if not complaint:
            raise ValueError(f"客诉单ID {claim_data.complaint_id} 不存在")
        
        # 创建索赔记录
        claim = CustomerClaim(
            **claim_data.model_dump(),
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
    ) -> Optional[CustomerClaim]:
        """
        根据ID获取客户索赔记录
        
        Args:
            db: 数据库会话
            claim_id: 索赔ID
            
        Returns:
            索赔记录或None
        """
        result = await db.execute(
            select(CustomerClaim)
            .options(selectinload(CustomerClaim.complaint))
            .where(CustomerClaim.id == claim_id)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def list_claims(
        db: AsyncSession,
        complaint_id: Optional[int] = None,
        customer_name: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        skip: int = 0,
        limit: int = 100
    ) -> tuple[List[CustomerClaim], int]:
        """
        获取客户索赔列表（支持筛选）
        
        Args:
            db: 数据库会话
            complaint_id: 客诉单ID筛选
            customer_name: 客户名称筛选（模糊匹配）
            start_date: 开始日期
            end_date: 结束日期
            skip: 跳过记录数
            limit: 返回记录数
            
        Returns:
            (索赔列表, 总数)
        """
        # 构建查询
        query = select(CustomerClaim).options(selectinload(CustomerClaim.complaint))
        
        # 应用筛选条件
        if complaint_id:
            query = query.where(CustomerClaim.complaint_id == complaint_id)
        if customer_name:
            query = query.where(CustomerClaim.customer_name.ilike(f"%{customer_name}%"))
        if start_date:
            query = query.where(CustomerClaim.claim_date >= start_date)
        if end_date:
            query = query.where(CustomerClaim.claim_date <= end_date)
        
        # 获取总数
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar_one()
        
        # 获取分页数据
        query = query.order_by(CustomerClaim.claim_date.desc()).offset(skip).limit(limit)
        result = await db.execute(query)
        claims = result.scalars().all()
        
        return list(claims), total

    @staticmethod
    async def update_claim(
        db: AsyncSession,
        claim_id: int,
        claim_data: CustomerClaimUpdate
    ) -> Optional[CustomerClaim]:
        """
        更新客户索赔记录
        
        Args:
            db: 数据库会话
            claim_id: 索赔ID
            claim_data: 更新数据
            
        Returns:
            更新后的索赔记录或None
        """
        claim = await db.get(CustomerClaim, claim_id)
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
        删除客户索赔记录
        
        Args:
            db: 数据库会话
            claim_id: 索赔ID
            
        Returns:
            是否删除成功
        """
        claim = await db.get(CustomerClaim, claim_id)
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
    ) -> CustomerClaimStatistics:
        """
        获取客户索赔统计数据
        
        Args:
            db: 数据库会话
            start_date: 开始日期
            end_date: 结束日期
            
        Returns:
            统计数据
        """
        # 构建基础查询
        query = select(CustomerClaim)
        
        if start_date:
            query = query.where(CustomerClaim.claim_date >= start_date)
        if end_date:
            query = query.where(CustomerClaim.claim_date <= end_date)
        
        result = await db.execute(query)
        claims = result.scalars().all()
        
        # 计算统计数据
        total_claims = len(claims)
        total_amount = sum(claim.claim_amount for claim in claims)
        
        # 按客户统计
        by_customer = {}
        for claim in claims:
            customer = claim.customer_name
            by_customer[customer] = by_customer.get(customer, Decimal(0)) + claim.claim_amount
        
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
        
        return CustomerClaimStatistics(
            total_claims=total_claims,
            total_amount=total_amount,
            by_customer=by_customer,
            by_month=by_month,
            by_currency=by_currency
        )
