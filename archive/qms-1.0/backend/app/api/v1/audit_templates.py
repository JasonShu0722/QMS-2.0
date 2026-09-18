"""
审核模板 API 路由
Audit Template Routes - 审核模板库管理接口
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.audit_template import (
    AuditTemplateCreate,
    AuditTemplateUpdate,
    AuditTemplateResponse,
    AuditTemplateListResponse
)
from app.services.audit_template_service import AuditTemplateService

router = APIRouter(prefix="/audit-templates", tags=["审核模板管理"])


@router.post(
    "",
    response_model=AuditTemplateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建审核模板"
)
async def create_audit_template(
    template_data: AuditTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    创建自定义审核模板
    
    - **template_name**: 模板名称（唯一）
    - **audit_type**: 审核类型 (system_audit, process_audit, product_audit, custom)
    - **checklist_items**: 检查表条款列表 (JSON格式)
    - **scoring_rules**: 评分规则 (JSON格式)
    - **description**: 模板描述（可选）
    - **is_active**: 是否启用（默认true）
    
    注意：
    - 系统内置模板（VDA 6.3, VDA 6.5, IATF16949）不可修改
    - 自定义模板可用于专项审核（如：防静电专项审核、异物管理专项审核）
    """
    # 检查模板名称是否已存在
    existing_template = await AuditTemplateService.get_audit_template_by_name(
        db, template_data.template_name
    )
    if existing_template:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"模板名称 '{template_data.template_name}' 已存在"
        )
    
    audit_template = await AuditTemplateService.create_audit_template(
        db=db,
        template_data=template_data,
        created_by=current_user.id,
        is_builtin=False
    )
    
    return audit_template


@router.get(
    "",
    response_model=AuditTemplateListResponse,
    summary="获取审核模板库"
)
async def get_audit_templates(
    audit_type: Optional[str] = Query(None, description="审核类型筛选"),
    is_active: Optional[bool] = Query(None, description="是否启用筛选"),
    is_builtin: Optional[bool] = Query(None, description="是否内置模板筛选"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(50, ge=1, le=100, description="每页记录数"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取审核模板库（支持筛选和分页）
    
    支持按以下条件筛选：
    - 审核类型 (system_audit, process_audit, product_audit, custom)
    - 是否启用
    - 是否内置模板
    
    返回结果按以下顺序排序：
    1. 内置模板优先
    2. 创建时间倒序
    
    内置标准模板包括：
    - VDA 6.3 P2-P7 (过程审核)
    - VDA 6.5 (产品审核)
    - IATF 16949 (体系审核)
    """
    templates, total = await AuditTemplateService.get_audit_templates(
        db=db,
        audit_type=audit_type,
        is_active=is_active,
        is_builtin=is_builtin,
        page=page,
        page_size=page_size
    )
    
    return AuditTemplateListResponse(
        total=total,
        items=templates,
        page=page,
        page_size=page_size
    )


@router.get(
    "/{template_id}",
    response_model=AuditTemplateResponse,
    summary="获取审核模板详情"
)
async def get_audit_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    根据ID获取审核模板详情
    
    返回完整的模板信息，包括：
    - 检查表条款列表
    - 评分规则
    - 模板元数据
    """
    audit_template = await AuditTemplateService.get_audit_template_by_id(
        db=db,
        template_id=template_id
    )
    
    if not audit_template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"审核模板 ID {template_id} 不存在"
        )
    
    return audit_template


@router.put(
    "/{template_id}",
    response_model=AuditTemplateResponse,
    summary="更新审核模板"
)
async def update_audit_template(
    template_id: int,
    template_data: AuditTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    更新自定义审核模板
    
    注意：
    - 仅支持更新自定义模板
    - 系统内置模板（VDA 6.3, VDA 6.5, IATF16949）不可修改
    """
    try:
        audit_template = await AuditTemplateService.update_audit_template(
            db=db,
            template_id=template_id,
            template_data=template_data
        )
        
        if not audit_template:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"审核模板 ID {template_id} 不存在"
            )
        
        return audit_template
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.delete(
    "/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除审核模板"
)
async def delete_audit_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    删除自定义审核模板
    
    注意：
    - 仅支持删除自定义模板
    - 系统内置模板（VDA 6.3, VDA 6.5, IATF16949）不可删除
    - 如果模板已被审核执行记录引用，删除操作将失败
    """
    try:
        success = await AuditTemplateService.delete_audit_template(
            db=db,
            template_id=template_id
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"审核模板 ID {template_id} 不存在"
            )
        
        return None
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post(
    "/initialize-builtin",
    response_model=list[AuditTemplateResponse],
    summary="初始化内置标准模板"
)
async def initialize_builtin_templates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    初始化系统内置标准模板
    
    此接口用于首次部署时初始化以下标准模板：
    - VDA 6.3 P2-P7 (过程审核标准模板)
    - VDA 6.5 (产品审核标准模板)
    - IATF 16949 (体系审核标准模板)
    
    注意：
    - 如果模板已存在，将跳过创建
    - 仅系统管理员可调用此接口
    - 内置模板创建后不可修改或删除
    """
    # TODO: 添加权限检查，确保只有系统管理员可以调用
    
    created_templates = await AuditTemplateService.initialize_builtin_templates(
        db=db,
        created_by=current_user.id
    )
    
    return created_templates
