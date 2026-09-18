"""
权限配置管理 API
Admin Permissions API - 管理员用于配置角色标签权限的接口
"""
from __future__ import annotations

from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permission_catalog import OPERATION_SEQUENCE, PERMISSION_MODULE_CATALOG
from app.core.permissions import PermissionChecker
from app.core.platform_admin import get_current_platform_admin
from app.models.permission import OperationType, Permission
from app.models.role_permission import RolePermission
from app.models.role_tag import RoleTag
from app.models.user import User
from app.models.user_role_assignment import UserRoleAssignment
from app.schemas.permission import (
    PermissionGrantRequest,
    PermissionMatrixModule,
    PermissionMatrixResponse,
    PermissionMatrixRow,
    PermissionOperationResponse,
    PermissionResponse,
    PermissionRevokeRequest,
    UserPermissionDetailResponse,
)
from app.schemas.role_tag import (
    RolePermissionOperationResponse,
    RoleTagCreateRequest,
    RoleTemplateInitializationResponse,
    RoleTagOperationResponse,
    RoleTagPermissionUpdateRequest,
    RoleTagSummarySchema,
    RoleTagUpdateRequest,
)
from app.services.role_template_service import seed_default_role_templates


router = APIRouter(prefix="/admin/permissions", tags=["Admin - Permissions"])


def _build_modules() -> list[PermissionMatrixModule]:
    return [
        PermissionMatrixModule(
            module_path=item["module_path"],
            module_name=item["module_name"],
            group_key=item["group_key"],
            group_name=item["group_name"],
            operations=OPERATION_SEQUENCE,
        )
        for item in PERMISSION_MODULE_CATALOG
    ]


def _serialize_role_tag(role_tag: RoleTag, assigned_user_count: int = 0) -> RoleTagSummarySchema:
    return RoleTagSummarySchema(
        id=role_tag.id,
        role_key=role_tag.role_key,
        role_name=role_tag.role_name,
        description=role_tag.description,
        applicable_user_type=role_tag.applicable_user_type,
        is_active=role_tag.is_active,
        assigned_user_count=assigned_user_count,
        created_at=role_tag.created_at,
        updated_at=role_tag.updated_at,
    )


async def _load_role_summaries(
    db: AsyncSession,
    *,
    include_inactive: bool = True,
    applicable_user_type: str | None = None,
) -> list[RoleTagSummarySchema]:
    query = (
        select(RoleTag, func.count(UserRoleAssignment.id))
        .outerjoin(UserRoleAssignment, UserRoleAssignment.role_tag_id == RoleTag.id)
        .group_by(RoleTag.id)
        .order_by(RoleTag.is_active.desc(), RoleTag.role_key.asc())
    )

    if not include_inactive:
        query = query.where(RoleTag.is_active == True)
    if applicable_user_type:
        query = query.where(
            (RoleTag.applicable_user_type == applicable_user_type)
            | (RoleTag.applicable_user_type.is_(None))
        )

    result = await db.execute(query)
    return [
        _serialize_role_tag(role_tag, assigned_user_count=int(assigned_user_count or 0))
        for role_tag, assigned_user_count in result.all()
    ]


async def _get_role_tag_or_404(db: AsyncSession, role_id: int) -> RoleTag:
    result = await db.execute(select(RoleTag).where(RoleTag.id == role_id))
    role_tag = result.scalar_one_or_none()
    if not role_tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="角色标签不存在")
    return role_tag


async def _get_assigned_user_ids(db: AsyncSession, role_id: int) -> list[int]:
    result = await db.execute(
        select(UserRoleAssignment.user_id).where(UserRoleAssignment.role_tag_id == role_id)
    )
    return [user_id for user_id in result.scalars().all()]


