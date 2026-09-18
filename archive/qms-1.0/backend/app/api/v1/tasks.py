"""
任务管理 API 路由
Tasks API - 待办任务聚合与查询接口
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.task import TaskListResponse, TaskItemResponse, TaskStatisticsResponse
from app.services.task_aggregator import task_aggregator


router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get(
    "/my-tasks",
    response_model=TaskListResponse,
    summary="获取当前用户待办任务",
    description="""
    获取当前登录用户的所有待办任务。
    
    功能：
    - 从各业务表聚合待办任务（SCAR、8D报告、审核整改项等）
    - 自动计算任务紧急程度（已超期/即将超期/正常）
    - 自动计算剩余处理时间
    - 按紧急程度排序（最紧急的在前）
    
    紧急程度规则：
    - 🔴 已超期 (overdue/red)：剩余时间 < 0
    - 🟡 即将超期 (urgent/yellow)：剩余时间 ≤ 72小时
    - 🟢 正常 (normal/green)：剩余时间 > 72小时
    
    注：Phase 1 阶段，业务表尚未创建，此接口将返回空列表。
    """
)
async def get_my_tasks(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    获取当前用户待办任务
    
    Args:
        current_user: 当前登录用户（通过 JWT Token 验证）
        db: 数据库会话
        
    Returns:
        TaskListResponse: 待办任务列表
    """
    try:
        # 调用任务聚合服务
        tasks = await task_aggregator.get_user_tasks(db, current_user.id)
        
        # 转换为响应模型
        task_items = [TaskItemResponse(**task.to_dict()) for task in tasks]
        
        return TaskListResponse(
            total=len(task_items),
            tasks=task_items
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取待办任务失败: {str(e)}"
        )


@router.get(
    "/statistics",
    response_model=TaskStatisticsResponse,
    summary="获取任务统计信息",
    description="""
    获取当前用户的任务统计信息。
    
    统计维度：
    - total: 总任务数
    - overdue: 已超期任务数
    - urgent: 紧急任务数（≤72小时）
    - normal: 正常任务数（>72小时）
    
    用途：
    - 个人中心仪表盘展示
    - 任务数量红点提醒
    """
)
async def get_task_statistics(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    获取任务统计信息
    
    Args:
        current_user: 当前登录用户
        db: 数据库会话
        
    Returns:
        TaskStatisticsResponse: 任务统计信息
    """
    try:
        # 调用任务聚合服务
        statistics = await task_aggregator.get_task_statistics(db, current_user.id)
        
        return TaskStatisticsResponse(**statistics)
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取任务统计失败: {str(e)}"
        )

