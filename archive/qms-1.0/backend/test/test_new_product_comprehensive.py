"""
Comprehensive Tests for New Product Quality Management Module
新品质量管理模块综合测试

测试范围：
- 经验教训自动推送逻辑 (2.8.1)
- 阶段评审交付物互锁 (2.8.2)
- 试产数据自动抓取和计算 (2.8.3)
- 试产问题跟进 (2.8.4)
"""
import pytest
from datetime import datetime, timedelta
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from unittest.mock import AsyncMock, patch

from app.models.user import User, UserType, UserStatus
from app.models.new_product_project import NewProductProject, ProjectStage, ProjectStatus
from app.models.lesson_learned_library import LessonLearnedLibrary, SourceModule
from app.models.stage_review import StageReview, ReviewResult
from app.models.trial_production import TrialProduction, TrialStatus
from app.models.trial_issue import TrialIssue, IssueType, IssueStatus
from app.services.lesson_learned_service import LessonLearnedService
from app.services.trial_production_service import TrialProductionService


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
        project_code="NP-2024-TEST",
        project_name="新能源控制器V3.0",
        product_type="MCU控制器",
        project_manager=test_user.id,
        current_stage=ProjectStage.CONCEPT,
        status=ProjectStatus.ACTIVE,
        planned_sop_date=datetime.utcnow() + timedelta(days=180),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)
    return project


@pytest.fixture
async def test_lessons(db_session: AsyncSession, test_user: User) -> list[LessonLearnedLibrary]:
    """创建多个测试经验教训"""
    lessons = [
        LessonLearnedLibrary(
            lesson_title="供应商模具老化导致尺寸超差",
            lesson_content="供应商A在2023年Q4连续3批次出现尺寸超差问题",
            source_module=SourceModule.SUPPLIER_QUALITY,
            root_cause="模具老化，未按周期保养",
            preventive_action="要求供应商建立模具保养台账",
            applicable_scenarios="注塑件、压铸件",
            is_active=True,
            created_by=test_user.id
        ),
        LessonLearnedLibrary(
            lesson_title="设计缺陷导致客诉",
            lesson_content="产品设计时未考虑极端温度环境",
            source_module=SourceModule.CUSTOMER_QUALITY,
            root_cause="设计评审不充分",
            preventive_action="增加环境适应性测试项目",
            applicable_scenarios="户外使用产品",
            is_active=True,
            created_by=test_user.id
        ),
        LessonLearnedLibrary(
            lesson_title="工艺参数不当导致批量不良",
            lesson_content="焊接温度设置过高导致元器件损坏",
            source_module=SourceModule.PROCESS_QUALITY,
            root_cause="工艺参数未经充分验证",
            preventive_action="建立工艺参数验证流程",
            applicable_scenarios="SMT焊接工艺",
            is_active=True,
            created_by=test_user.id
        )
    ]
    
    for lesson in lessons:
        db_session.add(lesson)
    await db_session.commit()
    
    for lesson in lessons:
        await db_session.refresh(lesson)
    
    return lessons