@router.get(
    "/roles",
    response_model=List[RoleTagSummarySchema],
    summary="获取角色标签列表",
)
async def get_role_tags(
    include_inactive: bool = Query(True, description="是否包含停用角色"),
    applicable_user_type: str | None = Query(None, description="按适用用户类型筛选"),
    current_user: User = Depends(get_current_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    return await _load_role_summaries(
        db,
        include_inactive=include_inactive,
        applicable_user_type=applicable_user_type,
    )


@router.post(
    "/initialize-role-templates",
    response_model=RoleTemplateInitializationResponse,
    summary="初始化预设角色模板",
)
async def initialize_role_templates(
    current_user: User = Depends(get_current_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await seed_default_role_templates(db, actor_user_id=current_user.id)

    assigned_user_ids = (
        await db.execute(
            select(UserRoleAssignment.user_id)
            .join(RoleTag, RoleTag.id == UserRoleAssignment.role_tag_id)
            .where(RoleTag.role_key.in_(result.role_keys))
        )
    ).scalars().all()
    await PermissionChecker.clear_users_cache(assigned_user_ids)

    return RoleTemplateInitializationResponse(
        success=True,
        message=f"已完成预设角色初始化，本次新增 {result.created_roles} 个角色、{result.created_permissions} 条权限。",
        created_roles=result.created_roles,
        existing_roles=result.existing_roles,
        created_permissions=result.created_permissions,
        role_keys=result.role_keys,
    )


@router.post(
    "/roles",
    response_model=RoleTagSummarySchema,
    summary="创建角色标签",
)
async def create_role_tag(
    request: RoleTagCreateRequest,
    current_user: User = Depends(get_current_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    role_tag = RoleTag(
        role_key=request.role_key,
        role_name=request.role_name.strip(),
        description=request.description.strip() if request.description else None,
        applicable_user_type=request.applicable_user_type,
        is_active=request.is_active,
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(role_tag)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="角色唯一键已存在，请更换后重试",
        )

    await db.refresh(role_tag)
    return _serialize_role_tag(role_tag, assigned_user_count=0)


@router.put(
    "/roles/{role_id}",
    response_model=RoleTagSummarySchema,
    summary="更新角色标签",
)
async def update_role_tag(
    role_id: int,
    request: RoleTagUpdateRequest,
    current_user: User = Depends(get_current_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    role_tag = await _get_role_tag_or_404(db, role_id)
    assigned_user_ids = await _get_assigned_user_ids(db, role_id)

    role_tag.role_name = request.role_name.strip()
    role_tag.description = request.description.strip() if request.description else None
    role_tag.applicable_user_type = request.applicable_user_type
    role_tag.is_active = request.is_active
    role_tag.updated_by = current_user.id

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="角色标签更新失败，请检查数据后重试",
        )

    await db.refresh(role_tag)
    await PermissionChecker.clear_users_cache(assigned_user_ids)

    return _serialize_role_tag(role_tag, assigned_user_count=len(assigned_user_ids))


@router.delete(
    "/roles/{role_id}",
    response_model=RoleTagOperationResponse,
    summary="删除角色标签",
)
async def delete_role_tag(
    role_id: int,
    current_user: User = Depends(get_current_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    role_tag = await _get_role_tag_or_404(db, role_id)
    assigned_user_ids = await _get_assigned_user_ids(db, role_id)

    if assigned_user_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该角色标签已分配给用户，请先解除分配后再删除",
        )

    await db.delete(role_tag)
    await db.commit()

    return RoleTagOperationResponse(message="角色标签已删除", role_id=role_id)


@router.put(
    "/roles/{role_id}/permissions",
    response_model=RolePermissionOperationResponse,
    summary="批量更新角色标签权限",
)
async def update_role_permissions(
    role_id: int,
    request: RoleTagPermissionUpdateRequest,
    current_user: User = Depends(get_current_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    role_tag = await _get_role_tag_or_404(db, role_id)
    affected_permissions = 0

    for permission_item in request.permissions:
        stmt = select(RolePermission).where(
            and_(
                RolePermission.role_tag_id == role_id,
                RolePermission.module_path == permission_item.module_path,
                RolePermission.operation_type == permission_item.operation_type,
            )
        )
        result = await db.execute(stmt)
        role_permission = result.scalar_one_or_none()

        if role_permission:
            if role_permission.is_granted != permission_item.is_granted:
                role_permission.is_granted = permission_item.is_granted
                role_permission.updated_by = current_user.id
                affected_permissions += 1
        else:
            db.add(
                RolePermission(
                    role_tag_id=role_id,
                    module_path=permission_item.module_path,
                    operation_type=permission_item.operation_type,
                    is_granted=permission_item.is_granted,
                    created_by=current_user.id,
                    updated_by=current_user.id,
                )
            )
            affected_permissions += 1

    await db.commit()
    await PermissionChecker.clear_users_cache(await _get_assigned_user_ids(db, role_id))

    return RolePermissionOperationResponse(
        success=True,
        message=f"角色标签“{role_tag.role_name}”权限已更新",
        role_id=role_id,
        affected_permissions=affected_permissions,
    )


@router.get(
    "/matrix",
    response_model=PermissionMatrixResponse,
    summary="获取角色权限矩阵",
)
async def get_permission_matrix(
    include_inactive: bool = Query(True, description="是否包含停用角色"),
    applicable_user_type: str | None = Query(None, description="按适用用户类型筛选"),
    current_user: User = Depends(get_current_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    modules = _build_modules()
    role_summaries = await _load_role_summaries(
        db,
        include_inactive=include_inactive,
        applicable_user_type=applicable_user_type,
    )
    role_ids = [role.id for role in role_summaries]

    permission_map: Dict[int, Dict[str, bool]] = {}
    if role_ids:
        result = await db.execute(
            select(RolePermission)
            .where(RolePermission.role_tag_id.in_(role_ids))
        )
        for permission in result.scalars().all():
            permission_map.setdefault(permission.role_tag_id, {})[permission.permission_key] = bool(permission.is_granted)

    rows = [
        PermissionMatrixRow(
            role=role_summary,
            permissions={
                f"{module.module_path}.{operation}": permission_map.get(role_summary.id, {}).get(
                    f"{module.module_path}.{operation}",
                    False,
                )
                for module in modules
                for operation in module.operations
            },
        )
        for role_summary in role_summaries
    ]

    return PermissionMatrixResponse(modules=modules, rows=rows)


@router.put(
    "/grant",
    response_model=PermissionOperationResponse,
    summary="批量授予用户直连权限",
    description="保留兼容能力，推荐优先通过角色标签统一配置权限。",
)
async def grant_permissions(
    request: PermissionGrantRequest,
    current_user: User = Depends(get_current_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    affected_users = 0
    affected_permissions = 0

    for user_id in request.user_ids:
        user = await db.get(User, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"用户 ID {user_id} 不存在",
            )

        user_affected = False
        for perm_data in request.permissions:
            stmt = select(Permission).where(
                and_(
                    Permission.user_id == user_id,
                    Permission.module_path == perm_data["module_path"],
                    Permission.operation_type == perm_data["operation_type"],
                )
            )
            result = await db.execute(stmt)
            existing_perm = result.scalar_one_or_none()

            if existing_perm:
                if not existing_perm.is_granted:
                    existing_perm.is_granted = True
                    affected_permissions += 1
                    user_affected = True
            else:
                db.add(
                    Permission(
                        user_id=user_id,
                        module_path=perm_data["module_path"],
                        operation_type=perm_data["operation_type"],
                        is_granted=True,
                        created_by=current_user.id,
                    )
                )
                affected_permissions += 1
                user_affected = True

        if user_affected:
            affected_users += 1
            await PermissionChecker.clear_user_cache(user_id)

    await db.commit()

    return PermissionOperationResponse(
        success=True,
        message=f"成功授予权限给 {affected_users} 个用户，共 {affected_permissions} 条权限记录",
        affected_users=affected_users,
        affected_permissions=affected_permissions,
    )


@router.put(
    "/revoke",
    response_model=PermissionOperationResponse,
    summary="批量撤销用户直连权限",
    description="保留兼容能力，推荐优先通过角色标签统一配置权限。",
)
async def revoke_permissions(
    request: PermissionRevokeRequest,
    current_user: User = Depends(get_current_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    affected_users = 0
    affected_permissions = 0

    for user_id in request.user_ids:
        user = await db.get(User, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"用户 ID {user_id} 不存在",
            )

        user_affected = False
        for perm_data in request.permissions:
            stmt = select(Permission).where(
                and_(
                    Permission.user_id == user_id,
                    Permission.module_path == perm_data["module_path"],
                    Permission.operation_type == perm_data["operation_type"],
                )
            )
            result = await db.execute(stmt)
            existing_perm = result.scalar_one_or_none()
            if existing_perm and existing_perm.is_granted:
                existing_perm.is_granted = False
                affected_permissions += 1
                user_affected = True

        if user_affected:
            affected_users += 1
            await PermissionChecker.clear_user_cache(user_id)

    await db.commit()

    return PermissionOperationResponse(
        success=True,
        message=f"成功撤销 {affected_users} 个用户的权限，共 {affected_permissions} 条权限记录",
        affected_users=affected_users,
        affected_permissions=affected_permissions,
    )


@router.get(
    "/users/{user_id}",
    response_model=UserPermissionDetailResponse,
    summary="获取用户权限详情",
)
async def get_user_permissions(
    user_id: int,
    current_user: User = Depends(get_current_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"用户 ID {user_id} 不存在",
        )

    perm_result = await db.execute(select(Permission).where(Permission.user_id == user_id))
    permissions = perm_result.scalars().all()

    permission_responses = [
        PermissionResponse(
            id=perm.id,
            user_id=perm.user_id,
            module_path=perm.module_path,
            operation_type=perm.operation_type,
            is_granted=perm.is_granted,
            created_at=perm.created_at,
            updated_at=perm.updated_at,
        )
        for perm in permissions
    ]

    permission_tree = await PermissionChecker.get_user_permissions(user_id, db)

    return UserPermissionDetailResponse(
        user_id=user.id,
        username=user.username,
        full_name=user.full_name,
        user_type=user.user_type,
        permissions=permission_responses,
        permission_tree=permission_tree,
    )
