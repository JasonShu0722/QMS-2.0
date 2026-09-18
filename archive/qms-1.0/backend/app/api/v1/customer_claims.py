"""
Customer Claims API Routes
客户索赔接口路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from datetime import date

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.customer_claim import (
    CustomerClaimCreate,
    CustomerClaimUpdate,
    CustomerClaimResponse,
    CustomerClaimListResponse,
    CustomerClaimStatistics
)
from app.services.customer_claim_service import CustomerClaimService

router = APIRouter(prefix="/customer-claims", tags=["customer-claims"])


@router.post("", response_model=CustomerClaimResponse, status_code=201)
async def create_customer_claim(
    claim_data: CustomerClaimCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    创建客户索赔记录
    
    登记客户因质量问题向公司提出的索赔要求
    
    **权限要求**: 需要登录
    """
    try:
        claim = await CustomerClaimService.create_claim(
            db=db,
            claim_data=claim_data,
            created_by=current_user.id
        )
        return claim
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{claim_id}", response_model=CustomerClaimResponse)
async def get_customer_claim(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取客户索赔详情
    
    **权限要求**: 需要登录
    """
    claim = await CustomerClaimService.get_claim_by_id(db=db, claim_id=claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail=f"客户索赔记录 {claim_id} 不存在")
    
    return claim


@router.get("", response_model=CustomerClaimListResponse)
async def list_customer_claims(
    complaint_id: Optional[int] = Query(None, description="客诉单ID筛选"),
    customer_name: Optional[str] = Query(None, description="客户名称筛选（模糊匹配）"),
    start_date: Optional[date] = Query(None, description="开始日期"),
    end_date: Optional[date] = Query(None, description="结束日期"),
    skip: int = Query(0, ge=0, description="跳过记录数"),
    limit: int = Query(100, ge=1, le=1000, description="返回记录数"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取客户索赔列表（支持筛选和分页）
    
    **权限要求**: 需要登录
    """
    claims, total = await CustomerClaimService.list_claims(
        db=db,
        complaint_id=complaint_id,
        customer_name=customer_name,
        start_date=start_date,
        end_date=end_date,
        skip=skip,
        limit=limit
    )
    
    return CustomerClaimListResponse(total=total, items=claims)


@router.put("/{claim_id}", response_model=CustomerClaimResponse)
async def update_customer_claim(
    claim_id: int,
    claim_data: CustomerClaimUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    更新客户索赔记录
    
    **权限要求**: 需要登录
    """
    claim = await CustomerClaimService.update_claim(
        db=db,
        claim_id=claim_id,
        claim_data=claim_data
    )
    
    if not claim:
        raise HTTPException(status_code=404, detail=f"客户索赔记录 {claim_id} 不存在")
    
    return claim


@router.delete("/{claim_id}", status_code=204)
async def delete_customer_claim(
    claim_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    删除客户索赔记录
    
    **权限要求**: 需要登录
    """
    success = await CustomerClaimService.delete_claim(db=db, claim_id=claim_id)
    
    if not success:
        raise HTTPException(status_code=404, detail=f"客户索赔记录 {claim_id} 不存在")
    
    return None


@router.get("/statistics/summary", response_model=CustomerClaimStatistics)
async def get_customer_claim_statistics(
    start_date: Optional[date] = Query(None, description="开始日期"),
    end_date: Optional[date] = Query(None, description="结束日期"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取客户索赔统计数据
    
    提供按客户、月份、币种的统计分析
    
    **权限要求**: 需要登录
    """
    statistics = await CustomerClaimService.get_statistics(
        db=db,
        start_date=start_date,
        end_date=end_date
    )
    
    return statistics