@pytest.mark.asyncio
class TestLessonAutoPush:
    """测试经验教训自动推送逻辑 (Requirements: 2.8.1)"""
    
    async def test_auto_push_on_project_creation(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_lessons: list[LessonLearnedLibrary]
    ):
        """测试项目立项时自动推送相关经验教训"""
        # 执行自动推送
        pushed_lessons = await LessonLearnedService.push_lessons_to_project(
            db=db_session,
            project_id=test_project.id
        )
        
        # 验证推送了所有活跃的经验教训
        assert len(pushed_lessons) == len(test_lessons)
        
        # 验证每个经验教训都创建了点检记录
        from sqlalchemy import select
        from app.models.project_lesson_check import ProjectLessonCheck
        
        stmt = select(ProjectLessonCheck).where(
            ProjectLessonCheck.project_id == test_project.id
        )
        result = await db_session.execute(stmt)
        checks = result.scalars().all()
        
        assert len(checks) == len(test_lessons)
        
        # 验证点检记录的初始状态
        for check in checks:
            assert check.is_applicable is None  # 未点检
            assert check.checked_at is None
    
    async def test_push_only_active_lessons(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_user: User
    ):
        """测试只推送活跃的经验教训"""
        # 创建一个活跃和一个非活跃的经验教训
        active_lesson = LessonLearnedLibrary(
            lesson_title="活跃的经验教训",
            lesson_content="这是活跃的",
            source_module=SourceModule.MANUAL,
            root_cause="测试",
            preventive_action="测试",
            is_active=True,
            created_by=test_user.id
        )
        inactive_lesson = LessonLearnedLibrary(
            lesson_title="非活跃的经验教训",
            lesson_content="这是非活跃的",
            source_module=SourceModule.MANUAL,
            root_cause="测试",
            preventive_action="测试",
            is_active=False,
            created_by=test_user.id
        )
        
        db_session.add(active_lesson)
        db_session.add(inactive_lesson)
        await db_session.commit()
        
        # 执行推送
        pushed_lessons = await LessonLearnedService.push_lessons_to_project(
            db=db_session,
            project_id=test_project.id
        )
        
        # 验证只推送了活跃的经验教训
        lesson_ids = [lesson.id for lesson in pushed_lessons]
        assert active_lesson.id in lesson_ids
        assert inactive_lesson.id not in lesson_ids
    
    async def test_mandatory_lesson_check(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_lessons: list[LessonLearnedLibrary],
        test_user: User
    ):
        """测试强制点检机制：必须逐条勾选"""
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
        
        assert unchecked_count == len(test_lessons)
        
        # 点检第一条
        from app.schemas.lesson_learned import ProjectLessonCheckRequest
        check_data = ProjectLessonCheckRequest(
            lesson_id=test_lessons[0].id,
            is_applicable=True,
            evidence_description="已在设计评审中规避"
        )
        
        await LessonLearnedService.check_lesson_for_project(
            db=db_session,
            project_id=test_project.id,
            check_data=check_data,
            checked_by=test_user.id
        )
        
        # 验证未点检数量减少
        unchecked_count = await LessonLearnedService.get_unchecked_lessons_count(
            db=db_session,
            project_id=test_project.id
        )
        
        assert unchecked_count == len(test_lessons) - 1


