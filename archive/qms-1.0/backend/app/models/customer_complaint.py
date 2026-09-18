"""
Customer Complaint Model
客诉单模型 - 记录客户质量投诉信息
"""
from datetime import datetime
import enum

from sqlalchemy import Boolean, Column, Date, DateTime, Enum as SQLEnum, ForeignKey, Integer, String, Text, inspect
from sqlalchemy.orm import relationship

from .base import Base
from app.core.problem_management import get_problem_category_by_customer_complaint_type


def enum_values(enum_cls):
    return [item.value for item in enum_cls]


class ComplaintType(str, enum.Enum):
    """客诉类型枚举"""

    ZERO_KM = "0km"
    AFTER_SALES = "after_sales"


class ComplaintStatus(str, enum.Enum):
    """客诉状态枚举"""

    PENDING = "pending"
    IN_ANALYSIS = "in_analysis"
    IN_RESPONSE = "in_response"
    IN_REVIEW = "in_review"
    CLOSED = "closed"
    REJECTED = "rejected"


class PhysicalDispositionStatus(str, enum.Enum):
    """无需实物解析时的实物处理备案状态"""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class PhysicalAnalysisStatus(str, enum.Enum):
    """需要实物解析时的任务状态"""

    PENDING = "pending"
    ASSIGNED = "assigned"
    COMPLETED = "completed"


class SeverityLevel(str, enum.Enum):
    """严重度等级枚举"""

    CRITICAL = "critical"
    MAJOR = "major"
    MINOR = "minor"
    TBD = "tbd"


