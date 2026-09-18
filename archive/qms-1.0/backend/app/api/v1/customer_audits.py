"""
客户审核管理 API
Customer Audit Management API - 客户来厂审核台账和问题跟踪
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.customer_audit import (
    CustomerAuditCreate,
    CustomerAuditUpdate,
    CustomerAuditResponse,
    CustomerAuditListResponse,
    CustomerAuditQuery,
    CustomerAuditIssueTaskCreate,
    CustomerAuditIssueTaskResponse
)
from app.services.customer_audit_service import CustomerAuditService
from app.services.audit_log_service import AuditLogService

router = APIRouter(prefix="/customer-audits", tags=["客户审核管理"])


@router.post(
    "",
    response_model=CustomerAuditResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建客户审核台账",
    description="""
    创建客户来厂审核台账记录。
    
    **功能说明**：
    - 记录客户审核的基本信息（客户名称、审核类型、审核日期、最终结果等）
    - 支持上传客户提供的问题整改清单（Excel等格式）
    - 支持上传审核报告文件
    - 自动记录创建人和创建时间
    
    **权限要求**：需要"客户审核管理-录入"权限
    """
)
async def create_customer_audit(
    audit_data: CustomerAuditCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """创建客户审核台账"""
    try:
        # 创建客户审核记录
        customer_audit = await CustomerAuditService.create_customer_audit(
            db=db,
            audit_data=audit_data,
            created_by=current_user.id
        )
        
        # 记录操作日志
        await AuditLogService.log_operation(
            db=db,
            user_id=current_user.id,
            operation_type="create",
            target_type="customer_audit",
            target_id=customer_audit.id,
            after_data=customer_audit.to_dict(),
            description=f"创建客户审核台账: {audit_data.customer_name}"
        )
        
        return customer_audit
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"创建客户审核台账失败: {str(e)}"
        )


@router.get(
    "",
    response_model=CustomerAuditListResponse,
    summary="获取客户审核台账列表",
    description="""
    查询客户审核台账列表，支持多条件筛选和分页。
    
    **查询条件**：
    - customer_name: 客户名称（模糊搜索）
    - audit_type: 审核类型
    - final_result: 最终结果
    - status: 状态
    - start_date: 开始日期
    - end_date: 结束日期
    
    **权限要求**：需要"客户审核管理-查阅"权限
    """
)
async def get_customer_audits(
    customer_name: str = None,
    audit_type: str = None,
    final_result: str = None,
    status: str = None,
    start_date: str = None,
    end_date: str = None,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取客户审核台账列表"""
    try:
        # 构建查询参数
        from datetime import datetime
        query_params = CustomerAuditQuery(
            customer_name=customer_name,
            audit_type=audit_type,
            final_result=final_result,
            status=status,
            start_date=datetime.fromisoformat(start_date) if start_date else None,
            end_date=datetime.fromisoformat(end_date) if end_date else None,
            page=page,
            page_size=page_size
        )
        
        # 查询客户审核列表
        audits, total = await CustomerAuditService.query_customer_audits(
            db=db,
            query_params=query_params
        )
        
        return CustomerAuditListResponse(
            total=total,
            items=[CustomerAuditResponse.model_validate(audit) for audit in audits]
        )
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"查询客户审核台账失败: {str(e)}"
        )


