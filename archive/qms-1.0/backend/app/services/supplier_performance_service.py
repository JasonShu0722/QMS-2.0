"""
供应商绩效管理服务
Supplier Performance Service - 实现绩效计算、查询、校核的业务逻辑
"""
from datetime import datetime, date
from typing import List, Optional, Dict, Any
from sqlalchemy import select, and_, func, desc, extract
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.supplier_performance import SupplierPerformance, PerformanceGrade, CooperationLevel
from app.models.supplier import Supplier
from app.schemas.supplier_performance import (
    CooperationEvaluation,
    PerformanceReview,
    PerformanceQueryParams,
    PerformanceDeductionDetail
)
from app.services.performance_calculator import PerformanceCalculator


class SupplierPerformanceService:
    """供应商绩效管理服务"""
    
    @staticmethod
    async def calculate_and_save_performance(
        db: AsyncSession,
        supplier_id: int,
        year: int,
        month: int,
        cooperation_level: Optional[CooperationLevel] = None,
        cooperation_comment: Optional[str] = None
    ) -> SupplierPerformance:
        """
        计算并保存月度绩效
        
        业务逻辑：
        1. 调用 PerformanceCalculator 计算扣分明细
        2. 检查是否已存在绩效记录
        3. 如果存在，更新；如果不存在，创建
        """
        # 计算绩效
        calculation_result = await PerformanceCalculator.calculate_monthly_performance(
            db, supplier_id, year, month, cooperation_level
        )
        
        # 检查是否已存在
        existing_stmt = select(SupplierPerformance).where(
            and_(
                SupplierPerformance.supplier_id == supplier_id,
                SupplierPerformance.year == year,
                SupplierPerformance.month == month
            )
        )
        existing_result = await db.execute(existing_stmt)
        existing_performance = existing_result.scalar_one_or_none()
        
        if existing_performance:
            # 更新现有记录
            existing_performance.incoming_quality_deduction = calculation_result["incoming_quality_deduction"]
            existing_performance.process_quality_deduction = calculation_result["process_quality_deduction"]
            existing_performance.cooperation_deduction = calculation_result["cooperation_deduction"]
            existing_performance.zero_km_deduction = calculation_result["zero_km_deduction"]
            existing_performance.total_deduction = calculation_result["total_deduction"]
            existing_performance.final_score = calculation_result["final_score"]
            existing_performance.grade = calculation_result["grade"]
            
            if cooperation_level:
                existing_performance.cooperation_level = cooperation_level.value
            if cooperation_comment:
                existing_performance.cooperation_comment = cooperation_comment
            
            existing_performance.updated_at = datetime.utcnow()
            
            await db.commit()
            await db.refresh(existing_performance)
            return existing_performance
        else:
            # 创建新记录
            new_performance = SupplierPerformance(
                supplier_id=supplier_id,
                year=year,
                month=month,
                incoming_quality_deduction=calculation_result["incoming_quality_deduction"],
                process_quality_deduction=calculation_result["process_quality_deduction"],
                cooperation_deduction=calculation_result["cooperation_deduction"],
                zero_km_deduction=calculation_result["zero_km_deduction"],
                total_deduction=calculation_result["total_deduction"],
                final_score=calculation_result["final_score"],
                grade=calculation_result["grade"],
                cooperation_level=cooperation_level.value if cooperation_level else None,
                cooperation_comment=cooperation_comment,
                is_reviewed=False
            )
            
            db.add(new_performance)
            await db.commit()
            await db.refresh(new_performance)
            return new_performance
    
    @staticmethod
    async def evaluate_cooperation(
        db: AsyncSession,
        performance_id: int,
        evaluation: CooperationEvaluation,
        evaluated_by: int
    ) -> SupplierPerformance:
        """
        SQE评价配合度
        
        业务逻辑：
        1. 更新配合度等级和说明
        2. 重新计算绩效（因为配合度扣分变化）
        """
        stmt = select(SupplierPerformance).where(SupplierPerformance.id == performance_id)
        result = await db.execute(stmt)
        performance = result.scalar_one_or_none()
        
        if not performance:
            raise ValueError(f"绩效记录ID {performance_id} 不存在")
        
        # 重新计算绩效（包含新的配合度评价）
        cooperation_level = CooperationLevel(evaluation.cooperation_level)
        calculation_result = await PerformanceCalculator.calculate_monthly_performance(
            db,
            performance.supplier_id,
            performance.year,
            performance.month,
            cooperation_level
        )
        
        # 更新记录
        performance.cooperation_level = evaluation.cooperation_level
        performance.cooperation_comment = evaluation.cooperation_comment
        performance.cooperation_deduction = calculation_result["cooperation_deduction"]
        performance.total_deduction = calculation_result["total_deduction"]
        performance.final_score = calculation_result["final_score"]
        performance.grade = calculation_result["grade"]
        performance.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(performance)
        return performance
    
    @staticmethod
    async def review_performance(
        db: AsyncSession,
        performance_id: int,
        review: PerformanceReview,
        reviewed_by: int
    ) -> SupplierPerformance:
        """
        SQE人工校核绩效
        
        业务逻辑：
        1. 记录校核说明和人工调整分数
        2. 重新计算最终得分和等级
        """
        stmt = select(SupplierPerformance).where(SupplierPerformance.id == performance_id)
        result = await db.execute(stmt)
        performance = result.scalar_one_or_none()
        
        if not performance:
            raise ValueError(f"绩效记录ID {performance_id} 不存在")
        
        # 应用人工调整
        performance.manual_adjustment = review.manual_adjustment
        performance.review_comment = review.review_comment
        performance.is_reviewed = True
        performance.reviewed_by = reviewed_by
        performance.reviewed_at = datetime.utcnow()
        
        # 重新计算最终得分（应用人工调整）
        adjusted_deduction = performance.total_deduction - review.manual_adjustment
        performance.final_score = PerformanceCalculator.calculate_final_score(adjusted_deduction)
        performance.grade = PerformanceCalculator.determine_grade(performance.final_score).value
        
        performance.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(performance)
        return performance
    
    @staticmethod
    async def get_performances(
        db: AsyncSession,
        params: PerformanceQueryParams
    ) -> Dict[str, Any]:
        """
        查询绩效列表
        
        支持多条件筛选和分页
        """
        # 构建查询条件
        conditions = []
        
        if params.supplier_id is not None:
            conditions.append(SupplierPerformance.supplier_id == params.supplier_id)
        
        if params.year is not None:
            conditions.append(SupplierPerformance.year == params.year)
        
        if params.month is not None:
            conditions.append(SupplierPerformance.month == params.month)
        
        if params.grade is not None:
            conditions.append(SupplierPerformance.grade == params.grade)
        
        if params.is_reviewed is not None:
            conditions.append(SupplierPerformance.is_reviewed == params.is_reviewed)
        
        # 查询总数
        count_stmt = select(func.count(SupplierPerformance.id))
        if conditions:
            count_stmt = count_stmt.where(and_(*conditions))
        
        count_result = await db.execute(count_stmt)
        total = count_result.scalar()
        
        # 查询数据
        stmt = select(SupplierPerformance)
        if conditions:
            stmt = stmt.where(and_(*conditions))
        
        stmt = stmt.order_by(
            desc(SupplierPerformance.year),
            desc(SupplierPerformance.month),
            desc(SupplierPerformance.final_score)
        )
        stmt = stmt.offset((params.page - 1) * params.page_size).limit(params.page_size)
        
        result = await db.execute(stmt)
        performances = result.scalars().all()
        
        return {
            "total": total,
            "page": params.page,
            "page_size": params.page_size,
            "items": performances
        }
    
    @staticmethod
    async def get_performance_by_id(
        db: AsyncSession,
        performance_id: int
    ) -> Optional[SupplierPerformance]:
        """根据ID获取绩效详情"""
        stmt = select(SupplierPerformance).where(SupplierPerformance.id == performance_id)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()
    
    @staticmethod
    async def get_performance_card(
        db: AsyncSession,
        supplier_id: int,
        year: int,
        month: int
    ) -> Dict[str, Any]:
        """
        获取供应商绩效卡（供应商视图）
        
        包含：
        - 当前绩效
        - 本月扣分情况
        - 历史趋势（最近6个月）
        - 是否需要参加改善会议
        """
        # 获取当前绩效
        current_stmt = select(SupplierPerformance).where(
            and_(
                SupplierPerformance.supplier_id == supplier_id,
                SupplierPerformance.year == year,
                SupplierPerformance.month == month
            )
        )
        current_result = await db.execute(current_stmt)
        current_performance = current_result.scalar_one_or_none()
        
        if not current_performance:
            raise ValueError(f"供应商 {supplier_id} 在 {year}-{month} 无绩效记录")
        
        # 获取供应商信息
        supplier_stmt = select(Supplier).where(Supplier.id == supplier_id)
        supplier_result = await db.execute(supplier_stmt)
        supplier = supplier_result.scalar_one_or_none()
        
        # 获取历史趋势（最近6个月）
        historical_stmt = select(SupplierPerformance).where(
            SupplierPerformance.supplier_id == supplier_id
        ).order_by(
            desc(SupplierPerformance.year),
            desc(SupplierPerformance.month)
        ).limit(6)
        
        historical_result = await db.execute(historical_stmt)
        historical_performances = historical_result.scalars().all()
        
        historical_scores = [
            {
                "year": p.year,
                "month": p.month,
                "score": p.final_score,
                "grade": p.grade
            }
            for p in reversed(historical_performances)
        ]
        
        # 判断是否需要参加改善会议（C/D级）
        requires_meeting = current_performance.grade in [PerformanceGrade.C.value, PerformanceGrade.D.value]
        
        return {
            "supplier_id": supplier_id,
            "supplier_name": supplier.name if supplier else "未知供应商",
            "year": year,
            "month": month,
            "current_score": current_performance.final_score,
            "current_grade": current_performance.grade,
            "deduction_this_month": current_performance.total_deduction,
            "deduction_detail": {
                "incoming_quality_deduction": current_performance.incoming_quality_deduction,
                "process_quality_deduction": current_performance.process_quality_deduction,
                "cooperation_deduction": current_performance.cooperation_deduction,
                "zero_km_deduction": current_performance.zero_km_deduction,
                "total_deduction": current_performance.total_deduction,
            },
            "historical_scores": historical_scores,
            "requires_meeting": requires_meeting
        }
    
    @staticmethod
    async def get_performance_statistics(
        db: AsyncSession,
        year: int,
        month: int
    ) -> Dict[str, Any]:
        """
        获取绩效统计
        
        包含：
        - 总供应商数
        - 等级分布
        - 平均得分
        - Top/Bottom供应商
        - 需要关注的供应商（C/D级）
        """
        # 查询当月所有绩效
        stmt = select(SupplierPerformance).where(
            and_(
                SupplierPerformance.year == year,
                SupplierPerformance.month == month
            )
        )
        result = await db.execute(stmt)
        performances = result.scalars().all()
        
        if not performances:
            return {
                "total_suppliers": 0,
                "grade_distribution": {},
                "average_score": 0.0,
                "top_suppliers": [],
                "bottom_suppliers": [],
                "requires_attention": []
            }
        
        # 等级分布
        grade_distribution = {
            "A": 0,
            "B": 0,
            "C": 0,
            "D": 0
        }
        for p in performances:
            grade_distribution[p.grade] += 1
        
        # 平均得分
        average_score = sum(p.final_score for p in performances) / len(performances)
        
        # 排序
        sorted_performances = sorted(performances, key=lambda x: x.final_score, reverse=True)
        
        # Top5供应商
        top_suppliers = [
            {
                "supplier_id": p.supplier_id,
                "score": p.final_score,
                "grade": p.grade
            }
            for p in sorted_performances[:5]
        ]
        
        # Bottom5供应商
        bottom_suppliers = [
            {
                "supplier_id": p.supplier_id,
                "score": p.final_score,
                "grade": p.grade
            }
            for p in sorted_performances[-5:]
        ]
        
        # 需要关注的供应商（C/D级）
        requires_attention = [
            {
                "supplier_id": p.supplier_id,
                "score": p.final_score,
                "grade": p.grade,
                "total_deduction": p.total_deduction
            }
            for p in performances
            if p.grade in [PerformanceGrade.C.value, PerformanceGrade.D.value]
        ]
        
        return {
            "total_suppliers": len(performances),
            "grade_distribution": grade_distribution,
            "average_score": round(average_score, 2),
            "top_suppliers": top_suppliers,
            "bottom_suppliers": bottom_suppliers,
            "requires_attention": requires_attention
        }
    
    @staticmethod
    async def batch_calculate_monthly_performances(
        db: AsyncSession,
        year: int,
        month: int
    ) -> Dict[str, Any]:
        """
        批量计算月度绩效（Celery定时任务调用）
        
        业务逻辑：
        1. 查询所有活跃供应商
        2. 逐个计算绩效
        3. 返回成功/失败统计
        """
        # 查询所有活跃供应商
        supplier_stmt = select(Supplier).where(Supplier.status == "active")
        supplier_result = await db.execute(supplier_stmt)
        suppliers = supplier_result.scalars().all()
        
        success_count = 0
        failed_count = 0
        failed_suppliers = []
        
        for supplier in suppliers:
            try:
                await SupplierPerformanceService.calculate_and_save_performance(
                    db,
                    supplier.id,
                    year,
                    month
                )
                success_count += 1
            except Exception as e:
                failed_count += 1
                failed_suppliers.append({
                    "supplier_id": supplier.id,
                    "supplier_name": supplier.name,
                    "reason": str(e)
                })
        
        return {
            "success_count": success_count,
            "failed_count": failed_count,
            "failed_suppliers": failed_suppliers
        }
