"""
质量数据 API 路由
Quality Metrics Routes - 质量数据面板相关接口
"""
from datetime import date, datetime, timedelta
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, desc

from app.core.database import get_db
from app.core.dependencies import get_current_active_user
from app.core.permissions import require_permission, has_permission
from app.models.user import User, UserType
from app.models.permission import OperationType
from app.models.quality_metric import QualityMetric, MetricType
from app.models.supplier import Supplier
from app.services.metrics_calculator import metrics_calculator
from app.schemas.quality_metric import (
    DashboardResponse,
    DashboardMetricSummary,
    MetricTrendRequest,
    MetricTrendResponse,
    DrillDownRequest,
    DrillDownResponse,
    TopSuppliersResponse,
    TopSupplierItem,
    ProcessAnalysisResponse,
    ProcessAnalysisItem,
    CustomerAnalysisResponse,
    CustomerAnalysisItem,
    QualityMetricResponse
)

router = APIRouter(prefix="/quality-metrics", tags=["质量数据面板"])


# 指标类型到中文名称的映射
METRIC_NAMES = {
    MetricType.INCOMING_BATCH_PASS_RATE: "来料批次合格率",
    MetricType.MATERIAL_ONLINE_PPM: "物料上线不良PPM",
    MetricType.PROCESS_DEFECT_RATE: "制程不合格率",
    MetricType.PROCESS_FPY: "制程直通率",
    MetricType.OKM_PPM: "0KM不良PPM",
    MetricType.MIS_3_PPM: "3MIS售后不良PPM",
    MetricType.MIS_12_PPM: "12MIS售后不良PPM",
}

QUALITY_DASHBOARD_PERMISSION = "quality.data_panel"
SUPPLIER_ANALYSIS_PERMISSION = "supplier.performance"
PROCESS_ANALYSIS_PERMISSION = "quality.process"
CUSTOMER_ANALYSIS_PERMISSION = "quality.customer"
SUPPLIER_VISIBLE_METRIC_TYPES = {
    MetricType.INCOMING_BATCH_PASS_RATE.value,
    MetricType.MATERIAL_ONLINE_PPM.value,
}


async def _ensure_permission(
    *,
    current_user: User,
    db: AsyncSession,
    module_path: str,
    operation: OperationType = OperationType.READ,
) -> None:
    has_perm = await has_permission(
        user=current_user,
        module_path=module_path,
        operation=operation,
        db=db,
    )

    if not has_perm:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"权限不足，需要 '{module_path}.{operation.value}' 权限",
        )


def _ensure_internal_user(current_user: User) -> None:
    if current_user.user_type != UserType.INTERNAL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="当前账号无法访问该分析视图",
        )


def _ensure_supplier_metric_access(current_user: User, metric_type: str) -> None:
    if current_user.user_type == UserType.SUPPLIER and metric_type not in SUPPLIER_VISIBLE_METRIC_TYPES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="当前账号仅可查看归属供应商的质量趋势数据",
        )


