"""
供应商生命周期管理 API
Supplier Lifecycle Management API Endpoints
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.supplier_lifecycle import (
    SupplierQualificationCreate,
    SupplierQualificationResponse,
    SupplierDocumentUpload,
    SupplierDocumentReview,
    SupplierDocumentResponse,
    SupplierPCNCreate,
    SupplierPCNUpdate,
    SupplierPCNResponse,
    SupplierAuditPlanCreate,
    SupplierAuditPlanResponse,
    SupplierAuditCreate,
    SupplierAuditResponse,
    SupplierAuditNCCreate,
    SupplierAuditNCUpdate,
    SupplierAuditNCResponse,
    CertificateExpiryWarning
)
from app.services.supplier_lifecycle_service import supplier_lifecycle_service

router = APIRouter(prefix="/suppliers", tags=["Supplier Lifecycle"])


# ==================== 供应商准入审核 ====================

@router.post("/qualification", response_model=dict, status_code=status.HTTP_200_OK)
async def qualify_supplier(
    qualification_data: SupplierQualificationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    供应商准入审核
    
    审核新供应商或重新认证供应商，通过后激活供应商状态
    """
    try:
        supplier = await supplier_lifecycle_service.qualify_supplier(
            db=db,
            supplier_id=qualification_data.supplier_id,
            qualification_type=qualification_data.qualification_type,
            review_comment=qualification_data.review_comment,
            reviewed_by=current_user.id
        )
        
        return {
            "message": "供应商准入审核成功",
            "supplier": supplier.to_dict()
        }
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# ==================== 资质文件管理 ====================

@router.post("/{supplier_id}/documents", response_model=SupplierDocumentResponse, status_code=status.HTTP_201_CREATED)
async def upload_supplier_document(
    supplier_id: int,
    document_data: SupplierDocumentUpload,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    上传供应商资质文件
    
    供应商或采购工程师上传ISO证书、营业执照等资质文件
    """
    # 验证supplier_id匹配
    if document_data.supplier_id != supplier_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Supplier ID in path and body must match"
        )
    
    try:
        document = await supplier_lifecycle_service.upload_document(
            db=db,
            document_data=document_data,
            uploaded_by=current_user.id
        )
        return document
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.put("/documents/{document_id}/review", response_model=SupplierDocumentResponse)
async def review_supplier_document(
    document_id: int,
    review_data: SupplierDocumentReview,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    审核供应商资质文件
    
    SQE或采购工程师审核供应商上传的资质文件
    """
    try:
        document = await supplier_lifecycle_service.review_document(
            db=db,
            document_id=document_id,
            review_status=review_data.review_status,
            review_comment=review_data.review_comment,
            reviewed_by=current_user.id
        )
        return document
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/documents/expiring", response_model=List[CertificateExpiryWarning])
async def get_expiring_certificates(
    days: int = Query(30, ge=1, le=365, description="天数阈值"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取即将到期的证书列表
    
    用于Celery定时任务自动预警
    """
    try:
        warnings = await supplier_lifecycle_service.get_expiring_certificates(
            db=db,
            days_threshold=days
        )
        return warnings
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# ==================== 供应商变更管理 (PCN) ====================

@router.post("/pcn", response_model=SupplierPCNResponse, status_code=status.HTTP_201_CREATED)
async def create_supplier_pcn(
    pcn_data: SupplierPCNCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    创建供应商变更申请
    
    供应商在线提交PCN申请
    """
    try:
        pcn = await supplier_lifecycle_service.create_pcn(
            db=db,
            pcn_data=pcn_data,
            submitted_by=current_user.id
        )
        return pcn
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.put("/pcn/{pcn_id}", response_model=SupplierPCNResponse)
async def update_supplier_pcn(
    pcn_id: int,
    pcn_update: SupplierPCNUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    更新供应商变更申请
    
    采购工程师/SQE审核PCN或供应商更新实施信息
    """
    try:
        pcn = await supplier_lifecycle_service.update_pcn(
            db=db,
            pcn_id=pcn_id,
            pcn_update=pcn_update,
            updated_by=current_user.id
        )
        return pcn
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# ==================== 审核计划管理 ====================

@router.get("/audits/plan", response_model=List[SupplierAuditPlanResponse])
async def get_audit_plans(
    audit_year: Optional[int] = Query(None, description="审核年度"),
    supplier_id: Optional[int] = Query(None, description="供应商ID"),
    auditor_id: Optional[int] = Query(None, description="审核员ID"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取年度审核计划
    
    查询供应商审核计划，支持按年度、供应商、审核员筛选
    """
    try:
        plans = await supplier_lifecycle_service.get_audit_plans(
            db=db,
            audit_year=audit_year,
            supplier_id=supplier_id,
            auditor_id=auditor_id
        )
        return plans
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/audits/plan", response_model=SupplierAuditPlanResponse, status_code=status.HTTP_201_CREATED)
async def create_audit_plan(
    plan_data: SupplierAuditPlanCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    创建审核计划
    
    设定年度供应商审核计划
    """
    try:
        plan = await supplier_lifecycle_service.create_audit_plan(
            db=db,
            plan_data=plan_data,
            created_by=current_user.id
        )
        return plan
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# ==================== 审核记录管理 ====================

@router.post("/audits", response_model=SupplierAuditResponse, status_code=status.HTTP_201_CREATED)
async def create_supplier_audit(
    audit_data: SupplierAuditCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    创建供应商审核记录
    
    审核员录入审核结果和不符合项统计
    """
    try:
        audit = await supplier_lifecycle_service.create_audit(
            db=db,
            audit_data=audit_data,
            created_by=current_user.id
        )
        return audit
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# ==================== 不符合项管理 ====================

@router.post("/audits/{audit_id}/nc", response_model=SupplierAuditNCResponse, status_code=status.HTTP_201_CREATED)
async def create_audit_nc(
    audit_id: int,
    nc_data: SupplierAuditNCCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    录入审核不符合项
    
    审核员录入发现的不符合项（NC）
    """
    # 验证audit_id匹配
    if nc_data.audit_id != audit_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Audit ID in path and body must match"
        )
    
    try:
        nc = await supplier_lifecycle_service.create_audit_nc(
            db=db,
            nc_data=nc_data,
            created_by=current_user.id
        )
        return nc
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.put("/audits/nc/{nc_id}", response_model=SupplierAuditNCResponse)
async def update_audit_nc(
    nc_id: int,
    nc_update: SupplierAuditNCUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    更新审核不符合项
    
    责任人填写整改措施或审核员验证整改结果
    """
    try:
        nc = await supplier_lifecycle_service.update_audit_nc(
            db=db,
            nc_id=nc_id,
            nc_update=nc_update,
            updated_by=current_user.id
        )
        return nc
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
