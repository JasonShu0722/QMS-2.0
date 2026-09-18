# Pydantic Schemas

from app.schemas.task import (
    TaskItemResponse,
    TaskListResponse,
    TaskStatisticsResponse
)

from app.schemas.supplier_target import (
    BatchTargetCreate,
    BatchTargetCreateResponse,
    IndividualTargetCreate,
    IndividualTargetUpdate,
    TargetSignRequest,
    TargetApprovalRequest,
    TargetQueryParams,
    TargetResponse,
    TargetListResponse,
    HistoricalPerformanceData,
    UnsignedTargetsSummary
)

from app.schemas.process_defect import (
    ProcessDefectCreate,
    ProcessDefectUpdate,
    ProcessDefectResponse,
    ProcessDefectListQuery,
    DefectTypeOption,
    DefectTypeListResponse,
    ResponsibilityCategoryOption,
    ResponsibilityCategoryListResponse
)

__all__ = [
    "TaskItemResponse",
    "TaskListResponse",
    "TaskStatisticsResponse",
    "BatchTargetCreate",
    "BatchTargetCreateResponse",
    "IndividualTargetCreate",
    "IndividualTargetUpdate",
    "TargetSignRequest",
    "TargetApprovalRequest",
    "TargetQueryParams",
    "TargetResponse",
    "TargetListResponse",
    "HistoricalPerformanceData",
    "UnsignedTargetsSummary",
    "ProcessDefectCreate",
    "ProcessDefectUpdate",
    "ProcessDefectResponse",
    "ProcessDefectListQuery",
    "DefectTypeOption",
    "DefectTypeListResponse",
    "ResponsibilityCategoryOption",
    "ResponsibilityCategoryListResponse"
]
