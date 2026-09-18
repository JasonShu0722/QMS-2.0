"""
操作日志管理 API
Operation Logs Admin API - 管理员查询操作日志
"""
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.dependencies import get_current_active_user
from app.models.user import User
from app.models.operation_log import OperationLog
from app.schemas.operation_log import (
    OperationLogListResponse,
    OperationLogResponse,
    OperationLogDetailResponse,
)


router = APIRouter(prefix="/operation-logs", tags=["操作日志管理"])


@router.get("", response_model=OperationLogListResponse)
async def get_operation_logs(
    user_id: Optional[int] = Query(None, description="按用户ID筛选"),
    operation_type: Optional[str] = Query(None, description="按操作类型筛选"),
    target_module: Optional[str] = Query(None, description="按目标模块筛选"),
    start_date: Optional[datetime] = Query(None, description="开始时间"),
    end_date: Optional[datetime] = Query(None, description="结束时间"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(50, ge=1, le=100, description="每页数量"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    获取操作日志列表
    
    支持按用户、操作类型、时间范围、目标模块筛选，并分页查询。
    
    **权限要求**: 管理员
    
    **查询参数**:
    - user_id: 按用户ID筛选
    - operation_type: 按操作类型筛选（create/update/delete）
    - target_module: 按目标模块筛选（users/permissions/suppliers等）
    - start_date: 开始时间（ISO 8601 格式）
    - end_date: 结束时间（ISO 8601 格式）
    - page: 页码（从1开始）
    - page_size: 每页数量（1-100）
    
    **返回**:
    - total: 总记录数
    - page: 当前页码
    - page_size: 每页数量
    - items: 日志列表
    """
    # TODO: 添加权限检查（仅管理员可访问）
    # 当前暂时允许所有已认证用户访问
    
    # 构建查询条件
    conditions = []
    
    if user_id is not None:
        conditions.append(OperationLog.user_id == user_id)
    
    if operation_type:
        conditions.append(OperationLog.operation_type == operation_type)
    
    if target_module:
        conditions.append(OperationLog.target_module == target_module)
    
    if start_date:
        conditions.append(OperationLog.created_at >= start_date)
    
    if end_date:
        conditions.append(OperationLog.created_at <= end_date)
    
    # 查询总数
    count_query = select(func.count(OperationLog.id))
    if conditions:
        count_query = count_query.where(and_(*conditions))
    
    result = await db.execute(count_query)
    total = result.scalar_one()
    
    # 查询日志列表（关联用户信息）
    query = (
        select(OperationLog)
        .options(selectinload(OperationLog.user))
        .order_by(OperationLog.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    
    if conditions:
        query = query.where(and_(*conditions))
    
    result = await db.execute(query)
    logs = result.scalars().all()
    
    # 构建响应数据
    items = []
    for log in logs:
        log_dict = log.to_dict()
        
        # 添加用户信息
        if log.user:
            log_dict["username"] = log.user.username
            log_dict["user_full_name"] = log.user.full_name
        else:
            log_dict["username"] = None
            log_dict["user_full_name"] = None
        
        items.append(OperationLogResponse(**log_dict))
    
    return OperationLogListResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=items,
    )


@router.get("/{log_id}", response_model=OperationLogDetailResponse)
async def get_operation_log_detail(
    log_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    获取操作日志详情
    
    展示数据变更 diff 对比（before_data vs after_data）。
    
    **权限要求**: 管理员
    
    **路径参数**:
    - log_id: 日志ID
    
    **返回**:
    - 日志详情，包含 data_diff 字段（数据变更对比）
    """
    # TODO: 添加权限检查（仅管理员可访问）
    
    # 查询日志（关联用户信息）
    query = (
        select(OperationLog)
        .options(selectinload(OperationLog.user))
        .where(OperationLog.id == log_id)
    )
    
    result = await db.execute(query)
    log = result.scalar_one_or_none()
    
    if not log:
        raise HTTPException(status_code=404, detail="操作日志不存在")
    
    # 构建响应数据
    log_dict = log.to_dict()
    
    # 添加用户信息
    if log.user:
        log_dict["username"] = log.user.username
        log_dict["user_full_name"] = log.user.full_name
    else:
        log_dict["username"] = None
        log_dict["user_full_name"] = None
    
    # 计算数据变更 diff
    data_diff = _calculate_diff(log.before_data, log.after_data)
    log_dict["data_diff"] = data_diff
    
    return OperationLogDetailResponse(**log_dict)


def _calculate_diff(before: Optional[dict], after: Optional[dict]) -> Optional[dict]:
    """
    计算数据变更 diff
    
    对比 before_data 和 after_data，返回变更的字段。
    
    Args:
        before: 操作前数据
        after: 操作后数据
        
    Returns:
        dict: 变更字段的对比
        {
            "added": {"field": "value"},  # 新增字段
            "removed": {"field": "value"},  # 删除字段
            "modified": {  # 修改字段
                "field": {
                    "old": "old_value",
                    "new": "new_value"
                }
            }
        }
    """
    if before is None and after is None:
        return None
    
    diff = {
        "added": {},
        "removed": {},
        "modified": {},
    }
    
    # 处理新增字段
    if after:
        for key, value in after.items():
            if before is None or key not in before:
                diff["added"][key] = value
    
    # 处理删除字段
    if before:
        for key, value in before.items():
            if after is None or key not in after:
                diff["removed"][key] = value
    
    # 处理修改字段
    if before and after:
        for key in set(before.keys()) & set(after.keys()):
            if before[key] != after[key]:
                diff["modified"][key] = {
                    "old": before[key],
                    "new": after[key],
                }
    
    # 如果没有任何变更，返回 None
    if not diff["added"] and not diff["removed"] and not diff["modified"]:
        return None
    
    return diff
