"""
8D Customer Report Tests
客诉8D报告测试
"""
import pytest
from app.services.eight_d_customer_service import EightDCustomerService
from app.schemas.eight_d_customer import (
    D4D7Request,
    D4RootCauseAnalysis,
    CorrectiveAction,
    D6Verification,
    D7Standardization,
    D8Request,
    HorizontalDeployment,
    LessonLearnedData,
    EightDReviewRequest
)


class TestEightDWorkflow:
    """测试8D工作流程"""
    
    def test_d4_root_cause_analysis_validation(self):
        """测试D4根本原因分析数据校验"""
        # 有效数据
        d4_data = D4RootCauseAnalysis(
            analysis_method="5Why",
            root_cause="电源模块设计裕量不足，未考虑极端温度下的电流冲击",
            evidence_files=["/uploads/8d/root_cause.pdf"]
        )
        assert d4_data.analysis_method == "5Why"
        assert len(d4_data.root_cause) >= 20
        
        # 无效数据：根本原因描述太短
        with pytest.raises(ValueError):
            D4RootCauseAnalysis(
                analysis_method="5Why",
                root_cause="设计问题",  # 少于20字
                evidence_files=[]
            )
    
    def test_d5_corrective_actions_validation(self):
        """测试D5纠正措施数据校验"""
        # 有效数据
        actions = [
            CorrectiveAction(
                action="重新设计电源模块，增加20%裕量",
                responsible="张工",
                deadline="2024-02-15"
            ),
            CorrectiveAction(
                action="更新设计规范，增加极端温度测试要求",
                responsible="李工",
                deadline="2024-02-20"
            )
        ]
        assert len(actions) == 2
        assert actions[0].action == "重新设计电源模块，增加20%裕量"
        
        # 无效数据：措施描述太短
        with pytest.raises(ValueError):
            CorrectiveAction(
                action="改进",  # 少于10字
                responsible="张工",
                deadline="2024-02-15"
            )
    
    def test_d6_verification_validation(self):
        """测试D6验证有效性数据校验"""
        # 有效数据
        d6_data = D6Verification(
            verification_report="/uploads/8d/verification_report.pdf",
            test_data="/uploads/8d/test_data.xlsx",
            result="经过100次极端温度循环测试，未出现失效"
        )
        assert d6_data.verification_report is not None
        assert len(d6_data.result) >= 10
        
        # 无效数据：验证结果太短
        with pytest.raises(ValueError):
            D6Verification(
                verification_report="/uploads/8d/report.pdf",
                result="通过"  # 少于10字
            )
    
    def test_d7_standardization_validation(self):
        """测试D7标准化数据校验"""
        # 有效数据：涉及文件修改
        d7_data = D7Standardization(
            document_modified=True,
            modified_files=["PFMEA-MCU-V2.1", "CP-MCU-V2.1"],
            attachment_paths=["/uploads/8d/pfmea_v2.1.pdf"]
        )
        assert d7_data.document_modified is True
        assert len(d7_data.modified_files) > 0
        
        # 有效数据：不涉及文件修改
        d7_data_no_mod = D7Standardization(
            document_modified=False,
            modified_files=[],
            attachment_paths=[]
        )
        assert d7_data_no_mod.document_modified is False
    
    def test_d4_d7_request_validation(self):
        """测试D4-D7完整请求数据校验"""
        # 有效数据
        d4_d7_request = D4D7Request(
            d4_root_cause=D4RootCauseAnalysis(
                analysis_method="5Why",
                root_cause="电源模块设计裕量不足，未考虑极端温度下的电流冲击",
                evidence_files=["/uploads/8d/root_cause.pdf"]
            ),
            d5_corrective_actions=[
                CorrectiveAction(
                    action="重新设计电源模块，增加20%裕量",
                    responsible="张工",
                    deadline="2024-02-15"
                )
            ],
            d6_verification=D6Verification(
                verification_report="/uploads/8d/verification_report.pdf",
                result="经过100次极端温度循环测试，未出现失效"
            ),
            d7_standardization=D7Standardization(
                document_modified=True,
                modified_files=["PFMEA-MCU-V2.1"],
                attachment_paths=["/uploads/8d/pfmea_v2.1.pdf"]
            )
        )
        assert d4_d7_request.d4_root_cause is not None
        assert len(d4_d7_request.d5_corrective_actions) >= 1
        
        # 无效数据：纠正措施列表为空
        with pytest.raises(ValueError):
            D4D7Request(
                d4_root_cause=D4RootCauseAnalysis(
                    analysis_method="5Why",
                    root_cause="电源模块设计裕量不足，未考虑极端温度下的电流冲击",
                    evidence_files=[]
                ),
                d5_corrective_actions=[],  # 空列表
                d6_verification=D6Verification(
                    verification_report="/uploads/8d/report.pdf",
                    result="经过测试，未出现失效"
                ),
                d7_standardization=D7Standardization(
                    document_modified=False,
                    modified_files=[],
                    attachment_paths=[]
                )
            )
    
    def test_d8_horizontal_deployment_validation(self):
        """测试D8水平展开数据校验"""
        # 有效数据
        horizontal = [
            HorizontalDeployment(
                product="类似产品A（MCU-V2）",
                action="应用新的电源模块设计",
                status="completed"
            ),
            HorizontalDeployment(
                product="类似产品B（MCU-V3）",
                action="应用新的电源模块设计",
                status="pending"
            )
        ]
        assert len(horizontal) == 2
        assert horizontal[0].status == "completed"
    
    def test_d8_lesson_learned_validation(self):
        """测试D8经验教训数据校验"""
        # 有效数据：沉淀经验教训
        lesson_data = LessonLearnedData(
            should_archive=True,
            lesson_title="电源模块设计裕量不足导致失效",
            lesson_content="在极端温度环境下，电源模块设计裕量不足会导致电流冲击失效",
            preventive_action="所有新品设计必须进行极端温度循环测试，电源模块裕量至少20%"
        )
        assert lesson_data.should_archive is True
        assert lesson_data.lesson_title is not None
        
        # 有效数据：不沉淀经验教训
        lesson_data_no_archive = LessonLearnedData(
            should_archive=False
        )
        assert lesson_data_no_archive.should_archive is False
    
    def test_d8_request_validation(self):
        """测试D8完整请求数据校验"""
        # 有效数据
        d8_request = D8Request(
            horizontal_deployment=[
                HorizontalDeployment(
                    product="类似产品A",
                    action="应用新的电源模块设计",
                    status="completed"
                )
            ],
            lesson_learned=LessonLearnedData(
                should_archive=True,
                lesson_title="电源模块设计裕量不足导致失效",
                lesson_content="在极端温度环境下，电源模块设计裕量不足会导致电流冲击失效",
                preventive_action="所有新品设计必须进行极端温度循环测试"
            )
        )
        assert d8_request.lesson_learned.should_archive is True
        assert len(d8_request.horizontal_deployment) > 0
    
    def test_review_request_validation(self):
        """测试审核请求数据校验"""
        # 有效数据：批准
        review_approved = EightDReviewRequest(
            approved=True,
            review_comments="根本原因分析充分，纠正措施有效，验证数据完整，同意批准"
        )
        assert review_approved.approved is True
        assert len(review_approved.review_comments) >= 10
        
        # 有效数据：驳回
        review_rejected = EightDReviewRequest(
            approved=False,
            review_comments="根本原因分析不充分，请补充5Why分析过程，纠正措施缺少具体时间节点"
        )
        assert review_rejected.approved is False
        
        # 无效数据：审核意见太短
        with pytest.raises(ValueError):
            EightDReviewRequest(
                approved=True,
                review_comments="同意"  # 少于10字
            )


