"""
Comprehensive Tests for Audit Management Module
审核管理模块综合测试

测试范围：
- 审核计划提醒逻辑 (2.9.1)
- 自动评分规则 (2.9.2)
- NC 闭环流程 (2.9.3)
"""
import pytest
from datetime import datetime, timedelta
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from unittest.mock import AsyncMock, patch, MagicMock

from app.models.user import User, UserType, UserStatus
from app.models.audit_plan import AuditPlan, AuditType, AuditStatus
from app.models.audit_template import AuditTemplate
from app.models.audit_execution import AuditExecution, AuditGrade
from app.models.audit_nc import AuditNC, NCStatus, VerificationStatus
from app.services.audit_plan_service import AuditPlanService
from app.services.audit_execution_service import AuditExecutionService
from app.services.audit_nc_service import AuditNCService
from app.tasks.audit_plan_tasks import check_upcoming_audits


@pytest.fixture
async def test_auditor(db_session: AsyncSession) -> User:
    """创建测试审核员"""
    from app.core.auth_strategy import LocalAuthStrategy
    auth_strategy = LocalAuthStrategy()
    
    user = User(
        username="test_auditor",
        password_hash=auth_strategy.hash_password("Test@1234"),
        full_name="测试审核员",
        email="auditor@test.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE,
        department="质量部",
        position="审核员",
        password_changed_at=datetime.utcnow(),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
async def test_auditee(db_session: AsyncSession) -> User:
    """创建测试被审核人"""
    from app.core.auth_strategy import LocalAuthStrategy
    auth_strategy = LocalAuthStrategy()
    
    user = User(
        username="test_auditee",
        password_hash=auth_strategy.hash_password("Test@1234"),
        full_name="测试被审核人",
        email="auditee@test.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE,
        department="生产部",
        position="生产主管",
        password_changed_at=datetime.utcnow(),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
async def test_vda63_template(db_session: AsyncSession) -> AuditTemplate:
    """创建 VDA 6.3 测试模板"""
    template = AuditTemplate(
        template_name="VDA 6.3 P2-P7 标准模板",
        audit_type=AuditType.PROCESS_AUDIT,
        checklist_items=[
            {
                "id": "P2.1",
                "question": "项目管理是否建立？",
                "weight": 10,
                "max_score": 10
            },
            {
                "id": "P3.1",
                "question": "产品和过程开发的策划是否充分？",
                "weight": 10,
                "max_score": 10
            },
            {
                "id": "P4.1",
                "question": "供应商管理是否有效？",
                "weight": 10,
                "max_score": 10
            },
            {
                "id": "P5.1",
                "question": "生产过程分析是否完整？",
                "weight": 10,
                "max_score": 10
            },
            {
                "id": "P6.1",
                "question": "供方/生产是否受控？",
                "weight": 10,
                "max_score": 10
            },
            {
                "id": "P7.1",
                "question": "顾客关怀/顾客满意/服务是否到位？",
                "weight": 10,
                "max_score": 10
            }
        ],
        scoring_rules={
            "grade_thresholds": {
                "A": 90,
                "B": 80,
                "C": 70,
                "D": 0
            },
            "zero_score_downgrade": True,  # VDA 6.3 单项 0 分降级规则
            "description": "VDA 6.3 评分规则：任何单项得 0 分，整体等级自动降一级"
        },
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db_session.add(template)
    await db_session.commit()
    await db_session.refresh(template)
    return template


@pytest.fixture
async def test_audit_plan(
    db_session: AsyncSession,
    test_auditor: User,
    test_auditee: User
) -> AuditPlan:
    """创建测试审核计划"""
    plan = AuditPlan(
        audit_type=AuditType.PROCESS_AUDIT,
        audit_name="2024年Q1生产过程审核",
        planned_date=datetime.utcnow() + timedelta(days=7),
        auditor_id=test_auditor.id,
        auditee_dept="生产部",
        status=AuditStatus.PLANNED,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db_session.add(plan)
    await db_session.commit()
    await db_session.refresh(plan)
    return plan


# ============================================================================
# 测试 1: 审核计划提醒逻辑 (2.9.1)
# ============================================================================

class TestAuditPlanReminders:
    """测试审核计划提醒逻辑"""
    
    @pytest.mark.asyncio
    async def test_upcoming_audit_reminder_7_days(
        self,
        db_session: AsyncSession,
        test_auditor: User,
        test_auditee: User
    ):
        """测试提前 7 天提醒逻辑"""
        # 创建 7 天后的审核计划
        plan = AuditPlan(
            audit_type=AuditType.PROCESS_AUDIT,
            audit_name="7天后审核",
            planned_date=datetime.utcnow() + timedelta(days=7),
            auditor_id=test_auditor.id,
            auditee_dept="生产部",
            status=AuditStatus.PLANNED,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db_session.add(plan)
        await db_session.commit()
        
        # Mock 邮件发送服务
        with patch('app.services.notification_hub.NotificationHub.send_email') as mock_email:
            mock_email.return_value = True
            
            # 执行提醒任务
            await check_upcoming_audits()
            
            # 验证邮件已发送
            assert mock_email.called
            call_args = mock_email.call_args
            assert test_auditor.email in str(call_args)
            assert "7天后" in str(call_args) or "7 days" in str(call_args)
    
    @pytest.mark.asyncio
    async def test_no_reminder_for_past_audits(
        self,
        db_session: AsyncSession,
        test_auditor: User
    ):
        """测试不对过去的审核发送提醒"""
        # 创建已过期的审核计划
        plan = AuditPlan(
            audit_type=AuditType.SYSTEM_AUDIT,
            audit_name="已过期审核",
            planned_date=datetime.utcnow() - timedelta(days=1),
            auditor_id=test_auditor.id,
            auditee_dept="质量部",
            status=AuditStatus.PLANNED,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db_session.add(plan)
        await db_session.commit()
        
        with patch('app.services.notification_hub.NotificationHub.send_email') as mock_email:
            await check_upcoming_audits()
            
            # 验证不发送邮件
            assert not mock_email.called
    
    @pytest.mark.asyncio
    async def test_postpone_audit_plan(
        self,
        db_session: AsyncSession,
        test_audit_plan: AuditPlan
    ):
        """测试审核计划延期申请"""
        service = AuditPlanService(db_session)
        
        new_date = datetime.utcnow() + timedelta(days=14)
        reason = "生产线设备维护，需延期审核"
        
        # 执行延期
        updated_plan = await service.postpone_audit_plan(
            plan_id=test_audit_plan.id,
            new_planned_date=new_date,
            postpone_reason=reason,
            approved_by=1  # 质量部长 ID
        )
        
        # 验证延期成功
        assert updated_plan.planned_date.date() == new_date.date()
        assert updated_plan.status == AuditStatus.POSTPONED


# ============================================================================
# 测试 2: 自动评分规则 (2.9.2)
# ============================================================================

class TestAuditScoringRules:
    """测试审核自动评分规则"""
    
    @pytest.mark.asyncio
    async def test_vda63_normal_scoring(
        self,
        db_session: AsyncSession,
        test_audit_plan: AuditPlan,
        test_vda63_template: AuditTemplate,
        test_auditor: User
    ):
        """测试 VDA 6.3 正常评分（无 0 分项）"""
        service = AuditExecutionService(db_session)
        
        # 创建审核执行记录
        execution = await service.create_audit_execution(
            audit_plan_id=test_audit_plan.id,
            template_id=test_vda63_template.id,
            auditor_id=test_auditor.id
        )
        
        # 提交检查表结果（所有项目得分 >= 1）
        checklist_results = [
            {"id": "P2.1", "score": 8, "comment": "项目管理良好"},
            {"id": "P3.1", "score": 9, "comment": "策划充分"},
            {"id": "P4.1", "score": 7, "comment": "供应商管理有待改进"},
            {"id": "P5.1", "score": 10, "comment": "过程分析完整"},
            {"id": "P6.1", "score": 8, "comment": "生产受控"},
            {"id": "P7.1", "score": 9, "comment": "顾客满意度高"}
        ]
        
        # 计算评分
        result = await service.submit_checklist(
            execution_id=execution.id,
            checklist_results=checklist_results
        )
        
        # 验证评分
        expected_score = (8 + 9 + 7 + 10 + 8 + 9) / 60 * 100  # 85%
        assert abs(result.final_score - expected_score) < 0.1
        assert result.grade == AuditGrade.B  # 80-90 为 B 级
    
    @pytest.mark.asyncio
    async def test_vda63_zero_score_downgrade(
        self,
        db_session: AsyncSession,
        test_audit_plan: AuditPlan,
        test_vda63_template: AuditTemplate,
        test_auditor: User
    ):
        """测试 VDA 6.3 单项 0 分降级规则"""
        service = AuditExecutionService(db_session)
        
        execution = await service.create_audit_execution(
            audit_plan_id=test_audit_plan.id,
            template_id=test_vda63_template.id,
            auditor_id=test_auditor.id
        )
        
        # 提交检查表结果（P4.1 得 0 分）
        checklist_results = [
            {"id": "P2.1", "score": 10, "comment": "优秀"},
            {"id": "P3.1", "score": 10, "comment": "优秀"},
            {"id": "P4.1", "score": 0, "comment": "供应商管理严重缺失"},  # 0 分项
            {"id": "P5.1", "score": 10, "comment": "优秀"},
            {"id": "P6.1", "score": 10, "comment": "优秀"},
            {"id": "P7.1", "score": 10, "comment": "优秀"}
        ]
        
        result = await service.submit_checklist(
            execution_id=execution.id,
            checklist_results=checklist_results
        )
        
        # 验证降级逻辑
        raw_score = (10 + 10 + 0 + 10 + 10 + 10) / 60 * 100  # 83.3%
        assert abs(result.final_score - raw_score) < 0.1
        
        # 原本应为 B 级（80-90），但因有 0 分项，降为 C 级
        assert result.grade == AuditGrade.C
    
    @pytest.mark.asyncio
    async def test_custom_template_scoring(
        self,
        db_session: AsyncSession,
        test_audit_plan: AuditPlan,
        test_auditor: User
    ):
        """测试自定义模板评分（无降级规则）"""
        # 创建自定义模板（无 zero_score_downgrade 规则）
        custom_template = AuditTemplate(
            template_name="防静电专项审核",
            audit_type=AuditType.PROCESS_AUDIT,
            checklist_items=[
                {"id": "ESD-1", "question": "防静电手环是否佩戴？", "weight": 20, "max_score": 10},
                {"id": "ESD-2", "question": "防静电工作台是否接地？", "weight": 30, "max_score": 10},
                {"id": "ESD-3", "question": "防静电包装是否使用？", "weight": 50, "max_score": 10}
            ],
            scoring_rules={
                "grade_thresholds": {"A": 90, "B": 75, "C": 60, "D": 0},
                "zero_score_downgrade": False  # 无降级规则
            },
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db_session.add(custom_template)
        await db_session.commit()
        await db_session.refresh(custom_template)
        
        service = AuditExecutionService(db_session)
        execution = await service.create_audit_execution(
            audit_plan_id=test_audit_plan.id,
            template_id=custom_template.id,
            auditor_id=test_auditor.id
        )
        
        # 提交结果（ESD-1 得 0 分）
        checklist_results = [
            {"id": "ESD-1", "score": 0, "comment": "未佩戴手环"},
            {"id": "ESD-2", "score": 10, "comment": "接地良好"},
            {"id": "ESD-3", "score": 10, "comment": "包装合规"}
        ]
        
        result = await service.submit_checklist(
            execution_id=execution.id,
            checklist_results=checklist_results
        )
        
        # 验证加权评分
        weighted_score = (0 * 20 + 10 * 30 + 10 * 50) / 100  # 80%
        assert abs(result.final_score - weighted_score) < 0.1
        
        # 无降级规则，80% 应为 B 级
        assert result.grade == AuditGrade.B


# ============================================================================
# 测试 3: NC 闭环流程 (2.9.3)
# ============================================================================

class TestNCClosureWorkflow:
    """测试 NC 闭环流程"""
    
    @pytest.fixture
    async def test_audit_execution(
        self,
        db_session: AsyncSession,
        test_audit_plan: AuditPlan,
        test_vda63_template: AuditTemplate,
        test_auditor: User
    ) -> AuditExecution:
        """创建测试审核执行记录"""
        execution = AuditExecution(
            audit_plan_id=test_audit_plan.id,
            template_id=test_vda63_template.id,
            audit_date=datetime.utcnow(),
            auditor_id=test_auditor.id,
            checklist_results=[
                {"id": "P2.1", "score": 0, "comment": "项目管理缺失"}
            ],
            final_score=50.0,
            grade=AuditGrade.D,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db_session.add(execution)
        await db_session.commit()
        await db_session.refresh(execution)
        return execution
    
    @pytest.mark.asyncio
    async def test_auto_generate_nc_tasks(
        self,
        db_session: AsyncSession,
        test_audit_execution: AuditExecution
    ):
        """测试审核结束后自动生成 NC 待办任务"""
        service = AuditNCService(db_session)
        
        # 从审核结果自动生成 NC
        nc_list = await service.auto_generate_ncs_from_audit(
            audit_execution_id=test_audit_execution.id
        )
        
        # 验证 NC 已生成
        assert len(nc_list) > 0
        nc = nc_list[0]
        assert nc.audit_id == test_audit_execution.id
        assert nc.status == NCStatus.OPEN
        assert nc.nc_item == "P2.1"
    
    @pytest.mark.asyncio
    async def test_assign_nc_to_responsible_dept(
        self,
        db_session: AsyncSession,
        test_audit_execution: AuditExecution,
        test_auditee: User
    ):
        """测试指派 NC 给责任板块"""
        service = AuditNCService(db_session)
        
        # 创建 NC
        nc = AuditNC(
            audit_id=test_audit_execution.id,
            nc_item="P2.1",
            nc_description="项目管理流程未建立",
            responsible_dept="生产部",
            status=NCStatus.OPEN,
            deadline=datetime.utcnow() + timedelta(days=30),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db_session.add(nc)
        await db_session.commit()
        await db_session.refresh(nc)
        
        # 指派给责任人
        updated_nc = await service.assign_nc(
            nc_id=nc.id,
            assigned_to=test_auditee.id,
            assigned_by=test_audit_execution.auditor_id
        )
        
        # 验证指派成功
        assert updated_nc.assigned_to == test_auditee.id
        assert updated_nc.status == NCStatus.ASSIGNED
    
    @pytest.mark.asyncio
    async def test_nc_response_and_verification(
        self,
        db_session: AsyncSession,
        test_audit_execution: AuditExecution,
        test_auditee: User,
        test_auditor: User
    ):
        """测试 NC 整改响应和验证流程"""
        service = AuditNCService(db_session)
        
        # 创建已指派的 NC
        nc = AuditNC(
            audit_id=test_audit_execution.id,
            nc_item="P3.1",
            nc_description="产品开发策划不充分",
            responsible_dept="研发部",
            assigned_to=test_auditee.id,
            status=NCStatus.ASSIGNED,
            deadline=datetime.utcnow() + timedelta(days=30),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db_session.add(nc)
        await db_session.commit()
        await db_session.refresh(nc)
        
        # 责任人填写整改措施
        nc_with_response = await service.submit_nc_response(
            nc_id=nc.id,
            root_cause="开发流程文件未更新",
            corrective_action="已更新 APQP 流程文件，并培训相关人员",
            evidence_files=["apqp_v2.0.pdf", "training_record.xlsx"]
        )
        
        # 验证响应已提交
        assert nc_with_response.root_cause is not None
        assert nc_with_response.corrective_action is not None
        assert nc_with_response.status == NCStatus.PENDING_VERIFICATION
        
        # 审核员验证有效性
        verified_nc = await service.verify_nc(
            nc_id=nc.id,
            verifier_id=test_auditor.id,
            verification_status=VerificationStatus.EFFECTIVE,
            verification_comment="整改措施有效，现场已确认"
        )
        
        # 验证 NC 已关闭
        assert verified_nc.verification_status == VerificationStatus.EFFECTIVE
        assert verified_nc.status == NCStatus.CLOSED
    
    @pytest.mark.asyncio
    async def test_nc_overdue_escalation(
        self,
        db_session: AsyncSession,
        test_audit_execution: AuditExecution,
        test_auditee: User
    ):
        """测试 NC 逾期升级"""
        # 创建已逾期的 NC
        nc = AuditNC(
            audit_id=test_audit_execution.id,
            nc_item="P5.1",
            nc_description="生产过程分析缺失",
            responsible_dept="生产部",
            assigned_to=test_auditee.id,
            status=NCStatus.ASSIGNED,
            deadline=datetime.utcnow() - timedelta(days=1),  # 已逾期
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db_session.add(nc)
        await db_session.commit()
        
        # Mock 邮件服务
        with patch('app.services.notification_hub.NotificationHub.send_email') as mock_email:
            mock_email.return_value = True
            
            # 执行逾期检查任务
            from app.tasks.audit_nc_tasks import check_overdue_ncs
            await check_overdue_ncs()
            
            # 验证升级邮件已发送
            assert mock_email.called
            call_args = mock_email.call_args
            # 应抄送给上级
            assert "逾期" in str(call_args) or "overdue" in str(call_args)
    
    @pytest.mark.asyncio
    async def test_nc_rejection_and_resubmit(
        self,
        db_session: AsyncSession,
        test_audit_execution: AuditExecution,
        test_auditee: User,
        test_auditor: User
    ):
        """测试 NC 整改被驳回后重新提交"""
        service = AuditNCService(db_session)
        
        # 创建已提交整改的 NC
        nc = AuditNC(
            audit_id=test_audit_execution.id,
            nc_item="P6.1",
            nc_description="生产过程未受控",
            responsible_dept="生产部",
            assigned_to=test_auditee.id,
            root_cause="作业指导书未更新",
            corrective_action="已更新作业指导书",
            status=NCStatus.PENDING_VERIFICATION,
            deadline=datetime.utcnow() + timedelta(days=20),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db_session.add(nc)
        await db_session.commit()
        await db_session.refresh(nc)
        
        # 审核员驳回整改
        rejected_nc = await service.verify_nc(
            nc_id=nc.id,
            verifier_id=test_auditor.id,
            verification_status=VerificationStatus.INEFFECTIVE,
            verification_comment="整改措施不充分，需补充根本原因分析（5Why）"
        )
        
        # 验证 NC 状态回退
        assert rejected_nc.verification_status == VerificationStatus.INEFFECTIVE
        assert rejected_nc.status == NCStatus.ASSIGNED  # 回退到已指派状态
        
        # 责任人重新提交
        resubmitted_nc = await service.submit_nc_response(
            nc_id=nc.id,
            root_cause="根本原因：培训不足 -> 作业员不了解新工艺 -> 未按标准作业",
            corrective_action="1. 更新作业指导书 2. 全员培训并考核 3. 增加首件确认环节",
            evidence_files=["5why_analysis.pdf", "training_record_v2.xlsx", "sop_v3.0.pdf"]
        )
        
        # 验证重新提交成功
        assert resubmitted_nc.status == NCStatus.PENDING_VERIFICATION
        assert "5Why" in resubmitted_nc.root_cause or "5why" in resubmitted_nc.root_cause


# ============================================================================
# 集成测试：完整审核流程
# ============================================================================

class TestCompleteAuditWorkflow:
    """测试完整审核流程集成"""
    
    @pytest.mark.asyncio
    async def test_end_to_end_audit_workflow(
        self,
        db_session: AsyncSession,
        test_auditor: User,
        test_auditee: User,
        test_vda63_template: AuditTemplate
    ):
        """测试端到端审核流程"""
        # 1. 创建审核计划
        plan_service = AuditPlanService(db_session)
        plan = await plan_service.create_audit_plan(
            audit_type=AuditType.PROCESS_AUDIT,
            audit_name="完整流程测试审核",
            planned_date=datetime.utcnow() + timedelta(days=7),
            auditor_id=test_auditor.id,
            auditee_dept="生产部"
        )
        assert plan.status == AuditStatus.PLANNED
        
        # 2. 执行审核并提交检查表
        exec_service = AuditExecutionService(db_session)
        execution = await exec_service.create_audit_execution(
            audit_plan_id=plan.id,
            template_id=test_vda63_template.id,
            auditor_id=test_auditor.id
        )
        
        checklist_results = [
            {"id": "P2.1", "score": 8, "comment": "良好"},
            {"id": "P3.1", "score": 0, "comment": "严重缺失"},  # 将生成 NC
            {"id": "P4.1", "score": 7, "comment": "一般"},
            {"id": "P5.1", "score": 9, "comment": "优秀"},
            {"id": "P6.1", "score": 8, "comment": "良好"},
            {"id": "P7.1", "score": 9, "comment": "优秀"}
        ]
        
        scored_execution = await exec_service.submit_checklist(
            execution_id=execution.id,
            checklist_results=checklist_results
        )
        assert scored_execution.grade == AuditGrade.C  # 因有 0 分项降级
        
        # 3. 自动生成 NC
        nc_service = AuditNCService(db_session)
        nc_list = await nc_service.auto_generate_ncs_from_audit(
            audit_execution_id=execution.id
        )
        assert len(nc_list) == 1  # P3.1 得 0 分
        
        # 4. 指派 NC
        nc = nc_list[0]
        assigned_nc = await nc_service.assign_nc(
            nc_id=nc.id,
            assigned_to=test_auditee.id,
            assigned_by=test_auditor.id
        )
        assert assigned_nc.status == NCStatus.ASSIGNED
        
        # 5. 提交整改
        responded_nc = await nc_service.submit_nc_response(
            nc_id=nc.id,
            root_cause="流程文件缺失",
            corrective_action="已建立完整流程文件",
            evidence_files=["process_doc.pdf"]
        )
        assert responded_nc.status == NCStatus.PENDING_VERIFICATION
        
        # 6. 验证并关闭
        closed_nc = await nc_service.verify_nc(
            nc_id=nc.id,
            verifier_id=test_auditor.id,
            verification_status=VerificationStatus.EFFECTIVE,
            verification_comment="整改有效"
        )
        assert closed_nc.status == NCStatus.CLOSED
        
        # 7. 验证审核计划状态更新
        await db_session.refresh(plan)
        assert plan.status == AuditStatus.COMPLETED
       