@router.get(
    "/dashboard",
    response_model=DashboardResponse,
    summary="获取仪表盘数据",
    description="""
    获取质量数据仪表盘的核心指标数据。
    
    **权限要求：**
    - 需要 quality.dashboard.read 权限
    - 用户只能查看被授权的指标
    
    **数据范围：**
    - 内部员工：查看所有数据
    - 供应商：仅查看关联到自己的数据
    
    **返回指标：**
    - 来料批次合格率
    - 物料上线不良PPM
    - 制程不合格率
    - 制程直通率
    - 0KM不良PPM
    - 3MIS售后不良PPM
    - 12MIS售后不良PPM
    
    Requirements: 2.4.2
    """
)
async def get_dashboard(
    target_date: Optional[date] = Query(None, description="目标日期，默认为今天"),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """获取仪表盘数据"""
    
    await _ensure_permission(
        current_user=current_user,
        db=db,
        module_path=QUALITY_DASHBOARD_PERMISSION,
    )
    
    # 默认使用今天的日期
    if target_date is None:
        target_date = date.today()
    
    # 构建查询
    query = select(QualityMetric).where(
        QualityMetric.metric_date == target_date
    )
    
    # 供应商用户：仅查看关联到自己的供应商质量走势数据
    if current_user.user_type == UserType.SUPPLIER:
        query = query.where(QualityMetric.metric_type.in_(SUPPLIER_VISIBLE_METRIC_TYPES))
        if current_user.supplier_id:
            query = query.where(QualityMetric.supplier_id == current_user.supplier_id)
    
    result = await db.execute(query)
    metrics = result.scalars().all()
    
    # 构建仪表盘指标摘要
    metric_summaries = []
    
    for metric in metrics:
        # 判断状态
        if metric.is_target_met() is None:
            status_str = "unknown"
        elif metric.is_target_met():
            status_str = "good"
        else:
            status_str = "danger"
        
        # 计算趋势（与前一天对比）
        prev_date = target_date - timedelta(days=1)
        prev_query = select(QualityMetric).where(
            and_(
                QualityMetric.metric_type == metric.metric_type,
                QualityMetric.metric_date == prev_date,
                QualityMetric.supplier_id == metric.supplier_id if metric.supplier_id else True,
                QualityMetric.product_type == metric.product_type if metric.product_type else True
            )
        )
        prev_result = await db.execute(prev_query)
        prev_metric = prev_result.scalar_one_or_none()
        
        trend = "stable"
        change_percentage = None
        
        if prev_metric:
            change = float(metric.value) - float(prev_metric.value)
            if prev_metric.value != 0:
                change_percentage = (change / float(prev_metric.value)) * 100
            
            if abs(change) > 0.01:  # 变化超过0.01才认为有趋势
                trend = "up" if change > 0 else "down"
        
        metric_summaries.append(
            DashboardMetricSummary(
                metric_type=metric.metric_type,
                metric_name=METRIC_NAMES.get(MetricType(metric.metric_type), metric.metric_type),
                current_value=float(metric.value),
                target_value=float(metric.target_value) if metric.target_value else None,
                is_target_met=metric.is_target_met(),
                status=status_str,
                trend=trend,
                change_percentage=change_percentage
            )
        )
    
    # 构建汇总信息
    summary = {
        "total_metrics": len(metric_summaries),
        "good_count": sum(1 for m in metric_summaries if m.status == "good"),
        "danger_count": sum(1 for m in metric_summaries if m.status == "danger"),
        "date": target_date.isoformat()
    }
    
    return DashboardResponse(
        date=target_date,
        metrics=metric_summaries,
        summary=summary
    )


@router.get(
    "/trend",
    response_model=MetricTrendResponse,
    summary="获取指标趋势",
    description="""
    获取指定指标的趋势数据，支持时间范围筛选。
    
    **权限要求：**
    - 需要 quality.metrics.read 权限
    
    **筛选条件：**
    - 时间范围：start_date 到 end_date
    - 供应商ID（可选）
    - 产品类型（可选）
    - 产线ID（可选）
    - 工序ID（可选）
    
    Requirements: 2.4.2
    """
)
async def get_metric_trend(
    metric_type: str = Query(..., description="指标类型"),
    start_date: date = Query(..., description="开始日期"),
    end_date: date = Query(..., description="结束日期"),
    supplier_id: Optional[int] = Query(None, description="供应商ID"),
    product_type: Optional[str] = Query(None, description="产品类型"),
    line_id: Optional[str] = Query(None, description="产线ID"),
    process_id: Optional[str] = Query(None, description="工序ID"),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """获取指标趋势"""
    
    await _ensure_permission(
        current_user=current_user,
        db=db,
        module_path=QUALITY_DASHBOARD_PERMISSION,
    )
    
    # 验证指标类型
    try:
        metric_type_enum = MetricType(metric_type)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"无效的指标类型: {metric_type}"
        )

    _ensure_supplier_metric_access(current_user, metric_type)
    
    # 供应商用户：强制使用自己的supplier_id
    if current_user.user_type == UserType.SUPPLIER and current_user.supplier_id:
        supplier_id = current_user.supplier_id
    
    # 调用计算引擎获取趋势数据
    trend_data = await metrics_calculator.get_metric_trend(
        db=db,
        metric_type=metric_type_enum,
        start_date=start_date,
        end_date=end_date,
        supplier_id=supplier_id,
        product_type=product_type,
        line_id=line_id,
        process_id=process_id
    )
    
    # 计算统计信息
    values = [float(m.value) for m in trend_data]
    statistics = {
        "count": len(values),
        "average": sum(values) / len(values) if values else 0,
        "max": max(values) if values else 0,
        "min": min(values) if values else 0,
        "latest": values[-1] if values else 0
    }
    
    # 转换为响应格式
    data_points = [
        QualityMetricResponse(
            id=m.id,
            metric_type=m.metric_type,
            metric_date=m.metric_date,
            value=float(m.value),
            target_value=float(m.target_value) if m.target_value else None,
            product_type=m.product_type,
            supplier_id=m.supplier_id,
            line_id=m.line_id,
            process_id=m.process_id,
            is_target_met=m.is_target_met(),
            created_at=m.created_at.isoformat(),
            updated_at=m.updated_at.isoformat()
        )
        for m in trend_data
    ]
    
    return MetricTrendResponse(
        metric_type=metric_type,
        metric_name=METRIC_NAMES.get(metric_type_enum, metric_type),
        start_date=start_date,
        end_date=end_date,
        data_points=data_points,
        statistics=statistics
    )


@router.get(
    "/drill-down",
    response_model=DrillDownResponse,
    summary="下钻查询",
    description="""
    点击指标查看明细数据，支持多维度下钻。
    
    **权限要求：**
    - 需要 quality.metrics.read 权限
    
    **下钻维度：**
    - 按供应商
    - 按产品类型
    - 按产线
    - 按工序
    
    Requirements: 2.4.2
    """
)
async def drill_down_metric(
    metric_type: str = Query(..., description="指标类型"),
    metric_date: date = Query(..., description="指标日期"),
    supplier_id: Optional[int] = Query(None, description="供应商ID"),
    product_type: Optional[str] = Query(None, description="产品类型"),
    line_id: Optional[str] = Query(None, description="产线ID"),
    process_id: Optional[str] = Query(None, description="工序ID"),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """下钻查询"""
    
    await _ensure_permission(
        current_user=current_user,
        db=db,
        module_path=QUALITY_DASHBOARD_PERMISSION,
    )
    
    # 验证指标类型
    try:
        metric_type_enum = MetricType(metric_type)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"无效的指标类型: {metric_type}"
        )

    _ensure_supplier_metric_access(current_user, metric_type)
    
    # 供应商用户：强制使用自己的supplier_id
    if current_user.user_type == UserType.SUPPLIER and current_user.supplier_id:
        supplier_id = current_user.supplier_id
    
    # 查询指定日期的指标
    query = select(QualityMetric).where(
        and_(
            QualityMetric.metric_type == metric_type,
            QualityMetric.metric_date == metric_date
        )
    )
    
    if supplier_id:
        query = query.where(QualityMetric.supplier_id == supplier_id)
    if product_type:
        query = query.where(QualityMetric.product_type == product_type)
    if line_id:
        query = query.where(QualityMetric.line_id == line_id)
    if process_id:
        query = query.where(QualityMetric.process_id == process_id)
    
    result = await db.execute(query)
    metric = result.scalar_one_or_none()
    
    if not metric:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="未找到指定的指标数据"
        )
    
    # 构建明细数据（这里是示例，实际应从原始数据表查询）
    details = [
        {
            "date": metric.metric_date.isoformat(),
            "value": float(metric.value),
            "supplier_id": metric.supplier_id,
            "product_type": metric.product_type,
            "line_id": metric.line_id,
            "process_id": metric.process_id
        }
    ]
    
    # 构建分类统计（按不同维度聚合）
    breakdown = {
        "by_supplier": {},
        "by_product_type": {},
        "by_line": {},
        "by_process": {}
    }
    
    # 按供应商分类统计
    if not supplier_id:
        supplier_query = select(
            QualityMetric.supplier_id,
            func.avg(QualityMetric.value).label("avg_value"),
            func.count(QualityMetric.id).label("count")
        ).where(
            and_(
                QualityMetric.metric_type == metric_type,
                QualityMetric.metric_date == metric_date
            )
        ).group_by(QualityMetric.supplier_id)
        
        supplier_result = await db.execute(supplier_query)
        for row in supplier_result:
            if row.supplier_id:
                breakdown["by_supplier"][str(row.supplier_id)] = {
                    "avg_value": float(row.avg_value),
                    "count": row.count
                }
    
    return DrillDownResponse(
        metric_type=metric_type,
        metric_date=metric_date,
        metric_value=float(metric.value),
        details=details,
        breakdown=breakdown
    )


