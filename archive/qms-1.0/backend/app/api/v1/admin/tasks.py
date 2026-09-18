"""
管理员任务管理 API 路由
Admin Tasks API - 任务转派与统计监控接口
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.platform_admin import get_current_platform_admin
from app.models.user import User
from app.schemas.task import (
    TaskReassignRequest,
    TaskReassignResponse,
    TaskStatisticsByDepartmentResponse,
    TaskStatisticsByUserResponse,
    OverdueTaskListResponse
)
from app.services.task_reassignment_service import task_reassignment_service


router = APIRouter(prefix="/admin/tasks", tags=["admin-tasks"])


@router.post(
    "/reassign",
    response_model=TaskReassignResponse,
    summary="批量转派任务",
    description="""
    批量转派任务功能。
    
    使用场景：
    - 员工离职时，将其名下所有待办任务转移给接替人员
    - 员工请长假时，临时转派任务给其他同事
    - 工作负载调整，重新分配任务
    
    功能：
    - 支持批量转派多个任务
    - 自动更新各业务表的 current_handler_id
    - 自动发送通知给新的处理人
    - 记录操作日志
    
    权限要求：
    - 仅管理员可执行此操作
    """
)
async def reassign_tasks(
    request: TaskReassignRequest,
    current_user: User = Depends(get_current_platform_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    批量转派任务
    
    Args:
        request: 转派请求（包含 from_user_id, to_user_id, task_ids）
        current_user: 当前登录用户（必须是管理员）
        db: 数据库会话
        
    Returns:
        TaskReassignResponse: 转派结果
    """
    # TODO: 添加管理员权限检查
    # if not current_user.is_admin:
    #     raise HTTPException(
    #         status_code=status.HTTP_403_FORBIDDEN,
    #         detail="仅管理员可执行任务转派操作"
    #     )
    
    try:
        result = await task_reassignment_service.reassign_tasks(
            db=db,
            from_user_id=request.from_user_id,
            to_user_id=request.to_user_id,
            task_ids=request.task_ids,
            operator_id=current_user.id
        )
        
        return result
        
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"任务转派失败: {str(e)}"
        )


@router.get(
    "/statistics",
    response_model=dict,
    summary="获取任务统计信息",
    description="""
    获取全局任务统计信息。
    
    统计维度：
    - 按部门统计待办任务数量
    - 按人员统计待办任务数量
    - 统计逾期任务清单
    
    用途：
    - 管理员监控团队整体工作负载
    - 识别流程瓶颈
    - 发现逾期风险
    
    权限要求：
    - 仅管理员可查看全局统计
    """
)
async def get_task_statistics(
    current_user: User = Depends(get_current_platform_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    获取任务统计信息
    
    Args:
        current_user: 当前登录用户（必须是管理员）
        db: 数据库会话
        
    Returns:
        dict: 包含按部门、按人员、逾期任务的统计信息
    """
    # TODO: 添加管理员权限检查
    # if not current_user.is_admin:
    #     raise HTTPException(
    #         status_code=status.HTTP_403_FORBIDDEN,
    #         detail="仅管理员可查看全局任务统计"
    #     )
    
    try:
        statistics = await task_reassignment_service.get_task_statistics(db)
        
        return statistics
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取任务统计失败: {str(e)}"
        )


