"""
供应商绩效计算引擎
Performance Calculator - 实现60分制扣分模型计算逻辑
"""
from datetime import datetime, date
from typing import Dict, Any, Optional, Tuple
from sqlalchemy import select, and_, func, extract
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.supplier_target import SupplierTarget, TargetType
from app.models.quality_metric import QualityMetric, MetricType
from app.models.supplier_performance import SupplierPerformance, PerformanceGrade, CooperationLevel


class PerformanceCalculator:
    """
    供应商绩效计算器
    
    采用60分制扣分模型：
    - 基础分：60分
    - 最低分：0分
    - 最终得分按100分满分折算百分制
    """
    
    # 基础分
    BASE_SCORE = 60
    
    # 扣分规则
    INCOMING_QUALITY_DEDUCTIONS = {
        "达标": 0,
        "差距<10%": 5,
        "10%≤差距<20%": 15,
        "差距≥20%": 30,
    }
    
    PROCESS_QUALITY_DEDUCTIONS = {
        "达标": 0,
        "0<超标≤50%": 5,
        "50%<超标≤100%": 15,
        "超标>100%": 30,
    }
    
    COOPERATION_DEDUCTIONS = {
        CooperationLevel.HIGH: 0,
        CooperationLevel.MEDIUM: 5,
        CooperationLevel.LOW: 10,
    }
    
    ZERO_KM_DEDUCTIONS = {
        "个例物料问题": 10,
        "批量重大质量异常": 20,
        "安全问题": 30,
    }
    
    @staticmethod
    async def calculate_incoming_quality_deduction(
        db: AsyncSession,
        supplier_id: int,
        year: int,
        month: int
    ) -> Tuple[float, str]:
        """
        计算来料质量扣分
        
        数据源：2.4.1 计算的"来料检验质量合格率"
        算法：计算（2.5.4 设定目标值 - 实际值）的差距
        """
        # 获取目标值
        target_stmt = select(SupplierTarget).where(
            and_(
                SupplierTarget.supplier_id == supplier_id,
                SupplierTarget.year == year,
                SupplierTarget.target_type == TargetType.INCOMING_PASS_RATE
            )
        ).order_by(SupplierTarget.is_individual.desc())  # 单独设定优先
        
        target_result = await db.execute(target_stmt)
        target = target_result.scalar_one_or_none()
        
        if not target:
            return 0.0, "未设定目标值，不扣分"
        
        target_value = target.target_value
        
        # 获取实际值（当月平均）
        metric_stmt = select(func.avg(QualityMetric.value)).where(
            and_(
                QualityMetric.supplier_id == supplier_id,
                QualityMetric.metric_type == MetricType.INCOMING_BATCH_PASS_RATE,
                extract('year', QualityMetric.metric_date) == year,
                extract('month', QualityMetric.metric_date) == month
            )
        )
        
        metric_result = await db.execute(metric_stmt)
        actual_value = metric_result.scalar()
        
        if actual_value is None:
            return 0.0, "当月无数据，不扣分"
        
        # 计算差距
        gap = target_value - actual_value
        gap_percentage = (gap / target_value) * 100 if target_value > 0 else 0
        
        # 判定扣分
        if gap <= 0:
            deduction = PerformanceCalculator.INCOMING_QUALITY_DEDUCTIONS["达标"]
            reason = f"达标（目标{target_value}%，实际{actual_value:.2f}%）"
        elif gap_percentage < 10:
            deduction = PerformanceCalculator.INCOMING_QUALITY_DEDUCTIONS["差距<10%"]
            reason = f"差距{gap_percentage:.2f}%（目标{target_value}%，实际{actual_value:.2f}%）"
        elif gap_percentage < 20:
            deduction = PerformanceCalculator.INCOMING_QUALITY_DEDUCTIONS["10%≤差距<20%"]
            reason = f"差距{gap_percentage:.2f}%（目标{target_value}%，实际{actual_value:.2f}%）"
        else:
            deduction = PerformanceCalculator.INCOMING_QUALITY_DEDUCTIONS["差距≥20%"]
            reason = f"差距{gap_percentage:.2f}%（目标{target_value}%，实际{actual_value:.2f}%）"
        
        return deduction, reason
    
    @staticmethod
    async def calculate_process_quality_deduction(
        db: AsyncSession,
        supplier_id: int,
        year: int,
        month: int
    ) -> Tuple[float, str]:
        """
        计算制程质量扣分
        
        数据源：2.4.1 计算的"物料上线不良 PPM"
        算法：计算（实际 PPM - 2.5.4 设定目标 PPM）的超标比例
        """
        # 获取目标值
        target_stmt = select(SupplierTarget).where(
            and_(
                SupplierTarget.supplier_id == supplier_id,
                SupplierTarget.year == year,
                SupplierTarget.target_type == TargetType.MATERIAL_PPM
            )
        ).order_by(SupplierTarget.is_individual.desc())
        
        target_result = await db.execute(target_stmt)
        target = target_result.scalar_one_or_none()
        
        if not target:
            return 0.0, "未设定目标值，不扣分"
        
        target_ppm = target.target_value
        
        # 获取实际值（当月平均）
        metric_stmt = select(func.avg(QualityMetric.value)).where(
            and_(
                QualityMetric.supplier_id == supplier_id,
                QualityMetric.metric_type == MetricType.MATERIAL_ONLINE_PPM,
                extract('year', QualityMetric.metric_date) == year,
                extract('month', QualityMetric.metric_date) == month
            )
        )
        
        metric_result = await db.execute(metric_stmt)
        actual_ppm = metric_result.scalar()
        
        if actual_ppm is None:
            return 0.0, "当月无数据，不扣分"
        
        # 计算超标比例
        if actual_ppm <= target_ppm:
            deduction = PerformanceCalculator.PROCESS_QUALITY_DEDUCTIONS["达标"]
            reason = f"达标（目标{target_ppm} PPM，实际{actual_ppm:.2f} PPM）"
        else:
            exceed_percentage = ((actual_ppm - target_ppm) / target_ppm) * 100
            
            if exceed_percentage <= 50:
                deduction = PerformanceCalculator.PROCESS_QUALITY_DEDUCTIONS["0<超标≤50%"]
                reason = f"超标{exceed_percentage:.2f}%（目标{target_ppm} PPM，实际{actual_ppm:.2f} PPM）"
            elif exceed_percentage <= 100:
                deduction = PerformanceCalculator.PROCESS_QUALITY_DEDUCTIONS["50%<超标≤100%"]
                reason = f"超标{exceed_percentage:.2f}%（目标{target_ppm} PPM，实际{actual_ppm:.2f} PPM）"
            else:
                deduction = PerformanceCalculator.PROCESS_QUALITY_DEDUCTIONS["超标>100%"]
                reason = f"超标{exceed_percentage:.2f}%（目标{target_ppm} PPM，实际{actual_ppm:.2f} PPM）"
        
        return deduction, reason
    
    @staticmethod
    def calculate_cooperation_deduction(
        cooperation_level: Optional[CooperationLevel]
    ) -> Tuple[float, str]:
        """
        计算配合度扣分
        
        数据源：SQE 人工评价
        标准：高（扣0分）、中（扣5分）、低（扣10分）
        """
        if cooperation_level is None:
            return 0.0, "未评价，不扣分"
        
        deduction = PerformanceCalculator.COOPERATION_DEDUCTIONS.get(cooperation_level, 0)
        reason = f"配合度评价：{cooperation_level.value}"
        
        return deduction, reason
    
    @staticmethod
    async def calculate_zero_km_deduction(
        db: AsyncSession,
        supplier_id: int,
        year: int,
        month: int
    ) -> Tuple[float, str]:
        """
        计算0公里/售后质量扣分
        
        数据源：2.7 模块中的客诉记录（带严重度标签）
        算法：
        - 个例物料问题：每次扣10分
        - 批量重大质量异常：每次扣20分
        - 安全问题（如抛锚）：每次扣30分
        
        注：此处暂时返回0，待2.7模块实现后再完善
        """
        # TODO: 实现从客诉记录查询
        # 需要关联 customer_complaints 表，筛选当月的客诉记录
        # 根据 severity_level 判定扣分
        
        return 0.0, "暂无客诉数据"
    
    @staticmethod
    def calculate_final_score(total_deduction: float) -> float:
        """
        计算最终得分
        
        60分制扣分后按100分满分折算百分制
        公式：最终得分 = max(0, (60 - 总扣分)) / 60 * 100
        """
        score_60 = max(0, PerformanceCalculator.BASE_SCORE - total_deduction)
        final_score = (score_60 / PerformanceCalculator.BASE_SCORE) * 100
        return round(final_score, 2)
    
    @staticmethod
    def determine_grade(final_score: float) -> PerformanceGrade:
        """
        等级评定
        
        - A级：得分 > 95
        - B级：80 ≤ 得分 ≤ 95
        - C级：70 ≤ 得分 < 80
        - D级：得分 < 70
        """
        if final_score > 95:
            return PerformanceGrade.A
        elif final_score >= 80:
            return PerformanceGrade.B
        elif final_score >= 70:
            return PerformanceGrade.C
        else:
            return PerformanceGrade.D
    
    @staticmethod
    async def calculate_monthly_performance(
        db: AsyncSession,
        supplier_id: int,
        year: int,
        month: int,
        cooperation_level: Optional[CooperationLevel] = None
    ) -> Dict[str, Any]:
        """
        计算月度绩效
        
        返回完整的扣分明细和最终得分
        """
        # 1. 来料质量扣分
        incoming_deduction, incoming_reason = await PerformanceCalculator.calculate_incoming_quality_deduction(
            db, supplier_id, year, month
        )
        
        # 2. 制程质量扣分
        process_deduction, process_reason = await PerformanceCalculator.calculate_process_quality_deduction(
            db, supplier_id, year, month
        )
        
        # 3. 配合度扣分
        cooperation_deduction, cooperation_reason = PerformanceCalculator.calculate_cooperation_deduction(
            cooperation_level
        )
        
        # 4. 0公里/售后质量扣分
        zero_km_deduction, zero_km_reason = await PerformanceCalculator.calculate_zero_km_deduction(
            db, supplier_id, year, month
        )
        
        # 5. 计算总扣分
        total_deduction = (
            incoming_deduction +
            process_deduction +
            cooperation_deduction +
            zero_km_deduction
        )
        
        # 6. 计算最终得分
        final_score = PerformanceCalculator.calculate_final_score(total_deduction)
        
        # 7. 等级评定
        grade = PerformanceCalculator.determine_grade(final_score)
        
        return {
            "incoming_quality_deduction": incoming_deduction,
            "incoming_quality_reason": incoming_reason,
            "process_quality_deduction": process_deduction,
            "process_quality_reason": process_reason,
            "cooperation_deduction": cooperation_deduction,
            "cooperation_reason": cooperation_reason,
            "zero_km_deduction": zero_km_deduction,
            "zero_km_reason": zero_km_reason,
            "total_deduction": total_deduction,
            "final_score": final_score,
            "grade": grade.value,
        }
