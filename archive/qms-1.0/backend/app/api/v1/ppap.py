"""
PPAP 管理 API
Production Part Approval Process Management API

实现功能：
1. POST /api/v1/ppap - 创建 PPAP 提交任务
2. GET /api/v1/ppap - 获取 PPAP 列表
3. GET /api/v1/ppap/{id} - 获取 PPAP 详情
4. PUT /api/v1/ppap/{id} - 更新 PPAP 基本信息
5. POST /api/v1/ppap/{id}/documents - 供应商上传文件
6. POST /api/v1/ppap/{id}/review - SQE 审核（单项驳回/整体批准）
7. GET /api/v1/ppap/revalidation-reminders - 获取年度再鉴定提醒列表
8. POST /api/v1/ppap/{id}/mark-expired - 标记为已过期
9. GET /api/v1/ppap/statistics - 获取统计数据
10. GET /api/v1/ppap/document-checklist - 获取18项标准文件清单
"""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.models.ppap import PPAPStatus
from app.schemas.ppap import (
    PPAPCreate,
    PPAPUpdate,
    PPAPDocumentUpload,
    PPAPDocumentReview,
    PPAPBatchReview,
    PPAPResponse,
    PPAPListResponse,
    PPAPStatistics,
    PPAPRevalidationReminder,
    PPAP_STANDARD_DOCUMENTS,
    PPAPDocumentItem
)
from app.services.ppap_service import PPAPService
from datetime import date, datetime


router = APIRouter(prefix="/ppap", tags=["ppap"])


