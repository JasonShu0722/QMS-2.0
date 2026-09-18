"""
Customer Complaint Schemas
客诉单数据校验模型
"""
from datetime import date, datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, model_validator
from app.schemas.eight_d_customer import EightDStatusEnum


class ComplaintTypeEnum(str, Enum):
    """客诉类型枚举"""

    ZERO_KM = "0km"
    AFTER_SALES = "after_sales"


class ComplaintStatusEnum(str, Enum):
    """客诉状态枚举"""

    PENDING = "pending"
    IN_ANALYSIS = "in_analysis"
    IN_RESPONSE = "in_response"
    IN_REVIEW = "in_review"
    CLOSED = "closed"
    REJECTED = "rejected"


class PhysicalDispositionStatusEnum(str, Enum):
    """实物处理备案状态枚举"""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class PhysicalAnalysisStatusEnum(str, Enum):
    """实物解析任务状态枚举"""

    PENDING = "pending"
    ASSIGNED = "assigned"
    COMPLETED = "completed"


class SeverityLevelEnum(str, Enum):
    """严重度等级枚举"""

    CRITICAL = "critical"
    MAJOR = "major"
    MINOR = "minor"
    TBD = "tbd"


class CustomerComplaintCreate(BaseModel):
    """创建客诉单请求模型"""

    complaint_type: ComplaintTypeEnum = Field(..., description="客诉类型：0km / 售后")
    customer_id: Optional[int] = Field(None, ge=1, description="客户主数据 ID")
    customer_code: Optional[str] = Field(None, min_length=1, max_length=50, description="客户代码（兼容旧数据）")
    customer_name: Optional[str] = Field(None, min_length=1, max_length=200, description="客户名称（兼容旧数据）")
    end_customer_name: Optional[str] = Field(None, max_length=200, description="终端客户名称")
    received_date: Optional[date] = Field(None, description="收件日期")
    occurrence_date: Optional[date] = Field(None, description="发生/故障日期")
    production_date: Optional[date] = Field(None, description="生产/出厂日期")
    product_type: str = Field(..., min_length=1, max_length=100, description="产品类型")
    product_model: Optional[str] = Field(None, max_length=100, description="产品型号")
    project_stage: Optional[str] = Field(None, max_length=100, description="项目阶段")
    batch_code: Optional[str] = Field(None, max_length=100, description="批次号/条码")
    trace_code: Optional[str] = Field(None, max_length=100, description="产品追溯码")
    return_type: Optional[str] = Field(None, max_length=50, description="零星退件/集中退件")
    return_month: Optional[str] = Field(None, max_length=20, description="退件月份")
    service_months: Optional[int] = Field(None, ge=0, description="服务月数")
    service_month_category: Optional[str] = Field(None, max_length=50, description="服务月分类")
    dealer_name: Optional[str] = Field(None, max_length=200, description="4S 店名称")
    occurrence_region: Optional[str] = Field(None, max_length=100, description="发生区域")
    fault_category: Optional[str] = Field(None, max_length=100, description="故障分类")
    service_method: Optional[str] = Field(None, max_length=100, description="服务方式")
    analysis_priority: Optional[str] = Field(None, max_length=50, description="解析优先级")
    failure_count: Optional[int] = Field(None, ge=1, description="故障数")
    defect_description: str = Field(..., min_length=10, description="缺陷描述（至少 10 字）")
    is_return_required: bool = Field(False, description="是否涉及退件")
    requires_physical_analysis: bool = Field(False, description="是否需要实物解析")
    vin_code: Optional[str] = Field(None, max_length=50, description="VIN 码（售后客诉必填）")
    mileage: Optional[int] = Field(None, ge=0, description="失效里程（售后客诉必填）")
    mileage_category: Optional[str] = Field(None, max_length=50, description="里程分类")
    purchase_date: Optional[date] = Field(None, description="购车日期（售后客诉必填）")

    @model_validator(mode="after")
    def validate_after_sales_fields(self) -> "CustomerComplaintCreate":
        if self.customer_id is None and not self.customer_code and not self.customer_name:
            raise ValueError("请选择客户或填写客户名称/客户代码")

        if self.complaint_type == ComplaintTypeEnum.AFTER_SALES:
            if not self.vin_code:
                raise ValueError("售后客诉时，VIN 码为必填项")
            if self.mileage is None:
                raise ValueError("售后客诉时，失效里程为必填项")

        return self

    class Config:
        json_schema_extra = {
            "example": {
                "complaint_type": "after_sales",
                "customer_id": 1,
                "received_date": "2026-05-01",
                "occurrence_date": "2026-04-30",
                "product_type": "MCU 控制器",
                "product_model": "AV010A",
                "trace_code": "TRACE-001",
                "defect_description": "客户反馈车辆行驶中突然断电，检查发现 MCU 主板烧毁",
                "end_customer_name": "某终端项目",
                "is_return_required": True,
                "requires_physical_analysis": True,
                "vin_code": "LSVAA4182E2123456",
                "mileage": 15000,
                "purchase_date": "2023-06-15",
            }
        }


