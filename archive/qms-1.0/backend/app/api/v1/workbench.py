"""
工作台 API 路由
Workbench API - 工作台首页数据聚合接口
"""
from typing import Any, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.platform_admin import is_platform_admin
from app.models.user import User, UserType
from app.services.feature_flag_service import FeatureFlagService
from app.services.task_aggregator import task_aggregator
from app.services.user_session_service import build_user_response


router = APIRouter(prefix="/workbench", tags=["workbench"])


class MetricItem(BaseModel):
    """指标数据项"""

    key: str = Field(..., description="指标唯一标识")
    name: str = Field(..., description="指标名称")
    value: Any = Field(..., description="指标值")
    status: str = Field("good", description="状态: good/warning/danger")
    achievement: Optional[float] = Field(None, description="达成率（百分比）")
    unit: Optional[str] = Field(None, description="单位")


class TodoTaskItem(BaseModel):
    """工作台待办项"""

    task_type: str = Field(..., description="任务类型")
    task_id: Any = Field(..., description="任务编号")
    deadline: Optional[str] = Field(None, description="截止时间")
    remaining_hours: float = Field(0, description="剩余处理时间（小时）")
    urgency: str = Field("normal", description="紧急程度: overdue/urgent/normal")
    color: str = Field("green", description="颜色标识: red/yellow/green")
    link: str = Field("", description="跳转链接")
    title: Optional[str] = Field(None, description="任务标题")
    description: Optional[str] = Field(None, description="任务描述")


class TodoSummaryItem(BaseModel):
    """工作台待办统计"""

    total: int = Field(0, description="待办总数")
    overdue: int = Field(0, description="超期事项数")
    due_soon: int = Field(0, description="临期事项数")


class PerformanceStatus(BaseModel):
    """供应商绩效状态"""

    grade: str = Field("B", description="绩效等级: A/B/C/D")
    score: float = Field(0, description="当前得分")
    deduction_this_month: float = Field(0, description="本月扣分")


class InternalDashboardResponse(BaseModel):
    """内部员工工作台数据"""

    user_info: Any = Field(..., description="稳定的用户会话信息")
    environment: str = Field(..., description="当前环境")
    quick_actions: List[dict[str, str]] = Field(default_factory=list, description="快捷入口")
    feature_blocks: dict[str, bool] = Field(default_factory=dict, description="区块启用状态")
    metrics: List[MetricItem] = Field(default_factory=list, description="指标监控")
    todo_summary: TodoSummaryItem = Field(default_factory=TodoSummaryItem, description="待办统计")
    todos: List[TodoTaskItem] = Field(default_factory=list, description="待办任务")
    notifications: int = Field(0, description="未读消息数量")


class SupplierDashboardResponse(BaseModel):
    """供应商工作台数据"""

    user_info: Any = Field(..., description="稳定的用户会话信息")
    environment: str = Field(..., description="当前环境")
    quick_actions: List[dict[str, str]] = Field(default_factory=list, description="快捷入口")
    feature_blocks: dict[str, bool] = Field(default_factory=dict, description="区块启用状态")
    todo_summary: TodoSummaryItem = Field(default_factory=TodoSummaryItem, description="待办统计")
    performance_status: Optional[PerformanceStatus] = Field(None, description="绩效状态")
    action_required_tasks: List[TodoTaskItem] = Field(default_factory=list, description="待处理任务")


@router.get(
    "/dashboard",
    summary="获取工作台数据",
    description="""
    获取当前用户的工作台首页数据。

    根据用户类型返回不同的数据结构：
    - 内部员工：指标监控 + 待办任务 + 未读消息数
    - 供应商用户：绩效状态 + 待处理任务

    当前待办只聚合真实可处理事项，不再返回演示性质的伪待办。
    """,
)
async def get_dashboard_data(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    获取工作台数据。
    """

    try:
        tasks = await task_aggregator.get_user_tasks(db, current_user.id)
        todo_summary = TodoSummaryItem(**task_aggregator.summarize_tasks(tasks))
        todo_items = [
            TodoTaskItem(
                task_type=task.task_type,
                task_id=task.task_number if hasattr(task, "task_number") else task.task_id,
                deadline=task.deadline.isoformat() if task.deadline else None,
                remaining_hours=task.remaining_hours,
                urgency=task.urgency,
                color=task.color,
                link=task.link,
                title=task.title if hasattr(task, "title") else None,
                description=task.description if hasattr(task, "description") else None,
            )
            for task in tasks
        ]
    except Exception:
        todo_items = []
        todo_summary = TodoSummaryItem()

    session_user = await build_user_response(db, current_user)
    metrics_enabled = await FeatureFlagService.is_feature_enabled(
        db,
        "foundation.workbench.metrics",
        current_user.id,
        current_user.supplier_id,
        settings.ENVIRONMENT,
    )
    announcements_enabled = await FeatureFlagService.is_feature_enabled(
        db,
        "foundation.workbench.announcements",
        current_user.id,
        current_user.supplier_id,
        settings.ENVIRONMENT,
    )

    quick_actions = [
        {"title": "个人中心", "description": "个人资料", "link": "/workbench"},
    ]
    if is_platform_admin(current_user):
        quick_actions.extend(
            [
                {"title": "用户管理", "description": "用户管理", "link": "/admin/users"},
                {"title": "权限矩阵", "description": "权限矩阵", "link": "/admin/permissions"},
                {"title": "功能开关", "description": "功能开关", "link": "/admin/feature-flags"},
            ]
        )

    feature_blocks = {
        "metrics": metrics_enabled,
        "announcements": announcements_enabled,
        "notifications": False,
    }

    if current_user.user_type == UserType.INTERNAL:
        return InternalDashboardResponse(
            user_info=session_user.model_dump(mode="json"),
            environment=settings.ENVIRONMENT,
            quick_actions=quick_actions,
            feature_blocks=feature_blocks,
            metrics=[
                MetricItem(
                    key="foundation.pending_reviews",
                    name="待办总数",
                    value=todo_summary.total,
                    status="warning" if todo_summary.total else "good",
                    achievement=100 if not todo_summary.total else max(0, 100 - todo_summary.total * 10),
                )
            ]
            if metrics_enabled
            else [],
            todo_summary=todo_summary,
            todos=todo_items,
            notifications=0,
        )

    return SupplierDashboardResponse(
        user_info=session_user.model_dump(mode="json"),
        environment=settings.ENVIRONMENT,
        quick_actions=quick_actions,
        feature_blocks=feature_blocks,
        todo_summary=todo_summary,
        performance_status=None,
        action_required_tasks=todo_items,
    )
