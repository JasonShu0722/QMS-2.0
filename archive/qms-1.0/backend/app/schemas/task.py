"""
任务相关的 Pydantic 数据模型
Task Schemas - 用于 API 请求和响应的数据校验
"""
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field


class TaskItemResponse(BaseModel):
    """
    待办任务项响应模型
    """
    task_type: str = Field(..., description="任务类型")
    task_id: int = Field(..., description="任务ID")
    task_number: str = Field(..., description="任务单据编号")
    deadline: Optional[datetime] = Field(None, description="截止时间")
    urgency: str = Field(..., description="紧急程度: overdue/urgent/normal")
    color: str = Field(..., description="颜色标识: red/yellow/green")
    remaining_hours: float = Field(..., description="剩余处理时间（小时）")
    link: str = Field(..., description="跳转链接")
    description: Optional[str] = Field(None, description="任务描述")
    
    class Config:
        json_schema_extra = {
            "example": {
                "task_type": "SCAR报告处理",
                "task_id": 123,
                "task_number": "SCAR-2024-001",
                "deadline": "2024-01-20T10:00:00",
                "urgency": "urgent",
                "color": "yellow",
                "remaining_hours": 48.5,
                "link": "/supplier/scar/123",
                "description": "供应商A物料不良问题"
            }
        }


class TaskListResponse(BaseModel):
    """
    待办任务列表响应模型
    """
    total: int = Field(..., description="总任务数")
    tasks: list[TaskItemResponse] = Field(..., description="任务列表")
    
    class Config:
        json_schema_extra = {
            "example": {
                "total": 5,
                "tasks": [
                    {
                        "task_type": "SCAR报告处理",
                        "task_id": 123,
                        "task_number": "SCAR-2024-001",
                        "deadline": "2024-01-20T10:00:00",
                        "urgency": "urgent",
                        "color": "yellow",
                        "remaining_hours": 48.5,
                        "link": "/supplier/scar/123",
                        "description": "供应商A物料不良问题"
                    }
                ]
            }
        }


class TaskStatisticsResponse(BaseModel):
    """
    任务统计信息响应模型
    """
    total: int = Field(..., description="总任务数")
    overdue: int = Field(..., description="已超期任务数")
    urgent: int = Field(..., description="紧急任务数")
    normal: int = Field(..., description="正常任务数")
    
    class Config:
        json_schema_extra = {
            "example": {
                "total": 10,
                "overdue": 2,
                "urgent": 3,
                "normal": 5
            }
        }


class TaskReassignRequest(BaseModel):
    """
    任务转派请求模型
    """
    from_user_id: int = Field(..., description="原处理人ID")
    to_user_id: int = Field(..., description="新处理人ID")
    task_ids: Optional[List[str]] = Field(None, description="任务ID列表（格式：table_name:id），为空则转派所有任务")
    
    class Config:
        json_schema_extra = {
            "example": {
                "from_user_id": 10,
                "to_user_id": 20,
                "task_ids": ["scar_reports:123", "ppap_submissions:456"]
            }
        }


class TaskReassignResponse(BaseModel):
    """
    任务转派响应模型
    """
    success_count: int = Field(..., description="成功转派数量")
    failed_count: int = Field(..., description="失败转派数量")
    from_user: dict = Field(..., description="原处理人信息")
    to_user: dict = Field(..., description="新处理人信息")
    details: List[dict] = Field(..., description="详细信息")
    
    class Config:
        json_schema_extra = {
            "example": {
                "success_count": 5,
                "failed_count": 0,
                "from_user": {"id": 10, "name": "张三"},
                "to_user": {"id": 20, "name": "李四"},
                "details": [
                    {
                        "task_id": "scar_reports:123",
                        "status": "success",
                        "from_user": "张三",
                        "to_user": "李四"
                    }
                ]
            }
        }


class DepartmentStatistics(BaseModel):
    """
    部门任务统计模型
    """
    department: str = Field(..., description="部门名称")
    total: int = Field(..., description="总任务数")
    overdue: int = Field(..., description="已超期任务数")
    urgent: int = Field(..., description="紧急任务数")
    normal: int = Field(..., description="正常任务数")


class TaskStatisticsByDepartmentResponse(BaseModel):
    """
    按部门统计响应模型
    """
    departments: List[DepartmentStatistics] = Field(..., description="部门统计列表")
    
    class Config:
        json_schema_extra = {
            "example": {
                "departments": [
                    {
                        "department": "质量部",
                        "total": 50,
                        "overdue": 5,
                        "urgent": 15,
                        "normal": 30
                    }
                ]
            }
        }


class UserStatistics(BaseModel):
    """
    人员任务统计模型
    """
    user_id: int = Field(..., description="用户ID")
    user_name: str = Field(..., description="用户姓名")
    department: Optional[str] = Field(None, description="部门")
    total: int = Field(..., description="总任务数")
    overdue: int = Field(..., description="已超期任务数")
    urgent: int = Field(..., description="紧急任务数")
    normal: int = Field(..., description="正常任务数")


class TaskStatisticsByUserResponse(BaseModel):
    """
    按人员统计响应模型
    """
    users: List[UserStatistics] = Field(..., description="人员统计列表")
    
    class Config:
        json_schema_extra = {
            "example": {
                "users": [
                    {
                        "user_id": 10,
                        "user_name": "张三",
                        "department": "质量部",
                        "total": 15,
                        "overdue": 2,
                        "urgent": 5,
                        "normal": 8
                    }
                ]
            }
        }


class OverdueTask(BaseModel):
    """
    逾期任务模型
    """
    task_id: str = Field(..., description="任务ID（格式：table_name:id）")
    task_type: str = Field(..., description="任务类型")
    task_number: str = Field(..., description="任务单据编号")
    deadline: Optional[str] = Field(None, description="截止时间")
    handler_id: int = Field(..., description="处理人ID")
    handler_name: str = Field(..., description="处理人姓名")
    department: Optional[str] = Field(None, description="部门")
    overdue_hours: float = Field(..., description="逾期时长（小时）")


class OverdueTaskListResponse(BaseModel):
    """
    逾期任务清单响应模型
    """
    total: int = Field(..., description="逾期任务总数")
    tasks: List[OverdueTask] = Field(..., description="逾期任务列表")
    
    class Config:
        json_schema_extra = {
            "example": {
                "total": 3,
                "tasks": [
                    {
                        "task_id": "scar_reports:123",
                        "task_type": "SCAR报告处理",
                        "task_number": "SCAR-2024-001",
                        "deadline": "2024-01-15T10:00:00",
                        "handler_id": 10,
                        "handler_name": "张三",
                        "department": "质量部",
                        "overdue_hours": 120.5
                    }
                ]
            }
        }

