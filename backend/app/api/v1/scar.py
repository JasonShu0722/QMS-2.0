"""
SCAR 和 8D 报告 API 路由
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.supplier import Supplier, SupplierStatus
from app.models.role_tag import RoleTag
from app.models.user import User, UserStatus, UserType
from app.models.user_role_assignment import UserRoleAssignment
from app.schemas.scar import (
    SCARCreate, SCARUpdate, SCARResponse, SCARListQuery,
    EightDSubmit, EightDReview, EightDResponse,
    AIPreReviewRequest, AIPreReviewResponse, SCARInternalUserOption,
    SCARSupplierOption
)
from app.services.scar_service import SCARService, EightDService, AIPreReviewService
from app.core.exceptions import NotFoundException, BusinessException

router = APIRouter(prefix="/scar", tags=["SCAR & 8D Management"])


def _enum_value(value):
    return value.value if hasattr(value, "value") else value


# ============ SCAR 管理接口 ============

@router.get("/supplier-options", response_model=list[SCARSupplierOption])
async def search_supplier_options(
    keyword: str | None = Query(None, description="按供应商代码或名称搜索"),
    limit: int = Query(20, ge=1, le=50, description="返回数量"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    SCAR 创建弹窗使用的供应商检索。

    内部用户可按供应商代码或名称搜索激活供应商，外部供应商账号不可访问。
    """
    if _enum_value(current_user.user_type) != UserType.INTERNAL.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅内部用户可检索供应商")

    query = (
        select(Supplier)
        .where(Supplier.status == SupplierStatus.ACTIVE)
        .order_by(Supplier.code.asc())
        .limit(limit)
    )

    normalized_keyword = keyword.strip() if keyword else ""
    if normalized_keyword:
        like_value = f"%{normalized_keyword}%"
        query = query.where(
            or_(
                Supplier.code.ilike(like_value),
                Supplier.name.ilike(like_value),
            )
        )

    result = await db.execute(query)
    return [
        SCARSupplierOption(
            id=supplier.id,
            code=supplier.code,
            name=supplier.name,
            status=str(_enum_value(supplier.status)),
        )
        for supplier in result.scalars().all()
    ]


