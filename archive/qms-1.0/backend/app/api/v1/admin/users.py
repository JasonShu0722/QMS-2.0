"""
用户管理 API 路由
Admin User Management - 管理员用户审核、清单治理、角色分配等操作
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_strategy import LocalAuthStrategy
from app.core.database import get_db
from app.core.permissions import PermissionChecker
from app.core.platform_admin import get_current_platform_admin, is_platform_admin
from app.models.role_tag import RoleTag
from app.models.supplier import Supplier, SupplierStatus
from app.models.user import User, UserStatus
from app.models.user_role_assignment import UserRoleAssignment
from app.schemas.admin import (
    AdminBulkUserCreateItem,
    AdminBulkUserCreateItemResponse,
    AdminBulkUserCreateRequest,
    AdminBulkUserCreateResponse,
    AdminUserCreateRequest,
    AdminUserCreateResponse,
    PasswordResetResponse,
    UserActionResponse,
    UserApprovalRequest,
    UserFreezeRequest,
    UserRoleAssignmentRequest,
    UserUpdateRequest,
)
from app.schemas.user import UserResponseSchema
from app.services.notification_service import notification_service
from app.services.user_session_service import build_user_response, build_user_responses


router = APIRouter(prefix="/admin/users", tags=["Admin - User Management"])


async def _get_user_or_404(db: AsyncSession, user_id: int) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    return user


async def _get_role_tags_or_404(db: AsyncSession, role_tag_ids: list[int]) -> list[RoleTag]:
    if not role_tag_ids:
        return []

    result = await db.execute(
        select(RoleTag).where(RoleTag.id.in_(role_tag_ids)).order_by(RoleTag.role_name.asc())
    )
    role_tags = result.scalars().all()

    found_ids = {role.id for role in role_tags}
    missing_ids = sorted(set(role_tag_ids) - found_ids)
    if missing_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"角色标签不存在: {', '.join(str(item) for item in missing_ids)}",
        )

    return role_tags


def _normalize_optional_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _validate_role_tags_active(role_tags: list[RoleTag]) -> None:
    inactive_roles = [role.role_name for role in role_tags if not role.is_active]
    if inactive_roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"以下角色标签已停用，无法分配: {', '.join(inactive_roles)}",
        )


def _validate_role_applicable_user_type(user_type: str, role_tags: list[RoleTag]) -> None:
    incompatible_roles = [
        role.role_name
        for role in role_tags
        if role.applicable_user_type and role.applicable_user_type != user_type
    ]
    if incompatible_roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"以下角色标签不适用于当前用户类型: {', '.join(incompatible_roles)}",
        )


def _normalize_user_type_value(user_type: object) -> str:
    if hasattr(user_type, "value"):
        return str(getattr(user_type, "value"))
    return str(user_type)


def _validate_role_assignment(user: User, role_tags: list[RoleTag]) -> None:
    _validate_role_tags_active(role_tags)
    _validate_role_applicable_user_type(_normalize_user_type_value(user.user_type), role_tags)


def _validate_user_profile_requirements(
    *,
    user_type: str,
    department: Optional[str],
    supplier_identifier: Optional[str],
    row_label: str,
) -> None:
    if user_type == "internal" and not _normalize_optional_text(department):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{row_label}必须填写部门",
        )

    if user_type == "supplier" and not _normalize_optional_text(supplier_identifier):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{row_label}必须指定供应商",
        )


async def _resolve_supplier_id(
    db: AsyncSession,
    supplier_identifier: str,
    *,
    row_label: str,
) -> int:
    normalized_identifier = supplier_identifier.strip()
    if not normalized_identifier:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{row_label}必须指定供应商")

    code_result = await db.execute(
        select(Supplier).where(Supplier.code.ilike(normalized_identifier)).limit(1)
    )
    supplier = code_result.scalar_one_or_none()

    if supplier is None and normalized_identifier.isdigit():
        id_result = await db.execute(
            select(Supplier).where(Supplier.id == int(normalized_identifier)).limit(1)
        )
        supplier = id_result.scalar_one_or_none()

    if supplier is None:
        name_result = await db.execute(
            select(Supplier).where(Supplier.name.ilike(normalized_identifier))
        )
        suppliers = name_result.scalars().all()
        if len(suppliers) > 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"{row_label}匹配到多个同名供应商：{normalized_identifier}，"
                    "请改用唯一的供应商代码"
                ),
            )
        supplier = suppliers[0] if suppliers else None

    if not supplier:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{row_label}未找到供应商：{normalized_identifier}",
        )

    if supplier.status != SupplierStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{row_label}供应商 {supplier.name} 当前状态为 {supplier.status}，无法创建账号",
        )

    return supplier.id


async def _ensure_single_user_unique(
    db: AsyncSession,
    *,
    username: str,
    email: str,
) -> None:
    result = await db.execute(
        select(User).where(or_(User.username == username, User.email == email))
    )
    existing_users = result.scalars().all()

    for existing_user in existing_users:
        if existing_user.username == username:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"用户名已存在：{username}")
        if existing_user.email == email:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"邮箱已存在：{email}")


async def _collect_batch_uniqueness_errors(
    db: AsyncSession,
    items: list[AdminBulkUserCreateItem],
) -> list[str]:
    errors: list[str] = []
    username_rows: dict[str, int] = {}
    email_rows: dict[str, int] = {}

    for row_number, item in enumerate(items, start=1):
        normalized_username = item.username.strip()
        normalized_email = item.email.strip().lower()

        if normalized_username in username_rows:
            errors.append(f"第 {row_number} 行用户名与第 {username_rows[normalized_username]} 行重复")
        else:
            username_rows[normalized_username] = row_number

        if normalized_email in email_rows:
            errors.append(f"第 {row_number} 行邮箱与第 {email_rows[normalized_email]} 行重复")
        else:
            email_rows[normalized_email] = row_number

    if not username_rows and not email_rows:
        return errors

    result = await db.execute(
        select(User.username, User.email).where(
            or_(
                User.username.in_(list(username_rows.keys())),
                User.email.in_(list(email_rows.keys())),
            )
        )
    )

    for username, email in result.all():
        if username in username_rows:
            errors.append(f"第 {username_rows[username]} 行用户名已存在：{username}")
        if email and email.lower() in email_rows:
            errors.append(f"第 {email_rows[email.lower()]} 行邮箱已存在：{email}")

    return errors


async def _assign_role_tags_to_user(
    db: AsyncSession,
    *,
    user_id: int,
    role_tags: list[RoleTag],
    assigned_by: int,
) -> None:
    for role_tag in role_tags:
        db.add(
            UserRoleAssignment(
                user_id=user_id,
                role_tag_id=role_tag.id,
                assigned_by=assigned_by,
            )
        )


def _guard_high_risk_account_action(
    *,
    target_user: User,
    current_user: User,
    action_label: str,
    protect_bootstrap: bool = True,
) -> None:
    if target_user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不能{action_label}当前登录账号",
        )

    if protect_bootstrap and is_platform_admin(target_user):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不能{action_label}超级管理员 bootstrap 账号",
        )


@router.get(
    "/pending",
    response_model=List[UserResponseSchema],
    summary="获取待审核用户列表",
)
async def get_pending_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_platform_admin),
):
    result = await db.execute(
        select(User)
        .where(User.status == UserStatus.PENDING)
        .order_by(User.created_at.desc())
    )
    return await build_user_responses(db, result.scalars().all())


@router.get(
    "",
    response_model=List[UserResponseSchema],
    summary="获取用户清单",
    description="用户清单默认聚焦审批后的账号治理能力，不展示待审核列表。",
)
async def get_users(
    keyword: Optional[str] = Query(None, description="关键字，按用户名/姓名/邮箱模糊搜索"),
    department: Optional[str] = Query(None, description="部门筛选"),
    position: Optional[str] = Query(None, description="岗位筛选"),
    user_type: Optional[str] = Query(None, description="用户类型筛选（internal/supplier）"),
    status_filter: Optional[str] = Query(None, alias="status", description="状态筛选"),
    role_tag_id: Optional[int] = Query(None, description="角色标签筛选"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_platform_admin),
):
    query = select(User).where(User.status != UserStatus.PENDING)

    if keyword:
        like_value = f"%{keyword.strip()}%"
        query = query.where(
            or_(
                User.username.ilike(like_value),
                User.full_name.ilike(like_value),
                User.email.ilike(like_value),
            )
        )

    if department:
        query = query.where(User.department.ilike(f"%{department.strip()}%"))

    if position:
        query = query.where(User.position.ilike(f"%{position.strip()}%"))

    if user_type:
        query = query.where(User.user_type == user_type)

    if status_filter:
        query = query.where(User.status == status_filter)

    if role_tag_id:
        query = query.join(UserRoleAssignment, UserRoleAssignment.user_id == User.id).where(
            UserRoleAssignment.role_tag_id == role_tag_id
        )

    query = query.order_by(User.created_at.desc()).distinct()

    result = await db.execute(query)
    return await build_user_responses(db, result.scalars().all())


@router.post(
    "",
    response_model=AdminUserCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="单条创建用户",
)
async def create_user(
    request: AdminUserCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_platform_admin),
):
    role_tags = await _get_role_tags_or_404(db, request.role_tag_ids)
    _validate_role_tags_active(role_tags)
    _validate_role_applicable_user_type(request.user_type, role_tags)
    _validate_user_profile_requirements(
        user_type=request.user_type,
        department=request.department,
        supplier_identifier=request.supplier_identifier,
        row_label="当前用户",
    )

    username = request.username.strip()
    email = request.email.strip().lower()
    await _ensure_single_user_unique(db, username=username, email=email)

    supplier_id = None
    if request.user_type == "supplier":
        supplier_id = await _resolve_supplier_id(
            db,
            request.supplier_identifier or "",
            row_label="当前用户",
        )

    temporary_password = notification_service.generate_temporary_password()
    auth_strategy = LocalAuthStrategy()
    password_hash = auth_strategy.hash_password(temporary_password)

    created_user = User(
        username=username,
        password_hash=password_hash,
        full_name=request.full_name.strip(),
        email=email,
        phone=_normalize_optional_text(request.phone),
        user_type=request.user_type,
        status=UserStatus.ACTIVE,
        department=_normalize_optional_text(request.department) if request.user_type == "internal" else None,
        position=_normalize_optional_text(request.position),
        supplier_id=supplier_id,
        allowed_environments=request.allowed_environments,
        password_changed_at=None,
        created_by=current_user.id,
        updated_by=current_user.id,
    )

    db.add(created_user)
    await db.flush()
    await _assign_role_tags_to_user(
        db,
        user_id=created_user.id,
        role_tags=role_tags,
        assigned_by=current_user.id,
    )
    await db.commit()
    await db.refresh(created_user)
    await PermissionChecker.clear_user_cache(created_user.id)

    response_user = await build_user_response(db, created_user)
    email_sent = await notification_service.send_password_reset_notification(
        created_user,
        temporary_password,
    )

    return AdminUserCreateResponse(
        message="用户创建成功",
        user=response_user,
        temporary_password=temporary_password,
        email_sent=email_sent,
    )


@router.post(
    "/bulk",
    response_model=AdminBulkUserCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="批量创建用户",
)
async def bulk_create_users(
    request: AdminBulkUserCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_platform_admin),
):
    role_tags = await _get_role_tags_or_404(db, request.role_tag_ids)
    _validate_role_tags_active(role_tags)
    _validate_role_applicable_user_type(request.user_type, role_tags)

    errors = await _collect_batch_uniqueness_errors(db, request.items)
    prepared_items: list[tuple[int, AdminBulkUserCreateItem, Optional[int]]] = []

    for row_number, item in enumerate(request.items, start=1):
        row_label = f"第 {row_number} 行"
        try:
            _validate_user_profile_requirements(
                user_type=request.user_type,
                department=item.department,
                supplier_identifier=item.supplier_identifier,
                row_label=row_label,
            )

            supplier_id = None
            if request.user_type == "supplier":
                supplier_id = await _resolve_supplier_id(
                    db,
                    item.supplier_identifier or "",
                    row_label=row_label,
                )

            prepared_items.append((row_number, item, supplier_id))
        except HTTPException as exc:
            errors.append(str(exc.detail))

    if errors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="批量创建校验失败：" + "；".join(errors),
        )

    auth_strategy = LocalAuthStrategy()
    created_records: list[tuple[int, User, str]] = []

    for row_number, item, supplier_id in prepared_items:
        temporary_password = notification_service.generate_temporary_password()
        password_hash = auth_strategy.hash_password(temporary_password)

        created_user = User(
            username=item.username.strip(),
            password_hash=password_hash,
            full_name=item.full_name.strip(),
            email=item.email.strip().lower(),
            phone=_normalize_optional_text(item.phone),
            user_type=request.user_type,
            status=UserStatus.ACTIVE,
            department=_normalize_optional_text(item.department) if request.user_type == "internal" else None,
            position=_normalize_optional_text(item.position),
            supplier_id=supplier_id,
            allowed_environments=request.allowed_environments,
            password_changed_at=None,
            created_by=current_user.id,
            updated_by=current_user.id,
        )

        db.add(created_user)
        await db.flush()
        await _assign_role_tags_to_user(
            db,
            user_id=created_user.id,
            role_tags=role_tags,
            assigned_by=current_user.id,
        )
        created_records.append((row_number, created_user, temporary_password))

    await db.commit()

    created_users = [item[1] for item in created_records]
    response_users = await build_user_responses(db, created_users)
    response_user_map = {user.id: user for user in response_users}

    results: list[AdminBulkUserCreateItemResponse] = []
    for row_number, created_user, temporary_password in created_records:
        await PermissionChecker.clear_user_cache(created_user.id)
        email_sent = await notification_service.send_password_reset_notification(
            created_user,
            temporary_password,
        )
        results.append(
            AdminBulkUserCreateItemResponse(
                row_number=row_number,
                user=response_user_map[created_user.id],
                temporary_password=temporary_password,
                email_sent=email_sent,
            )
        )

    return AdminBulkUserCreateResponse(
        message=f"批量创建完成，共创建 {len(results)} 个用户",
        total_count=len(request.items),
        created_count=len(results),
        results=results,
    )


@router.patch(
    "/{user_id}",
    response_model=UserResponseSchema,
    summary="更新用户基本信息",
)
async def update_user(
    user_id: int,
    request: UserUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_platform_admin),
):
    user = await _get_user_or_404(db, user_id)

    update_values = {
        "full_name": request.full_name.strip(),
        "email": request.email,
        "phone": request.phone.strip() if request.phone else None,
        "position": request.position.strip() if request.position else None,
        "allowed_environments": request.allowed_environments,
        "updated_at": datetime.utcnow(),
        "updated_by": current_user.id,
    }

    if user.user_type == "internal":
        update_values["department"] = request.department.strip() if request.department else None
    else:
        update_values["department"] = None

    await db.execute(update(User).where(User.id == user_id).values(**update_values))
    await db.commit()
    await PermissionChecker.clear_user_cache(user_id)

    updated_user = await _get_user_or_404(db, user_id)
    return await build_user_response(db, updated_user)


@router.put(
    "/{user_id}/roles",
    response_model=UserResponseSchema,
    summary="分配用户角色标签",
)
async def assign_user_roles(
    user_id: int,
    request: UserRoleAssignmentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_platform_admin),
):
    user = await _get_user_or_404(db, user_id)
    role_tags = await _get_role_tags_or_404(db, request.role_tag_ids)
    _validate_role_assignment(user, role_tags)

    await db.execute(delete(UserRoleAssignment).where(UserRoleAssignment.user_id == user_id))
    for role_tag in role_tags:
        db.add(
            UserRoleAssignment(
                user_id=user_id,
                role_tag_id=role_tag.id,
                assigned_by=current_user.id,
            )
        )

    await db.commit()
    await PermissionChecker.clear_user_cache(user_id)

    updated_user = await _get_user_or_404(db, user_id)
    return await build_user_response(db, updated_user)


@router.post(
    "/{user_id}/approve",
    response_model=UserActionResponse,
    summary="批准用户注册",
)
async def approve_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_platform_admin),
):
    user = await _get_user_or_404(db, user_id)

    if user.status != UserStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"用户状态为 {user.status}，无法批准",
        )

    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(
            status=UserStatus.ACTIVE,
            updated_at=datetime.utcnow(),
            updated_by=current_user.id,
        )
    )
    await db.commit()
    await db.refresh(user)

    email_sent = await notification_service.send_approval_notification(user)

    return UserActionResponse(
        message="用户已批准",
        user_id=user.id,
        username=user.username,
        status=user.status,
        email_sent=email_sent,
    )


@router.post(
    "/{user_id}/reject",
    response_model=UserActionResponse,
    summary="拒绝用户注册",
)
async def reject_user(
    user_id: int,
    request: UserApprovalRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_platform_admin),
):
    if not request.reason or not request.reason.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="拒绝用户时必须填写拒绝原因",
        )

    user = await _get_user_or_404(db, user_id)

    if user.status != UserStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"用户状态为 {user.status}，无法拒绝",
        )

    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(
            status=UserStatus.REJECTED,
            updated_at=datetime.utcnow(),
            updated_by=current_user.id,
        )
    )
    await db.commit()
    await db.refresh(user)

    email_sent = await notification_service.send_rejection_notification(user, request.reason)

    return UserActionResponse(
        message=f"用户已拒绝：{request.reason}",
        user_id=user.id,
        username=user.username,
        status=user.status,
        email_sent=email_sent,
    )


@router.post(
    "/{user_id}/freeze",
    response_model=UserActionResponse,
    summary="冻结用户账号",
)
async def freeze_user(
    user_id: int,
    request: UserFreezeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_platform_admin),
):
    user = await _get_user_or_404(db, user_id)
    _guard_high_risk_account_action(
        target_user=user,
        current_user=current_user,
        action_label="冻结",
    )

    if user.status == UserStatus.FROZEN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户已处于冻结状态",
        )

    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(
            status=UserStatus.FROZEN,
            updated_at=datetime.utcnow(),
            updated_by=current_user.id,
        )
    )
    await db.commit()
    await db.refresh(user)
    await PermissionChecker.clear_user_cache(user_id)

    reason_msg = f"：{request.reason}" if request.reason else ""
    return UserActionResponse(
        message=f"用户已冻结{reason_msg}",
        user_id=user.id,
        username=user.username,
        status=user.status,
        email_sent=False,
    )


@router.post(
    "/{user_id}/unfreeze",
    response_model=UserActionResponse,
    summary="解冻用户账号",
)
async def unfreeze_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_platform_admin),
):
    user = await _get_user_or_404(db, user_id)

    if user.status != UserStatus.FROZEN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"用户状态为 {user.status}，无法解冻",
        )

    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(
            status=UserStatus.ACTIVE,
            updated_at=datetime.utcnow(),
            updated_by=current_user.id,
        )
    )
    await db.commit()
    await db.refresh(user)
    await PermissionChecker.clear_user_cache(user_id)

    return UserActionResponse(
        message="用户已解冻",
        user_id=user.id,
        username=user.username,
        status=user.status,
        email_sent=False,
    )


@router.post(
    "/{user_id}/reset-password",
    response_model=PasswordResetResponse,
    summary="重置用户密码",
)
async def reset_user_password(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_platform_admin),
):
    user = await _get_user_or_404(db, user_id)

    temporary_password = notification_service.generate_temporary_password()
    auth_strategy = LocalAuthStrategy()
    hashed_password = auth_strategy.hash_password(temporary_password)

    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(
            password_hash=hashed_password,
            password_changed_at=None,
            failed_login_attempts=0,
            locked_until=None,
            updated_at=datetime.utcnow(),
            updated_by=current_user.id,
        )
    )
    await db.commit()
    await db.refresh(user)

    email_sent = await notification_service.send_password_reset_notification(user, temporary_password)

    return PasswordResetResponse(
        message="密码已重置，临时密码已发送至用户邮箱",
        temporary_password=temporary_password,
        email_sent=email_sent,
    )


@router.delete(
    "/{user_id}",
    response_model=UserActionResponse,
    summary="删除用户账号",
)
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_platform_admin),
):
    user = await _get_user_or_404(db, user_id)
    _guard_high_risk_account_action(
        target_user=user,
        current_user=current_user,
        action_label="删除",
    )

    try:
        await db.delete(user)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户已关联业务数据，无法直接删除，请先冻结账号",
        )

    await PermissionChecker.clear_user_cache(user_id)

    return UserActionResponse(
        message="用户已删除",
        user_id=user_id,
        username=user.username,
        status="deleted",
        email_sent=False,
    )
