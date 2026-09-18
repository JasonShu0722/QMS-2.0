"""
New Product Projects API Routes
新品项目管理API路由 - 实现阶段评审与交付物管理
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.new_product_project import (
    NewProductProjectCreate,
    NewProductProjectUpdate,
    NewProductProjectResponse,
    StageReviewCreate,
    StageReviewUpdate,
    StageReviewResponse,
    StageReviewApprovalRequest,
    DeliverableUploadRequest
)
from app.services.new_product_project_service import NewProductProjectService

router = APIRouter(prefix="/projects", tags=["new-product-projects"])


@router.post("", response_model=NewProductProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    project_data: NewProductProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    创建新品项目
    
    实现需求 2.8.2：创建新品项目
    
    Args:
        project_data: 项目创建数据
        db: 数据库会话
        current_user: 当前用户
        
    Returns:
        创建的项目信息
    """
    project = await NewProductProjectService.create_project(
        db=db,
        project_data=project_data,
        created_by=current_user.id
    )
    
    return NewProductProjectResponse.model_validate(project)


@router.get("/{project_id}", response_model=NewProductProjectResponse)
async def get_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取项目详情
    
    Args:
        project_id: 项目ID
        db: 数据库会话
        current_user: 当前用户
        
    Returns:
        项目详情
    """
    project = await NewProductProjectService.get_project_by_id(db, project_id)
    
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"项目ID {project_id} 不存在"
        )
    
    return NewProductProjectResponse.model_validate(project)


@router.put("/{project_id}", response_model=NewProductProjectResponse)
async def update_project(
    project_id: int,
    project_data: NewProductProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    更新项目信息
    
    Args:
        project_id: 项目ID
        project_data: 更新数据
        db: 数据库会话
        current_user: 当前用户
        
    Returns:
        更新后的项目信息
    """
    project = await NewProductProjectService.update_project(
        db=db,
        project_id=project_id,
        project_data=project_data,
        updated_by=current_user.id
    )
    
    return NewProductProjectResponse.model_validate(project)


@router.post("/{project_id}/stage-reviews", response_model=StageReviewResponse, status_code=status.HTTP_201_CREATED)
async def create_stage_review(
    project_id: int,
    review_data: StageReviewCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    配置阶段评审节点
    
    实现需求 2.8.2：配置阶段评审节点和项目质量交付物清单
    
    Args:
        project_id: 项目ID
        review_data: 评审配置数据
        db: 数据库会话
        current_user: 当前用户
        
    Returns:
        创建的阶段评审信息
    """
    stage_review = await NewProductProjectService.create_stage_review(
        db=db,
        project_id=project_id,
        review_data=review_data,
        created_by=current_user.id
    )
    
    return StageReviewResponse.model_validate(stage_review)


@router.get("/{project_id}/stage-reviews", response_model=List[StageReviewResponse])
async def get_stage_reviews(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取项目的所有阶段评审
    
    Args:
        project_id: 项目ID
        db: 数据库会话
        current_user: 当前用户
        
    Returns:
        阶段评审列表
    """
    stage_reviews = await NewProductProjectService.get_stage_reviews_by_project(
        db=db,
        project_id=project_id
    )
    
    return [StageReviewResponse.model_validate(review) for review in stage_reviews]


@router.post("/{project_id}/deliverables", response_model=StageReviewResponse)
async def upload_deliverable(
    project_id: int,
    stage_review_id: int,
    upload_data: DeliverableUploadRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    上传交付物
    
    实现需求 2.8.2：上传交付物
    
    Args:
        project_id: 项目ID
        stage_review_id: 阶段评审ID（通过查询参数传递）
        upload_data: 上传数据
        db: 数据库会话
        current_user: 当前用户
        
    Returns:
        更新后的阶段评审信息
    """
    stage_review = await NewProductProjectService.upload_deliverable(
        db=db,
        project_id=project_id,
        stage_review_id=stage_review_id,
        upload_data=upload_data,
        uploaded_by=current_user.id
    )
    
    return StageReviewResponse.model_validate(stage_review)


@router.post("/{project_id}/stage-reviews/{stage_id}/approve", response_model=StageReviewResponse)
async def approve_stage_review(
    project_id: int,
    stage_id: int,
    approval_data: StageReviewApprovalRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    阶段评审批准
    
    实现需求 2.8.2：阶段评审批准，交付物缺失时锁定项目进度
    
    核心逻辑：
    - 检查所有必需的交付物是否已上传
    - 如果交付物不完整，拒绝批准并返回缺失清单
    - 如果完整，更新评审结果并可选地推进项目阶段
    
    Args:
        project_id: 项目ID
        stage_id: 阶段评审ID
        approval_data: 批准数据
        db: 数据库会话
        current_user: 当前用户
        
    Returns:
        更新后的阶段评审信息
    """
    stage_review = await NewProductProjectService.approve_stage_review(
        db=db,
        project_id=project_id,
        stage_review_id=stage_id,
        approval_data=approval_data,
        reviewer_id=current_user.id
    )
    
    return StageReviewResponse.model_validate(stage_review)


@router.get("/{project_id}/stage-reviews/{stage_id}", response_model=StageReviewResponse)
async def get_stage_review(
    project_id: int,
    stage_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取阶段评审详情
    
    Args:
        project_id: 项目ID
        stage_id: 阶段评审ID
        db: 数据库会话
        current_user: 当前用户
        
    Returns:
        阶段评审详情
    """
    stage_review = await NewProductProjectService.get_stage_review_by_id(db, stage_id)
    
    if not stage_review or stage_review.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"阶段评审ID {stage_id} 不存在"
        )
    
    return StageReviewResponse.model_validate(stage_review)