class CustomerComplaint(Base):
    """
    客诉单模型
    记录 0KM 客诉和售后客诉的完整信息
    """

    __tablename__ = "customer_complaints"

    id = Column(Integer, primary_key=True, index=True)
    complaint_number = Column(String(50), unique=True, nullable=False, index=True, comment="客诉单号")

    # 基本信息
    complaint_type = Column(SQLEnum(ComplaintType), nullable=False, comment="客诉类型：0km / 售后")
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True, comment="客户主数据 ID")
    customer_code = Column(String(50), nullable=False, index=True, comment="客户代码")
    customer_name_snapshot = Column(String(200), nullable=True, comment="客户名称快照")
    end_customer_name = Column(String(200), nullable=True, comment="终端客户名称")
    received_date = Column(Date, nullable=True, comment="收件日期")
    occurrence_date = Column(Date, nullable=True, comment="发生/故障日期")
    production_date = Column(Date, nullable=True, comment="生产/出厂日期")
    product_type = Column(String(100), nullable=False, comment="产品类型")
    product_model = Column(String(100), nullable=True, comment="产品型号")
    project_stage = Column(String(100), nullable=True, comment="项目阶段")
    batch_code = Column(String(100), nullable=True, comment="批次号/条码")
    trace_code = Column(String(100), nullable=True, comment="产品追溯码")
    return_type = Column(String(50), nullable=True, comment="零星退件/集中退件")
    return_month = Column(String(20), nullable=True, comment="退件月份")
    service_months = Column(Integer, nullable=True, comment="服务月数")
    service_month_category = Column(String(50), nullable=True, comment="服务月分类")
    dealer_name = Column(String(200), nullable=True, comment="4S 店名称")
    occurrence_region = Column(String(100), nullable=True, comment="发生区域")
    fault_category = Column(String(100), nullable=True, comment="故障分类")
    service_method = Column(String(100), nullable=True, comment="服务方式")
    analysis_priority = Column(String(50), nullable=True, comment="解析优先级")
    failure_count = Column(Integer, nullable=True, comment="故障数")
    is_return_required = Column(Boolean, nullable=False, default=False, comment="是否涉及退件")
    requires_physical_analysis = Column(Boolean, nullable=False, default=False, comment="是否需要实物解析")
    physical_disposition_status = Column(
        SQLEnum(PhysicalDispositionStatus, values_callable=enum_values),
        nullable=False,
        default=PhysicalDispositionStatus.PENDING,
        comment="实物处理备案状态",
    )
    physical_disposition_plan = Column(Text, nullable=True, comment="实物处理方案")
    physical_disposition_notes = Column(Text, nullable=True, comment="实物处理备注")
    physical_disposition_updated_at = Column(DateTime, nullable=True, comment="实物处理更新时间")
    physical_disposition_updated_by = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=True,
        comment="实物处理更新人 ID",
    )
    physical_analysis_status = Column(
        SQLEnum(PhysicalAnalysisStatus, values_callable=enum_values),
        nullable=False,
        default=PhysicalAnalysisStatus.PENDING,
        comment="实物解析任务状态",
    )
    physical_analysis_responsible_dept = Column(String(100), nullable=True, comment="实物解析责任部门")
    physical_analysis_responsible_user_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=True,
        comment="实物解析责任人 ID",
    )
    failed_part_number = Column(String(100), nullable=True, comment="失效零部件料号")
    physical_analysis_summary = Column(Text, nullable=True, comment="一次原因分析")
    physical_analysis_notes = Column(Text, nullable=True, comment="实物解析备注")
    physical_analysis_updated_at = Column(DateTime, nullable=True, comment="实物解析更新时间")
    physical_analysis_updated_by = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=True,
        comment="实物解析更新人 ID",
    )

    # 缺陷描述
    defect_description = Column(Text, nullable=False, comment="缺陷描述")
    severity_level = Column(SQLEnum(SeverityLevel), nullable=False, default=SeverityLevel.TBD, comment="严重度等级")

    # 售后客诉特有字段；0KM 客诉时可为空
    vin_code = Column(String(50), nullable=True, comment="VIN 码（车架号）")
    mileage = Column(Integer, nullable=True, comment="失效里程（公里）")
    mileage_category = Column(String(50), nullable=True, comment="里程分类")
    purchase_date = Column(Date, nullable=True, comment="购车日期")

    # 流程控制
    status = Column(SQLEnum(ComplaintStatus), nullable=False, default=ComplaintStatus.PENDING, comment="客诉状态")
    cqe_id = Column(Integer, ForeignKey("users.id"), nullable=True, comment="负责 CQE 的用户 ID")
    responsible_dept = Column(String(100), nullable=True, comment="责任部门")

    # 审计字段
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, comment="创建时间")
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow, comment="更新时间")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True, comment="创建人 ID")

    # 关系
    customer_master = relationship("CustomerMaster", foreign_keys=[customer_id], backref="customer_complaints")
    cqe = relationship("User", foreign_keys=[cqe_id], backref="assigned_complaints")
    creator = relationship("User", foreign_keys=[created_by], backref="created_complaints")
    physical_disposition_updater = relationship(
        "User",
        foreign_keys=[physical_disposition_updated_by],
        backref="updated_customer_complaint_dispositions",
    )
    physical_analysis_responsible_user = relationship(
        "User",
        foreign_keys=[physical_analysis_responsible_user_id],
        backref="assigned_customer_complaint_analyses",
    )
    physical_analysis_updater = relationship(
        "User",
        foreign_keys=[physical_analysis_updated_by],
        backref="updated_customer_complaint_analyses",
    )
    eight_d_report = relationship("EightDCustomer", back_populates="complaint", uselist=False)
    eight_d_links = relationship(
        "EightDCustomerComplaintLink",
        back_populates="complaint",
        cascade="all, delete-orphan",
    )
    customer_claims = relationship("CustomerClaim", back_populates="complaint")
    supplier_claims = relationship("SupplierClaim", back_populates="complaint")

    @property
    def customer_name(self):
        return self.customer_name_snapshot

    def _get_loaded_eight_d_report(self):
        state = inspect(self)
        if "eight_d_report" not in state.unloaded and self.eight_d_report:
            return self.eight_d_report

        if "eight_d_links" not in state.unloaded:
            for link in sorted(self.eight_d_links, key=lambda item: (not item.is_primary, item.id or 0)):
                if link.report:
                    return link.report

        return None

    @property
    def eight_d_report_id(self):
        report = self._get_loaded_eight_d_report()
        return report.id if report else None

    @property
    def eight_d_status(self):
        report = self._get_loaded_eight_d_report()
        return report.status if report else None

    @property
    def problem_category_key(self):
        try:
            category = get_problem_category_by_customer_complaint_type(self.complaint_type.value)
        except ValueError:
            return None
        return category.key

    @property
    def problem_category_label(self):
        try:
            category = get_problem_category_by_customer_complaint_type(self.complaint_type.value)
        except ValueError:
            return None
        return category.label

    @property
    def module_key(self):
        return "customer_quality"

    def __repr__(self):
        return f"<CustomerComplaint(id={self.id}, number={self.complaint_number}, type={self.complaint_type})>"