@router.get(
    "/top-suppliers",
    response_model=TopSuppliersResponse,
    summary="获取Top5供应商清单",
    description="""
    获取指定指标的Top5供应商清单（来料批次合格率、物料上线不良PPM）。
    
    **权限要求：**
    - 需要 quality.supplier-analysis.read 权限
    
    **支持的指标类型：**
    - incoming_batch_pass_rate: 来料批次合格率
    - material_online_ppm: 物料上线不良PPM
    
    Requirements: 2.4.3
    """
)
async def get_top_suppliers(
    metric_type: str = Query(..., description="指标类型"),
    period: str = Query("monthly", description="统计周期：daily/monthly/yearly"),
    target_date: Optional[date] = Query(None, description="目标日期，默认为今天"),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """获取Top5供应商清单"""
    
    _ensure_internal_user(current_user)
    await _ensure_permission(
        current_user=current_user,
        db=db,
        module_path=QUALITY_DASHBOARD_PERMISSION,
    )
    
    # 验证指标类型（仅支持供应商相关指标）
    if metric_type not in [
        MetricType.INCOMING_BATCH_PASS_RATE.value,
        MetricType.MATERIAL_ONLINE_PPM.value
    ]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该接口仅支持来料批次合格率和物料上线不良PPM指标"
        )
    
    # 默认使用今天的日期
    if target_date is None:
        target_date = date.today()
    
    # 根据周期计算日期范围
    if period == "daily":
        start_date = target_date
        end_date = target_date
    elif period == "monthly":
        start_date = target_date.replace(day=1)
        # 计算月末
        if target_date.month == 12:
            end_date = target_date.replace(year=target_date.year + 1, month=1, day=1) - timedelta(days=1)
        else:
            end_date = target_date.replace(month=target_date.month + 1, day=1) - timedelta(days=1)
    elif period == "yearly":
        start_date = target_date.replace(month=1, day=1)
        end_date = target_date.replace(month=12, day=31)
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="无效的统计周期，支持：daily/monthly/yearly"
        )
    
    # 查询并聚合数据
    query = select(
        QualityMetric.supplier_id,
        func.avg(QualityMetric.value).label("avg_value")
    ).where(
        and_(
            QualityMetric.metric_type == metric_type,
            QualityMetric.metric_date >= start_date,
            QualityMetric.metric_date <= end_date,
            QualityMetric.supplier_id.isnot(None)
        )
    ).group_by(QualityMetric.supplier_id)
    
    # 根据指标类型排序（PPM越小越好，合格率越大越好）
    if metric_type == MetricType.MATERIAL_ONLINE_PPM.value:
        query = query.order_by(func.avg(QualityMetric.value).asc())  # PPM越小越好
    else:
        query = query.order_by(func.avg(QualityMetric.value).desc())  # 合格率越大越好
    
    query = query.limit(5)
    
    result = await db.execute(query)
    top_data = result.all()
    
    # 获取供应商名称
    top_suppliers = []
    for rank, row in enumerate(top_data, start=1):
        supplier_query = select(Supplier).where(Supplier.id == row.supplier_id)
        supplier_result = await db.execute(supplier_query)
        supplier = supplier_result.scalar_one_or_none()
        
        # 判断状态
        avg_value = float(row.avg_value)
        if metric_type == MetricType.MATERIAL_ONLINE_PPM.value:
            # PPM指标：< 100 good, 100-500 warning, > 500 danger
            if avg_value < 100:
                status_str = "good"
            elif avg_value < 500:
                status_str = "warning"
            else:
                status_str = "danger"
        else:
            # 合格率指标：> 99% good, 95-99% warning, < 95% danger
            if avg_value > 99:
                status_str = "good"
            elif avg_value > 95:
                status_str = "warning"
            else:
                status_str = "danger"
        
        top_suppliers.append(
            TopSupplierItem(
                supplier_id=row.supplier_id,
                supplier_name=supplier.name if supplier else f"供应商{row.supplier_id}",
                metric_value=avg_value,
                rank=rank,
                status=status_str
            )
        )
    
    return TopSuppliersResponse(
        metric_type=metric_type,
        metric_name=METRIC_NAMES.get(MetricType(metric_type), metric_type),
        period=period,
        date=target_date,
        top_suppliers=top_suppliers
    )


