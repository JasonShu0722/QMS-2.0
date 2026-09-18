"""
条码校验 Pydantic 模型
Barcode Validation Schemas
"""
from datetime import datetime
from typing import Optional, Dict, Any
from pydantic import BaseModel, Field, field_validator
import re


# ============ 校验规则配置相关 ============

class ValidationRulesConfig(BaseModel):
    """校验规则配置"""
    prefix: Optional[str] = Field(None, description="固定前缀")
    suffix: Optional[str] = Field(None, description="固定后缀")
    min_length: Optional[int] = Field(None, ge=1, description="最小长度")
    max_length: Optional[int] = Field(None, ge=1, description="最大长度")
    
    @field_validator('max_length')
    @classmethod
    def validate_max_length(cls, v, info):
        """验证最大长度必须大于等于最小长度"""
        if v is not None and info.data.get('min_length') is not None:
            if v < info.data['min_length']:
                raise ValueError('max_length must be greater than or equal to min_length')
        return v


class BarcodeValidationCreate(BaseModel):
    """创建条码校验规则"""
    material_code: str = Field(..., min_length=1, max_length=100, description="物料编码")
    validation_rules: Optional[ValidationRulesConfig] = Field(None, description="校验规则")
    regex_pattern: Optional[str] = Field(None, max_length=200, description="正则表达式")
    is_unique_check: bool = Field(False, description="是否启用唯一性校验")
    
    @field_validator('regex_pattern')
    @classmethod
    def validate_regex_pattern(cls, v):
        """验证正则表达式的有效性"""
        if v:
            try:
                re.compile(v)
            except re.error as e:
                raise ValueError(f'Invalid regex pattern: {str(e)}')
        return v


class BarcodeValidationUpdate(BaseModel):
    """更新条码校验规则"""
    validation_rules: Optional[ValidationRulesConfig] = None
    regex_pattern: Optional[str] = Field(None, max_length=200)
    is_unique_check: Optional[bool] = None
    
    @field_validator('regex_pattern')
    @classmethod
    def validate_regex_pattern(cls, v):
        """验证正则表达式的有效性"""
        if v:
            try:
                re.compile(v)
            except re.error as e:
                raise ValueError(f'Invalid regex pattern: {str(e)}')
        return v


class BarcodeValidationResponse(BaseModel):
    """条码校验规则响应"""
    id: int
    material_code: str
    validation_rules: Optional[Dict[str, Any]]
    regex_pattern: Optional[str]
    is_unique_check: bool
    created_at: datetime
    updated_at: datetime
    
    model_config = {"from_attributes": True}


# ============ 扫码验证相关 ============

class BarcodeScanRequest(BaseModel):
    """扫码验证请求"""
    material_code: str = Field(..., min_length=1, max_length=100, description="物料编码")
    barcode_content: str = Field(..., min_length=1, max_length=200, description="条码内容")
    supplier_id: int = Field(..., gt=0, description="供应商ID")
    batch_number: Optional[str] = Field(None, max_length=100, description="批次号")
    device_ip: Optional[str] = Field(None, max_length=50, description="设备IP")


class BarcodeScanResponse(BaseModel):
    """扫码验证响应"""
    is_pass: bool = Field(..., description="是否通过")
    message: str = Field(..., description="验证消息")
    error_reason: Optional[str] = Field(None, description="错误原因（NG时）")
    record_id: int = Field(..., description="扫描记录ID")
    scanned_at: datetime = Field(..., description="扫描时间")


# ============ 批次提交归档相关 ============

class BatchSubmitRequest(BaseModel):
    """批次提交归档请求"""
    material_code: str = Field(..., min_length=1, max_length=100, description="物料编码")
    batch_number: str = Field(..., min_length=1, max_length=100, description="批次号")
    supplier_id: int = Field(..., gt=0, description="供应商ID")


class BatchSubmitResponse(BaseModel):
    """批次提交归档响应"""
    success: bool
    message: str
    archived_count: int = Field(..., description="归档记录数")
    batch_number: str
    archived_at: datetime


# ============ 扫描记录查询相关 ============

class BarcodeScanRecordResponse(BaseModel):
    """扫描记录响应"""
    id: int
    material_code: str
    supplier_id: int
    batch_number: Optional[str]
    barcode_content: str
    is_pass: bool
    error_reason: Optional[str]
    scanned_by: int
    scanned_at: datetime
    device_ip: Optional[str]
    is_archived: bool
    archived_at: Optional[datetime]
    
    model_config = {"from_attributes": True}


class BarcodeScanRecordListResponse(BaseModel):
    """扫描记录列表响应"""
    total: int
    records: list[BarcodeScanRecordResponse]


# ============ 统计相关 ============

class ScanStatisticsResponse(BaseModel):
    """扫码统计响应"""
    material_code: str
    batch_number: Optional[str]
    total_scanned: int = Field(..., description="总扫描数")
    pass_count: int = Field(..., description="通过数")
    fail_count: int = Field(..., description="失败数")
    pass_rate: float = Field(..., description="通过率")
    target_quantity: Optional[int] = Field(None, description="目标数量")
    remaining_quantity: Optional[int] = Field(None, description="剩余数量")
