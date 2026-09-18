"""
Lesson Learned Tests
测试经验教训反向注入功能
"""
import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime

from app.models.lesson_learned_library import LessonLearnedLibrary, SourceModule
from app.models.project_lesson_check import ProjectLessonCheck
from app.models.new_product_project import NewProductProject, ProjectStage, ProjectStatus
from app.models.eight_d import EightD, EightDStatus
from app.models.user import User, UserType, UserStatus
from app.services.lesson_learned_service import LessonLearnedService
from app.schemas.lesson_learned import (
    LessonLearnedCreate,
    LessonLearnedUpdate,
    ProjectLessonCheckRequest
)


@pytest.fixture
async def test_user(db_session: AsyncSession) -> User:
    """创建测试用户"""
    user = User(
        username="test_qe",
        hashed_password="hashed_password",
        full_name="测试质量工程师",
        email="qe@test.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE,
        department="质量部",
        position="质量工程师"
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
async def test_project(db_session: AsyncSession, test_user: User) -> NewProductProject:
    """创建测试项目"""
    project = NewProductProject(
        project_code="NP-2024-001",
        project_name="新能源控制器V2.0",
        product_type="控制器",
        project_manager=test_user.id,
        current_stage=ProjectStage.CONCEPT,
        status=ProjectStatus.ACTIVE,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)
    return project


@pytest.fixture
async def test_lesson(db_session: AsyncSession, test_user: User) -> LessonLearnedLibrary:
    """创建测试经验教训"""
    lesson = LessonLearnedLibrary(
        lesson_title="供应商模具老化导致尺寸超差",
        lesson_content="供应商A在2023年Q4连续3批次出现尺寸超差问题，根本原因为模具使用超过5年未进行保养",
        source_module=SourceModule.SUPPLIER_QUALITY,
        source_record_id=1,
        root_cause="模具老化，未按周期保养",
        preventive_action="1. 要求供应商建立模具保养台账 2. 每季度提交模具状态报告 3. 关键尺寸增加首件检验",
        applicable_scenarios="注塑件、压铸件等模具加工产品",
        is_active=True,
        created_by=test_user.id,
        updated_by=test_user.id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db_session.add(lesson)
    await db_session.commit()
    await db_session.refresh(lesson)
    return lesson


@pytest.mark.asyncio
class TestLessonLearnedCRUD:
    """测试经验教训的增删改查"""
    
    async def test_create_lesson(self, db_session: AsyncSession, test_user: User):
        """测试创建经验教训"""
        lesson_data = LessonLearnedCreate(
            lesson_title="设计缺陷导致客诉",
            lesson_content="产品设计时未考虑极端温度环境，导致客户现场失效",
            source_module=SourceModule.CUSTOMER_QUALITY,
            source_record_id=10,
            root_cause="设计评审不充分，未进行环境适应性测试",
            preventive_action="1. 增加环境适应性测试项目 2. 设计评审增加极端工况检查清单",
            applicable_scenarios="户外使用产品",
            is_active=True
        )
        
        lesson = await LessonLearnedService.create_lesson(
            db=db_session,
            lesson_data=lesson_data,
            created_by=test_user.id
        )
        
        assert lesson.id is not None
        assert lesson.lesson_title == "设计缺陷导致客诉"
        assert lesson.source_module == SourceModule.CUSTOMER_QUALITY
        assert lesson.is_active is True
    
    async def test_get_lessons(self, db_session: AsyncSession, test_lesson: LessonLearnedLibrary):
        """测试获取经验教训列表"""
        lessons, total = await LessonLearnedService.get_lessons(
            db=db_session,
            is_active=True,
            page=1,
            page_size=10
        )
        
        assert total >= 1
        assert len(lessons) >= 1
        assert any(lesson.id == test_lesson.id for lesson in lessons)
    
    async def test_search_lessons(self, db_session: AsyncSession, test_lesson: LessonLearnedLibrary):
        """测试关键词搜索"""
        lessons, total = await LessonLearnedService.get_lessons(
            db=db_session,
            search_keyword="模具",
            page=1,
            page_size=10
        )
        
        assert total >= 1
        assert any("模具" in lesson.lesson_title or "模具" in lesson.lesson_content for lesson in lessons)
    
    async def test_update_lesson(self, db_session: AsyncSession, test_lesson: LessonLearnedLibrary, test_user: User):
        """测试更新经验教训"""
        update_data = LessonLearnedUpdate(
            lesson_title="供应商模具老化导致尺寸超差（已更新）",
            preventive_action="1. 要求供应商建立模具保养台账 2. 每季度提交模具状态报告 3. 关键尺寸增加首件检验 4. 模具使用超过3年强制更换"
        )
        
        updated_lesson = await LessonLearnedService.update_lesson(
            db=db_session,
            lesson_id=test_lesson.id,
            lesson_data=update_data,
            updated_by=test_user.id
        )
        
        assert updated_lesson is not None
        assert "已更新" in updated_lesson.lesson_title
        assert "模具使用超过3年强制更换" in updated_lesson.preventive_action
    
    async def test_delete_lesson(self, db_session: AsyncSession, test_lesson: LessonLearnedLibrary):
        """测试删除经验教训（软删除）"""
        success = await LessonLearnedService.delete_lesson(
            db=db_session,
            lesson_id=test_lesson.id
        )
        
        assert success is True
        
        # 验证软删除
        await db_session.refresh(test_lesson)
        assert test_lesson.is_active is False


@pytest.mark.asyncio
class TestProjectLessonInjection:
    """测试项目经验教训反向注入"""
    
    async def test_push_lessons_to_project(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_lesson: LessonLearnedLibrary
    ):
        """测试项目立项时自动推送经验教训"""
        pushed_lessons = await LessonLearnedService.push_lessons_to_project(
            db=db_session,
            project_id=test_project.id
        )
        
        assert len(pushed_lessons) >= 1
        assert any(lesson.id == test_lesson.id for lesson in pushed_lessons)
        
        # 验证创建了点检记录
        from sqlalchemy import select
        stmt = select(ProjectLessonCheck).where(
            ProjectLessonCheck.project_id == test_project.id
        )
        result = await db_session.execute(stmt)
        checks = result.scalars().all()
        
        assert len(checks) >= 1
    
    async def test_check_lesson_applicable(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_lesson: LessonLearnedLibrary,
        test_user: User
    ):
        """测试勾选经验教训为适用"""
        check_data = ProjectLessonCheckRequest(
            lesson_id=test_lesson.id,
            is_applicable=True,
            reason_if_not=None,
            evidence_description="已在设计评审阶段要求供应商提供模具保养记录"
        )
        
        check = await LessonLearnedService.check_lesson_for_project(
            db=db_session,
            project_id=test_project.id,
            check_data=check_data,
            checked_by=test_user.id
        )
        
        assert check.id is not None
        assert check.is_applicable is True
        assert check.evidence_description == "已在设计评审阶段要求供应商提供模具保养记录"
        assert check.checked_by == test_user.id
        assert check.checked_at is not None
    
    async def test_check_lesson_not_applicable(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_lesson: LessonLearnedLibrary,
        test_user: User
    ):
        """测试勾选经验教训为不适用"""
        check_data = ProjectLessonCheckRequest(
            lesson_id=test_lesson.id,
            is_applicable=False,
            reason_if_not="本项目不涉及模具加工，采用CNC加工工艺",
            evidence_description=None
        )
        
        check = await LessonLearnedService.check_lesson_for_project(
            db=db_session,
            project_id=test_project.id,
            check_data=check_data,
            checked_by=test_user.id
        )
        
        assert check.id is not None
        assert check.is_applicable is False
        assert "CNC加工" in check.reason_if_not
    
    async def test_upload_evidence(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_lesson: LessonLearnedLibrary,
        test_user: User
    ):
        """测试上传规避证据"""
        # 先创建点检记录
        check_data = ProjectLessonCheckRequest(
            lesson_id=test_lesson.id,
            is_applicable=True,
            evidence_description="已增加模具保养检查项"
        )
        
        check = await LessonLearnedService.check_lesson_for_project(
            db=db_session,
            project_id=test_project.id,
            check_data=check_data,
            checked_by=test_user.id
        )
        
        # 上传证据
        file_path = "/uploads/lesson_evidence/1/design_review_screenshot.png"
        updated_check = await LessonLearnedService.upload_evidence(
            db=db_session,
            check_id=check.id,
            file_path=file_path
        )
        
        assert updated_check is not None
        assert updated_check.evidence_file_path == file_path
    
    async def test_verify_lesson_check(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_lesson: LessonLearnedLibrary,
        test_user: User
    ):
        """测试阶段评审时验证规避证据"""
        # 先创建点检记录
        check_data = ProjectLessonCheckRequest(
            lesson_id=test_lesson.id,
            is_applicable=True,
            evidence_description="已增加模具保养检查项"
        )
        
        check = await LessonLearnedService.check_lesson_for_project(
            db=db_session,
            project_id=test_project.id,
            check_data=check_data,
            checked_by=test_user.id
        )
        
        # 验证通过
        verified_check = await LessonLearnedService.verify_lesson_check(
            db=db_session,
            check_id=check.id,
            verified_by=test_user.id,
            verification_result="passed",
            verification_comment="规避措施有效，已在PPAP文件中体现"
        )
        
        assert verified_check is not None
        assert verified_check.verification_result == "passed"
        assert verified_check.verified_by == test_user.id
        assert verified_check.verified_at is not None
    
    async def test_get_project_lesson_checks(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_lesson: LessonLearnedLibrary,
        test_user: User
    ):
        """测试获取项目的所有点检记录"""
        # 创建点检记录
        check_data = ProjectLessonCheckRequest(
            lesson_id=test_lesson.id,
            is_applicable=True,
            evidence_description="已规避"
        )
        
        await LessonLearnedService.check_lesson_for_project(
            db=db_session,
            project_id=test_project.id,
            check_data=check_data,
            checked_by=test_user.id
        )
        
        # 获取所有点检记录
        checks = await LessonLearnedService.get_project_lesson_checks(
            db=db_session,
            project_id=test_project.id,
            include_lesson_details=True
        )
        
        assert len(checks) >= 1
        assert checks[0]['lesson_title'] is not None
        assert checks[0]['project_id'] == test_project.id
    
    async def test_get_unchecked_lessons_count(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_lesson: LessonLearnedLibrary
    ):
        """测试获取未点检的经验教训数量"""
        # 推送经验教训
        await LessonLearnedService.push_lessons_to_project(
            db=db_session,
            project_id=test_project.id
        )
        
        # 获取未点检数量
        unchecked_count = await LessonLearnedService.get_unchecked_lessons_count(
            db=db_session,
            project_id=test_project.id
        )
        
        # 应该有未点检的记录
        assert unchecked_count >= 1


@pytest.mark.asyncio
class TestExtractFrom8D:
    """测试从8D报告提取经验教训"""
    
    async def test_extract_from_supplier_8d(
        self,
        db_session: AsyncSession,
        test_user: User
    ):
        """测试从供应商8D报告提取经验教训"""
        # 创建一个已批准的8D报告
        from app.models.scar import SCAR, SCARStatus, SCARSeverity
        from app.models.supplier import Supplier, SupplierStatus
        
        # 创建供应商
        supplier = Supplier(
            name="测试供应商A",
            code="SUP-001",
            contact_person="张三",
            contact_email="zhangsan@supplier.com",
            status=SupplierStatus.ACTIVE
        )
        db_session.add(supplier)
        await db_session.commit()
        await db_session.refresh(supplier)
        
        # 创建SCAR
        scar = SCAR(
            scar_number="SCAR-2024-001",
            supplier_id=supplier.id,
            material_code="MAT-001",
            defect_description="尺寸超差",
            defect_qty=100,
            severity=SCARSeverity.MAJOR,
            status=SCARStatus.CLOSED,
            current_handler_id=test_user.id,
            deadline=datetime.utcnow()
        )
        db_session.add(scar)
        await db_session.commit()
        await db_session.refresh(scar)
        
        # 创建8D报告
        eight_d = EightD(
            scar_id=scar.id,
            d4_d7_data={
                "problem_description": "供应商模具老化导致尺寸超差",
                "root_cause_analysis": "模具使用超过5年未进行保养",
                "preventive_action": "建立模具保养台账，每季度提交模具状态报告",
                "applicable_scenarios": "注塑件、压铸件"
            },
            status=EightDStatus.APPROVED,
            submitted_by=test_user.id,
            submitted_at=datetime.utcnow()
        )
        db_session.add(eight_d)
        await db_session.commit()
        await db_session.refresh(eight_d)
        
        # 提取经验教训
        lesson = await LessonLearnedService.extract_from_supplier_8d(
            db=db_session,
            eight_d_id=eight_d.id,
            created_by=test_user.id
        )
        
        assert lesson is not None
        assert lesson.source_module == SourceModule.SUPPLIER_QUALITY
        assert lesson.source_record_id == eight_d.id
        assert "模具" in lesson.root_cause
        assert lesson.is_active is True


@pytest.mark.asyncio
class TestValidation:
    """测试数据校验"""
    
    async def test_not_applicable_requires_reason(self):
        """测试不适用时必须填写原因"""
        with pytest.raises(ValueError, match="不适用时必须填写原因说明"):
            ProjectLessonCheckRequest(
                lesson_id=1,
                is_applicable=False,
                reason_if_not="太短",  # 少于10字
                evidence_description=None
            )
    
    async def test_lesson_title_min_length(self):
        """测试经验教训标题最小长度"""
        with pytest.raises(ValueError):
            LessonLearnedCreate(
                lesson_title="短",  # 少于5字
                lesson_content="这是一个测试内容",
                source_module=SourceModule.MANUAL,
                root_cause="测试根本原因",
                preventive_action="测试预防措施"
            )
