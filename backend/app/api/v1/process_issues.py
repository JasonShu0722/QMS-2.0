"""
制程质量问题单 API 路由
ProcessIssue Routes - 制程质量问题发单与闭环管理
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db
from ...core.dependencies import get_current_user
from ...models.user import User
from ...models.process_issue import ProcessIssue
from ...schemas.process_issue import (
    ProcessIssueCreate,
    ProcessIssueResponse,
    ProcessIssueVerification,
    ProcessIssueClose,
    ProcessIssueFilter,
    ProcessIssueDetail,
    ProcessIssueListResponse,
    ProcessIssueCreateResponse,
    ProcessIssueOperationResponse
)
from ...services.process_issue_service import ProcessIssueService
from ...services.problem_management_service import ProblemManagementService

router = APIRouter(prefix="/process-issues", tags=["Process Issues - 制程质量问题管理"])


@router.post(
    "",
    response_model=ProcessIssueCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建制程问题单",
    description="""
    创建制程质量问题单
    
    **触发场景**：
    - 手动发起：PQE 从 2.4.3 报表或不良品清单发现异常，手动创建问题单
    - 自动触发：预留接口，未来可配置自动触发规则
    
    **权限要求**：
    - 需要有 process_quality.issue.create 权限
    
    **业务逻辑**：
    1. 生成问题单编号（格式：PQI-YYYYMMDD-XXXX）
    2. 根据责任类别指派给对应的责任板块担当
    3. 可关联多个不良品记录ID
    4. 初始状态为 OPEN（已开立）
    """
)
async def create_process_issue(
    issue_data: ProcessIssueCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """创建制程问题单"""
    try:
        # TODO: 权限检查
        # await check_permission(current_user.id, "process_quality.issue.create", db)
        
        # 创建问题单
        new_issue = await ProcessIssueService.create_issue(
            db=db,
            issue_data=issue_data,
            created_by=current_user.id
        )
        
        # TODO: 发送通知给被指派人
        # await NotificationService.send_notification(
        #     user_ids=[issue_data.assigned_to],
        #     title="新的制程问题单待处理",
        #     content=f"您有一个新的制程问题单 {new_issue.issue_number} 需要处理",
        #     notification_type="workflow",
        #     link=f"/process-quality/issues/{new_issue.id}"
        # )
        
        problem_report = None
        if new_issue.problem_report_id:
            problem_report = await ProblemManagementService.get_report_by_id(db, new_issue.problem_report_id)

        return ProcessIssueCreateResponse(
            id=new_issue.id,
            issue_number=new_issue.issue_number,
            problem_report_id=new_issue.problem_report_id,
            problem_number=problem_report.problem_number if problem_report else None,
            eight_d_number=problem_report.eight_d_number if problem_report else None,
            risk_level=ProblemManagementService._enum_value(problem_report.risk_level) if problem_report else None,
            response_mode=problem_report.response_mode if problem_report else None,
            message="制程问题单创建成功"
        )
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"创建问题单失败: {str(e)}"
        )


@router.get(
    "",
    response_model=ProcessIssueListResponse,
    summary="查询制程问题单列表",
    description="""
    查询制程问题单列表（支持多条件筛选和分页）
    
    **筛选条件**：
    - status: 问题单状态
    - responsibility_category: 责任类别
    - assigned_to: 当前处理人ID
    - created_by: 发起人ID
    - is_overdue: 是否逾期
    - start_date/end_date: 创建日期范围
    
    **权限要求**：
    - 需要有 process_quality.issue.read 权限
    """
)
async def get_process_issues(
    status: str = None,
    responsibility_category: str = None,
    assigned_to: int = None,
    created_by: int = None,
    is_overdue: bool = None,
    start_date: str = None,
    end_date: str = None,
    page: int = 1,
    page_size: int = 20,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """查询制程问题单列表"""
    try:
        # TODO: 权限检查
        # await check_permission(current_user.id, "process_quality.issue.read", db)
        
        # 构建过滤器
        from datetime import date as date_type
        filters = ProcessIssueFilter(
            status=status,
            responsibility_category=responsibility_category,
            assigned_to=assigned_to,
            created_by=created_by,
            is_overdue=is_overdue,
            start_date=date_type.fromisoformat(start_date) if start_date else None,
            end_date=date_type.fromisoformat(end_date) if end_date else None,
            page=page,
            page_size=page_size
        )
        
        # 查询问题单
        issues, total = await ProcessIssueService.query_issues(db, filters)
        
        # 转换为响应模型
        items = []
        for issue in issues:
            issue_dict = issue.to_dict()
            issue_dict["is_overdue"] = issue.is_overdue()
            items.append(ProcessIssueDetail(**issue_dict))
        
        return ProcessIssueListResponse(
            total=total,
            page=page,
            page_size=page_size,
            items=items
        )
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"查询问题单列表失败: {str(e)}"
        )


@router.get(
    "/{issue_id}",
    response_model=ProcessIssueDetail,
    summary="获取制程问题单详情",
    description="""
    根据ID获取制程问题单详情
    
    **权限要求**：
    - 需要有 process_quality.issue.read 权限
    """
)
async def get_process_issue_detail(
    issue_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取制程问题单详情"""
    try:
        # TODO: 权限检查
        # await check_permission(current_user.id, "process_quality.issue.read", db)
        
        issue = await ProcessIssueService.get_issue_by_id(db, issue_id)
        
        if not issue:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"问题单 ID {issue_id} 不存在"
            )
        
        issue_dict = issue.to_dict()
        issue_dict["is_overdue"] = issue.is_overdue()
        
        return ProcessIssueDetail(**issue_dict)
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取问题单详情失败: {str(e)}"
        )


