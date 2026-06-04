"""
过程质量不良品数据的 Pydantic 数据校验模型
Process Defect Schemas - 制程不合格品记录的请求/响应模型
"""
from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, Field, validator


class ProcessDefectCreate(BaseModel):
    """创建不良品记录请求模型"""
    defect_date: date = Field(..., description="不良发生日期")
    work_order: str = Field(..., min_length=1, max_length=100, description="工单号")
    process_id: str = Field(..., min_length=1, max_length=50, description="工序ID")
    line_id: str = Field(..., min_length=1, max_length=50, description="产线ID")
    defect_type: str = Field(..., min_length=1, max_length=200, description="不良类型/失效模式")
    defect_qty: int = Field(..., gt=0, description="不良数量")
    responsibility_category: str = Field(
        ..., 
        description="责任类别: material_defect, operation_defect, equipment_defect, process_defect, design_defect"
    )
    operator_id: Optional[int] = Field(None, description="操作员ID")
    material_code: Optional[str] = Field(None, max_length=100, description="物料编码（物料不良时必填）")
    supplier_id: Optional[int] = Field(None, description="供应商ID（物料不良时必填）")
    remarks: Optional[str] = Field(None, max_length=500, description="备注")
    
    @validator('responsibility_category')
    def validate_responsibility_category(cls, v):
        """验证责任类别"""
        allowed = ['material_defect', 'operation_defect', 'equipment_defect', 'process_defect', 'design_defect']
        if v not in allowed:
            raise ValueError(f'responsibility_category must be one of {allowed}')
        return v
    
    @validator('supplier_id', always=True)
    def validate_supplier_for_material_defect(cls, v, values):
        """当责任类别为物料不良时，供应商ID必填"""
        if 'responsibility_category' in values and values['responsibility_category'] == 'material_defect':
            if not v:
                raise ValueError('supplier_id is required when responsibility_category is material_defect')
        return v
    
    @validator('material_code', always=True)
    def validate_material_code_for_material_defect(cls, v, values):
        """当责任类别为物料不良时，物料编码必填"""
        if 'responsibility_category' in values and values['responsibility_category'] == 'material_defect':
            if not v:
                raise ValueError('material_code is required when responsibility_category is material_defect')
        return v


class ProcessDefectUpdate(BaseModel):
    """更新不良品记录请求模型"""
    defect_date: Optional[date] = Field(None, description="不良发生日期")
    work_order: Optional[str] = Field(None, min_length=1, max_length=100, description="工单号")
    process_id: Optional[str] = Field(None, min_length=1, max_length=50, description="工序ID")
    line_id: Optional[str] = Field(None, min_length=1, max_length=50, description="产线ID")
    defect_type: Optional[str] = Field(None, min_length=1, max_length=200, description="不良类型/失效模式")
    defect_qty: Optional[int] = Field(None, gt=0, description="不良数量")
    responsibility_category: Optional[str] = Field(None, description="责任类别")
    operator_id: Optional[int] = Field(None, description="操作员ID")
    material_code: Optional[str] = Field(None, max_length=100, description="物料编码")
    supplier_id: Optional[int] = Field(None, description="供应商ID")
    remarks: Optional[str] = Field(None, max_length=500, description="备注")
    
    @validator('responsibility_category')
    def validate_responsibility_category(cls, v):
        """验证责任类别"""
        if v is not None:
            allowed = ['material_defect', 'operation_defect', 'equipment_defect', 'process_defect', 'design_defect']
            if v not in allowed:
                raise ValueError(f'responsibility_category must be one of {allowed}')
        return v


class ProcessDefectResponse(BaseModel):
    """不良品记录响应模型"""
    id: int
    defect_number: Optional[str] = None
    defect_date: date
    work_order: str
    process_id: str
    line_id: str
    defect_type: str
    defect_qty: int
    responsibility_category: str
    operator_id: Optional[int]
    recorded_by: int
    material_code: Optional[str]
    supplier_id: Optional[int]
    remarks: Optional[str]
    created_at: datetime
    updated_at: datetime
    
    # 关联数据（可选）
    operator_name: Optional[str] = None
    recorded_by_name: Optional[str] = None
    supplier_name: Optional[str] = None
    
    class Config:
        from_attributes = True


class ProcessDefectListQuery(BaseModel):
    """不良品记录列表查询参数"""
    defect_date_start: Optional[date] = Field(None, description="不良日期起始")
    defect_date_end: Optional[date] = Field(None, description="不良日期结束")
    work_order: Optional[str] = Field(None, description="工单号筛选")
    process_id: Optional[str] = Field(None, description="工序ID筛选")
    line_id: Optional[str] = Field(None, description="产线ID筛选")
    defect_type: Optional[str] = Field(None, description="不良类型筛选")
    responsibility_category: Optional[str] = Field(None, description="责任类别筛选")
    supplier_id: Optional[int] = Field(None, description="供应商ID筛选")
    material_code: Optional[str] = Field(None, description="物料编码筛选")
    page: int = Field(1, ge=1, description="页码")
    page_size: int = Field(20, ge=1, le=100, description="每页数量")
    
    @validator('responsibility_category')
    def validate_responsibility_category(cls, v):
        """验证责任类别"""
        if v is not None:
            allowed = ['material_defect', 'operation_defect', 'equipment_defect', 'process_defect', 'design_defect']
            if v not in allowed:
                raise ValueError(f'responsibility_category must be one of {allowed}')
        return v


class DefectTypeOption(BaseModel):
    """失效类型预设选项"""
    value: str = Field(..., description="失效类型值")
    label: str = Field(..., description="失效类型显示名称")
    category: Optional[str] = Field(None, description="失效类型分类")


class DefectTypeListResponse(BaseModel):
    """失效类型列表响应"""
    defect_types: list[DefectTypeOption] = Field(..., description="失效类型列表")


class ResponsibilityCategoryOption(BaseModel):
    """责任类别选项"""
    value: str = Field(..., description="责任类别值")
    label: str = Field(..., description="责任类别显示名称")
    description: str = Field(..., description="责任类别说明")
    links_to_metric: Optional[str] = Field(None, description="关联的质量指标")


class ResponsibilityCategoryListResponse(BaseModel):
    """责任类别列表响应"""
    categories: list[ResponsibilityCategoryOption] = Field(..., description="责任类别列表")
