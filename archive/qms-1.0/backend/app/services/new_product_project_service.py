"""
New Product Project Service
新品项目服务层 - 实现阶段评审与交付物管理的业务逻辑
"""
from typing import List, Optional, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_
from sqlalchemy.orm import selectinload
from datetime import datetime
from fastapi import HTTPException, status

from app.models.new_product_project import NewProductProject, ProjectStage, ProjectStatus
from app.models.stage_review import StageReview, ReviewResult
from app.schemas.new_product_project import (
    NewProductProjectCreate,
    NewProductProjectUpdate,
    StageReviewCreate,
    StageReviewUpdate,
    StageReviewApprovalRequest,
    DeliverableUploadRequest,
    DeliverableItem
)


class NewProductProjectService:
    """新品项目服务"""
    
    @staticmethod
    async def create_project(
        db: AsyncSession,
        project_data: NewProductProjectCreate,
        created_by: int
    ) -> NewProductProject:
        """
        创建新品项目
        
        Args:
            db: 数据库会话
            project_data: 项目创建数据
            created_by: 创建人ID
            
        Returns:
            创建的项目对象
        """
        # 检查项目代码是否已存在
        stmt = select(NewProductProject).where(
            NewProductProject.project_code == project_data.project_code
        )
        result = await db.execute(stmt)
        existing_project = result.scalar_one_or_none()
        
        if existing_project:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"项目代码 {project_data.project_code} 已存在"
            )
        
        # 创建项目
        new_project = NewProductProject(
            project_code=project_data.project_code,
            project_name=project_data.project_name,
            product_type=project_data.product_type,
            project_manager=project_data.project_manager,
            project_manager_id=project_data.project_manager_id,
            planned_sop_date=project_data.planned_sop_date,
            current_stage=ProjectStage.CONCEPT,
            status=ProjectStatus.ACTIVE,
            created_by=created_by,
            updated_by=created_by
        )
        
        db.add(new_project)
        await db.commit()
        await db.refresh(new_project)
        
        return new_project
    
    @staticmethod
    async def get_project_by_id(
        db: AsyncSession,
        project_id: int
    ) -> Optional[NewProductProject]:
        """
        根据ID获取项目
        
        Args:
            db: 数据库会话
            project_id: 项目ID
            
        Returns:
            项目对象或None
        """
        stmt = select(NewProductProject).where(NewProductProject.id == project_id)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()
    
    @staticmethod
    async def update_project(
        db: AsyncSession,
        project_id: int,
        project_data: NewProductProjectUpdate,
        updated_by: int
    ) -> NewProductProject:
        """
        更新项目信息
        
        Args:
            db: 数据库会话
            project_id: 项目ID
            project_data: 更新数据
            updated_by: 更新人ID
            
        Returns:
            更新后的项目对象
        """
        project = await NewProductProjectService.get_project_by_id(db, project_id)
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"项目ID {project_id} 不存在"
            )
        
        # 更新字段
        update_data = project_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(project, field, value)
        
        project.updated_by = updated_by
        project.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(project)
        
        return project
    
    @staticmethod
    async def create_stage_review(
        db: AsyncSession,
        project_id: int,
        review_data: StageReviewCreate,
        created_by: int
    ) -> StageReview:
        """
        为项目配置阶段评审节点
        
        Args:
            db: 数据库会话
            project_id: 项目ID
            review_data: 评审配置数据
            created_by: 创建人ID
            
        Returns:
            创建的阶段评审对象
        """
        # 验证项目是否存在
        project = await NewProductProjectService.get_project_by_id(db, project_id)
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"项目ID {project_id} 不存在"
            )
        
        # 转换交付物清单为JSON格式
        deliverables_json = None
        if review_data.deliverables:
            deliverables_json = [item.model_dump() for item in review_data.deliverables]
        
        # 创建阶段评审
        stage_review = StageReview(
            project_id=project_id,
            stage_name=review_data.stage_name,
            planned_review_date=review_data.planned_review_date,
            deliverables=deliverables_json,
            reviewer_ids=review_data.reviewer_ids,
            review_result=ReviewResult.PENDING,
            created_by=created_by
        )
        
        db.add(stage_review)
        await db.commit()
        await db.refresh(stage_review)
        
        return stage_review
    
    @staticmethod
    async def upload_deliverable(
        db: AsyncSession,
        project_id: int,
        stage_review_id: int,
        upload_data: DeliverableUploadRequest,
        uploaded_by: int
    ) -> StageReview:
        """
        上传交付物
        
        Args:
            db: 数据库会话
            project_id: 项目ID
            stage_review_id: 阶段评审ID
            upload_data: 上传数据
            uploaded_by: 上传人ID
            
        Returns:
            更新后的阶段评审对象
        """
        # 获取阶段评审
        stmt = select(StageReview).where(
            and_(
                StageReview.id == stage_review_id,
                StageReview.project_id == project_id
            )
        )
        result = await db.execute(stmt)
        stage_review = result.scalar_one_or_none()
        
        if not stage_review:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"阶段评审ID {stage_review_id} 不存在"
            )
        
        # 更新交付物状态
        deliverables = stage_review.deliverables or []
        deliverable_found = False
        
        for deliverable in deliverables:
            if deliverable.get("name") == upload_data.deliverable_name:
                deliverable["file_path"] = upload_data.file_path
                deliverable["status"] = "submitted"
                deliverable["description"] = upload_data.description
                deliverable["uploaded_at"] = datetime.utcnow().isoformat()
                deliverable["uploaded_by"] = uploaded_by
                deliverable_found = True
                break
        
        if not deliverable_found:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"交付物 {upload_data.deliverable_name} 不在清单中"
            )
        
        stage_review.deliverables = deliverables
        stage_review.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(stage_review)
        
        return stage_review
    
    @staticmethod
    async def check_deliverables_complete(
        stage_review: StageReview
    ) -> tuple[bool, List[str]]:
        """
        检查交付物是否完整
        
        Args:
            stage_review: 阶段评审对象
            
        Returns:
            (是否完整, 缺失的交付物列表)
        """
        if not stage_review.deliverables:
            return True, []
        
        missing_deliverables = []
        
        for deliverable in stage_review.deliverables:
            if deliverable.get("required", True):
                status = deliverable.get("status", "missing")
                if status == "missing" or not deliverable.get("file_path"):
                    missing_deliverables.append(deliverable.get("name", "未知交付物"))
        
        is_complete = len(missing_deliverables) == 0
        return is_complete, missing_deliverables
    
    @staticmethod
    async def approve_stage_review(
        db: AsyncSession,
        project_id: int,
        stage_review_id: int,
        approval_data: StageReviewApprovalRequest,
        reviewer_id: int
    ) -> StageReview:
        """
        批准阶段评审
        实现交付物缺失时锁定项目进度的逻辑
        
        Args:
            db: 数据库会话
            project_id: 项目ID
            stage_review_id: 阶段评审ID
            approval_data: 批准数据
            reviewer_id: 评审人ID
            
        Returns:
            更新后的阶段评审对象
        """
        # 获取阶段评审
        stmt = select(StageReview).where(
            and_(
                StageReview.id == stage_review_id,
                StageReview.project_id == project_id
            )
        )
        result = await db.execute(stmt)
        stage_review = result.scalar_one_or_none()
        
        if not stage_review:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"阶段评审ID {stage_review_id} 不存在"
            )
        
        # 检查交付物完整性（仅在通过或有条件通过时检查）
        if approval_data.review_result in [ReviewResult.PASSED, ReviewResult.CONDITIONAL_PASS]:
            is_complete, missing_deliverables = await NewProductProjectService.check_deliverables_complete(
                stage_review
            )
            
            if not is_complete:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"交付物不完整，缺失：{', '.join(missing_deliverables)}。请先上传所有必需的交付物。"
                )
        
        # 更新评审结果
        stage_review.review_result = approval_data.review_result
        stage_review.review_comments = approval_data.review_comments
        stage_review.review_date = datetime.utcnow()
        stage_review.conditional_requirements = approval_data.conditional_requirements
        stage_review.conditional_deadline = approval_data.conditional_deadline
        stage_review.updated_at = datetime.utcnow()
        
        # 如果评审通过，更新项目阶段（可选逻辑，根据实际需求调整）
        if approval_data.review_result == ReviewResult.PASSED:
            project = await NewProductProjectService.get_project_by_id(db, project_id)
            if project:
                # 这里可以添加自动推进项目阶段的逻辑
                # 例如：从概念阶段推进到设计阶段
                pass
        
        await db.commit()
        await db.refresh(stage_review)
        
        return stage_review
    
    @staticmethod
    async def get_stage_reviews_by_project(
        db: AsyncSession,
        project_id: int
    ) -> List[StageReview]:
        """
        获取项目的所有阶段评审
        
        Args:
            db: 数据库会话
            project_id: 项目ID
            
        Returns:
            阶段评审列表
        """
        stmt = select(StageReview).where(
            StageReview.project_id == project_id
        ).order_by(StageReview.created_at)
        
        result = await db.execute(stmt)
        return result.scalars().all()
    
    @staticmethod
    async def get_stage_review_by_id(
        db: AsyncSession,
        stage_review_id: int
    ) -> Optional[StageReview]:
        """
        根据ID获取阶段评审
        
        Args:
            db: 数据库会话
            stage_review_id: 阶段评审ID
            
        Returns:
            阶段评审对象或None
        """
        stmt = select(StageReview).where(StageReview.id == stage_review_id)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()
