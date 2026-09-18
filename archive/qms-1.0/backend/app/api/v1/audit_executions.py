"""
审核执行 API 路由
Audit Execution API Routes - 审核实施与数字化检查表接口
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query, Path as PathParam
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.permissions import require_permission, OperationType
from app.models.user import User
from app.schemas.audit_execution import (
    AuditExecutionCreate,
    AuditExecutionResponse,
    AuditExecutionListResponse,
    AuditExecutionUpdate,
    ChecklistSubmit,
    AuditReportRequest,
    AuditReportResponse
)
from app.services.audit_execution_service import AuditExecutionService
from app.services.audit_report_service import AuditReportService
from app.core.exceptions import NotFoundException

router = APIRouter(prefix="/audit-executions", tags=["审核执行"])


@router.post(
    "",
    response_model=AuditExecutionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建审核执行记录",
    description="创建新的审核执行记录，关联审核计划和审核模板"
)
async def create_audit_execution(
    data: AuditExecutionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.execution", OperationType.CREATE))
):
    """
    创建审核执行记录
    
    - **audit_plan_id**: 审核计划ID
    - **template_id**: 审核模板ID
    - **audit_date**: 实际审核日期
    - **auditor_id**: 主审核员ID
    - **audit_team**: 审核组成员列表（可选）
    - **summary**: 审核总结（可选）
    """
    execution = await AuditExecutionService.create_audit_execution(
        db,
        data,
        current_user.id
    )
    return execution


@router.post(
    "/{execution_id}/checklist",
    response_model=AuditExecutionResponse,
    summary="提交检查表打分",
    description="在线提交检查表打分结果，支持移动端。系统自动应用VDA 6.3降级规则计算最终得分"
)
async def submit_checklist(
    execution_id: int = PathParam(..., description="审核执行记录ID"),
    data: ChecklistSubmit = ...,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.execution", OperationType.UPDATE))
):
    """
    提交检查表打分结果（支持移动端在线打分）
    
    功能特性：
    - 支持逐条录入检查结果
    - 支持现场拍照上传，照片自动挂载到对应条款
    - 自动应用VDA 6.3单项0分降级规则
    - 自动计算最终得分和等级评定
    - 自动生成不符合项(NC)记录
    
    - **checklist_results**: 检查表结果列表
        - **item_id**: 条款ID
        - **score**: 评分 (0-10分)
        - **comment**: 评价意见（可选）
        - **evidence_photos**: 证据照片路径列表（可选）
        - **is_nc**: 是否为不符合项
        - **nc_description**: 不符合项描述（如果is_nc为true则必填）
    """
    execution = await AuditExecutionService.submit_checklist(
        db,
        execution_id,
        data,
        current_user.id
    )
    return execution


@router.get(
    "/{execution_id}",
    response_model=AuditExecutionResponse,
    summary="获取审核执行记录详情",
    description="获取指定审核执行记录的详细信息"
)
async def get_audit_execution(
    execution_id: int = PathParam(..., description="审核执行记录ID"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.execution", OperationType.READ))
):
    """获取审核执行记录详情"""
    execution = await AuditExecutionService.get_audit_execution(db, execution_id)
    if not execution:
        raise NotFoundException(f"审核执行记录 ID {execution_id} 不存在")
    return execution


@router.put(
    "/{execution_id}",
    response_model=AuditExecutionResponse,
    summary="更新审核执行记录",
    description="更新审核执行记录的基本信息"
)
async def update_audit_execution(
    execution_id: int = PathParam(..., description="审核执行记录ID"),
    data: AuditExecutionUpdate = ...,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.execution", OperationType.UPDATE))
):
    """更新审核执行记录"""
    execution = await AuditExecutionService.update_audit_execution(
        db,
        execution_id,
        data
    )
    return execution


@router.get(
    "",
    response_model=AuditExecutionListResponse,
    summary="获取审核执行记录列表",
    description="获取审核执行记录列表，支持按审核计划、审核员、状态筛选"
)
async def list_audit_executions(
    audit_plan_id: Optional[int] = Query(None, description="审核计划ID"),
    auditor_id: Optional[int] = Query(None, description="审核员ID"),
    status: Optional[str] = Query(None, description="状态: draft, completed, nc_open, nc_closed"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页记录数"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.execution", OperationType.READ))
):
    """获取审核执行记录列表"""
    executions, total = await AuditExecutionService.list_audit_executions(
        db,
        audit_plan_id=audit_plan_id,
        auditor_id=auditor_id,
        status=status,
        page=page,
        page_size=page_size
    )
    
    return AuditExecutionListResponse(
        total=total,
        items=executions,
        page=page,
        page_size=page_size
    )


@router.get(
    "/{execution_id}/report",
    response_model=AuditReportResponse,
    summary="生成审核报告",
    description="生成PDF格式的审核报告，包含雷达图和证据照片"
)
async def generate_audit_report(
    execution_id: int = PathParam(..., description="审核执行记录ID"),
    include_radar_chart: bool = Query(True, description="是否包含雷达图"),
    include_photos: bool = Query(True, description="是否包含证据照片"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.execution", OperationType.EXPORT))
):
    """
    生成审核报告（PDF格式，含雷达图）
    
    功能特性：
    - 自动生成审核结果雷达图
    - 包含检查表详细结果
    - 包含证据照片
    - 支持导出为PDF格式
    
    - **include_radar_chart**: 是否包含雷达图（默认true）
    - **include_photos**: 是否包含证据照片（默认true）
    """
    report_path, report_url = await AuditReportService.generate_audit_report(
        db,
        execution_id,
        include_radar_chart=include_radar_chart,
        include_photos=include_photos
    )
    
    return AuditReportResponse(
        report_path=report_path,
        report_url=report_url
    )


@router.get(
    "/{execution_id}/report/download",
    summary="下载审核报告",
    description="下载已生成的审核报告文件",
    response_class=FileResponse
)
async def download_audit_report(
    execution_id: int = PathParam(..., description="审核执行记录ID"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.execution", OperationType.EXPORT))
):
    """下载审核报告文件"""
    execution = await AuditExecutionService.get_audit_execution(db, execution_id)
    if not execution:
        raise NotFoundException(f"审核执行记录 ID {execution_id} 不存在")
    
    if not execution.audit_report_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="审核报告尚未生成，请先调用生成报告接口"
        )
    
    import os
    if not os.path.exists(execution.audit_report_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="审核报告文件不存在"
        )
    
    return FileResponse(
        path=execution.audit_report_path,
        filename=f"audit_report_{execution_id}.pdf",
        media_type="application/pdf"
    )