class CustomerComplaintBatchCreate(BaseModel):
    """批量创建客诉单请求模型"""

    items: list[CustomerComplaintCreate] = Field(..., min_length=1, max_length=100, description="客诉单列表")


class PhysicalDispositionRecordRequest(BaseModel):
    """实物处理备案请求模型"""

    disposition_plan: str = Field(..., min_length=5, description="后续处理方案")
    disposition_status: PhysicalDispositionStatusEnum = Field(
        PhysicalDispositionStatusEnum.IN_PROGRESS,
        description="实物处理备案状态",
    )
    disposition_notes: Optional[str] = Field(None, description="处理备注")


class PhysicalAnalysisRecordRequest(BaseModel):
    """实物解析任务请求模型"""

    responsible_dept: str = Field(..., min_length=1, max_length=100, description="责任部门")
    responsible_user_id: int = Field(..., ge=1, description="责任人 ID")
    analysis_status: PhysicalAnalysisStatusEnum = Field(
        PhysicalAnalysisStatusEnum.ASSIGNED,
        description="实物解析任务状态",
    )
    failed_part_number: Optional[str] = Field(None, max_length=100, description="失效零部件料号")
    analysis_summary: Optional[str] = Field(None, description="一次原因分析")
    analysis_notes: Optional[str] = Field(None, description="实物解析备注")

    @model_validator(mode="after")
    def validate_completed_analysis(self) -> "PhysicalAnalysisRecordRequest":
        if self.analysis_status == PhysicalAnalysisStatusEnum.COMPLETED and not self.analysis_summary:
            raise ValueError("完成实物解析时，需填写一次原因分析")
        return self


class PreliminaryAnalysisRequest(BaseModel):
    """CQE 一次因解析请求模型（D0-D3）"""

    emergency_action: str = Field(..., min_length=10, description="紧急响应措施（围堵措施）")
    team_members: str = Field(..., description="团队成员（逗号分隔）")
    problem_description_5w2h: str = Field(..., min_length=20, description="问题描述（5W2H 格式）")
    containment_action: str = Field(..., min_length=10, description="临时围堵措施详情")
    containment_verification: str = Field(..., description="围堵措施验证结果")
    responsible_dept: str = Field(..., description="责任部门")
    root_cause_preliminary: Optional[str] = Field(None, description="初步原因分析")
    ims_work_order: Optional[str] = Field(None, description="关联的 IMS 工单号")
    ims_batch_number: Optional[str] = Field(None, description="关联的批次号")

    class Config:
        json_schema_extra = {
            "example": {
                "emergency_action": "立即冻结库存同批次产品，通知客户暂停使用",
                "team_members": "张三(CQE), 李四(设计), 王五(制造)",
                "problem_description_5w2h": "What: MCU 主板烧毁; When: 2024-01-10; Where: 客户产线; Who: 终端用户; Why: 待分析; How: 行驶中突然断电; How Many: 1 台",
                "containment_action": "冻结库存并排查在途品，安排现场调查",
                "containment_verification": "已完成库存冻结和客户现场排查",
                "responsible_dept": "设计部",
                "root_cause_preliminary": "初步怀疑电源模块设计裕量不足",
                "ims_work_order": "WO202401001",
                "ims_batch_number": "BATCH20240105",
            }
        }


