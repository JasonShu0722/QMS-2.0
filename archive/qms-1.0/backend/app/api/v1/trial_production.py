"""
Trial Production API Routes
试产目标与实绩管理API路由
实现2.8.3试产目标与实绩管理
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.models.trial_production import TrialStatus
from app.schemas.trial_production import (
    TrialProductionCreate,
    TrialProductionUpdate,
    TrialProductionResponse,
    ManualMetricsInput,
    TrialProductionSummary,
    IMSSyncRequest,
    IMSSyncResponse
)
from app.services.trial_production_service import trial_production_service


router = APIRouter(prefix="/trial-production", tags=["Trial Production - 试产管理"])


@router.post("", response_model=TrialProductionResponse, status_code=201)
async def create_trial_production(
    trial_data: TrialProductionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    创建试产记录
    
    功能：
    - 关联IMS工单号
    - 设定质量目标（直通率、CPK、尺寸合格率等）
    
    权限要求：
    - 需要登录
    - 需要有新品质量管理模块的录入权限
    """
    try:
        trial = await trial_production_service.create_trial_production(
            db=db,
            trial_data=trial_data,
            current_user_id=current_user.id
        )
        return TrialProductionResponse.from_orm(trial)
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"创建试产记录失败: {str(e)}")


@router.get("/{trial_id}", response_model=TrialProductionResponse)
async def get_trial_production(
    trial_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取试产记录详情
    
    权限要求：
    - 需要登录
    - 需要有新品质量管理模块的查阅权限
    """
    trial = await trial_production_service.get_trial_production_by_id(db, trial_id)
    
    if not trial:
        raise HTTPException(status_code=404, detail=f"试产记录不存在: trial_id={trial_id}")
    
    return TrialProductionResponse.from_orm(trial)


@router.put("/{trial_id}", response_model=TrialProductionResponse)
async def update_trial_production(
    trial_id: int,
    trial_data: TrialProductionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    更新试产记录
    
    功能：
    - 更新目标指标
    - 更新实绩数据
    - 更新试产状态
    
    权限要求：
    - 需要登录
    - 需要有新品质量管理模块的修改权限
    """
    try:
        trial = await trial_production_service.update_trial_production(
            db=db,
            trial_id=trial_id,
            trial_data=trial_data,
            current_user_id=current_user.id
        )
        return TrialProductionResponse.from_orm(trial)
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"更新试产记录失败: {str(e)}")


@router.post("/{trial_id}/sync-ims", response_model=IMSSyncResponse)
async def sync_ims_data(
    trial_id: int,
    sync_request: IMSSyncRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    从IMS系统同步试产数据
    
    功能：
    - 自动抓取IMS数据（投入数、产出数、一次合格数、不良数）
    - 自动计算合格率和直通率
    - 与目标值对比，更新红绿灯状态
    
    权限要求：
    - 需要登录
    - 需要有新品质量管理模块的修改权限
    """
    result = await trial_production_service.sync_ims_data(
        db=db,
        trial_id=trial_id,
        force_sync=sync_request.force_sync
    )
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    
    return IMSSyncResponse(**result)


@router.post("/{trial_id}/manual-input", response_model=TrialProductionResponse)
async def manual_input_metrics(
    trial_id: int,
    manual_data: ManualMetricsInput,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    手动补录实绩数据
    
    功能：
    - 录入IMS无法采集的数据
    - 支持录入：CPK、破坏性实验、外观评审、尺寸合格率等
    
    权限要求：
    - 需要登录
    - 需要有新品质量管理模块的录入权限
    """
    try:
        trial = await trial_production_service.manual_input_metrics(
            db=db,
            trial_id=trial_id,
            manual_data=manual_data,
            current_user_id=current_user.id
        )
        return TrialProductionResponse.from_orm(trial)
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"手动补录数据失败: {str(e)}")


@router.get("/{trial_id}/summary", response_model=TrialProductionSummary)
async def get_trial_summary(
    trial_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    生成试产总结报告
    
    功能：
    - 红绿灯对比（目标值 vs 实绩值）
    - 整体达成状态评估
    - 自动生成改进建议
    
    权限要求：
    - 需要登录
    - 需要有新品质量管理模块的查阅权限
    """
    try:
        summary = await trial_production_service.generate_summary(db, trial_id)
        return summary
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成总结报告失败: {str(e)}")


@router.post("/{trial_id}/export")
async def export_summary_report(
    trial_id: int,
    format: str = Query("pdf", regex="^(pdf|excel)$", description="导出格式：pdf或excel"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    导出试产总结报告
    
    功能：
    - 一键导出Excel/PDF格式报告
    - 包含完整的目标vs实绩对比数据
    
    权限要求：
    - 需要登录
    - 需要有新品质量管理模块的导出权限
    """
    try:
        report_path = await trial_production_service.export_summary_report(
            db=db,
            trial_id=trial_id,
            format=format
        )
        
        return {
            "success": True,
            "message": f"报告导出成功",
            "report_path": report_path,
            "format": format
        }
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"导出报告失败: {str(e)}")


@router.get("", response_model=List[TrialProductionResponse])
async def list_trial_productions(
    project_id: Optional[int] = Query(None, description="项目ID"),
    status: Optional[TrialStatus] = Query(None, description="试产状态"),
    skip: int = Query(0, ge=0, description="跳过记录数"),
    limit: int = Query(50, ge=1, le=100, description="返回记录数限制"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    查询试产记录列表
    
    功能：
    - 支持按项目ID筛选
    - 支持按试产状态筛选
    - 支持分页查询
    
    权限要求：
    - 需要登录
    - 需要有新品质量管理模块的查阅权限
    """
    trials = await trial_production_service.list_trial_productions(
        db=db,
        project_id=project_id,
        status=status,
        skip=skip,
        limit=limit
    )
    
    return [TrialProductionResponse.from_orm(trial) for trial in trials]
