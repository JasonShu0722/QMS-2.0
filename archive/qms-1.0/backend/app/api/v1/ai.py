"""
AI 智能诊断 API 路由
AI Analysis Routes - AI 诊断和自然语言查询接口

Requirements: 2.4.4
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_active_user
from app.core.permissions import require_permission, has_permission
from app.models.user import User
from app.models.permission import OperationType
from app.services.ai_analysis_service import ai_analysis_service
from app.schemas.ai_analysis import (
    AnomalyDiagnoseRequest,
    AnomalyDiagnoseResponse,
    NaturalLanguageQueryRequest,
    NaturalLanguageQueryResponse,
    ChartGenerationRequest,
    ChartGenerationResponse
)

router = APIRouter(prefix="/ai", tags=["AI智能诊断"])


@router.post(
    "/diagnose",
    response_model=AnomalyDiagnoseResponse,
    summary="异常诊断",
    description="""
    AI 异常自动寻源功能。
    
    **功能说明：**
    当监控到某项指标突发飙升时，AI 自动触发分析，寻找强相关性因子。
    
    **权限要求：**
    - 需要 quality.ai-diagnose.read 权限
    
    **分析内容：**
    - 异常严重程度评估
    - 可能的根本原因分析
    - 改善建议措施
    - 相关指标关联分析
    
    **使用场景：**
    - 指标异常告警时自动触发
    - 人工主动发起诊断分析
    
    Requirements: 2.4.4
    """
)
async def diagnose_anomaly(
    request: AnomalyDiagnoseRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    异常诊断接口
    
    当质量指标出现异常波动时，调用此接口进行 AI 诊断分析。
    """
    
    # 检查权限
    has_perm = await has_permission(
        user=current_user,
        module_path="quality.ai-diagnose",
        operation=OperationType.READ,
        db=db
    )
    
    if not has_perm:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="权限不足：需要 'quality.ai-diagnose.read' 权限"
        )
    
    # 调用 AI 服务进行异常分析
    result = await ai_analysis_service.analyze_anomaly(
        db=db,
        metric_type=request.metric_type,
        metric_date=request.metric_date,
        current_value=request.current_value,
        historical_avg=request.historical_avg,
        supplier_id=request.supplier_id,
        product_type=request.product_type
    )
    
    return AnomalyDiagnoseResponse(**result)


@router.post(
    "/query",
    response_model=NaturalLanguageQueryResponse,
    summary="自然语言查询",
    description="""
    AI 自然语言查询功能。
    
    **功能说明：**
    用户可以用自然语言提问，AI 自动转化为 SQL 查询数据库并返回数据详情以及图表。
    
    **权限要求：**
    - 需要 quality.ai-query.read 权限
    
    **查询能力：**
    - 理解自然语言问题
    - 自动生成 SQL 查询
    - 返回结构化数据
    - 推荐合适的图表类型
    - 提供结果解释说明
    
    **使用示例：**
    - "帮我把过去三个月MCU产品的0KM不良率趋势画成折线图"
    - "查询上个月来料批次合格率最低的5个供应商"
    - "对比今年和去年同期的制程不合格率"
    
    **安全限制：**
    - 仅支持 SELECT 查询
    - 不允许修改数据库
    
    Requirements: 2.4.4
    """
)
async def natural_language_query(
    request: NaturalLanguageQueryRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    自然语言查询接口
    
    用户输入自然语言问题，AI 自动转换为 SQL 并执行查询。
    """
    
    # 检查权限
    has_perm = await has_permission(
        user=current_user,
        module_path="quality.ai-query",
        operation=OperationType.READ,
        db=db
    )
    
    if not has_perm:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="权限不足：需要 'quality.ai-query.read' 权限"
        )
    
    # 构建用户上下文
    user_context = {
        "user_id": current_user.id,
        "user_type": current_user.user_type,
        "supplier_id": current_user.supplier_id if hasattr(current_user, 'supplier_id') else None
    }
    
    # 调用 AI 服务进行自然语言查询
    result = await ai_analysis_service.natural_language_query(
        db=db,
        user_question=request.question,
        user_context=user_context
    )
    
    return NaturalLanguageQueryResponse(**result)


@router.post(
    "/generate-chart",
    response_model=ChartGenerationResponse,
    summary="生成图表配置",
    description="""
    AI 图表生成功能。
    
    **功能说明：**
    根据用户描述自动生成 ECharts 图表配置。
    
    **权限要求：**
    - 需要 quality.ai-chart.read 权限
    
    **生成能力：**
    - 理解用户对图表的描述
    - 自动选择合适的图表类型
    - 生成完整的 ECharts 配置
    - 支持多种图表类型（折线图、柱状图、饼图、雷达图等）
    
    **使用场景：**
    - 配合自然语言查询使用
    - 快速生成可视化图表
    - 自定义图表展示
    
    Requirements: 2.4.4
    """
)
async def generate_chart(
    request: ChartGenerationRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    生成图表配置接口
    
    根据用户描述和数据，生成 ECharts 图表配置。
    """
    
    # 检查权限
    has_perm = await has_permission(
        user=current_user,
        module_path="quality.ai-chart",
        operation=OperationType.READ,
        db=db
    )
    
    if not has_perm:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="权限不足：需要 'quality.ai-chart.read' 权限"
        )
    
    # 调用 AI 服务生成图表配置
    result = await ai_analysis_service.generate_trend_chart(
        user_description=request.description,
        data=request.data
    )
    
    return ChartGenerationResponse(**result)