class CustomerComplaintResponse(BaseModel):
    """客诉单响应模型"""

    id: int
    complaint_number: str
    complaint_type: ComplaintTypeEnum
    customer_id: Optional[int]
    customer_code: str
    customer_name: Optional[str]
    end_customer_name: Optional[str]
    received_date: Optional[date]
    occurrence_date: Optional[date]
    production_date: Optional[date]
    product_type: str
    product_model: Optional[str]
    project_stage: Optional[str]
    batch_code: Optional[str]
    trace_code: Optional[str]
    return_type: Optional[str]
    return_month: Optional[str]
    service_months: Optional[int]
    service_month_category: Optional[str]
    dealer_name: Optional[str]
    occurrence_region: Optional[str]
    fault_category: Optional[str]
    service_method: Optional[str]
    analysis_priority: Optional[str]
    failure_count: Optional[int]
    defect_description: str
    severity_level: SeverityLevelEnum
    is_return_required: bool
    requires_physical_analysis: bool
    physical_disposition_status: PhysicalDispositionStatusEnum
    physical_disposition_plan: Optional[str]
    physical_disposition_notes: Optional[str]
    physical_disposition_updated_at: Optional[datetime]
    physical_disposition_updated_by: Optional[int]
    physical_analysis_status: PhysicalAnalysisStatusEnum
    physical_analysis_responsible_dept: Optional[str]
    physical_analysis_responsible_user_id: Optional[int]
    failed_part_number: Optional[str]
    physical_analysis_summary: Optional[str]
    physical_analysis_notes: Optional[str]
    physical_analysis_updated_at: Optional[datetime]
    physical_analysis_updated_by: Optional[int]
    eight_d_report_id: Optional[int]
    eight_d_status: Optional[EightDStatusEnum]
    problem_report_id: Optional[int] = None
    problem_number: Optional[str] = None
    problem_report_eight_d_number: Optional[str] = None
    problem_report_response_mode: Optional[str] = None
    problem_report_risk_level: Optional[str] = None
    problem_category_key: Optional[str] = None
    problem_category_label: Optional[str] = None
    module_key: Optional[str] = None
    vin_code: Optional[str]
    mileage: Optional[int]
    mileage_category: Optional[str]
    purchase_date: Optional[date]
    status: ComplaintStatusEnum
    cqe_id: Optional[int]
    responsible_dept: Optional[str]
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int]

    class Config:
        from_attributes = True


class CustomerComplaintListResponse(BaseModel):
    """客诉单列表响应模型"""

    total: int
    items: list[CustomerComplaintResponse]
    page: int
    page_size: int


class CustomerComplaintBatchCreateResponse(BaseModel):
    """批量创建客诉单响应模型"""

    total: int
    items: list[CustomerComplaintResponse]


class CustomerComplaintCustomerOption(BaseModel):
    id: int
    code: str
    name: str

    class Config:
        from_attributes = True


class CustomerComplaintInternalUserOption(BaseModel):
    id: int
    username: str
    full_name: str
    department: Optional[str]
    position: Optional[str]

    class Config:
        from_attributes = True


class IMSTracebackRequest(BaseModel):
    """IMS 自动追溯请求模型"""

    work_order: Optional[str] = Field(None, description="工单号")
    batch_number: Optional[str] = Field(None, description="批次号")
    material_code: Optional[str] = Field(None, description="物料编码")
    production_date: Optional[date] = Field(None, description="生产日期")

    class Config:
        json_schema_extra = {
            "example": {
                "work_order": "WO202401001",
                "batch_number": "BATCH20240105",
                "material_code": "MAT-MCU-001",
            }
        }


class IMSTracebackResponse(BaseModel):
    """IMS 追溯结果响应模型"""

    found: bool = Field(..., description="是否找到追溯记录")
    work_order: Optional[str] = None
    batch_number: Optional[str] = None
    production_date: Optional[date] = None
    process_records: list[dict] = Field(default_factory=list, description="过程记录列表")
    defect_records: list[dict] = Field(default_factory=list, description="不良记录列表")
    material_records: list[dict] = Field(default_factory=list, description="物料追溯记录")
    anomaly_detected: bool = Field(False, description="是否检测到异常")
    anomaly_description: Optional[str] = Field(None, description="异常描述")

    class Config:
        json_schema_extra = {
            "example": {
                "found": True,
                "work_order": "WO202401001",
                "batch_number": "BATCH20240105",
                "production_date": "2024-01-05",
                "process_records": [
                    {"process": "SMT 贴片", "operator": "张三", "result": "OK"},
                    {"process": "波峰焊", "operator": "李四", "result": "OK"},
                ],
                "defect_records": [
                    {"defect_type": "虚焊", "qty": 2, "date": "2024-01-05"},
                ],
                "material_records": [
                    {"material_code": "MAT-001", "supplier": "SUP-A", "batch": "B001"},
                ],
                "anomaly_detected": True,
                "anomaly_description": "该批次在波峰焊工序出现 2 次虚焊不良",
            }
        }
