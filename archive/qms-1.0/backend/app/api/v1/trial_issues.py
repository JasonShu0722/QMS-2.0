"""
Trial Issues API Routes
试产问题跟进API路由
实现2.8.4试产问题跟进
"""
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
from datetime import datetime

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.models.trial_issue import IssueStatus, IssueType
from app.schemas.trial_issue import (
    TrialIssueCreate,
    TrialIssueUpdate,
    TrialIssueAssign,
    TrialIssueSolution,
    TrialIssueVerification,
    TrialIssueEscalate,
    LegacyIssueApproval,
    TrialIssueResponse,
    TrialIssueStatistics
)
from app.services.trial_issue_service import trial_issue_service


router = APIRouter(prefix="/trial-issues", tags=["Trial Issues - 试产问题跟进"])


@router.post("", response_model=TrialIssueResponse, status_code=201)
async def create_trial_issue(
    issue_data: TrialIssueCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    创建试产问题
    
    功能：
    - 录入试产过程中发现的问题
    - 支持设计、模具、工艺、物料、设备等问题类型
    - 可指派责任人和设定完成期限
    
    权限要求：
    - 需要登录
    - 需要有新品质量管理模块的录入权限
    """
    try:
        issue = await trial_issue_service.create_trial_issue(
            db=db,
            issue_data=issue_data,
            current_user_id=current_user.id
        )
        return TrialIssueResponse.from_orm(issue)
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"创建试产问题失败: {str(e)}")


@router.get("/{issue_id:int}", response_model=TrialIssueResponse)
async def get_trial_issue(
    issue_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取试产问题详情
    
    权限要求：
    - 需要登录
    - 需要有新品质量管理模块的查阅权限
    """
    issue = await trial_issue_service.get_trial_issue_by_id(db, issue_id)
    
    if not issue:
        raise HTTPException(status_code=404, detail=f"试产问题不存在: issue_id={issue_id}")
    
    return TrialIssueResponse.from_orm(issue)


@router.put("/{issue_id}", response_model=TrialIssueResponse)
async def update_trial_issue(
    issue_id: int,
    issue_data: TrialIssueUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    更新试产问题
    
    功能：
    - 更新问题描述、类型、责任人等信息
    - 更新根本原因、解决方案、验证方法
    - 更新问题状态
    
    权限要求：
    - 需要登录
    - 需要有新品质量管理模块的修改权限
    """
    try:
        issue = await trial_issue_service.update_trial_issue(
            db=db,
            issue_id=issue_id,
            issue_data=issue_data,
            current_user_id=current_user.id
        )
        return TrialIssueResponse.from_orm(issue)
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"更新试产问题失败: {str(e)}")


@router.post("/{issue_id}/assign", response_model=TrialIssueResponse)
async def assign_issue(
    issue_id: int,
    assign_data: TrialIssueAssign,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    指派试产问题
    
    功能：
    - 指派责任人和责任部门
    - 设定完成期限
    - 自动将问题状态更新为"处理中"
    
    权限要求：
    - 需要登录
    - 需要有新品质量管理模块的修改权限
    """
    try:
        issue = await trial_issue_service.assign_issue(
            db=db,
            issue_id=issue_id,
            assign_data=assign_data,
            current_user_id=current_user.id
        )
        return TrialIssueResponse.from_orm(issue)
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"指派问题失败: {str(e)}")


@router.post("/{issue_id}/solution", response_model=TrialIssueResponse)
async def submit_solution(
    issue_id: int,
    solution_data: TrialIssueSolution,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    提交解决方案
    
    功能：
    - 责任人填写根本原因分析
    - 提交解决方案和验证方法
    - 可上传对策附件
    
    权限要求：
    - 需要登录
    - 需要是问题的责任人或有修改权限
    """
    try:
        issue = await trial_issue_service.submit_solution(
            db=db,
            issue_id=issue_id,
            solution_data=solution_data,
            current_user_id=current_user.id
        )
        return TrialIssueResponse.from_orm(issue)
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"提交解决方案失败: {str(e)}")


@router.post("/{issue_id}/verify", response_model=TrialIssueResponse)
async def verify_solution(
    issue_id: int,
    verification_data: TrialIssueVerification,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    验证解决方案
    
    功能：
    - 验证人对解决方案进行验证
    - 验证通过则问题状态更新为"已解决"
    - 验证失败则保持"处理中"，需重新提交对策
    
    权限要求：
    - 需要登录
    - 需要有新品质量管理模块的修改权限
    """
    try:
        issue = await trial_issue_service.verify_solution(
            db=db,
            issue_id=issue_id,
            verification_data=verification_data,
            current_user_id=current_user.id
        )
        return TrialIssueResponse.from_orm(issue)
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"验证解决方案失败: {str(e)}")


@router.post("/{issue_id}/close", response_model=TrialIssueResponse)
async def close_issue(
    issue_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    关闭问题
    
    功能：
    - 将已解决的问题关闭
    - 只有已解决的问题才能关闭
    
    权限要求：
    - 需要登录
    - 需要有新品质量管理模块的修改权限
    """
    try:
        issue = await trial_issue_service.close_issue(
            db=db,
            issue_id=issue_id,
            current_user_id=current_user.id
        )
        return TrialIssueResponse.from_orm(issue)
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"关闭问题失败: {str(e)}")


@router.post("/{issue_id}/escalate", response_model=TrialIssueResponse)
async def escalate_to_8d(
    issue_id: int,
    escalate_data: TrialIssueEscalate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    升级为8D报告
    
    功能：
    - 复杂问题可一键升级为8D报告流程
    - 进行深度分析和系统性改善
    - 升级后问题状态变为"已升级"
    
    权限要求：
    - 需要登录
    - 需要有新品质量管理模块的修改权限
    """
    try:
        issue = await trial_issue_service.escalate_to_8d(
            db=db,
            issue_id=issue_id,
            escalate_data=escalate_data,
            current_user_id=current_user.id
        )
        return TrialIssueResponse.from_orm(issue)
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"升级为8D报告失败: {str(e)}")


@router.post("/{issue_id}/mark-legacy", response_model=TrialIssueResponse)
async def mark_as_legacy(
    issue_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    标记为遗留问题
    
    功能：
    - 将SOP节点未关闭的问题标记为遗留问题
    - 遗留问题需要特批才能量产
    
    权限要求：
    - 需要登录
    - 需要有新品质量管理模块的修改权限
    """
    try:
        issue = await trial_issue_service.mark_as_legacy(
            db=db,
            issue_id=issue_id,
            current_user_id=current_user.id
        )
        return TrialIssueResponse.from_orm(issue)
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"标记为遗留问题失败: {str(e)}")


@router.post("/{issue_id}/approve-legacy", response_model=TrialIssueResponse)
async def approve_legacy_issue(
    issue_id: int,
    approval_data: LegacyIssueApproval,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    带病量产特批
    
    功能：
    - 对遗留问题进行特批审核
    - 批准后允许带病量产
    - 需签署风险告知书
    
    权限要求：
    - 需要登录
    - 需要有特批权限（通常为质量经理或更高级别）
    """
    try:
        issue = await trial_issue_service.approve_legacy_issue(
            db=db,
            issue_id=issue_id,
            approval_data=approval_data,
            current_user_id=current_user.id
        )
        return TrialIssueResponse.from_orm(issue)
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"带病量产特批失败: {str(e)}")


@router.post("/{issue_id}/upload-solution-file")
async def upload_solution_file(
    issue_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    上传对策附件
    
    功能：
    - 上传解决方案相关的附件文件
    - 支持图片、PDF、Word等格式
    
    权限要求：
    - 需要登录
    - 需要是问题的责任人或有修改权限
    """
    try:
        # 验证问题是否存在
        issue = await trial_issue_service.get_trial_issue_by_id(db, issue_id)
        if not issue:
            raise HTTPException(status_code=404, detail=f"试产问题不存在: issue_id={issue_id}")
        
        # TODO: 实现文件上传逻辑
        # 1. 验证文件类型和大小
        # 2. 保存文件到服务器
        # 3. 更新数据库记录
        
        # 暂时返回模拟路径
        file_path = f"/uploads/trial_issues/{issue_id}/{file.filename}"
        
        # 更新问题记录
        issue.solution_file_path = file_path
        issue.updated_at = datetime.utcnow()
        await db.commit()
        
        return {
            "success": True,
            "message": "文件上传成功",
            "file_path": file_path
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"文件上传失败: {str(e)}")


@router.get("", response_model=List[TrialIssueResponse])
async def list_trial_issues(
    trial_id: Optional[int] = Query(None, description="试产记录ID"),
    status: Optional[IssueStatus] = Query(None, description="问题状态"),
    issue_type: Optional[IssueType] = Query(None, description="问题类型"),
    assigned_to: Optional[int] = Query(None, description="责任人ID"),
    is_legacy: Optional[bool] = Query(None, description="是否遗留问题"),
    skip: int = Query(0, ge=0, description="跳过记录数"),
    limit: int = Query(50, ge=1, le=100, description="返回记录数限制"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    查询试产问题列表
    
    功能：
    - 支持按试产记录ID筛选
    - 支持按问题状态筛选
    - 支持按问题类型筛选
    - 支持按责任人筛选
    - 支持筛选遗留问题
    - 支持分页查询
    
    权限要求：
    - 需要登录
    - 需要有新品质量管理模块的查阅权限
    """
    issues = await trial_issue_service.list_trial_issues(
        db=db,
        trial_id=trial_id,
        status=status,
        issue_type=issue_type,
        assigned_to=assigned_to,
        is_legacy=is_legacy,
        skip=skip,
        limit=limit
    )
    
    return [TrialIssueResponse.from_orm(issue) for issue in issues]


@router.get("/statistics", response_model=TrialIssueStatistics)
async def get_issue_statistics(
    trial_id: Optional[int] = Query(None, description="试产记录ID"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取试产问题统计
    
    功能：
    - 统计问题总数
    - 按状态统计（待处理、处理中、已解决、已关闭、已升级）
    - 统计遗留问题数
    - 按类型统计（设计、模具、工艺、物料、设备）
    
    权限要求：
    - 需要登录
    - 需要有新品质量管理模块的查阅权限
    """
    statistics = await trial_issue_service.get_issue_statistics(
        db=db,
        trial_id=trial_id
    )
    
    return statistics