@router.post(
    "",
    response_model=PPAPResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建 PPAP 提交任务",
    description="SQE 创建 PPAP 提交任务，指定供应商、物料和等级"
)
async def create_ppap_submission(
    ppap_data: PPAPCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    创建 PPAP 提交任务
    
    - **supplier_id**: 供应商ID
    - **material_code**: 物料编码
    - **ppap_level**: PPAP等级（level_1/level_2/level_3/level_4/level_5）
    - **required_documents**: 要求提交的文件清单（可选，不指定则根据等级自动生成）
    - **submission_deadline**: 提交截止日期（可选）
    """
    # 权限检查：只有内部员工（SQE）可以创建
    if current_user.user_type != "internal":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有内部员工可以创建 PPAP 提交任务"
        )
    
    # 创建 PPAP
    ppap = await PPAPService.create_ppap_submission(
        db=db,
        supplier_id=ppap_data.supplier_id,
        material_code=ppap_data.material_code,
        ppap_level=ppap_data.ppap_level,
        required_documents=ppap_data.required_documents,
        submission_deadline=ppap_data.submission_deadline,
        created_by=current_user.id
    )
    
    # 构建响应
    response = PPAPResponse.model_validate(ppap)
    response.completion_rate = PPAPService.calculate_completion_rate(ppap.documents)
    
    return response


@router.get(
    "",
    response_model=PPAPListResponse,
    summary="获取 PPAP 列表",
    description="查询 PPAP 列表，支持多条件筛选和分页"
)
async def list_ppap_submissions(
    supplier_id: Optional[int] = Query(None, description="供应商ID"),
    material_code: Optional[str] = Query(None, description="物料编码（模糊匹配）"),
    status: Optional[str] = Query(None, description="状态：pending/submitted/under_review/rejected/approved/expired"),
    ppap_level: Optional[str] = Query(None, description="PPAP等级"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页记录数"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取 PPAP 列表
    
    支持筛选条件：
    - supplier_id: 供应商ID
    - material_code: 物料编码
    - status: 状态
    - ppap_level: PPAP等级
    """
    # 如果是供应商用户，只能查看自己的 PPAP
    if current_user.user_type == "supplier":
        supplier_id = current_user.supplier_id
    
    ppap_list, total = await PPAPService.list_ppap_submissions(
        db=db,
        supplier_id=supplier_id,
        material_code=material_code,
        status=status,
        ppap_level=ppap_level,
        page=page,
        page_size=page_size
    )
    
    # 构建响应
    items = []
    for ppap in ppap_list:
        response = PPAPResponse.model_validate(ppap)
        response.completion_rate = PPAPService.calculate_completion_rate(ppap.documents)
        items.append(response)
    
    return {
        "total": total,
        "items": items,
        "page": page,
        "page_size": page_size
    }


@router.get(
    "/{ppap_id}",
    response_model=PPAPResponse,
    summary="获取 PPAP 详情",
    description="根据 PPAP ID 获取详细信息"
)
async def get_ppap_submission(
    ppap_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取 PPAP 详情"""
    ppap = await PPAPService.get_ppap_by_id(db, ppap_id)
    
    if not ppap:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"PPAP 记录不存在: {ppap_id}"
        )
    
    # 权限检查：供应商只能查看自己的 PPAP
    if current_user.user_type == "supplier" and ppap.supplier_id != current_user.supplier_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权访问该 PPAP 记录"
        )
    
    # 构建响应
    response = PPAPResponse.model_validate(ppap)
    response.completion_rate = PPAPService.calculate_completion_rate(ppap.documents)
    
    return response


@router.put(
    "/{ppap_id}",
    response_model=PPAPResponse,
    summary="更新 PPAP 基本信息",
    description="更新 PPAP 的等级、截止日期等基本信息"
)
async def update_ppap_submission(
    ppap_id: int,
    ppap_data: PPAPUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """更新 PPAP 基本信息"""
    ppap = await PPAPService.get_ppap_by_id(db, ppap_id)
    
    if not ppap:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"PPAP 记录不存在: {ppap_id}"
        )
    
    # 权限检查：只有内部员工可以更新
    if current_user.user_type != "internal":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有内部员工可以更新 PPAP 信息"
        )
    
    # 更新字段
    update_data = ppap_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(ppap, field, value)
    
    ppap.updated_at = datetime.utcnow()
    
    await db.commit()
    await db.refresh(ppap)
    
    # 构建响应
    response = PPAPResponse.model_validate(ppap)
    response.completion_rate = PPAPService.calculate_completion_rate(ppap.documents)
    
    return response


@router.post(
    "/{ppap_id}/documents",
    response_model=PPAPResponse,
    summary="供应商上传文件",
    description="供应商上传 PPAP 文件（18项标准文件之一）"
)
async def upload_ppap_document(
    ppap_id: int,
    document_data: PPAPDocumentUpload,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    供应商上传文件
    
    - **document_key**: 文件键名（如：psw, pfmea, control_plan）
    - **file_path**: 文件路径
    """
    ppap = await PPAPService.get_ppap_by_id(db, ppap_id)
    
    if not ppap:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"PPAP 记录不存在: {ppap_id}"
        )
    
    # 权限检查：只有对应的供应商可以上传
    if current_user.user_type != "supplier" or ppap.supplier_id != current_user.supplier_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有对应的供应商可以上传文件"
        )
    
    # 状态检查：只有待提交或已驳回状态可以上传
    if ppap.status not in [PPAPStatus.PENDING, PPAPStatus.REJECTED]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"当前状态（{ppap.status}）不允许上传文件"
        )
    
    # 上传文件
    try:
        updated_ppap = await PPAPService.upload_document(
            db=db,
            ppap_id=ppap_id,
            document_key=document_data.document_key,
            file_path=document_data.file_path,
            uploaded_by=current_user.id
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    
    # 构建响应
    response = PPAPResponse.model_validate(updated_ppap)
    response.completion_rate = PPAPService.calculate_completion_rate(updated_ppap.documents)
    
    return response


@router.post(
    "/{ppap_id}/review",
    response_model=PPAPResponse,
    summary="SQE 审核 PPAP",
    description="SQE 审核 PPAP 文件，支持单项驳回或整体批准"
)
async def review_ppap_submission(
    ppap_id: int,
    review_data: PPAPBatchReview,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    SQE 审核 PPAP
    
    - **reviews**: 审核列表（每个文件的审核结果）
    - **overall_decision**: 整体决策（approve/reject）
    - **overall_comments**: 整体审核意见
    """
    ppap = await PPAPService.get_ppap_by_id(db, ppap_id)
    
    if not ppap:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"PPAP 记录不存在: {ppap_id}"
        )
    
    # 权限检查：只有内部员工（SQE）可以审核
    if current_user.user_type != "internal":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有内部员工可以审核 PPAP"
        )
    
    # 状态检查：只有已提交或审核中状态可以审核
    if ppap.status not in [PPAPStatus.SUBMITTED, PPAPStatus.UNDER_REVIEW]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"当前状态（{ppap.status}）不允许审核"
        )
    
    # 批量审核
    try:
        reviews_dict = [review.model_dump() for review in review_data.reviews]
        updated_ppap = await PPAPService.batch_review_and_approve(
            db=db,
            ppap_id=ppap_id,
            reviews=reviews_dict,
            overall_decision=review_data.overall_decision,
            overall_comments=review_data.overall_comments,
            reviewed_by=current_user.id
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    
    # 构建响应
    response = PPAPResponse.model_validate(updated_ppap)
    response.completion_rate = PPAPService.calculate_completion_rate(updated_ppap.documents)
    
    return response


@router.get(
    "/revalidation-reminders",
    response_model=List[PPAPRevalidationReminder],
    summary="获取年度再鉴定提醒列表",
    description="获取需要年度再鉴定的 PPAP 列表（批准后1年）"
)
async def get_revalidation_reminders(
    days_threshold: int = Query(30, ge=1, le=365, description="提前提醒天数"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取年度再鉴定提醒列表
    
    - **days_threshold**: 提前提醒天数（默认30天）
    """
    # 权限检查：只有内部员工可以查看
    if current_user.user_type != "internal":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有内部员工可以查看再鉴定提醒"
        )
    
    ppap_list = await PPAPService.get_revalidation_reminders(db, days_threshold)
    
    # 构建响应
    reminders = []
    today = date.today()
    
    for ppap in ppap_list:
        days_until_due = (ppap.revalidation_due_date - today).days
        
        reminder = PPAPRevalidationReminder(
            ppap_id=ppap.id,
            supplier_id=ppap.supplier_id,
            supplier_name="",  # TODO: 关联查询供应商名称
            material_code=ppap.material_code,
            approved_at=ppap.approved_at,
            revalidation_due_date=ppap.revalidation_due_date,
            days_until_due=days_until_due,
            status="overdue" if days_until_due < 0 else "upcoming"
        )
        reminders.append(reminder)
    
    return reminders


@router.post(
    "/{ppap_id}/mark-expired",
    response_model=PPAPResponse,
    summary="标记为已过期",
    description="标记 PPAP 为已过期状态（需要年度再鉴定）"
)
async def mark_ppap_as_expired(
    ppap_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """标记 PPAP 为已过期"""
    # 权限检查：只有内部员工可以标记
    if current_user.user_type != "internal":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有内部员工可以标记 PPAP 为已过期"
        )
    
    try:
        updated_ppap = await PPAPService.mark_as_expired(db, ppap_id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    
    # 构建响应
    response = PPAPResponse.model_validate(updated_ppap)
    response.completion_rate = PPAPService.calculate_completion_rate(updated_ppap.documents)
    
    return response


@router.get(
    "/statistics",
    response_model=PPAPStatistics,
    summary="获取 PPAP 统计数据",
    description="获取 PPAP 的统计数据"
)
async def get_ppap_statistics(
    supplier_id: Optional[int] = Query(None, description="供应商ID"),
    year: Optional[int] = Query(None, description="年份"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取 PPAP 统计数据
    
    - **supplier_id**: 供应商ID（可选）
    - **year**: 年份（可选）
    """
    # 如果是供应商用户，只能查看自己的统计
    if current_user.user_type == "supplier":
        supplier_id = current_user.supplier_id
    
    statistics = await PPAPService.get_statistics(
        db=db,
        supplier_id=supplier_id,
        year=year
    )
    
    return PPAPStatistics(**statistics)


@router.get(
    "/document-checklist",
    response_model=List[PPAPDocumentItem],
    summary="获取18项标准文件清单",
    description="获取 PPAP 18项标准文件清单配置"
)
async def get_document_checklist(
    current_user: User = Depends(get_current_user)
):
    """
    获取18项标准文件清单
    
    返回 PPAP 标准的18项文件清单配置
    """
    checklist = []
    
    for doc_key, doc_info in PPAP_STANDARD_DOCUMENTS.items():
        item = PPAPDocumentItem(
            document_key=doc_key,
            document_name=doc_info["name"],
            document_name_cn=doc_info["name_cn"],
            required=doc_info["required"]
        )
        checklist.append(item)
    
    return checklist
