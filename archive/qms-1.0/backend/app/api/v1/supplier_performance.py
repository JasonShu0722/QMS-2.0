"""
供应商绩效评价 API
Supplier Performance API - 绩效查询、评价、校核接口
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User, UserType
from app.models.supplier_performance import CooperationLevel
from app.schemas.supplier_performance import (
    CooperationEvaluation,
    PerformanceReview,
    PerformanceQueryParams,
    PerformanceResponse,
    PerformanceListResponse,
    PerformanceCardResponse,
    PerformanceStatistics
)
from app.services.supplier_performance_service import SupplierPerformanceService


router = APIRouter(prefix="/supplier-performance", tags=["Supplier Performance"])


def _ensure_internal_user(current_user: User) -> None:
    if current_user.user_type != UserType.INTERNAL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="当前账号无法访问该页面",
        )


@router.get("", response_model=PerformanceListResponse)
async def get_performances(
    supplier_id: int = None,
    year: int = None,
    month: int = None,
    grade: str = None,
    is_reviewed: bool = None,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取绩效列表
    
    支持多条件筛选和分页
    """
    effective_supplier_id = supplier_id
    if current_user.user_type == UserType.SUPPLIER and current_user.supplier_id is not None:
        effective_supplier_id = current_user.supplier_id

    params = PerformanceQueryParams(
        supplier_id=effective_supplier_id,
        year=year,
        month=month,
        grade=grade,
        is_reviewed=is_reviewed,
        page=page,
        page_size=page_size
    )
    
    result = await SupplierPerformanceService.get_performances(db, params)
    
    return PerformanceListResponse(
        total=result["total"],
        page=result["page"],
        page_size=result["page_size"],
        items=[PerformanceResponse.model_validate(item) for item in result["items"]]
    )


@router.get("/{performance_id}", response_model=PerformanceResponse)
async def get_performance_by_id(
    performance_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    根据ID获取绩效详情
    """
    performance = await SupplierPerformanceService.get_performance_by_id(db, performance_id)
    
    if not performance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"绩效记录ID {performance_id} 不存在"
        )
    
    if current_user.user_type == UserType.SUPPLIER and current_user.supplier_id != performance.supplier_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"缁╂晥璁板綍ID {performance_id} 涓嶅瓨鍦?"
        )

    return PerformanceResponse.model_validate(performance)


@router.get("/card/{supplier_id}", response_model=PerformanceCardResponse)
async def get_performance_card(
    supplier_id: int,
    year: int,
    month: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取供应商绩效卡（供应商视图）
    
    包含：
    - 当前绩效
    - 本月扣分情况
    - 历史趋势（最近6个月）
    - 是否需要参加改善会议
    """
    if current_user.user_type == UserType.SUPPLIER and current_user.supplier_id is not None:
        supplier_id = current_user.supplier_id

    try:
        card_data = await SupplierPerformanceService.get_performance_card(
            db, supplier_id, year, month
        )
        return PerformanceCardResponse(**card_data)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )


@router.get("/statistics/{year}/{month}", response_model=PerformanceStatistics)
async def get_performance_statistics(
    year: int,
    month: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取绩效统计
    
    包含：
    - 总供应商数
    - 等级分布
    - 平均得分
    - Top/Bottom供应商
    - 需要关注的供应商（C/D级）
    """
    _ensure_internal_user(current_user)

    stats = await SupplierPerformanceService.get_performance_statistics(db, year, month)
    return PerformanceStatistics(**stats)


@router.post("/{performance_id}/evaluate-cooperation", response_model=PerformanceResponse)
async def evaluate_cooperation(
    performance_id: int,
    evaluation: CooperationEvaluation,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    SQE评价配合度
    
    业务逻辑：
    1. 更新配合度等级和说明
    2. 重新计算绩效（因为配合度扣分变化）
    """
    _ensure_internal_user(current_user)

    try:
        performance = await SupplierPerformanceService.evaluate_cooperation(
            db, performance_id, evaluation, current_user.id
        )
        return PerformanceResponse.model_validate(performance)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )


@router.post("/{performance_id}/review", response_model=PerformanceResponse)
async def review_performance(
    performance_id: int,
    review: PerformanceReview,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    SQE人工校核绩效
    
    业务逻辑：
    1. 记录校核说明和人工调整分数
    2. 重新计算最终得分和等级
    """
    _ensure_internal_user(current_user)

    try:
        performance = await SupplierPerformanceService.review_performance(
            db, performance_id, review, current_user.id
        )
        return PerformanceResponse.model_validate(performance)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )


@router.post("/calculate/{supplier_id}")
async def calculate_performance(
    supplier_id: int,
    year: int,
    month: int,
    cooperation_level: str = None,
    cooperation_comment: str = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    手动触发绩效计算
    
    用于测试或补算历史数据
    """
    _ensure_internal_user(current_user)

    try:
        cooperation_enum = CooperationLevel(cooperation_level) if cooperation_level else None
        
        performance = await SupplierPerformanceService.calculate_and_save_performance(
            db, supplier_id, year, month, cooperation_enum, cooperation_comment
        )
        
        return {
            "message": "绩效计算成功",
            "performance_id": performance.id,
            "final_score": performance.final_score,
            "grade": performance.grade
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post("/batch-calculate/{year}/{month}")
async def batch_calculate_performances(
    year: int,
    month: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    批量计算月度绩效
    
    用于每月1日自动计算所有供应商的绩效
    """
    _ensure_internal_user(current_user)

    result = await SupplierPerformanceService.batch_calculate_monthly_performances(
        db, year, month
    )
    
    return {
        "message": f"批量计算完成",
        "success_count": result["success_count"],
        "failed_count": result["failed_count"],
        "failed_suppliers": result["failed_suppliers"]
    }
