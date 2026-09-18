"""
操作日志 Pydantic 数据校验模型
Operation Log Schemas - 用于 API 请求/响应的数据校验
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class OperationLogBase(BaseModel):
    """操作日志基础模型"""
    user_id: Optional[int] = Field(None, description="操作用户ID")
    operation_type: str = Field(..., description="操作类型: create/update/delete/login/logout")
    target_module: str = Field(..., description="目标模块")
    target_id: Optional[int] = Field(None, description="目标对象ID")
    ip_address: Optional[str] = Field(None, description="客户端IP地址")
    user_agent: Optional[str] = Field(None, description="浏览器User-Agent")


class OperationLogCreate(OperationLogBase):
    """创建操作日志的请求模型"""
    before_data: Optional[dict] = Field(None, description="操作前数据快照")
    after_data: Optional[dict] = Field(None, description="操作后数据快照")


class OperationLogResponse(OperationLogBase):
    """操作日志响应模型"""
    id: int = Field(..., description="日志ID")
    before_data: Optional[dict] = Field(None, description="操作前数据快照")
    after_data: Optional[dict] = Field(None, description="操作后数据快照")
    created_at: datetime = Field(..., description="操作时间")
    
    # 关联用户信息（可选）
    username: Optional[str] = Field(None, description="操作用户名")
    user_full_name: Optional[str] = Field(None, description="操作用户姓名")
    
    class Config:
        from_attributes = True


class OperationLogListQuery(BaseModel):
    """操作日志列表查询参数"""
    user_id: Optional[int] = Field(None, description="按用户ID筛选")
    operation_type: Optional[str] = Field(None, description="按操作类型筛选")
    target_module: Optional[str] = Field(None, description="按目标模块筛选")
    start_date: Optional[datetime] = Field(None, description="开始时间")
    end_date: Optional[datetime] = Field(None, description="结束时间")
    page: int = Field(1, ge=1, description="页码")
    page_size: int = Field(50, ge=1, le=100, description="每页数量")


class OperationLogListResponse(BaseModel):
    """操作日志列表响应模型"""
    total: int = Field(..., description="总记录数")
    page: int = Field(..., description="当前页码")
    page_size: int = Field(..., description="每页数量")
    items: list[OperationLogResponse] = Field(..., description="日志列表")


class OperationLogDetailResponse(OperationLogResponse):
    """操作日志详情响应模型（包含 diff 对比）"""
    data_diff: Optional[dict] = Field(None, description="数据变更 diff 对比")
    
    class Config:
        from_attributes = True
