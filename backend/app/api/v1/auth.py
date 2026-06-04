"""
认证相关 API。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_strategy import (
    AccountInactiveError,
    AccountLockedError,
    InvalidCredentialsError,
    LocalAuthStrategy,
    PasswordExpiredError,
)
from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.permissions import PermissionChecker
from app.models.permission import OperationType
from app.models.user import User, UserStatus, UserType
from app.schemas.user import (
    CaptchaResponseSchema,
    LoginRequestSchema,
    LoginResponseSchema,
    RegisterResponseSchema,
    UserRegisterSchema,
    UserResponseSchema,
)
from app.services.user_session_service import build_user_response


router = APIRouter(prefix="/auth", tags=["认证管理"])

local_auth = LocalAuthStrategy()
GENERIC_REGISTRATION_VALIDATION_ERROR = "注册信息校验未通过，请检查后重试"
LOGIN_ENVIRONMENTS = {"stable", "preview"}


def _current_login_environment() -> str:
    environment = (settings.ENVIRONMENT or "stable").strip().lower()
    return environment if environment in LOGIN_ENVIRONMENTS else "stable"


def _parse_allowed_environments(raw_environments: str | None) -> list[str]:
    parsed = [
        item.strip()
        for item in (raw_environments or "stable").split(",")
        if item.strip()
    ]
    return parsed or ["stable"]


def _normalize_internal_registration_email_domain() -> str:
    return settings.INTERNAL_REGISTRATION_EMAIL_DOMAIN.strip().lower().lstrip("@")


def _matches_internal_registration_email_policy(email: str) -> bool:
    domain = _normalize_internal_registration_email_domain()
    return email.strip().lower().endswith(f"@{domain}")


@router.post(
    "/register",
    response_model=RegisterResponseSchema,
    status_code=status.HTTP_201_CREATED,
    summary="内部员工注册",
)
async def register_user(
    user_data: UserRegisterSchema,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.username == user_data.username))
    existing_user = result.scalar_one_or_none()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户名已存在，请选择其他用户名",
        )

    is_valid, error_message = local_auth.validate_password_complexity(user_data.password)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_message,
        )

    if not _matches_internal_registration_email_policy(user_data.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=GENERIC_REGISTRATION_VALIDATION_ERROR,
        )

    if not user_data.department:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="内部员工注册时部门为必填项",
        )

    new_user = User(
        username=user_data.username,
        password_hash=local_auth.hash_password(user_data.password),
        full_name=user_data.full_name,
        email=user_data.email.strip().lower(),
        phone=user_data.phone,
        user_type=UserType.INTERNAL,
        status=UserStatus.PENDING,
        department=user_data.department,
        position=user_data.position,
        supplier_id=None,
    )

    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    return RegisterResponseSchema(
        message="注册成功，请等待管理员审核",
        user_id=new_user.id,
        username=new_user.username,
        status=new_user.status,
    )


@router.post(
    "/login",
    response_model=LoginResponseSchema,
    summary="统一登录",
)
async def login(
    login_data: LoginRequestSchema,
    db: AsyncSession = Depends(get_db),
):
    from app.services.captcha_service import captcha_service

    if login_data.user_type == UserType.SUPPLIER:
        if not login_data.captcha or not login_data.captcha_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="供应商登录必须提供图形验证码",
            )

        if not captcha_service.verify_captcha(login_data.captcha_id, login_data.captcha):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="验证码错误或已过期，请重新获取",
            )

    try:
        user = await local_auth.authenticate(db, login_data.username, login_data.password)
    except InvalidCredentialsError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except AccountLockedError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except AccountInactiveError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except PasswordExpiredError:
        user_result = await db.execute(select(User).where(User.username == login_data.username))
        user = user_result.scalar_one()
        await local_auth.record_successful_login(db, user)

        login_environment = _current_login_environment()
        allowed = _parse_allowed_environments(user.allowed_environments)
        if login_environment not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"您没有 {login_environment} 环境的访问权限，请联系管理员",
            )

        access_token = local_auth.create_access_token(user.id)
        return LoginResponseSchema(
            access_token=access_token,
            token_type="bearer",
            user_info=await build_user_response(db, user),
            environment=login_environment,
            allowed_environments=allowed,
            password_expired=True,
        )

    login_environment = _current_login_environment()
    allowed = _parse_allowed_environments(user.allowed_environments)
    if login_environment not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"您没有 {login_environment} 环境的访问权限，请联系管理员",
        )

    access_token = local_auth.create_access_token(user.id)
    return LoginResponseSchema(
        access_token=access_token,
        token_type="bearer",
        user_info=await build_user_response(db, user),
        environment=login_environment,
        allowed_environments=allowed,
        password_expired=False,
    )


@router.get(
    "/captcha",
    response_model=CaptchaResponseSchema,
    summary="生成图形验证码",
)
async def get_captcha():
    from app.services.captcha_service import captcha_service

    captcha_id, captcha_image = captcha_service.generate_captcha()
    return CaptchaResponseSchema(captcha_id=captcha_id, captcha_image=captcha_image)


@router.get(
    "/me",
    response_model=UserResponseSchema,
    summary="获取当前用户信息",
)
async def get_current_user_info(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await build_user_response(db, current_user)


@router.post(
    "/check-permission",
    summary="检查当前用户权限",
)
async def check_permission(
    request_data: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    module_path = request_data.get("module_path", "")
    operation = request_data.get("operation", "")
    if not module_path or not operation:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="module_path 和 operation 为必填参数",
        )

    try:
        op_type = OperationType(operation)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"无效的操作类型: {operation}",
        ) from exc

    try:
        has_permission = await PermissionChecker.check_permission(
            user_id=current_user.id,
            module_path=module_path,
            operation=op_type,
            db=db,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"权限检查失败: {exc}",
        ) from exc

    return {"has_permission": has_permission}


@router.get(
    "/permissions-tree",
    summary="获取当前用户权限树",
)
async def get_current_user_permissions_tree(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        permissions_tree = await PermissionChecker.get_user_permissions(current_user.id, db)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"权限树获取失败: {exc}",
        ) from exc

    return {"permissions": permissions_tree}
