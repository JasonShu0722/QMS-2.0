"""
Supplier Claims API Routes
供应商索赔接口路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from datetime import date

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.models.supplier_claim import SupplierClaimStatus
from app.schemas.supplier_claim import (
    SupplierClaimCreate,
    SupplierClaimFromComplaint,
    SupplierClaimUpdate,
    SupplierClaimResponse,
    SupplierClaimListResponse,
    SupplierClaimStatistics
)
from app.services.supplier_claim_service import SupplierClaimService

router = APIRouter(prefix="/supplier-claims", tags=["supplier-claims"])


@router.post("", response_model=SupplierClaimResponse, status_code=201)
async def create_supplier_claim(
    claim_data: SupplierClaimCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    创建供应商索赔记录
    
    登记公司因供应商质量问题向供应商提出的索赔要求
    
    **权限要求**: 需要登录
    """
    try:
        claim = await SupplierClaimService.create_claim(
            db=db,
            claim_data=claim_data,
            created_by=current_user.id
        )
        return claim
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/from-complaint", response_model=SupplierClaimResponse, status_code=201)
async def create_supplier_claim_from_complaint(
    claim_data: SupplierClaimFromComplaint,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    从客诉单一键转嫁生成供应商索赔
    
    核心功能：当8D报告判定根本原因为"供应商来料问题"时，
    可一键将客诉成本转嫁给供应商，实现成本转移
    
    **使用场景**:
    - 客诉根本原因为供应商来料不良
    - 需要向供应商追偿质量损失
    
    **权限要求**: 需要登录
    """
    try:
        claim = await SupplierClaimService.create_claim_from_complaint(
            db=db,
            claim_data=claim_data,
            created_by=current_user.id
        )
        return claim
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{claim_id}", response_model=SupplierClaimResponse)
async def get_supplier_claim(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取供应商索赔详情
    
    **权限要求**: 需要登录
    """
    claim = await SupplierClaimService.get_claim_by_id(db=db, claim_id=claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail=f"供应商索赔记录 {claim_id} 不存在")
    
    return claim


@router.get("", response_model=SupplierClaimListResponse)
async def list_supplier_claims(
    supplier_id: Optional[int] = Query(None, description="供应商ID筛选"),
    complaint_id: Optional[int] = Query(None, description="客诉单ID筛选"),
    status: Optional[SupplierClaimStatus] = Query(None, description="状态筛选"),
    start_date: Optional[date] = Query(None, description="开始日期"),
    end_date: Optional[date] = Query(None, description="结束日期"),
    skip: int = Query(0, ge=0, description="跳过记录数"),
    limit: int = Query(100, ge=1, le=1000, description="返回记录数"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取供应商索赔列表（支持筛选和分页）
    
    **权限要求**: 需要登录
    """
    claims, total = await SupplierClaimService.list_claims(
        db=db,
        supplier_id=supplier_id,
        complaint_id=complaint_id,
        status=status,
        start_date=start_date,
        end_date=end_date,
        skip=skip,
        limit=limit
    )
    
    return SupplierClaimListResponse(total=total, items=claims)


@router.put("/{claim_id}", response_model=SupplierClaimResponse)
async def update_supplier_claim(
    claim_id: int,
    claim_data: SupplierClaimUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    更新供应商索赔记录
    
    支持更新索赔金额、状态、协商记录等信息
    
    **权限要求**: 需要登录
    """
    claim = await SupplierClaimService.update_claim(
        db=db,
        claim_id=claim_id,
        claim_data=claim_data
    )
    
    if not claim:
        raise HTTPException(status_code=404, detail=f"供应商索赔记录 {claim_id} 不存在")
    
    return claim


@router.delete("/{claim_id}", status_code=204)
async def delete_supplier_claim(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    删除供应商索赔记录
    
    **权限要求**: 需要登录
    """
    success = await SupplierClaimService.delete_claim(db=db, claim_id=claim_id)
    
    if not success:
        raise HTTPException(status_code=404, detail=f"供应商索赔记录 {claim_id} 不存在")
    
    return None


@router.get("/statistics/summary", response_model=SupplierClaimStatistics)
async def get_supplier_claim_statistics(
    start_date: Optional[date] = Query(None, description="开始日期"),
    end_date: Optional[date] = Query(None, description="结束日期"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取供应商索赔统计数据
    
    提供按供应商、状态、月份、币种的统计分析
    
    **使用场景**:
    - 分析哪家供应商赔钱最多
    - 追踪索赔回收进度
    - 成本分析决策支持
    
    **权限要求**: 需要登录
    """
    statistics = await SupplierClaimService.get_statistics(
        db=db,
        start_date=start_date,
        end_date=end_date
    )
    
    return statistics