@router.get(
    "/process-analysis",
    response_model=ProcessAnalysisResponse,
    summary="制程质量分析",
    description="""
    制程质量数据分析，按责任类别、工序、线体进行分类统计。
    
    **权限要求：**
    - 需要 quality.process-analysis.read 权限
    
    **分析维度：**
    - 按责任类别统计（物料不良、作业不良、设备不良、工艺不良、设计不良）
    - 按工序统计
    - 按线体统计
    - 月度趋势
    
    Requirements: 2.4.3
    """
)
async def get_process_analysis(
    start_date: date = Query(..., description="开始日期"),
    end_date: date = Query(..., description="结束日期"),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """制程质量分析"""
    
    _ensure_internal_user(current_user)
    await _ensure_permission(
        current_user=current_user,
        db=db,
        module_path=QUALITY_DASHBOARD_PERMISSION,
    )
    
    # 查询制程不合格率和直通率数据
    query = select(QualityMetric).where(
        and_(
            QualityMetric.metric_type.in_([
                MetricType.PROCESS_DEFECT_RATE.value,
                MetricType.PROCESS_FPY.value
            ]),
            QualityMetric.metric_date >= start_date,
            QualityMetric.metric_date <= end_date
        )
    )
    
    result = await db.execute(query)
    metrics = result.scalars().all()
    
    # 按线体统计
    by_line: Dict[str, Dict[str, Any]] = {}
    for metric in metrics:
        if metric.line_id:
            if metric.line_id not in by_line:
                by_line[metric.line_id] = {
                    "defect_rates": [],
                    "fpys": [],
                    "defect_count": 0,
                    "total_count": 0
                }
            
            if metric.metric_type == MetricType.PROCESS_DEFECT_RATE.value:
                by_line[metric.line_id]["defect_rates"].append(float(metric.value))
            elif metric.metric_type == MetricType.PROCESS_FPY.value:
                by_line[metric.line_id]["fpys"].append(float(metric.value))
    
    # 构建按线体统计结果
    by_line_items = []
    for line_id, data in by_line.items():
        avg_defect_rate = sum(data["defect_rates"]) / len(data["defect_rates"]) if data["defect_rates"] else 0
        avg_fpy = sum(data["fpys"]) / len(data["fpys"]) if data["fpys"] else 0
        
        # 判断趋势（简化版：比较前后两半数据）
        trend = "stable"
        if len(data["defect_rates"]) >= 4:
            first_half = sum(data["defect_rates"][:len(data["defect_rates"])//2]) / (len(data["defect_rates"])//2)
            second_half = sum(data["defect_rates"][len(data["defect_rates"])//2:]) / (len(data["defect_rates"]) - len(data["defect_rates"])//2)
            if second_half < first_half * 0.9:
                trend = "improving"
            elif second_half > first_half * 1.1:
                trend = "worsening"
        
        by_line_items.append(
            ProcessAnalysisItem(
                category="line",
                category_name=line_id,
                defect_rate=avg_defect_rate,
                fpy=avg_fpy,
                defect_count=data["defect_count"],
                total_count=data["total_count"],
                trend=trend
            )
        )
    
    # 按工序统计（类似逻辑）
    by_process_items = []  # 简化处理，实际应类似按线体统计
    
    # 按责任类别统计（需要从原始数据表查询，这里返回空列表）
    by_responsibility_items = []
    
    # 月度趋势
    monthly_trend = []
    current_month = start_date.replace(day=1)
    while current_month <= end_date:
        month_metrics = [m for m in metrics if m.metric_date.year == current_month.year and m.metric_date.month == current_month.month]
        
        defect_rates = [float(m.value) for m in month_metrics if m.metric_type == MetricType.PROCESS_DEFECT_RATE.value]
        fpys = [float(m.value) for m in month_metrics if m.metric_type == MetricType.PROCESS_FPY.value]
        
        monthly_trend.append({
            "month": current_month.strftime("%Y-%m"),
            "avg_defect_rate": sum(defect_rates) / len(defect_rates) if defect_rates else 0,
            "avg_fpy": sum(fpys) / len(fpys) if fpys else 0
        })
        
        # 移动到下个月
        if current_month.month == 12:
            current_month = current_month.replace(year=current_month.year + 1, month=1)
        else:
            current_month = current_month.replace(month=current_month.month + 1)
    
    return ProcessAnalysisResponse(
        period=f"{start_date.isoformat()} to {end_date.isoformat()}",
        start_date=start_date,
        end_date=end_date,
        by_responsibility=by_responsibility_items,
        by_process=by_process_items,
        by_line=by_line_items,
        monthly_trend=monthly_trend
    )


@router.get(
    "/customer-analysis",
    response_model=CustomerAnalysisResponse,
    summary="客户质量分析",
    description="""
    客户质量数据分析，按产品类型进行分类统计。
    
    **权限要求：**
    - 需要 quality.customer-analysis.read 权限
    
    **分析维度：**
    - 按产品类型统计（0KM PPM、3MIS PPM、12MIS PPM）
    - 月度趋势
    - 严重度分布
    
    Requirements: 2.4.3
    """
)
async def get_customer_analysis(
    start_date: date = Query(..., description="开始日期"),
    end_date: date = Query(..., description="结束日期"),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """客户质量分析"""
    
    _ensure_internal_user(current_user)
    await _ensure_permission(
        current_user=current_user,
        db=db,
        module_path=QUALITY_DASHBOARD_PERMISSION,
    )
    
    # 查询客户质量指标数据
    query = select(QualityMetric).where(
        and_(
            QualityMetric.metric_type.in_([
                MetricType.OKM_PPM.value,
                MetricType.MIS_3_PPM.value,
                MetricType.MIS_12_PPM.value
            ]),
            QualityMetric.metric_date >= start_date,
            QualityMetric.metric_date <= end_date
        )
    )
    
    result = await db.execute(query)
    metrics = result.scalars().all()
    
    # 按产品类型统计
    by_product_type: Dict[str, Dict[str, Any]] = {}
    for metric in metrics:
        product_type = metric.product_type or "未分类"
        
        if product_type not in by_product_type:
            by_product_type[product_type] = {
                "okm_ppms": [],
                "mis_3_ppms": [],
                "mis_12_ppms": [],
                "complaint_count": 0
            }
        
        if metric.metric_type == MetricType.OKM_PPM.value:
            by_product_type[product_type]["okm_ppms"].append(float(metric.value))
        elif metric.metric_type == MetricType.MIS_3_PPM.value:
            by_product_type[product_type]["mis_3_ppms"].append(float(metric.value))
        elif metric.metric_type == MetricType.MIS_12_PPM.value:
            by_product_type[product_type]["mis_12_ppms"].append(float(metric.value))
    
    # 构建按产品类型统计结果
    by_product_type_items = []
    for product_type, data in by_product_type.items():
        avg_okm_ppm = sum(data["okm_ppms"]) / len(data["okm_ppms"]) if data["okm_ppms"] else 0
        avg_mis_3_ppm = sum(data["mis_3_ppms"]) / len(data["mis_3_ppms"]) if data["mis_3_ppms"] else 0
        avg_mis_12_ppm = sum(data["mis_12_ppms"]) / len(data["mis_12_ppms"]) if data["mis_12_ppms"] else 0
        
        # 判断趋势
        trend = "stable"
        if len(data["okm_ppms"]) >= 4:
            first_half = sum(data["okm_ppms"][:len(data["okm_ppms"])//2]) / (len(data["okm_ppms"])//2)
            second_half = sum(data["okm_ppms"][len(data["okm_ppms"])//2:]) / (len(data["okm_ppms"]) - len(data["okm_ppms"])//2)
            if second_half < first_half * 0.9:
                trend = "improving"
            elif second_half > first_half * 1.1:
                trend = "worsening"
        
        by_product_type_items.append(
            CustomerAnalysisItem(
                product_type=product_type,
                okm_ppm=avg_okm_ppm,
                mis_3_ppm=avg_mis_3_ppm,
                mis_12_ppm=avg_mis_12_ppm,
                complaint_count=data["complaint_count"],
                trend=trend
            )
        )
    
    # 月度趋势
    monthly_trend = []
    current_month = start_date.replace(day=1)
    while current_month <= end_date:
        month_metrics = [m for m in metrics if m.metric_date.year == current_month.year and m.metric_date.month == current_month.month]
        
        okm_ppms = [float(m.value) for m in month_metrics if m.metric_type == MetricType.OKM_PPM.value]
        mis_3_ppms = [float(m.value) for m in month_metrics if m.metric_type == MetricType.MIS_3_PPM.value]
        mis_12_ppms = [float(m.value) for m in month_metrics if m.metric_type == MetricType.MIS_12_PPM.value]
        
        monthly_trend.append({
            "month": current_month.strftime("%Y-%m"),
            "avg_okm_ppm": sum(okm_ppms) / len(okm_ppms) if okm_ppms else 0,
            "avg_mis_3_ppm": sum(mis_3_ppms) / len(mis_3_ppms) if mis_3_ppms else 0,
            "avg_mis_12_ppm": sum(mis_12_ppms) / len(mis_12_ppms) if mis_12_ppms else 0
        })
        
        # 移动到下个月
        if current_month.month == 12:
            current_month = current_month.replace(year=current_month.year + 1, month=1)
        else:
            current_month = current_month.replace(month=current_month.month + 1)
    
    # 严重度分布（需要从客诉数据表查询，这里返回示例数据）
    severity_distribution = {
        "critical": 0,
        "major": 0,
        "minor": 0
    }
    
    return CustomerAnalysisResponse(
        period=f"{start_date.isoformat()} to {end_date.isoformat()}",
        start_date=start_date,
        end_date=end_date,
        by_product_type=by_product_type_items,
        monthly_trend=monthly_trend,
        severity_distribution=severity_distribution
    )
