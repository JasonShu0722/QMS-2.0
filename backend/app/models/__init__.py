# Database Models
from app.models.base import Base
from app.models.supplier import Supplier, SupplierStatus
from app.models.customer_master import CustomerMaster, CustomerStatus
from app.models.user import User, UserType, UserStatus
from app.models.permission import Permission, OperationType
from app.models.role_tag import RoleTag
from app.models.role_permission import RolePermission
from app.models.user_role_assignment import UserRoleAssignment
from app.models.feature_flag import FeatureFlag, FeatureFlagScope, FeatureFlagEnvironment
from app.models.system_config import SystemConfig, ConfigCategory
from app.models.notification import Notification, MessageType
from app.models.announcement import Announcement, AnnouncementType, ImportanceLevel
from app.models.announcement_read_log import AnnouncementReadLog
from app.models.operation_log import OperationLog
from app.models.notification_rule import NotificationRule, ActionType
from app.models.smtp_config import SMTPConfig, TestResult
from app.models.instrument_calibration import InstrumentCalibration, CalibrationStatus
from app.models.instrument import Instrument, InstrumentType, InstrumentStatus
from app.models.msa_record import MSARecord, MSAType, MSAResult
from app.models.quality_cost import QualityCost, CostAnalysis
from app.models.quality_metric import QualityMetric, MetricType
from app.models.ims_sync_log import IMSSyncLog, SyncStatus, SyncType
from app.models.requirements_panel_status import RequirementsPanelStatus
from app.models.requirements_panel_user import RequirementsPanelUser
from app.models.problem_report import ProblemReport, ProblemReportSource, ProblemRiskLevel, ProblemReportStatus

# Supplier Quality Management Models (供应商质量管理模型)
from app.models.scar import SCAR, SCARSeverity, SCARStatus
from app.models.eight_d import EightD, EightDStatus
from app.models.supplier_document import SupplierDocument
from app.models.supplier_pcn import SupplierPCN
from app.models.supplier_audit import SupplierAuditPlan, SupplierAudit, SupplierAuditNC
from app.models.supplier_performance import SupplierPerformance, PerformanceGrade
from app.models.supplier_target import SupplierTarget, TargetType
from app.models.supplier_meeting import SupplierMeeting
from app.models.ppap import PPAP, PPAPLevel, PPAPStatus
from app.models.inspection_spec import InspectionSpec, InspectionSpecStatus
from app.models.barcode_validation import BarcodeValidation, BarcodeScanRecord

# Process Quality Management Models (过程质量管理模型)
from app.models.process_defect import ProcessDefect, ResponsibilityCategory
from app.models.process_issue import ProcessIssue, ProcessIssueStatus

# Customer Quality Management Models (客户质量管理模型)
from app.models.customer_complaint import (
    CustomerComplaint,
    PhysicalAnalysisStatus,
    ComplaintType,
    ComplaintStatus,
    PhysicalDispositionStatus,
    SeverityLevel,
)
from app.models.eight_d_customer import (
    EightDCustomer,
    EightDCustomerComplaintLink,
    EightDStatus as CustomerEightDStatus,
    ApprovalLevel,
)
from app.models.customer_claim import CustomerClaim
from app.models.supplier_claim import SupplierClaim, SupplierClaimStatus
from app.models.lesson_learned import LessonLearned, SourceType

# New Product Quality Management Models (新品质量管理模型)
from app.models.lesson_learned_library import LessonLearnedLibrary, SourceModule
from app.models.new_product_project import NewProductProject, ProjectStage, ProjectStatus
from app.models.project_lesson_check import ProjectLessonCheck
from app.models.stage_review import StageReview, ReviewResult
from app.models.trial_production import TrialProduction, TrialStatus
from app.models.trial_issue import TrialIssue, IssueType, IssueStatus
from app.models.new_product_defect import NewProductDefect, NewProductDefectSourceType, NewProductDefectStatus
from app.models.initial_flow_control import InitialFlowControl, FlowControlStatus, FlowControlType

# Audit Management Models (审核管理模型)
from app.models.audit import AuditPlan, AuditTemplate, AuditExecution, AuditNC, CustomerAudit

__all__ = [
    "Base",
    "Supplier",
    "SupplierStatus",
    "CustomerMaster",
    "CustomerStatus",
    "User",
    "UserType",
    "UserStatus",
    "Permission",
    "OperationType",
    "RoleTag",
    "RolePermission",
    "UserRoleAssignment",
    "FeatureFlag",
    "FeatureFlagScope",
    "FeatureFlagEnvironment",
    "SystemConfig",
    "ConfigCategory",
    "Notification",
    "MessageType",
    "Announcement",
    "AnnouncementType",
    "ImportanceLevel",
    "AnnouncementReadLog",
    "OperationLog",
    "NotificationRule",
    "ActionType",
    "SMTPConfig",
    "TestResult",
    "InstrumentCalibration",
    "CalibrationStatus",
    "Instrument",
    "InstrumentType",
    "InstrumentStatus",
    "MSARecord",
    "MSAType",
    "MSAResult",
    "QualityCost",
    "CostAnalysis",
    "QualityMetric",
    "MetricType",
    "IMSSyncLog",
    "SyncStatus",
    "SyncType",
    "RequirementsPanelStatus",
    "RequirementsPanelUser",
    "ProblemReport",
    "ProblemReportSource",
    "ProblemRiskLevel",
    "ProblemReportStatus",
    # Supplier Quality Management
    "SCAR",
    "SCARSeverity",
    "SCARStatus",
    "EightD",
    "EightDStatus",
    "SupplierDocument",
    "SupplierPCN",
    "SupplierAuditPlan",
    "SupplierAudit",
    "SupplierAuditNC",
    "SupplierPerformance",
    "PerformanceGrade",
    "SupplierTarget",
    "TargetType",
    "SupplierMeeting",
    "PPAP",
    "PPAPLevel",
    "PPAPStatus",
    "InspectionSpec",
    "InspectionSpecStatus",
    "BarcodeValidation",
    "BarcodeScanRecord",
    # Process Quality Management
    "ProcessDefect",
    "ResponsibilityCategory",
    "ProcessIssue",
    "ProcessIssueStatus",
    # Customer Quality Management
    "CustomerComplaint",
    "PhysicalAnalysisStatus",
    "ComplaintType",
    "ComplaintStatus",
    "PhysicalDispositionStatus",
    "SeverityLevel",
    "EightDCustomer",
    "EightDCustomerComplaintLink",
    "CustomerEightDStatus",
    "ApprovalLevel",
    "CustomerClaim",
    "SupplierClaim",
    "SupplierClaimStatus",
    "LessonLearned",
    "SourceType",
    # New Product Quality Management
    "LessonLearnedLibrary",
    "SourceModule",
    "NewProductProject",
    "ProjectStage",
    "ProjectStatus",
    "ProjectLessonCheck",
    "StageReview",
    "ReviewResult",
    "TrialProduction",
    "TrialStatus",
    "TrialIssue",
    "IssueType",
    "IssueStatus",
    "NewProductDefect",
    "NewProductDefectSourceType",
    "NewProductDefectStatus",
    "InitialFlowControl",
    "FlowControlStatus",
    "FlowControlType",
    # Audit Management
    "AuditPlan",
    "AuditTemplate",
    "AuditExecution",
    "AuditNC",
    "CustomerAudit",
]