@router.get("/sqe-options", response_model=list[SCARInternalUserOption])
async def search_sqe_options(
    keyword: str | None = Query(None, description="按姓名、账号、部门或岗位检索供应商质量工程师"),
    limit: int = Query(20, ge=1, le=50, description="返回数量"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    8D 报告提交审核时使用的供应商质量工程师选项。
    优先返回绑定“供应商质量工程师”角色标签的内部账号；本地未配置角色时回退内部激活账号，避免流程卡死。
    """
    normalized_keyword = keyword.strip() if keyword else ""
    keyword_filter = None
    if normalized_keyword:
        like_value = f"%{normalized_keyword}%"
        keyword_filter = or_(
            User.username.ilike(like_value),
            User.full_name.ilike(like_value),
            User.department.ilike(like_value),
            User.position.ilike(like_value),
        )

    base_conditions = [
        User.user_type == UserType.INTERNAL,
        User.status == UserStatus.ACTIVE,
    ]

    role_stmt = (
        select(User)
        .join(UserRoleAssignment, UserRoleAssignment.user_id == User.id)
        .join(RoleTag, RoleTag.id == UserRoleAssignment.role_tag_id)
        .where(
            *base_conditions,
            RoleTag.role_key == "quality.supplier.engineer",
            RoleTag.is_active.is_(True),
        )
        .distinct()
        .order_by(User.full_name.asc(), User.username.asc())
        .limit(limit)
    )
    if keyword_filter is not None:
        role_stmt = role_stmt.where(keyword_filter)

    result = await db.execute(role_stmt)
    users = list(result.scalars().all())

    if not users:
        fallback_stmt = (
            select(User)
            .where(*base_conditions)
            .order_by(User.full_name.asc(), User.username.asc())
            .limit(limit)
        )
        if keyword_filter is not None:
            fallback_stmt = fallback_stmt.where(keyword_filter)

        fallback_result = await db.execute(fallback_stmt)
        users = list(fallback_result.scalars().all())

    return [
        SCARInternalUserOption(
            id=user.id,
            username=user.username,
            full_name=user.full_name,
            department=user.department,
            position=user.position,
        )
        for user in users
    ]

@router.post("", response_model=SCARResponse, status_code=status.HTTP_201_CREATED)
async def create_scar(
    scar_data: SCARCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    创建 SCAR 单
    
    权限要求：内部用户（IQC/SQE）
    
    业务流程：
    1. 生成 SCAR 编号
    2. 创建 SCAR 记录
    3. 通知供应商
    """
    try:
        scar = await SCARService.create_scar(
            db=db,
            scar_data=scar_data,
            created_by=current_user.id
        )
        
        # 构建响应
        response = SCARResponse.from_orm(scar)
        
        # 查询供应商名称
        from app.models.supplier import Supplier
        from sqlalchemy import select
        supplier_result = await db.execute(
            select(Supplier).where(Supplier.id == scar.supplier_id)
        )
        supplier = supplier_result.scalar_one_or_none()
        if supplier:
            response.supplier_name = supplier.name
        
        return response
        
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create SCAR: {str(e)}")


@router.get("", response_model=dict)
async def get_scar_list(
    supplier_id: int = None,
    material_code: str = None,
    status: str = None,
    severity: str = None,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取 SCAR 列表
    
    权限控制：
    - 供应商用户只能看到自己的 SCAR
    - 内部用户可以看到所有 SCAR
    
    支持筛选：供应商、物料编码、状态、严重度
    """
    try:
        query = SCARListQuery(
            supplier_id=supplier_id,
            material_code=material_code,
            status=status,
            severity=severity,
            page=page,
            page_size=page_size
        )
        
        scars, total = await SCARService.get_scar_list(
            db=db,
            query=query,
            current_user=current_user
        )
        
        # 构建响应列表
        from app.models.supplier import Supplier
        from sqlalchemy import select
        
        scar_list = []
        for scar in scars:
            response = SCARResponse.from_orm(scar)
            
            # 查询供应商名称
            supplier_result = await db.execute(
                select(Supplier).where(Supplier.id == scar.supplier_id)
            )
            supplier = supplier_result.scalar_one_or_none()
            if supplier:
                response.supplier_name = supplier.name
            
            # 检查是否有 8D 报告
            from app.models.eight_d import EightD
            eight_d_result = await db.execute(
                select(EightD).where(EightD.scar_id == scar.id)
            )
            response.has_8d_report = eight_d_result.scalar_one_or_none() is not None
            
            scar_list.append(response)
        
        return {
            "items": scar_list,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get SCAR list: {str(e)}")


@router.get("/{scar_id}", response_model=SCARResponse)
async def get_scar_detail(
    scar_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取 SCAR 详情
    
    权限控制：供应商用户只能查看自己的 SCAR
    """
    try:
        scar = await SCARService.get_scar_by_id(
            db=db,
            scar_id=scar_id,
            current_user=current_user
        )
        
        response = SCARResponse.from_orm(scar)
        
        # 查询供应商名称
        from app.models.supplier import Supplier
        from sqlalchemy import select
        supplier_result = await db.execute(
            select(Supplier).where(Supplier.id == scar.supplier_id)
        )
        supplier = supplier_result.scalar_one_or_none()
        if supplier:
            response.supplier_name = supplier.name
        
        # 查询当前处理人名称
        if scar.current_handler_id:
            handler_result = await db.execute(
                select(User).where(User.id == scar.current_handler_id)
            )
            handler = handler_result.scalar_one_or_none()
            if handler:
                response.current_handler_name = handler.full_name
        
        # 检查是否有 8D 报告
        from app.models.eight_d import EightD
        eight_d_result = await db.execute(
            select(EightD).where(EightD.scar_id == scar.id)
        )
        response.has_8d_report = eight_d_result.scalar_one_or_none() is not None
        
        return response
        
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BusinessException as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get SCAR detail: {str(e)}")


@router.patch("/{scar_id}", response_model=SCARResponse)
async def update_scar(
    scar_id: int,
    scar_data: SCARUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    更新 SCAR 基础信息。

    当前主要用于补充/修正来料分类，保证 8D 报告编号中的 IQ0/IQ1 来自业务选项。
    """
    try:
        if _enum_value(current_user.user_type) != UserType.INTERNAL.value:
            raise HTTPException(status_code=403, detail="Only internal users can update SCAR")

        scar = await SCARService.update_scar(
            db=db,
            scar_id=scar_id,
            scar_data=scar_data,
            updated_by=current_user.id,
            current_user=current_user,
        )

        response = SCARResponse.from_orm(scar)

        supplier_result = await db.execute(
            select(Supplier).where(Supplier.id == scar.supplier_id)
        )
        supplier = supplier_result.scalar_one_or_none()
        if supplier:
            response.supplier_name = supplier.name

        if scar.current_handler_id:
            handler_result = await db.execute(
                select(User).where(User.id == scar.current_handler_id)
            )
            handler = handler_result.scalar_one_or_none()
            if handler:
                response.current_handler_name = handler.full_name

        from app.models.eight_d import EightD
        eight_d_result = await db.execute(
            select(EightD).where(EightD.scar_id == scar.id)
        )
        response.has_8d_report = eight_d_result.scalar_one_or_none() is not None

        return response

    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BusinessException as e:
        raise HTTPException(status_code=403, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update SCAR: {str(e)}")


# ============ 8D 报告管理接口 ============

@router.post("/{scar_id}/8d", response_model=EightDResponse, status_code=status.HTTP_201_CREATED)
async def submit_8d_report(
    scar_id: int,
    eight_d_data: EightDSubmit,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    供应商提交 8D 报告
    
    权限要求：供应商用户
    
    业务流程：
    1. 验证 SCAR 归属
    2. 创建/更新 8D 报告
    3. 更新 SCAR 状态为"审核中"
    4. 通知 SQE 审核
    """
    try:
        eight_d = await EightDService.submit_8d_report(
            db=db,
            scar_id=scar_id,
            eight_d_data=eight_d_data,
            submitted_by=current_user.id,
            current_user=current_user
        )
        
        response = EightDResponse.from_orm(eight_d)
        
        # 查询提交人名称
        if eight_d.submitted_by:
            from sqlalchemy import select
            submitter_result = await db.execute(
                select(User).where(User.id == eight_d.submitted_by)
            )
            submitter = submitter_result.scalar_one_or_none()
            if submitter:
                response.submitter_name = submitter.full_name
        
        # 查询 SCAR 编号
        from app.models.scar import SCAR
        from sqlalchemy import select
        scar_result = await db.execute(
            select(SCAR).where(SCAR.id == scar_id)
        )
        scar = scar_result.scalar_one_or_none()
        if scar:
            response.scar_number = scar.scar_number
        
        return response
        
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BusinessException as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to submit 8D report: {str(e)}")


@router.get("/{scar_id}/8d", response_model=EightDResponse)
async def get_8d_report(
    scar_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取 8D 报告
    
    权限控制：供应商用户只能查看自己的报告
    """
    try:
        eight_d = await EightDService.get_8d_report(
            db=db,
            scar_id=scar_id,
            current_user=current_user
        )
        
        if not eight_d:
            raise HTTPException(status_code=404, detail="8D report not found")
        
        response = EightDResponse.from_orm(eight_d)
        
        # 查询提交人和审核人名称
        from sqlalchemy import select
        
        if eight_d.submitted_by:
            submitter_result = await db.execute(
                select(User).where(User.id == eight_d.submitted_by)
            )
            submitter = submitter_result.scalar_one_or_none()
            if submitter:
                response.submitter_name = submitter.full_name
        
        if eight_d.reviewed_by:
            reviewer_result = await db.execute(
                select(User).where(User.id == eight_d.reviewed_by)
            )
            reviewer = reviewer_result.scalar_one_or_none()
            if reviewer:
                response.reviewer_name = reviewer.full_name
        
        # 查询 SCAR 编号
        from app.models.scar import SCAR
        scar_result = await db.execute(
            select(SCAR).where(SCAR.id == scar_id)
        )
        scar = scar_result.scalar_one_or_none()
        if scar:
            response.scar_number = scar.scar_number
        
        return response
        
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BusinessException as e:
        raise HTTPException(status_code=403, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get 8D report: {str(e)}")


@router.post("/{scar_id}/8d/review", response_model=EightDResponse)
async def review_8d_report(
    scar_id: int,
    review_data: EightDReview,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    SQE 审核 8D 报告
    
    权限要求：内部用户（SQE）
    
    业务流程：
    1. 更新审核状态和意见
    2. 更新 SCAR 状态（批准/驳回）
    3. 通知供应商审核结果
    """
    try:
        # 权限检查：只有内部用户可以审核
        if current_user.user_type != "internal":
            raise HTTPException(status_code=403, detail="Only internal users can review 8D reports")
        
        eight_d = await EightDService.review_8d_report(
            db=db,
            scar_id=scar_id,
            review_data=review_data,
            reviewed_by=current_user.id
        )
        
        response = EightDResponse.from_orm(eight_d)
        
        # 查询审核人名称
        response.reviewer_name = current_user.full_name
        
        # 查询 SCAR 编号
        from app.models.scar import SCAR
        from sqlalchemy import select
        scar_result = await db.execute(
            select(SCAR).where(SCAR.id == scar_id)
        )
        scar = scar_result.scalar_one_or_none()
        if scar:
            response.scar_number = scar.scar_number
        
        return response
        
    except NotFoundException as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BusinessException as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to review 8D report: {str(e)}")


@router.post("/{scar_id}/8d/reject", response_model=EightDResponse)
async def reject_8d_report(
    scar_id: int,
    review_data: EightDReview,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    SQE 驳回 8D 报告（便捷接口）
    
    等同于 review_8d_report 但 approved=False
    """
    review_data.approved = False
    return await review_8d_report(scar_id, review_data, db, current_user)


# ============ AI 预审接口 ============

@router.post("/8d/ai-prereview", response_model=AIPreReviewResponse)
async def ai_prereview_8d(
    request: AIPreReviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    AI 预审 8D 报告
    
    检查项：
    1. 关键词检测（空洞词汇）
    2. 历史查重（根本原因重复）
    
    注意：这是辅助功能，不替代人工审核
    """
    try:
        result = await AIPreReviewService.pre_review_8d(
            db=db,
            eight_d_data=request.eight_d_data,
            supplier_id=request.supplier_id
        )
        
        return AIPreReviewResponse(**result)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI pre-review failed: {str(e)}")