@pytest.mark.asyncio
class TestStageReviewInterlock:
    """测试阶段评审交付物互锁 (Requirements: 2.8.2)"""
    
    async def test_cannot_approve_with_missing_required_deliverables(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_user: User
    ):
        """测试交付物缺失时无法批准评审"""
        # 创建阶段评审，包含必需的交付物
        stage_review = StageReview(
            project_id=test_project.id,
            stage_name="设计评审",
            deliverables=[
                {
                    "name": "DFMEA",
                    "required": True,
                    "status": "missing"
                },
                {
                    "name": "控制计划",
                    "required": True,
                    "status": "missing"
                },
                {
                    "name": "可选文档",
                    "required": False,
                    "status": "missing"
                }
            ],
            review_result=ReviewResult.PENDING,
            created_by=test_user.id
        )
        db_session.add(stage_review)
        await db_session.commit()
        await db_session.refresh(stage_review)
        
        # 尝试批准评审（应该失败）
        from app.services.stage_review_service import StageReviewService
        
        with pytest.raises(ValueError, match="交付物不完整"):
            await StageReviewService.approve_stage_review(
                db=db_session,
                stage_review_id=stage_review.id,
                review_result="passed",
                review_comments="尝试批准",
                reviewer_id=test_user.id
            )
    
    async def test_can_approve_with_complete_required_deliverables(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_user: User
    ):
        """测试所有必需交付物完整时可以批准"""
        # 创建阶段评审，所有必需交付物已提交
        stage_review = StageReview(
            project_id=test_project.id,
            stage_name="设计评审",
            deliverables=[
                {
                    "name": "DFMEA",
                    "required": True,
                    "status": "submitted",
                    "file_path": "/uploads/dfmea.xlsx"
                },
                {
                    "name": "控制计划",
                    "required": True,
                    "status": "submitted",
                    "file_path": "/uploads/control_plan.xlsx"
                },
                {
                    "name": "可选文档",
                    "required": False,
                    "status": "missing"  # 可选项缺失不影响
                }
            ],
            review_result=ReviewResult.PENDING,
            created_by=test_user.id
        )
        db_session.add(stage_review)
        await db_session.commit()
        await db_session.refresh(stage_review)
        
        # 批准评审（应该成功）
        from app.services.stage_review_service import StageReviewService
        
        approved_review = await StageReviewService.approve_stage_review(
            db=db_session,
            stage_review_id=stage_review.id,
            review_result="passed",
            review_comments="所有交付物齐全",
            reviewer_id=test_user.id
        )
        
        assert approved_review.review_result == ReviewResult.PASSED
        assert approved_review.review_date is not None
        assert approved_review.reviewer_ids == f"{test_user.id}"
    
    async def test_optional_deliverables_not_blocking(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_user: User
    ):
        """测试可选交付物缺失不阻塞评审"""
        stage_review = StageReview(
            project_id=test_project.id,
            stage_name="概念评审",
            deliverables=[
                {
                    "name": "必需文档",
                    "required": True,
                    "status": "submitted",
                    "file_path": "/uploads/doc.pdf"
                },
                {
                    "name": "可选文档1",
                    "required": False,
                    "status": "missing"
                },
                {
                    "name": "可选文档2",
                    "required": False,
                    "status": "missing"
                }
            ],
            review_result=ReviewResult.PENDING,
            created_by=test_user.id
        )
        db_session.add(stage_review)
        await db_session.commit()
        await db_session.refresh(stage_review)
        
        # 应该可以批准
        from app.services.stage_review_service import StageReviewService
        
        approved_review = await StageReviewService.approve_stage_review(
            db=db_session,
            stage_review_id=stage_review.id,
            review_result="passed",
            review_comments="必需交付物已齐全",
            reviewer_id=test_user.id
        )
        
        assert approved_review.review_result == ReviewResult.PASSED
    
    async def test_evidence_upload_required_for_applicable_lessons(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_lessons: list[LessonLearnedLibrary],
        test_user: User
    ):
        """测试适用的经验教训必须上传规避证据"""
        # 推送经验教训
        await LessonLearnedService.push_lessons_to_project(
            db=db_session,
            project_id=test_project.id
        )
        
        # 勾选为适用但未上传证据
        from app.schemas.lesson_learned import ProjectLessonCheckRequest
        check_data = ProjectLessonCheckRequest(
            lesson_id=test_lessons[0].id,
            is_applicable=True,
            evidence_description="已规避"
        )
        
        check = await LessonLearnedService.check_lesson_for_project(
            db=db_session,
            project_id=test_project.id,
            check_data=check_data,
            checked_by=test_user.id
        )
        
        # 验证未上传证据时的状态
        assert check.evidence_file_path is None
        
        # 上传证据
        file_path = "/uploads/evidence/design_screenshot.png"
        updated_check = await LessonLearnedService.upload_evidence(
            db=db_session,
            check_id=check.id,
            file_path=file_path
        )
        
        assert updated_check.evidence_file_path == file_path


