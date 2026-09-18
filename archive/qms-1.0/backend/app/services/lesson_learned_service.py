"""
Lesson Learned Service
经验教训服务 - 实现经验教训库管理和项目反向注入
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import selectinload
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta

from app.models.lesson_learned_library import LessonLearnedLibrary, SourceModule
from app.models.project_lesson_check import ProjectLessonCheck
from app.models.new_product_project import NewProductProject
from app.models.eight_d import EightD, EightDStatus
from app.models.eight_d_customer import EightDCustomer, EightDStatus as CustomerEightDStatus
from app.schemas.lesson_learned import (
    LessonLearnedCreate,
    LessonLearnedUpdate,
    ProjectLessonCheckRequest
)


class LessonLearnedService:
    """经验教训服务类"""
    
    @staticmethod
    async def create_lesson(
        db: AsyncSession,
        lesson_data: LessonLearnedCreate,
        created_by: int
    ) -> LessonLearnedLibrary:
        """
        创建经验教训
        支持手工新增或从8D报告自动提取
        """
        lesson = LessonLearnedLibrary(
            lesson_title=lesson_data.lesson_title,
            lesson_content=lesson_data.lesson_content,
            source_module=lesson_data.source_module,
            source_record_id=lesson_data.source_record_id,
            root_cause=lesson_data.root_cause,
            preventive_action=lesson_data.preventive_action,
            applicable_scenarios=lesson_data.applicable_scenarios,
            is_active=lesson_data.is_active,
            created_by=created_by,
            updated_by=created_by
        )
        
        db.add(lesson)
        await db.commit()
        await db.refresh(lesson)
        
        return lesson
    
    @staticmethod
    async def update_lesson(
        db: AsyncSession,
        lesson_id: int,
        lesson_data: LessonLearnedUpdate,
        updated_by: int
    ) -> Optional[LessonLearnedLibrary]:
        """更新经验教训"""
        stmt = select(LessonLearnedLibrary).where(LessonLearnedLibrary.id == lesson_id)
        result = await db.execute(stmt)
        lesson = result.scalar_one_or_none()
        
        if not lesson:
            return None
        
        # 更新字段
        update_data = lesson_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(lesson, field, value)
        
        lesson.updated_by = updated_by
        lesson.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(lesson)
        
        return lesson
    
    @staticmethod
    async def delete_lesson(
        db: AsyncSession,
        lesson_id: int
    ) -> bool:
        """
        删除经验教训（软删除，设置为不启用）
        """
        stmt = select(LessonLearnedLibrary).where(LessonLearnedLibrary.id == lesson_id)
        result = await db.execute(stmt)
        lesson = result.scalar_one_or_none()
        
        if not lesson:
            return False
        
        lesson.is_active = False
        lesson.updated_at = datetime.utcnow()
        
        await db.commit()
        return True
    
    @staticmethod
    async def get_lesson_by_id(
        db: AsyncSession,
        lesson_id: int
    ) -> Optional[LessonLearnedLibrary]:
        """根据ID获取经验教训"""
        stmt = select(LessonLearnedLibrary).where(LessonLearnedLibrary.id == lesson_id)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()
    
    @staticmethod
    async def get_lessons(
        db: AsyncSession,
        source_module: Optional[str] = None,
        is_active: Optional[bool] = True,
        search_keyword: Optional[str] = None,
        page: int = 1,
        page_size: int = 50
    ) -> tuple[List[LessonLearnedLibrary], int]:
        """
        获取经验教训列表
        支持按来源模块、启用状态、关键词搜索
        """
        # 构建查询条件
        conditions = []
        
        if source_module:
            conditions.append(LessonLearnedLibrary.source_module == source_module)
        
        if is_active is not None:
            conditions.append(LessonLearnedLibrary.is_active == is_active)
        
        if search_keyword:
            keyword_filter = or_(
                LessonLearnedLibrary.lesson_title.ilike(f"%{search_keyword}%"),
                LessonLearnedLibrary.lesson_content.ilike(f"%{search_keyword}%"),
                LessonLearnedLibrary.applicable_scenarios.ilike(f"%{search_keyword}%")
            )
            conditions.append(keyword_filter)
        
        # 查询总数
        count_stmt = select(func.count(LessonLearnedLibrary.id))
        if conditions:
            count_stmt = count_stmt.where(and_(*conditions))
        
        count_result = await db.execute(count_stmt)
        total = count_result.scalar()
        
        # 查询数据
        stmt = select(LessonLearnedLibrary)
        if conditions:
            stmt = stmt.where(and_(*conditions))
        
        stmt = stmt.order_by(LessonLearnedLibrary.created_at.desc())
        stmt = stmt.offset((page - 1) * page_size).limit(page_size)
        
        result = await db.execute(stmt)
        lessons = result.scalars().all()
        
        return list(lessons), total
    
    @staticmethod
    async def extract_from_supplier_8d(
        db: AsyncSession,
        eight_d_id: int,
        created_by: int
    ) -> Optional[LessonLearnedLibrary]:
        """
        从供应商8D报告提取经验教训
        调用2.5模块的8D结案记录
        """
        stmt = select(EightD).where(
            and_(
                EightD.id == eight_d_id,
                EightD.status == EightDStatus.APPROVED
            )
        )
        result = await db.execute(stmt)
        eight_d = result.scalar_one_or_none()
        
        if not eight_d or not eight_d.d4_d7_data:
            return None
        
        # 从8D报告提取数据
        d4_d7_data = eight_d.d4_d7_data
        
        lesson = LessonLearnedLibrary(
            lesson_title=f"供应商质量问题：{d4_d7_data.get('root_cause_analysis', '')[:50]}",
            lesson_content=d4_d7_data.get('problem_description', ''),
            source_module=SourceModule.SUPPLIER_QUALITY,
            source_record_id=eight_d_id,
            root_cause=d4_d7_data.get('root_cause_analysis', ''),
            preventive_action=d4_d7_data.get('preventive_action', ''),
            applicable_scenarios=d4_d7_data.get('applicable_scenarios', ''),
            is_active=True,
            created_by=created_by,
            updated_by=created_by
        )
        
        db.add(lesson)
        await db.commit()
        await db.refresh(lesson)
        
        return lesson
    
    @staticmethod
    async def extract_from_customer_8d(
        db: AsyncSession,
        eight_d_id: int,
        created_by: int
    ) -> Optional[LessonLearnedLibrary]:
        """
        从客诉8D报告提取经验教训
        调用2.7模块的8D结案记录
        """
        stmt = select(EightDCustomer).where(
            and_(
                EightDCustomer.id == eight_d_id,
                EightDCustomer.status == CustomerEightDStatus.APPROVED
            )
        )
        result = await db.execute(stmt)
        eight_d = result.scalar_one_or_none()
        
        if not eight_d:
            return None
        
        # 从8D报告提取数据
        d4_d7_data = eight_d.d4_d7_responsible or {}
        d8_data = eight_d.d8_horizontal or {}
        
        lesson = LessonLearnedLibrary(
            lesson_title=f"客户质量问题：{d4_d7_data.get('root_cause_analysis', '')[:50]}",
            lesson_content=d8_data.get('lesson_learned_summary', ''),
            source_module=SourceModule.CUSTOMER_QUALITY,
            source_record_id=eight_d_id,
            root_cause=d4_d7_data.get('root_cause_analysis', ''),
            preventive_action=d4_d7_data.get('preventive_action', ''),
            applicable_scenarios=d8_data.get('similar_products', ''),
            is_active=True,
            created_by=created_by,
            updated_by=created_by
        )
        
        db.add(lesson)
        await db.commit()
        await db.refresh(lesson)
        
        return lesson
    
    @staticmethod
    async def push_lessons_to_project(
        db: AsyncSession,
        project_id: int
    ) -> List[LessonLearnedLibrary]:
        """
        项目立项时自动推送相关历史问题
        基于项目类型、产品类型等智能匹配
        """
        # 获取项目信息
        stmt = select(NewProductProject).where(NewProductProject.id == project_id)
        result = await db.execute(stmt)
        project = result.scalar_one_or_none()
        
        if not project:
            return []
        
        # 查询所有启用的经验教训
        stmt = select(LessonLearnedLibrary).where(
            LessonLearnedLibrary.is_active == True
        )
        result = await db.execute(stmt)
        all_lessons = result.scalars().all()
        
        # 智能匹配：基于产品类型、关键词等
        matched_lessons = []
        for lesson in all_lessons:
            # 简单匹配逻辑：检查产品类型是否在适用场景中
            if lesson.applicable_scenarios and project.product_type:
                if project.product_type.lower() in lesson.applicable_scenarios.lower():
                    matched_lessons.append(lesson)
                    continue
            
            # 默认推送所有经验教训（可根据实际需求优化）
            matched_lessons.append(lesson)
        
        # 为每个匹配的经验教训创建点检记录
        for lesson in matched_lessons:
            # 检查是否已存在点检记录
            check_stmt = select(ProjectLessonCheck).where(
                and_(
                    ProjectLessonCheck.project_id == project_id,
                    ProjectLessonCheck.lesson_id == lesson.id
                )
            )
            check_result = await db.execute(check_stmt)
            existing_check = check_result.scalar_one_or_none()
            
            if not existing_check:
                # 创建新的点检记录
                check = ProjectLessonCheck(
                    project_id=project_id,
                    lesson_id=lesson.id,
                    is_applicable=False,  # 默认未点检
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                db.add(check)
        
        await db.commit()
        
        return matched_lessons
    
    @staticmethod
    async def check_lesson_for_project(
        db: AsyncSession,
        project_id: int,
        check_data: ProjectLessonCheckRequest,
        checked_by: int
    ) -> ProjectLessonCheck:
        """
        逐条勾选规避措施
        项目团队填写是否适用及规避措施
        """
        # 查找或创建点检记录
        stmt = select(ProjectLessonCheck).where(
            and_(
                ProjectLessonCheck.project_id == project_id,
                ProjectLessonCheck.lesson_id == check_data.lesson_id
            )
        )
        result = await db.execute(stmt)
        check = result.scalar_one_or_none()
        
        if not check:
            # 创建新记录
            check = ProjectLessonCheck(
                project_id=project_id,
                lesson_id=check_data.lesson_id,
                is_applicable=check_data.is_applicable,
                reason_if_not=check_data.reason_if_not,
                evidence_description=check_data.evidence_description,
                checked_by=checked_by,
                checked_at=datetime.utcnow(),
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(check)
        else:
            # 更新现有记录
            check.is_applicable = check_data.is_applicable
            check.reason_if_not = check_data.reason_if_not
            check.evidence_description = check_data.evidence_description
            check.checked_by = checked_by
            check.checked_at = datetime.utcnow()
            check.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(check)
        
        return check
    
    @staticmethod
    async def upload_evidence(
        db: AsyncSession,
        check_id: int,
        file_path: str
    ) -> Optional[ProjectLessonCheck]:
        """
        上传规避证据
        阶段评审时上传设计截图、文件修改记录等
        """
        stmt = select(ProjectLessonCheck).where(ProjectLessonCheck.id == check_id)
        result = await db.execute(stmt)
        check = result.scalar_one_or_none()
        
        if not check:
            return None
        
        check.evidence_file_path = file_path
        check.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(check)
        
        return check
    
    @staticmethod
    async def get_project_lesson_checks(
        db: AsyncSession,
        project_id: int,
        include_lesson_details: bool = True
    ) -> List[Dict[str, Any]]:
        """
        获取项目的所有经验教训点检记录
        包含经验教训详情
        """
        stmt = select(ProjectLessonCheck).where(
            ProjectLessonCheck.project_id == project_id
        )
        
        if include_lesson_details:
            stmt = stmt.options(selectinload(ProjectLessonCheck.lesson))
        
        result = await db.execute(stmt)
        checks = result.scalars().all()
        
        # 转换为字典格式，包含经验教训详情
        check_list = []
        for check in checks:
            check_dict = check.to_dict()
            if include_lesson_details and check.lesson:
                check_dict['lesson_title'] = check.lesson.lesson_title
                check_dict['lesson_content'] = check.lesson.lesson_content
                check_dict['root_cause'] = check.lesson.root_cause
                check_dict['preventive_action'] = check.lesson.preventive_action
            check_list.append(check_dict)
        
        return check_list
    
    @staticmethod
    async def verify_lesson_check(
        db: AsyncSession,
        check_id: int,
        verified_by: int,
        verification_result: str,
        verification_comment: Optional[str] = None
    ) -> Optional[ProjectLessonCheck]:
        """
        阶段评审时验证规避证据
        评审员验证项目团队提交的规避措施是否有效
        """
        stmt = select(ProjectLessonCheck).where(ProjectLessonCheck.id == check_id)
        result = await db.execute(stmt)
        check = result.scalar_one_or_none()
        
        if not check:
            return None
        
        check.verified_by = verified_by
        check.verified_at = datetime.utcnow()
        check.verification_result = verification_result
        check.verification_comment = verification_comment
        check.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(check)
        
        return check
    
    @staticmethod
    async def get_unchecked_lessons_count(
        db: AsyncSession,
        project_id: int
    ) -> int:
        """
        获取项目未点检的经验教训数量
        用于阶段评审时的互锁检查
        """
        stmt = select(func.count(ProjectLessonCheck.id)).where(
            and_(
                ProjectLessonCheck.project_id == project_id,
                ProjectLessonCheck.checked_at.is_(None)
            )
        )
        result = await db.execute(stmt)
        return result.scalar() or 0
