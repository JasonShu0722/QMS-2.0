"""Schemas for new-product defect source records."""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.problem_management import ProblemReportResponse


class NewProductDefectCreate(BaseModel):
    source_type: str = Field(..., description="trial_defect or customer_complaint")
    defect_date: date = Field(..., description="Defect occurrence date")
    project_id: Optional[int] = Field(default=None, description="New product project id")
    trial_id: Optional[int] = Field(default=None, description="Trial production id")
    customer_name: Optional[str] = Field(default=None, max_length=200, description="Customer name")
    customer_complaint_number: Optional[str] = Field(default=None, max_length=100, description="New-product complaint number")
    product_code: Optional[str] = Field(default=None, max_length=100, description="Product code")
    product_name: Optional[str] = Field(default=None, max_length=200, description="Product name")
    defect_type: str = Field(..., min_length=1, max_length=200, description="Defect type")
    defect_description: str = Field(..., min_length=1, description="Defect description")
    defect_qty: Optional[int] = Field(default=None, gt=0, description="Defect quantity")
    responsible_dept: Optional[str] = Field(default=None, max_length=100, description="Responsible department")
    remarks: Optional[str] = Field(default=None, max_length=500, description="Remarks")


class NewProductDefectUpdate(BaseModel):
    defect_date: Optional[date] = None
    customer_name: Optional[str] = Field(default=None, max_length=200)
    customer_complaint_number: Optional[str] = Field(default=None, max_length=100)
    product_code: Optional[str] = Field(default=None, max_length=100)
    product_name: Optional[str] = Field(default=None, max_length=200)
    defect_type: Optional[str] = Field(default=None, min_length=1, max_length=200)
    defect_description: Optional[str] = Field(default=None, min_length=1)
    defect_qty: Optional[int] = Field(default=None, gt=0)
    responsible_dept: Optional[str] = Field(default=None, max_length=100)
    remarks: Optional[str] = Field(default=None, max_length=500)


class NewProductDefectResponse(BaseModel):
    id: int
    defect_number: str
    source_type: str
    status: str
    defect_date: date
    project_id: Optional[int] = None
    trial_id: Optional[int] = None
    customer_name: Optional[str] = None
    customer_complaint_number: Optional[str] = None
    product_code: Optional[str] = None
    product_name: Optional[str] = None
    defect_type: str
    defect_description: str
    defect_qty: Optional[int] = None
    responsible_dept: Optional[str] = None
    recorded_by: int
    problem_report_id: Optional[int] = None
    remarks: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    problem_number: Optional[str] = None
    eight_d_number: Optional[str] = None

    class Config:
        from_attributes = True


class NewProductDefectListResponse(BaseModel):
    items: list[NewProductDefectResponse]
    total: int
    page: int
    page_size: int


class NewProductDefectProblemReportCreate(BaseModel):
    problem_category_key: str = Field(default="DQ0", description="DQ0 or DQ1")
    title: Optional[str] = Field(default=None, max_length=500)
    description: Optional[str] = None
    risk_level: str = Field(default="medium", description="low, medium, high, critical")
    response_mode: str = Field(default="brief", description="brief or eight_d")
    assigned_to: Optional[int] = None
    due_at: Optional[datetime] = None


class NewProductDefectProblemReportResponse(BaseModel):
    defect: NewProductDefectResponse
    report: ProblemReportResponse