@pytest.mark.asyncio
class TestTrialProductionDataIntegration:
    """测试试产数据自动抓取和计算 (Requirements: 2.8.3)"""
    
    @patch('app.services.ims_integration_service.IMSIntegrationService.fetch_trial_production_data')
    async def test_auto_fetch_ims_data(
        self,
        mock_fetch_ims,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_user: User
    ):
        """测试自动从IMS抓取试产数据"""
        # Mock IMS返回数据
        mock_fetch_ims.return_value = {
            "work_order": "WO-2024-001",
            "input_qty": 1000,
            "output_qty": 950,
            "first_pass_qty": 900,
            "defect_qty": 50
        }
        
        # 创建试产记录
        trial = TrialProduction(
            project_id=test_project.id,
            work_order="WO-2024-001",
            target_metrics={
                "first_pass_rate": 95.0,
                "cpk": 1.33,
                "dimension_pass_rate": 100.0
            },
            status=TrialStatus.IN_PROGRESS,
            created_by=test_user.id
        )
        db_session.add(trial)
        await db_session.commit()
        await db_session.refresh(trial)
        
        # 执行数据同步
        updated_trial = await TrialProductionService.sync_ims_data(
            db=db_session,
            trial_id=trial.id
        )
        
        # 验证自动抓取的数据
        assert updated_trial.actual_metrics["input_qty"] == 1000
        assert updated_trial.actual_metrics["output_qty"] == 950
        assert updated_trial.actual_metrics["first_pass_qty"] == 900
        assert updated_trial.actual_metrics["defect_qty"] == 50
        
        # 验证自动计算的指标
        assert updated_trial.actual_metrics["yield_rate"] == 95.0  # 950/1000
        assert updated_trial.actual_metrics["first_pass_rate"] == 90.0  # 900/1000
    
    async def test_manual_input_for_non_ims_metrics(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_user: User
    ):
        """测试手动录入IMS无法采集的数据"""
        # 创建试产记录
        trial = TrialProduction(
            project_id=test_project.id,
            work_order="WO-2024-002",
            target_metrics={
                "cpk": 1.33,
                "destructive_test_pass_rate": 100.0
            },
            status=TrialStatus.IN_PROGRESS,
            created_by=test_user.id
        )
        db_session.add(trial)
        await db_session.commit()
        await db_session.refresh(trial)
        
        # 手动录入CPK和破坏性实验结果
        manual_data = {
            "cpk": 1.45,
            "destructive_test_pass_rate": 98.5,
            "appearance_score": 92.0
        }
        
        updated_trial = await TrialProductionService.update_manual_metrics(
            db=db_session,
            trial_id=trial.id,
            manual_metrics=manual_data
        )
        
        # 验证手动录入的数据
        assert updated_trial.actual_metrics["cpk"] == 1.45
        assert updated_trial.actual_metrics["destructive_test_pass_rate"] == 98.5
        assert updated_trial.actual_metrics["appearance_score"] == 92.0
    
    async def test_target_vs_actual_comparison(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_user: User
    ):
        """测试目标值与实绩值对比（红绿灯）"""
        # 创建试产记录
        trial = TrialProduction(
            project_id=test_project.id,
            work_order="WO-2024-003",
            target_metrics={
                "first_pass_rate": 95.0,
                "cpk": 1.33,
                "dimension_pass_rate": 100.0
            },
            actual_metrics={
                "first_pass_rate": 97.0,  # 达标（绿色）
                "cpk": 1.20,  # 未达标（红色）
                "dimension_pass_rate": 100.0  # 达标（绿色）
            },
            status=TrialStatus.COMPLETED,
            created_by=test_user.id
        )
        db_session.add(trial)
        await db_session.commit()
        await db_session.refresh(trial)
        
        # 生成对比分析
        comparison = await TrialProductionService.generate_comparison_report(
            db=db_session,
            trial_id=trial.id
        )
        
        # 验证对比结果
        assert comparison["first_pass_rate"]["status"] == "pass"
        assert comparison["first_pass_rate"]["color"] == "green"
        assert comparison["cpk"]["status"] == "fail"
        assert comparison["cpk"]["color"] == "red"
        assert comparison["dimension_pass_rate"]["status"] == "pass"
        
        # 验证整体达成率
        assert comparison["overall_achievement_rate"] == 66.67  # 2/3达标
    
    async def test_export_trial_summary_report(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_user: User
    ):
        """测试导出试产总结报告"""
        # 创建完整的试产记录
        trial = TrialProduction(
            project_id=test_project.id,
            work_order="WO-2024-004",
            target_metrics={
                "first_pass_rate": 95.0,
                "cpk": 1.33
            },
            actual_metrics={
                "first_pass_rate": 96.5,
                "cpk": 1.40,
                "input_qty": 1000,
                "output_qty": 965
            },
            status=TrialStatus.COMPLETED,
            created_by=test_user.id
        )
        db_session.add(trial)
        await db_session.commit()
        await db_session.refresh(trial)
        
        # 生成报告
        report_path = await TrialProductionService.export_summary_report(
            db=db_session,
            trial_id=trial.id,
            format="excel"
        )
        
        # 验证报告生成
        assert report_path is not None
        assert ".xlsx" in report_path or ".pdf" in report_path