class TestSLACalculation:
    """测试SLA时效计算"""
    
    def test_sla_status_structure(self):
        """测试SLA状态数据结构"""
        from app.schemas.eight_d_customer import SLAStatus, EightDStatusEnum
        
        # 模拟SLA状态
        sla_status = SLAStatus(
            complaint_id=1,
            complaint_number="CC-20240115-001",
            eight_d_status=EightDStatusEnum.D4_D7_IN_PROGRESS,
            days_since_creation=5,
            submission_deadline=7,
            archive_deadline=10,
            is_submission_overdue=False,
            is_archive_overdue=False,
            remaining_days=2
        )
        
        assert sla_status.complaint_id == 1
        assert sla_status.days_since_creation == 5
        assert sla_status.remaining_days == 2
        assert sla_status.is_submission_overdue is False
    
    def test_sla_overdue_detection(self):
        """测试SLA超期检测"""
        from app.schemas.eight_d_customer import SLAStatus, EightDStatusEnum
        
        # 模拟提交超期
        sla_overdue = SLAStatus(
            complaint_id=2,
            complaint_number="CC-20240110-002",
            eight_d_status=EightDStatusEnum.D4_D7_IN_PROGRESS,
            days_since_creation=10,
            submission_deadline=7,
            archive_deadline=10,
            is_submission_overdue=True,
            is_archive_overdue=False,
            remaining_days=-3
        )
        
        assert sla_overdue.is_submission_overdue is True
        assert sla_overdue.remaining_days < 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
