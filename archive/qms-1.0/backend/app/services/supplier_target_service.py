"""
供应商质量目标管理服务
Supplier Target Service - 实现目标设定、签署、审批的业务逻辑
"""
from datetime import datetime
from typing import List, Optional, Dict, Any
from sqlalchemy import select, and_, or_, func, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.supplier_target import SupplierTarget, TargetType
from app.models.supplier import Supplier
from app.models.user import User
from app.schemas.supplier_target import (
    BatchTargetCreate,
    IndividualTargetCreate,
    IndividualTargetUpdate,
    TargetQueryParams,
    HistoricalPerformanceData
)


class SupplierTargetService:
    """供应商质量目标管理服务"""
    
    @staticmethod
    async def batch_create_targets(
        db: AsyncSession,
        data: BatchTargetCreate,
        created_by: int
    ) -> Dict[str, Any]:
        """
        批量设定目标
        
        业务逻辑：
        1. 验证供应商ID是否存在
        2. 检查是否已存在目标（批量设定不覆盖单独设定）
        3. 批量创建目标记录
        4. 返回成功/失败统计
        """
        success_count = 0
        failed_count = 0
        failed_suppliers = []
        created_targets = []
        
        # 验证供应商是否存在
        stmt = select(Supplier).where(Supplier.id.in_(data.supplier_ids))
        result = await db.execute(stmt)
        existing_suppliers = {s.id: s for s in result.scalars().all()}
        
        for supplier_id in data.supplier_ids:
            try:
                # 检查供应商是否存在
                if supplier_id not in existing_suppliers:
                    failed_count += 1
                    failed_suppliers.append({
                        "supplier_id": supplier_id,
                        "reason": "供应商不存在"
                    })
                    continue
                
                # 检查是否已存在目标
                existing_stmt = select(SupplierTarget).where(
                    and_(
                        SupplierTarget.supplier_id == supplier_id,
                        SupplierTarget.year == data.year,
                        SupplierTarget.target_type == data.target_type
                    )
                )
                existing_result = await db.execute(existing_stmt)
                existing_target = existing_result.scalar_one_or_none()
                
                if existing_target:
                    # 如果已存在单独设定，跳过（优先级：单独设定 > 批量设定）
                    if existing_target.is_individual:
                        failed_count += 1
                        failed_suppliers.append({
                            "supplier_id": supplier_id,
                            "reason": "已存在单独设定的目标，批量设定不覆盖"
                        })
                        continue
                    
                    # 如果已存在批量设定，更新
                    existing_target.target_value = data.target_value
                    existing_target.updated_at = datetime.utcnow()
                    existing_target.updated_by = created_by
                    success_count += 1
                    created_targets.append(existing_target.id)
                else:
                    # 创建新目标
                    new_target = SupplierTarget(
                        supplier_id=supplier_id,
                        year=data.year,
                        target_type=data.target_type,
                        target_value=data.target_value,
                        is_individual=False,  # 批量设定
                        is_signed=False,
                        is_approved=False,
                        created_by=created_by
                    )
                    db.add(new_target)
                    await db.flush()
                    success_count += 1
                    created_targets.append(new_target.id)
                    
            except Exception as e:
                failed_count += 1
                failed_suppliers.append({
                    "supplier_id": supplier_id,
                    "reason": str(e)
                })
        
        await db.commit()
        
        return {
            "success_count": success_count,
            "failed_count": failed_count,
            "failed_suppliers": failed_suppliers,
            "created_targets": created_targets
        }
    
    @staticmethod
    async def create_individual_target(
        db: AsyncSession,
        data: IndividualTargetCreate,
        created_by: int
    ) -> SupplierTarget:
        """
        单独设定目标
        
        业务逻辑：
        1. 验证供应商是否存在
        2. 检查是否已存在目标
        3. 如果存在，更新为单独设定；如果不存在，创建新记录
        4. 单独设定优先级高于批量设定
        """
        # 验证供应商是否存在
        supplier_stmt = select(Supplier).where(Supplier.id == data.supplier_id)
        supplier_result = await db.execute(supplier_stmt)
        supplier = supplier_result.scalar_one_or_none()
        
        if not supplier:
            raise ValueError(f"供应商ID {data.supplier_id} 不存在")
        
        # 检查是否已存在目标
        existing_stmt = select(SupplierTarget).where(
            and_(
                SupplierTarget.supplier_id == data.supplier_id,
                SupplierTarget.year == data.year,
                SupplierTarget.target_type == data.target_type
            )
        )
        existing_result = await db.execute(existing_stmt)
        existing_target = existing_result.scalar_one_or_none()
        
        if existing_target:
            # 更新为单独设定
            existing_target.target_value = data.target_value
            existing_target.is_individual = True  # 标记为单独设定
            existing_target.previous_year_actual = data.previous_year_actual
            existing_target.updated_at = datetime.utcnow()
            existing_target.updated_by = created_by
            
            # 如果已签署或已审批，需要重置状态（因为目标值变更）
            if existing_target.is_signed or existing_target.is_approved:
                existing_target.is_signed = False
                existing_target.signed_at = None
                existing_target.signed_by = None
                existing_target.is_approved = False
                existing_target.approved_at = None
                existing_target.approved_by = None
            
            await db.commit()
            await db.refresh(existing_target)
            return existing_target
        else:
            # 创建新目标
            new_target = SupplierTarget(
                supplier_id=data.supplier_id,
                year=data.year,
                target_type=data.target_type,
                target_value=data.target_value,
                is_individual=True,  # 单独设定
                previous_year_actual=data.previous_year_actual,
                is_signed=False,
                is_approved=False,
                created_by=created_by
            )
            db.add(new_target)
            await db.commit()
            await db.refresh(new_target)
            return new_target
    
    @staticmethod
    async def update_individual_target(
        db: AsyncSession,
        target_id: int,
        data: IndividualTargetUpdate,
        updated_by: int
    ) -> SupplierTarget:
        """
        更新单独设定的目标
        
        业务逻辑：
        1. 仅允许更新单独设定的目标
        2. 如果已签署或已审批，更新后需重置状态
        """
        stmt = select(SupplierTarget).where(SupplierTarget.id == target_id)
        result = await db.execute(stmt)
        target = result.scalar_one_or_none()
        
        if not target:
            raise ValueError(f"目标ID {target_id} 不存在")
        
        if not target.is_individual:
            raise ValueError("仅允许更新单独设定的目标，批量设定的目标请使用批量更新接口")
        
        # 更新字段
        if data.target_value is not None:
            target.target_value = data.target_value
            
            # 目标值变更，重置签署和审批状态
            if target.is_signed or target.is_approved:
                target.is_signed = False
                target.signed_at = None
                target.signed_by = None
                target.is_approved = False
                target.approved_at = None
                target.approved_by = None
        
        if data.previous_year_actual is not None:
            target.previous_year_actual = data.previous_year_actual
        
        target.updated_at = datetime.utcnow()
        target.updated_by = updated_by
        
        await db.commit()
        await db.refresh(target)
        return target
    
    @staticmethod
    async def sign_target(
        db: AsyncSession,
        target_id: int,
        user_id: int,
        supplier_id: int
    ) -> SupplierTarget:
        """
        供应商签署目标
        
        业务逻辑：
        1. 验证目标是否属于该供应商
        2. 验证目标是否已审批（必须先审批后签署）
        3. 记录签署时间和签署人
        """
        stmt = select(SupplierTarget).where(SupplierTarget.id == target_id)
        result = await db.execute(stmt)
        target = result.scalar_one_or_none()
        
        if not target:
            raise ValueError(f"目标ID {target_id} 不存在")
        
        # 验证目标是否属于该供应商
        if target.supplier_id != supplier_id:
            raise ValueError("无权签署其他供应商的目标")
        
        # 验证目标是否已审批
        if not target.is_approved:
            raise ValueError("目标尚未审批，无法签署")
        
        # 验证是否已签署
        if target.is_signed:
            raise ValueError("目标已签署，无需重复签署")
        
        # 记录签署
        target.is_signed = True
        target.signed_at = datetime.utcnow()
        target.signed_by = user_id
        target.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(target)
        return target
    
    @staticmethod
    async def approve_targets(
        db: AsyncSession,
        target_ids: List[int],
        approve: bool,
        approved_by: int
    ) -> Dict[str, Any]:
        """
        质量经理审批目标
        
        业务逻辑：
        1. 批量审批多个目标
        2. 记录审批时间和审批人
        3. 返回成功/失败统计
        """
        success_count = 0
        failed_count = 0
        failed_targets = []
        
        for target_id in target_ids:
            try:
                stmt = select(SupplierTarget).where(SupplierTarget.id == target_id)
                result = await db.execute(stmt)
                target = result.scalar_one_or_none()
                
                if not target:
                    failed_count += 1
                    failed_targets.append({
                        "target_id": target_id,
                        "reason": "目标不存在"
                    })
                    continue
                
                # 更新审批状态
                target.is_approved = approve
                target.approved_by = approved_by
                target.approved_at = datetime.utcnow()
                target.updated_at = datetime.utcnow()
                
                # 如果驳回，重置签署状态
                if not approve and target.is_signed:
                    target.is_signed = False
                    target.signed_at = None
                    target.signed_by = None
                
                success_count += 1
                
            except Exception as e:
                failed_count += 1
                failed_targets.append({
                    "target_id": target_id,
                    "reason": str(e)
                })
        
        await db.commit()
        
        return {
            "success_count": success_count,
            "failed_count": failed_count,
            "failed_targets": failed_targets
        }
    
    @staticmethod
    async def get_targets(
        db: AsyncSession,
        params: TargetQueryParams
    ) -> Dict[str, Any]:
        """
        查询目标列表
        
        支持多条件筛选和分页
        """
        # 构建查询条件
        conditions = []
        
        if params.supplier_id is not None:
            conditions.append(SupplierTarget.supplier_id == params.supplier_id)
        
        if params.year is not None:
            conditions.append(SupplierTarget.year == params.year)
        
        if params.target_type is not None:
            conditions.append(SupplierTarget.target_type == params.target_type)
        
        if params.is_signed is not None:
            conditions.append(SupplierTarget.is_signed == params.is_signed)
        
        if params.is_approved is not None:
            conditions.append(SupplierTarget.is_approved == params.is_approved)
        
        if params.is_individual is not None:
            conditions.append(SupplierTarget.is_individual == params.is_individual)
        
        # 查询总数
        count_stmt = select(func.count(SupplierTarget.id))
        if conditions:
            count_stmt = count_stmt.where(and_(*conditions))
        
        count_result = await db.execute(count_stmt)
        total = count_result.scalar()
        
        # 查询数据
        stmt = select(SupplierTarget)
        if conditions:
            stmt = stmt.where(and_(*conditions))
        
        stmt = stmt.order_by(desc(SupplierTarget.created_at))
        stmt = stmt.offset((params.page - 1) * params.page_size).limit(params.page_size)
        
        result = await db.execute(stmt)
        targets = result.scalars().all()
        
        return {
            "total": total,
            "page": params.page,
            "page_size": params.page_size,
            "items": targets
        }
    
    @staticmethod
    async def get_target_by_id(
        db: AsyncSession,
        target_id: int
    ) -> Optional[SupplierTarget]:
        """根据ID获取目标详情"""
        stmt = select(SupplierTarget).where(SupplierTarget.id == target_id)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()
    
    @staticmethod
    async def get_effective_target(
        db: AsyncSession,
        supplier_id: int,
        year: int,
        target_type: TargetType
    ) -> Optional[SupplierTarget]:
        """
        获取生效的目标值
        
        优先级逻辑：单独设定 > 批量设定 > 全局默认值
        """
        stmt = select(SupplierTarget).where(
            and_(
                SupplierTarget.supplier_id == supplier_id,
                SupplierTarget.year == year,
                SupplierTarget.target_type == target_type
            )
        ).order_by(desc(SupplierTarget.is_individual))  # 单独设定优先
        
        result = await db.execute(stmt)
        return result.scalar_one_or_none()
    
    @staticmethod
    async def get_historical_performance(
        db: AsyncSession,
        supplier_id: int,
        target_type: TargetType,
        year: int
    ) -> Optional[HistoricalPerformanceData]:
        """
        获取历史绩效数据（辅助决策）
        
        从 quality_metrics 表查询历史实际值
        计算平均值、最小值、最大值、标准差
        """
        # TODO: 实现从 quality_metrics 表查询历史数据
        # 这里需要根据 target_type 映射到对应的 metric_type
        # 例如：incoming_pass_rate -> incoming_batch_pass_rate
        
        # 暂时返回模拟数据
        return None
    
    @staticmethod
    async def get_unsigned_targets_summary(
        db: AsyncSession,
        year: int
    ) -> Dict[str, Any]:
        """
        获取未签署目标统计
        
        用于管理员监控供应商签署进度
        """
        stmt = select(SupplierTarget).where(
            and_(
                SupplierTarget.year == year,
                SupplierTarget.is_approved == True,  # 已审批
                SupplierTarget.is_signed == False    # 未签署
            )
        )
        
        result = await db.execute(stmt)
        unsigned_targets = result.scalars().all()
        
        # 按供应商分组统计
        by_supplier = {}
        for target in unsigned_targets:
            if target.supplier_id not in by_supplier:
                by_supplier[target.supplier_id] = {
                    "supplier_id": target.supplier_id,
                    "unsigned_count": 0
                }
            by_supplier[target.supplier_id]["unsigned_count"] += 1
        
        return {
            "total_unsigned": len(unsigned_targets),
            "by_supplier": list(by_supplier.values()),
            "deadline": None  # TODO: 从系统配置读取签署截止日期
        }
    
    @staticmethod
    async def check_signing_permission(
        db: AsyncSession,
        supplier_id: int,
        year: int
    ) -> bool:
        """
        检查供应商是否有申诉权限
        
        签署互锁机制：未签署限制申诉权限
        """
        stmt = select(SupplierTarget).where(
            and_(
                SupplierTarget.supplier_id == supplier_id,
                SupplierTarget.year == year,
                SupplierTarget.is_approved == True,  # 已审批
                SupplierTarget.is_signed == False    # 未签署
            )
        )
        
        result = await db.execute(stmt)
        unsigned_targets = result.scalars().all()
        
        # 如果有未签署的目标，限制申诉权限
        return len(unsigned_targets) == 0