@pytest.mark.asyncio
class TestTrialIssueTracking:
    """测试试产问题跟进 (Requirements: 2.8.4)"""
    
    async def test_create_trial_issue(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_user: User
    ):
        """测试录入试产问题"""
        # 创建试产记录
        trial = TrialProduction(
            project_id=test_project.id,
            work_order="WO-2024-005",
            status=TrialStatus.IN_PROGRESS,
            created_by=test_user.id
        )
        db_session.add(trial)
        await db_session.commit()
        await db_session.refresh(trial)
        
        # 创建试产问题
        issue = TrialIssue(
            trial_id=trial.id,
            issue_description="焊接温度过高导致元器件损坏",
            issue_type=IssueType.PROCESS,
            assigned_to=test_user.id,
            status=IssueStatus.OPEN,
            created_by=test_user.id
        )
        db_session.add(issue)
        await db_session.commit()
        await db_session.refresh(issue)
        
        assert issue.id is not None
        assert issue.issue_type == IssueType.PROCESS
        assert issue.status == IssueStatus.OPEN
    
    async def test_close_simple_issue(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_user: User
    ):
        """测试关闭简单问题"""
        # 创建试产和问题
        trial = TrialProduction(
            project_id=test_project.id,
            work_order="WO-2024-006",
            status=TrialStatus.IN_PROGRESS,
            created_by=test_user.id
        )
        db_session.add(trial)
        await db_session.commit()
        
        issue = TrialIssue(
            trial_id=trial.id,
            issue_description="工装夹具松动",
            issue_type=IssueType.EQUIPMENT,
            assigned_to=test_user.id,
            status=IssueStatus.OPEN,
            created_by=test_user.id
        )
        db_session.add(issue)
        await db_session.commit()
        await db_session.refresh(issue)
        
        # 上传对策并关闭
        from app.services.trial_issue_service import TrialIssueService
        
        closed_issue = await TrialIssueService.close_issue(
            db=db_session,
            issue_id=issue.id,
            solution="已紧固工装夹具并增加定期检查",
            evidence_file_path="/uploads/evidence/fixture_check.jpg"
        )
        
        assert closed_issue.status == IssueStatus.CLOSED
        assert closed_issue.solution == "已紧固工装夹具并增加定期检查"
        assert closed_issue.closed_at is not None
    
    async def test_escalate_to_8d(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_user: User
    ):
        """测试升级为8D报告"""
        # 创建试产和复杂问题
        trial = TrialProduction(
            project_id=test_project.id,
            work_order="WO-2024-007",
            status=TrialStatus.IN_PROGRESS,
            created_by=test_user.id
        )
        db_session.add(trial)
        await db_session.commit()
        
        issue = TrialIssue(
            trial_id=trial.id,
            issue_description="批量尺寸超差，疑似设计问题",
            issue_type=IssueType.DESIGN,
            assigned_to=test_user.id,
            status=IssueStatus.OPEN,
            created_by=test_user.id
        )
        db_session.add(issue)
        await db_session.commit()
        await db_session.refresh(issue)
        
        # 升级为8D
        from app.services.trial_issue_service import TrialIssueService
        
        escalated_issue = await TrialIssueService.escalate_to_8d(
            db=db_session,
            issue_id=issue.id,
            escalation_reason="问题复杂，需要深度分析"
        )
        
        assert escalated_issue.is_escalated_to_8d is True
        assert escalated_issue.escalation_reason == "问题复杂，需要深度分析"
        assert escalated_issue.escalated_at is not None
    
    async def test_legacy_issue_management(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_user: User
    ):
        """测试遗留问题管理（SOP节点未关闭问题需特批）"""
        # 创建试产
        trial = TrialProduction(
            project_id=test_project.id,
            work_order="WO-2024-008",
            status=TrialStatus.COMPLETED,
            created_by=test_user.id
        )
        db_session.add(trial)
        await db_session.commit()
        
        # 创建未关闭的问题
        issue = TrialIssue(
            trial_id=trial.id,
            issue_description="外观瑕疵问题尚未完全解决",
            issue_type=IssueType.QUALITY,
            assigned_to=test_user.id,
            status=IssueStatus.OPEN,
            created_by=test_user.id
        )
        db_session.add(issue)
        await db_session.commit()
        await db_session.refresh(issue)
        
        # 尝试项目转入SOP（应该被拦截）
        from app.services.new_product_project_service import NewProductProjectService
        
        with pytest.raises(ValueError, match="存在未关闭的试产问题"):
            await NewProductProjectService.transition_to_sop(
                db=db_session,
                project_id=test_project.id
            )
    
    async def test_special_approval_for_legacy_issues(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_user: User
    ):
        """测试带病量产特批流程"""
        # 创建试产和未关闭问题
        trial = TrialProduction(
            project_id=test_project.id,
            work_order="WO-2024-009",
            status=TrialStatus.COMPLETED,
            created_by=test_user.id
        )
        db_session.add(trial)
        await db_session.commit()
        
        issue = TrialIssue(
            trial_id=trial.id,
            issue_description="外观瑕疵问题",
            issue_type=IssueType.QUALITY,
            assigned_to=test_user.id,
            status=IssueStatus.OPEN,
            created_by=test_user.id
        )
        db_session.add(issue)
        await db_session.commit()
        await db_session.refresh(issue)
        
        # 提交特批申请
        from app.services.trial_issue_service import TrialIssueService
        
        approval = await TrialIssueService.request_special_approval(
            db=db_session,
            issue_id=issue.id,
            risk_assessment="外观瑕疵不影响功能，客户可接受",
            mitigation_plan="加强出货检验，持续改善",
            approver_id=test_user.id
        )
        
        assert approval["status"] == "pending"
        assert approval["risk_assessment"] is not None
        
        # 批准特批
        approved_issue = await TrialIssueService.approve_special_approval(
            db=db_session,
            issue_id=issue.id,
            approver_id=test_user.id,
            approval_comments="同意带病量产，需在3个月内完成改善"
        )
        
        assert approved_issue.special_approval_status == "approved"
        assert approved_issue.special_approval_at is not None


