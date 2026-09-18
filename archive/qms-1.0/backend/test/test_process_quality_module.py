"""
过程质量管理模块测试
测试生产数据同步逻辑、责任类别关联指标计算、问题闭环流程
Requirements: 2.6.1-2.6.3
"""
import pytest
from datetime import date, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.services.ims_integration_service import IMSIntegrationService
from app.services.process_defect_service import ProcessDefectService
from app.services.process_issue_service import ProcessIssueService
from app.models.process_defect import ProcessDefect, ResponsibilityCategory
from app.models.process_issue import ProcessIssue, ProcessIssueStatus
from app.models.user import User, UserType, UserStatus
from app.models.ims_sync_log import IMSSyncLog, SyncType, SyncStatus
from app.core.auth_strategy import LocalAuthStrategy


# ============================================================================
# Shared Fixtures
# ============================================================================

@pytest.fixture
async def test_pqe_user(db_session: AsyncSession) -> User:
    """创建测试 PQE 用户（共享 fixture）"""
    auth_strategy = LocalAuthStrategy()
    user = User(
        username="pqe_user",
        password_hash=auth_strategy.hash_password("Test@1234"),
        full_name="过程质量工程师",
        email="pqe@company.com",
        phone="13800138001",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE,
        department="质量部",
        position="PQE",
        password_changed_at=datetime.utcnow(),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


# ============================================================================
# 生产数据同步逻辑测试
# ============================================================================

class TestProductionDataSync:
    """测试生产数据集成与同步"""
    
    @pytest.fixture
    async def ims_service(self):
        """创建 IMS 集成服务实例"""
        return IMSIntegrationService()

    @pytest.mark.asyncio
    async def test_sync_production_output_success(
        self, ims_service, db_session
    ):
        """测试成功同步成品入库数据"""
        # Mock IMS API 响应
        mock_response = {
            "success": True,
            "data": [
                {
                    "work_order": "WO20240115001",
                    "product_code": "PROD001",
                    "production_date": "2024-01-15",
                    "process_id": "P001",
                    "line_id": "LINE01",
                    "finished_goods_count": 1000,
                    "ng_count": 50
                },
                {
                    "work_order": "WO20240115002",
                    "product_code": "PROD002",
                    "production_date": "2024-01-15",
                    "process_id": "P002",
                    "line_id": "LINE02",
                    "finished_goods_count": 800,
                    "ng_count": 20
                }
            ]
        }
        
        with patch.object(
            ims_service, '_make_request', 
            return_value=mock_response
        ) as mock_request:
            # 执行同步
            result = await ims_service.sync_production_output(
                db_session,
                start_date=date(2024, 1, 15),
                end_date=date(2024, 1, 15)
            )
            
            # 验证结果
            assert result["success"] is True
            assert result["records_count"] == 2
            assert "成品入库数据" in result["message"]
            
            # 验证同步日志
            sync_log_query = select(IMSSyncLog).where(
                IMSSyncLog.sync_type == SyncType.PRODUCTION_OUTPUT
            )
            sync_log_result = await db_session.execute(sync_log_query)
            sync_log = sync_log_result.scalar_one_or_none()
            
            assert sync_log is not None
            assert sync_log.status == SyncStatus.SUCCESS
            assert sync_log.records_count == 2

    @pytest.mark.asyncio
    async def test_sync_first_pass_test_success(
        self, ims_service, db_session
    ):
        """测试成功同步一次测试数据"""
        mock_response = {
            "success": True,
            "data": [
                {
                    "work_order": "WO20240115001",
                    "test_date": "2024-01-15",
                    "process_id": "P001",
                    "line_id": "LINE01",
                    "first_pass_count": 950,
                    "total_test_count": 1000
                }
            ]
        }
        
        with patch.object(
            ims_service, '_make_request', 
            return_value=mock_response
        ):
            result = await ims_service.sync_first_pass_test(
                db_session,
                start_date=date(2024, 1, 15),
                end_date=date(2024, 1, 15)
            )
            
            assert result["success"] is True
            assert result["records_count"] == 1
            assert "一次测试数据" in result["message"]

    @pytest.mark.asyncio
    async def test_sync_process_defects_success(
        self, ims_service, db_session
    ):
        """测试成功同步制程不良记录"""
        mock_response = {
            "success": True,
            "data": [
                {
                    "defect_date": "2024-01-15",
                    "work_order": "WO20240115001",
                    "process_id": "P001",
                    "line_id": "LINE01",
                    "defect_type": "焊接不良",
                    "defect_qty": 10,
                    "operator_id": "OP001"
                },
                {
                    "defect_date": "2024-01-15",
                    "work_order": "WO20240115001",
                    "process_id": "P001",
                    "line_id": "LINE01",
                    "defect_type": "外观不良",
                    "defect_qty": 5,
                    "operator_id": "OP002"
                }
            ]
        }
        
        with patch.object(
            ims_service, '_make_request', 
            return_value=mock_response
        ):
            result = await ims_service.sync_process_defects(
                db_session,
                start_date=date(2024, 1, 15),
                end_date=date(2024, 1, 15)
            )
            
            assert result["success"] is True
            assert result["records_count"] == 2
            assert "制程不良记录" in result["message"]
            
            # 验证不良记录已保存
            defects_query = select(ProcessDefect).where(
                ProcessDefect.defect_date == date(2024, 1, 15)
            )
            defects_result = await db_session.execute(defects_query)
            defects = defects_result.scalars().all()
            
            assert len(defects) == 2
            assert defects[0].defect_type == "焊接不良"
            assert defects[0].defect_qty == 10

    @pytest.mark.asyncio
    async def test_sync_production_data_api_error(
        self, ims_service, db_session
    ):
        """测试 IMS API 错误处理"""
        with patch.object(
            ims_service, '_make_request',
            side_effect=Exception("IMS 连接失败")
        ):
            result = await ims_service.sync_production_output(
                db_session,
                start_date=date(2024, 1, 15),
                end_date=date(2024, 1, 15)
            )
            
            assert result["success"] is False
            assert "IMS 连接失败" in result["error_message"]
            
            # 验证错误日志
            sync_log_query = select(IMSSyncLog).where(
                IMSSyncLog.sync_type == SyncType.PRODUCTION_OUTPUT,
                IMSSyncLog.status == SyncStatus.FAILED
            )
            sync_log_result = await db_session.execute(sync_log_query)
            sync_log = sync_log_result.scalar_one_or_none()
            
            assert sync_log is not None
            assert "IMS 连接失败" in sync_log.error_message


# ============================================================================
# 责任类别关联指标计算测试
# ============================================================================

class TestResponsibilityCategoryCalculation:
    """测试责任类别与指标关联计算"""
    
    @pytest.fixture
    async def defect_service(self):
        """创建不良品服务实例"""
        return ProcessDefectService()
    
    @pytest.fixture
    async def test_defects(self, db_session: AsyncSession, test_pqe_user: User):
        """创建测试不良品数据"""
        defects = [
            ProcessDefect(
                defect_date=date(2024, 1, 15),
                work_order="WO20240115001",
                process_id="P001",
                line_id="LINE01",
                defect_type="物料不良",
                defect_qty=10,
                responsibility_category=ResponsibilityCategory.MATERIAL_DEFECT,
                recorded_by=test_pqe_user.id,
                created_at=datetime.utcnow()
            ),
            ProcessDefect(
                defect_date=date(2024, 1, 15),
                work_order="WO20240115001",
                process_id="P001",
                line_id="LINE01",
                defect_type="作业不良",
                defect_qty=5,
                responsibility_category=ResponsibilityCategory.OPERATION_DEFECT,
                recorded_by=test_pqe_user.id,
                created_at=datetime.utcnow()
            ),
            ProcessDefect(
                defect_date=date(2024, 1, 15),
                work_order="WO20240115002",
                process_id="P002",
                line_id="LINE02",
                defect_type="设备不良",
                defect_qty=8,
                responsibility_category=ResponsibilityCategory.EQUIPMENT_DEFECT,
                recorded_by=test_pqe_user.id,
                created_at=datetime.utcnow()
            )
        ]
        
        for defect in defects:
            db_session.add(defect)
        await db_session.commit()
        
        return defects

    @pytest.mark.asyncio
    async def test_calculate_defects_by_responsibility(
        self, defect_service, db_session, test_defects
    ):
        """测试按责任类别统计不良数"""
        # 计算各责任类别的不良数
        result = await defect_service.calculate_defects_by_responsibility(
            db_session,
            start_date=date(2024, 1, 15),
            end_date=date(2024, 1, 15)
        )
        
        # 验证统计结果
        assert result[ResponsibilityCategory.MATERIAL_DEFECT] == 10
        assert result[ResponsibilityCategory.OPERATION_DEFECT] == 5
        assert result[ResponsibilityCategory.EQUIPMENT_DEFECT] == 8
        assert result.get(ResponsibilityCategory.PROCESS_DEFECT, 0) == 0

    @pytest.mark.asyncio
    async def test_calculate_defects_by_process(
        self, defect_service, db_session, test_defects
    ):
        """测试按工序统计不良数"""
        result = await defect_service.calculate_defects_by_process(
            db_session,
            start_date=date(2024, 1, 15),
            end_date=date(2024, 1, 15)
        )
        
        # 验证按工序统计
        assert "P001" in result
        assert result["P001"]["total_defect_qty"] == 15  # 10 + 5
        assert "P002" in result
        assert result["P002"]["total_defect_qty"] == 8

    @pytest.mark.asyncio
    async def test_calculate_defects_by_line(
        self, defect_service, db_session, test_defects
    ):
        """测试按产线统计不良数"""
        result = await defect_service.calculate_defects_by_line(
            db_session,
            start_date=date(2024, 1, 15),
            end_date=date(2024, 1, 15)
        )
        
        # 验证按产线统计
        assert "LINE01" in result
        assert result["LINE01"]["total_defect_qty"] == 15
        assert "LINE02" in result
        assert result["LINE02"]["total_defect_qty"] == 8

    @pytest.mark.asyncio
    async def test_material_defect_links_to_supplier_ppm(
        self, defect_service, db_session, test_defects
    ):
        """测试物料不良关联到供应商 PPM 指标"""
        # 获取物料不良数据
        material_defects = await defect_service.get_defects_by_category(
            db_session,
            category=ResponsibilityCategory.MATERIAL_DEFECT,
            start_date=date(2024, 1, 15),
            end_date=date(2024, 1, 15)
        )
        
        # 验证物料不良数据
        assert len(material_defects) == 1
        assert material_defects[0].defect_qty == 10
        assert material_defects[0].responsibility_category == ResponsibilityCategory.MATERIAL_DEFECT
        
        # 验证该数据应关联到 2.4.1 的"物料上线不良 PPM"指标
        # （实际关联逻辑在 MetricsCalculator 中实现）
        assert material_defects[0].defect_type == "物料不良"


# ============================================================================
# 问题闭环流程测试
# ============================================================================

class TestProcessIssueWorkflow:
    """测试制程质量问题发单管理闭环流程"""
    
    @pytest.fixture
    async def issue_service(self):
        """创建问题服务实例"""
        return ProcessIssueService()
    
    @pytest.fixture
    async def test_responsible_user(self, db_session: AsyncSession) -> User:
        """创建测试责任板块用户"""
        auth_strategy = LocalAuthStrategy()
        user = User(
            username="responsible_user",
            password_hash=auth_strategy.hash_password("Test@1234"),
            full_name="制造工程师",
            email="mfg@company.com",
            phone="13800138002",
            user_type=UserType.INTERNAL,
            status=UserStatus.ACTIVE,
            department="制造部",
            position="制造工程师",
            password_changed_at=datetime.utcnow(),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)
        return user

    @pytest.mark.asyncio
    async def test_create_process_issue(
        self, issue_service, db_session, test_pqe_user, test_responsible_user
    ):
        """测试创建制程问题单"""
        # 创建问题单
        issue_data = {
            "issue_description": "产线 LINE01 焊接不良率异常升高",
            "responsibility_category": ResponsibilityCategory.EQUIPMENT_DEFECT,
            "assigned_to": test_responsible_user.id
        }
        
        issue = await issue_service.create_issue(
            db_session,
            issue_data=issue_data,
            created_by=test_pqe_user.id
        )
        
        # 验证问题单创建成功
        assert issue.id is not None
        assert issue.issue_number.startswith("PI")
        assert issue.status == ProcessIssueStatus.OPEN
        assert issue.assigned_to == test_responsible_user.id
        assert issue.responsibility_category == ResponsibilityCategory.EQUIPMENT_DEFECT

    @pytest.mark.asyncio
    async def test_submit_response_to_issue(
        self, issue_service, db_session, test_pqe_user, test_responsible_user
    ):
        """测试责任板块提交分析和对策"""
        # 创建问题单
        issue = ProcessIssue(
            issue_number="PI20240115001",
            issue_description="产线 LINE01 焊接不良率异常升高",
            responsibility_category=ResponsibilityCategory.EQUIPMENT_DEFECT,
            assigned_to=test_responsible_user.id,
            status=ProcessIssueStatus.OPEN,
            created_by=test_pqe_user.id,
            created_at=datetime.utcnow()
        )
        db_session.add(issue)
        await db_session.commit()
        await db_session.refresh(issue)
        
        # 提交分析和对策
        response_data = {
            "root_cause": "焊接设备温度控制模块故障",
            "containment_action": "暂停该设备生产，转移至备用产线",
            "corrective_action": "更换温度控制模块，重新校准设备参数",
            "verification_period": 7
        }
        
        updated_issue = await issue_service.submit_response(
            db_session,
            issue_id=issue.id,
            response_data=response_data,
            user_id=test_responsible_user.id
        )
        
        # 验证对策已提交
        assert updated_issue.root_cause == "焊接设备温度控制模块故障"
        assert updated_issue.containment_action == "暂停该设备生产，转移至备用产线"
        assert updated_issue.corrective_action == "更换温度控制模块，重新校准设备参数"
        assert updated_issue.verification_period == 7
        assert updated_issue.status == ProcessIssueStatus.IN_VERIFICATION

    @pytest.mark.asyncio
    async def test_verify_and_close_issue(
        self, issue_service, db_session, test_pqe_user, test_responsible_user
    ):
        """测试 PQE 验证对策有效性并关闭问题单"""
        # 创建已提交对策的问题单
        issue = ProcessIssue(
            issue_number="PI20240115002",
            issue_description="产线 LINE02 外观不良率超标",
            responsibility_category=ResponsibilityCategory.OPERATION_DEFECT,
            assigned_to=test_responsible_user.id,
            status=ProcessIssueStatus.IN_VERIFICATION,
            root_cause="作业员未按 SOP 操作",
            containment_action="加强现场监督",
            corrective_action="重新培训作业员，更新作业指导书",
            verification_period=7,
            created_by=test_pqe_user.id,
            created_at=datetime.utcnow()
        )
        db_session.add(issue)
        await db_session.commit()
        await db_session.refresh(issue)
        
        # PQE 验证通过
        verification_data = {
            "verification_result": "验证通过",
            "verification_comments": "对策实施后，外观不良率已降至正常水平"
        }
        
        closed_issue = await issue_service.verify_issue(
            db_session,
            issue_id=issue.id,
            verification_data=verification_data,
            user_id=test_pqe_user.id
        )
        
        # 验证问题单已关闭
        assert closed_issue.status == ProcessIssueStatus.VERIFIED
        
        # 关闭问题单
        final_issue = await issue_service.close_issue(
            db_session,
            issue_id=issue.id,
            user_id=test_pqe_user.id
        )
        
        assert final_issue.status == ProcessIssueStatus.CLOSED
        assert final_issue.closed_at is not None

    @pytest.mark.asyncio
    async def test_issue_workflow_complete_cycle(
        self, issue_service, db_session, test_pqe_user, test_responsible_user
    ):
        """测试问题单完整闭环流程"""
        # 1. PQE 创建问题单
        issue_data = {
            "issue_description": "制程直通率连续 3 天低于目标值",
            "responsibility_category": ResponsibilityCategory.PROCESS_DEFECT,
            "assigned_to": test_responsible_user.id
        }
        
        issue = await issue_service.create_issue(
            db_session,
            issue_data=issue_data,
            created_by=test_pqe_user.id
        )
        
        assert issue.status == ProcessIssueStatus.OPEN
        
        # 2. 责任板块提交分析和对策
        response_data = {
            "root_cause": "工艺参数设置不合理",
            "containment_action": "临时调整工艺参数",
            "corrective_action": "优化工艺参数并更新工艺文件",
            "verification_period": 7
        }
        
        issue = await issue_service.submit_response(
            db_session,
            issue_id=issue.id,
            response_data=response_data,
            user_id=test_responsible_user.id
        )
        
        assert issue.status == ProcessIssueStatus.IN_VERIFICATION
        
        # 3. PQE 验证对策有效性
        verification_data = {
            "verification_result": "验证通过",
            "verification_comments": "工艺优化后，直通率已恢复至目标水平以上"
        }
        
        issue = await issue_service.verify_issue(
            db_session,
            issue_id=issue.id,
            verification_data=verification_data,
            user_id=test_pqe_user.id
        )
        
        assert issue.status == ProcessIssueStatus.VERIFIED
        
        # 4. 关闭问题单
        issue = await issue_service.close_issue(
            db_session,
            issue_id=issue.id,
            user_id=test_pqe_user.id
        )
        
        assert issue.status == ProcessIssueStatus.CLOSED
        assert issue.closed_at is not None
        
        # 验证完整流程数据
        assert issue.root_cause is not None
        assert issue.corrective_action is not None
        assert issue.verification_period == 7

    @pytest.mark.asyncio
    async def test_issue_cannot_close_without_verification(
        self, issue_service, db_session, test_pqe_user, test_responsible_user
    ):
        """测试未验证的问题单不能关闭"""
        # 创建未验证的问题单
        issue = ProcessIssue(
            issue_number="PI20240115003",
            issue_description="测试问题",
            responsibility_category=ResponsibilityCategory.OPERATION_DEFECT,
            assigned_to=test_responsible_user.id,
            status=ProcessIssueStatus.OPEN,
            created_by=test_pqe_user.id,
            created_at=datetime.utcnow()
        )
        db_session.add(issue)
        await db_session.commit()
        await db_session.refresh(issue)
        
        # 尝试直接关闭（应该失败）
        with pytest.raises(ValueError, match="问题单必须先验证通过才能关闭"):
            await issue_service.close_issue(
                db_session,
                issue_id=issue.id,
                user_id=test_pqe_user.id
            )

    @pytest.mark.asyncio
    async def test_get_overdue_issues(
        self, issue_service, db_session, test_pqe_user, test_responsible_user
    ):
        """测试获取逾期问题单"""
        # 创建逾期问题单
        overdue_issue = ProcessIssue(
            issue_number="PI20240101001",
            issue_description="逾期问题",
            responsibility_category=ResponsibilityCategory.EQUIPMENT_DEFECT,
            assigned_to=test_responsible_user.id,
            status=ProcessIssueStatus.OPEN,
            verification_end_date=date.today() - timedelta(days=3),  # 3 天前到期
            created_by=test_pqe_user.id,
            created_at=datetime.utcnow() - timedelta(days=10)
        )
        
        # 创建正常问题单
        normal_issue = ProcessIssue(
            issue_number="PI20240115004",
            issue_description="正常问题",
            responsibility_category=ResponsibilityCategory.OPERATION_DEFECT,
            assigned_to=test_responsible_user.id,
            status=ProcessIssueStatus.OPEN,
            verification_end_date=date.today() + timedelta(days=5),
            created_by=test_pqe_user.id,
            created_at=datetime.utcnow()
        )
        
        db_session.add(overdue_issue)
        db_session.add(normal_issue)
        await db_session.commit()
        
        # 获取逾期问题单
        overdue_issues = await issue_service.get_overdue_issues(db_session)
        
        # 验证只返回逾期问题单
        assert len(overdue_issues) == 1
        assert overdue_issues[0].issue_number == "PI20240101001"
        assert overdue_issues[0].verification_end_date < date.today()


# ============================================================================
# 集成测试
# ============================================================================

class TestProcessQualityIntegration:
    """测试过程质量管理模块的集成场景"""
    
    @pytest.mark.asyncio
    async def test_defect_to_issue_workflow(
        self, db_session, test_pqe_user
    ):
        """测试从不良品数据到问题单的完整流程"""
        # 1. 创建不良品记录
        defect = ProcessDefect(
            defect_date=date(2024, 1, 15),
            work_order="WO20240115001",
            process_id="P001",
            line_id="LINE01",
            defect_type="焊接不良",
            defect_qty=50,  # 大量不良
            responsibility_category=ResponsibilityCategory.EQUIPMENT_DEFECT,
            recorded_by=test_pqe_user.id,
            created_at=datetime.utcnow()
        )
        db_session.add(defect)
        await db_session.commit()
        
        # 2. PQE 查看不良品数据，发现异常
        defect_service = ProcessDefectService()
        defects = await defect_service.get_defects_by_process(
            db_session,
            process_id="P001",
            start_date=date(2024, 1, 15),
            end_date=date(2024, 1, 15)
        )
        
        assert len(defects) == 1
        assert defects[0].defect_qty == 50
        
        # 3. PQE 发起问题单
        issue_service = ProcessIssueService()
        issue_data = {
            "issue_description": f"产线 LINE01 焊接不良数量异常：{defects[0].defect_qty} 件",
            "responsibility_category": defects[0].responsibility_category,
            "assigned_to": test_pqe_user.id  # 简化测试，指派给自己
        }
        
        issue = await issue_service.create_issue(
            db_session,
            issue_data=issue_data,
            created_by=test_pqe_user.id
        )
        
        # 验证问题单创建成功
        assert issue.id is not None
        assert "焊接不良数量异常" in issue.issue_description
        assert issue.responsibility_category == ResponsibilityCategory.EQUIPMENT_DEFECT