@router.get(
    "/{audit_id}",
    response_model=CustomerAuditResponse,
    summary="获取客户审核台账详情",
    description="""
    根据ID获取客户审核台账详细信息。
    
    **权限要求**：需要"客户审核管理-查阅"权限
    """
)
async def get_customer_audit(
    audit_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取客户审核台账详情"""
    customer_audit = await CustomerAuditService.get_customer_audit_by_id(db, audit_id)
    
    if not customer_audit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"客户审核记录不存在: {audit_id}"
        )
    
    return customer_audit


@router.put(
    "/{audit_id}",
    response_model=CustomerAuditResponse,
    summary="更新客户审核台账",
    description="""
    更新客户审核台账信息。
    
    **权限要求**：需要"客户审核管理-修改"权限
    """
)
async def update_customer_audit(
    audit_id: int,
    audit_data: CustomerAuditUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """更新客户审核台账"""
    # 获取原记录
    old_audit = await CustomerAuditService.get_customer_audit_by_id(db, audit_id)
    if not old_audit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"客户审核记录不存在: {audit_id}"
        )
    
    old_data = old_audit.to_dict()
    
    # 更新记录
    updated_audit = await CustomerAuditService.update_customer_audit(
        db=db,
        audit_id=audit_id,
        audit_data=audit_data
    )
    
    if not updated_audit:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="更新客户审核台账失败"
        )
    
    # 记录操作日志
    await AuditLogService.log_operation(
        db=db,
        user_id=current_user.id,
        operation_type="update",
        target_type="customer_audit",
        target_id=audit_id,
        before_data=old_data,
        after_data=updated_audit.to_dict(),
        description=f"更新客户审核台账: {updated_audit.customer_name}"
    )
    
    return updated_audit


@router.post(
    "/{audit_id}/issue-tasks",
    response_model=CustomerAuditIssueTaskResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建客户审核问题任务",
    description="""
    从客户问题清单创建内部闭环任务。
    
    **功能说明**：
    - 依据客户指摘问题清单，在系统内部创建对应的NC任务条目
    - 确保不遗漏任何一个客户提出的整改项
    - 自动将客户审核状态更新为"问题待关闭"
    - 支持指派责任部门和责任人
    - 设定整改期限和优先级
    
    **权限要求**：需要"客户审核管理-录入"权限
    """
)
async def create_customer_audit_issue_task(
    audit_id: int,
    task_data: CustomerAuditIssueTaskCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """创建客户审核问题任务"""
    try:
        # 验证audit_id与task_data中的customer_audit_id一致
        if task_data.customer_audit_id != audit_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="路径参数audit_id与请求体中的customer_audit_id不一致"
            )
        
        # 创建问题任务
        nc_task = await CustomerAuditService.create_issue_task_from_customer_audit(
            db=db,
            task_data=task_data,
            created_by=current_user.id
        )
        response = CustomerAuditService.build_issue_task_response(
            nc_task,
            customer_audit_id=audit_id,
            priority=task_data.priority,
        )
        
        # 记录操作日志
        await AuditLogService.log_operation(
            db=db,
            user_id=current_user.id,
            operation_type="create",
            target_type="customer_audit_issue_task",
            target_id=nc_task.id,
            after_data=response.model_dump(mode="json"),
            description=f"创建客户审核问题任务: {task_data.issue_description[:50]}"
        )
        
        return response
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"创建客户审核问题任务失败: {str(e)}"
        )


@router.get(
    "/{audit_id}/issue-tasks",
    response_model=List[CustomerAuditIssueTaskResponse],
    summary="获取客户审核问题任务列表",
    description="""
    获取指定客户审核关联的所有问题任务。
    
    **权限要求**：需要"客户审核管理-查阅"权限
    """
)
async def get_customer_audit_issue_tasks(
    audit_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取客户审核问题任务列表"""
    try:
        # 验证客户审核记录是否存在
        customer_audit = await CustomerAuditService.get_customer_audit_by_id(db, audit_id)
        if not customer_audit:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"客户审核记录不存在: {audit_id}"
            )
        
        # 获取问题任务列表
        tasks = await CustomerAuditService.get_customer_audit_issue_tasks(
            db=db,
            customer_audit_id=audit_id
        )
        
        return [
            CustomerAuditService.build_issue_task_response(
                task,
                customer_audit_id=audit_id,
            )
            for task in tasks
        ]
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取客户审核问题任务失败: {str(e)}"
        )


@router.post(
    "/{audit_id}/check-status",
    response_model=CustomerAuditResponse,
    summary="检查并更新客户审核状态",
    description="""
    检查客户审核的所有问题任务是否已关闭，并自动更新审核状态。
    
    **功能说明**：
    - 检查所有关联的问题任务是否已关闭
    - 如果所有问题已关闭，自动将客户审核状态更新为"问题已关闭"
    - 返回更新后的客户审核记录
    
    **权限要求**：需要"客户审核管理-查阅"权限
    """
)
async def check_customer_audit_status(
    audit_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """检查并更新客户审核状态"""
    try:
        customer_audit = await CustomerAuditService.auto_update_customer_audit_status(
            db=db,
            customer_audit_id=audit_id
        )
        
        if not customer_audit:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"客户审核记录不存在: {audit_id}"
            )
        
        return customer_audit
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"检查客户审核状态失败: {str(e)}"
        )