@pytest.mark.asyncio
class TestIntegrationScenarios:
    """测试集成场景"""
    
    async def test_complete_new_product_workflow(
        self,
        db_session: AsyncSession,
        test_project: NewProductProject,
        test_lessons: list[LessonLearnedLibrary],
        test_user: User
    ):
        """测试完整的新品质量管理流程"""
        # 1. 项目立项，自动推送经验教训
        pushed_lessons = await LessonLearnedService.push_lessons_to_project(
            db=db_session,
            project_id=test_project.id
        )
        assert len(pushed_lessons) > 0
        
        # 2. 逐条点检经验教训
        from app.schemas.lesson_learned import ProjectLessonCheckRequest
        for lesson in test_lessons:
            check_data = ProjectLessonCheckRequest(
                lesson_id=lesson.id,
                is_applicable=True,
                evidence_description=f"已在设计中规避：{lesson.lesson_title}"
            )
            await LessonLearnedService.check_lesson_for_project(
                db=db_session,
                project_id=test_project.id,
                check_data=check_data,
                checked_by=test_user.id
            )
        
        # 3. 配置阶段评审
        stage_review = StageReview(
            project_id=test_project.id,
            stage_name="设计评审",
            deliverables=[
                {
                    "name": "DFMEA",
                    "required": True,
                    "status": "submitted",
                    "file_path": "/uploads/dfmea.xlsx"
                }
            ],
            review_result=ReviewResult.PENDING,
            created_by=test_user.id
        )
        db_session.add(stage_review)
        await db_session.commit()
        
        # 4. 批准阶段评审
        from app.services.stage_review_service import StageReviewService
        approved_review = await StageReviewService.approve_stage_review(
            db=db_session,
            stage_review_id=stage_review.id,
            review_result="passed",
            review_comments="评审通过",
            reviewer_id=test_user.id
        )
        assert approved_review.review_result == ReviewResult.PASSED
        
        # 5. 创建试产记录
        trial = TrialProduction(
            project_id=test_project.id,
            work_order="WO-2024-FINAL",
            target_metrics={"first_pass_rate": 95.0},
            actual_metrics={"first_pass_rate": 96.0},
            status=TrialStatus.COMPLETED,
            created_by=test_user.id
        )
        db_session.add(trial)
        await db_session.commit()
        
        # 6. 验证整个流程完成
        assert test_project.status == ProjectStatus.ACTIVE