@router.post(
    "/{issue_id}/response",
    response_model=ProcessIssueOperationResponse,
    summary="责任板块填写分析和对策",
    description="""
    责任板块填写根本原因分析和纠正措施
    
    **执行流程**：
    1. 责任板块担当填写：
       - 根本原因分析（必填，最少20字）
       - 围堵措施（必填，最少10字）
       - 纠正措施（必填，最少20字）
       - 验证期（必填，1-90天）
       - 改善证据附件（可选）
    2. 系统自动计算验证开始日期和结束日期
    3. 状态更新为 IN_VERIFICATION（验证中）
    
    **权限要求**：
    - 只有被指派的责任人才能填写
    - 只有 OPEN 或 IN_ANALYSIS 状态才能填写
    """
)
async def submit_issue_response(
    issue_id: int,
    response_data: ProcessIssueResponse,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """责任板块填写分析和对策"""
    try:
        # 提交响应
        updated_issue = await ProcessIssueService.submit_response(
            db=db,
            issue_id=issue_id,
            response_data=response_data,
            user_id=current_user.id
        )
        
        # TODO: 发送通知给PQE
        # await NotificationService.send_notification(
        #     user_ids=[updated_issue.created_by],
        #     title="制程问题单对策已提交",
        #     content=f"问题单 {updated_issue.issue_number} 的对策已提交，请验证",
        #     notification_type="workflow",
        #     link=f"/process-quality/issues/{updated_issue.id}"
        # )
        
        return ProcessIssueOperationResponse(
            success=True,
            message="分析和对策提交成功，进入验证期",
            issue_number=updated_issue.issue_number
        )
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"提交分析和对策失败: {str(e)}"
        )


@router.post(
    "/{issue_id}/verify",
    response_model=ProcessIssueOperationResponse,
    summary="PQE 验证对策有效性",
    description="""
    PQE 验证对策有效性
    
    **验证逻辑**：
    1. 检查是否在验证期内（必须等待验证期结束）
    2. 验证通过：问题单保持 IN_VERIFICATION 状态，等待关闭
    3. 验证不通过：退回到 IN_ANALYSIS 状态，需要重新填写对策
    
    **权限要求**：
    - 需要有 process_quality.issue.verify 权限
    - 只有 IN_VERIFICATION 状态才能验证
    """
)
async def verify_issue(
    issue_id: int,
    verification_data: ProcessIssueVerification,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """PQE 验证对策有效性"""
    try:
        # TODO: 权限检查
        # await check_permission(current_user.id, "process_quality.issue.verify", db)
        
        # 验证对策
        updated_issue = await ProcessIssueService.verify_issue(
            db=db,
            issue_id=issue_id,
            verification_data=verification_data,
            verified_by=current_user.id
        )
        
        if verification_data.verification_result:
            message = "对策验证通过，可以关闭问题单"
            # TODO: 发送通知
        else:
            message = "对策验证不通过，已退回重新分析"
            # TODO: 发送通知给责任人
        
        return ProcessIssueOperationResponse(
            success=True,
            message=message,
            issue_number=updated_issue.issue_number
        )
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"验证对策失败: {str(e)}"
        )


@router.post(
    "/{issue_id}/close",
    response_model=ProcessIssueOperationResponse,
    summary="关闭问题单",
    description="""
    关闭制程问题单
    
    **关闭条件**：
    1. 问题单状态必须为 IN_VERIFICATION（验证中）
    2. 必须已经过 PQE 验证（verified_by 不为空）
    3. 验证结果为通过
    
    **权限要求**：
    - 需要有 process_quality.issue.close 权限
    """
)
async def close_issue(
    issue_id: int,
    close_data: ProcessIssueClose,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """关闭问题单"""
    try:
        # TODO: 权限检查
        # await check_permission(current_user.id, "process_quality.issue.close", db)
        
        # 关闭问题单
        updated_issue = await ProcessIssueService.close_issue(
            db=db,
            issue_id=issue_id,
            close_data=close_data,
            closed_by=current_user.id
        )
        
        # TODO: 发送通知给相关人员
        # await NotificationService.send_notification(
        #     user_ids=[updated_issue.created_by, updated_issue.assigned_to],
        #     title="制程问题单已关闭",
        #     content=f"问题单 {updated_issue.issue_number} 已关闭",
        #     notification_type="workflow",
        #     link=f"/process-quality/issues/{updated_issue.id}"
        # )
        
        return ProcessIssueOperationResponse(
            success=True,
            message="问题单已成功关闭",
            issue_number=updated_issue.issue_number
        )
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"关闭问题单失败: {str(e)}"
        )


@router.get(
    "/my/pending",
    response_model=List[ProcessIssueDetail],
    summary="获取我的待处理问题单",
    description="""
    获取当前用户待处理的制程问题单
    
    **返回条件**：
    - assigned_to = 当前用户ID
    - status in [OPEN, IN_ANALYSIS, IN_VERIFICATION]
    
    **排序规则**：
    - 按验证结束日期升序排列（逾期的排在前面）
    """
)
async def get_my_pending_issues(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取我的待处理问题单"""
    try:
        issues = await ProcessIssueService.get_user_pending_issues(
            db=db,
            user_id=current_user.id
        )
        
        # 转换为响应模型
        items = []
        for issue in issues:
            issue_dict = issue.to_dict()
            issue_dict["is_overdue"] = issue.is_overdue()
            items.append(ProcessIssueDetail(**issue_dict))
        
        return items
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取待处理问题单失败: {str(e)}"
        )
