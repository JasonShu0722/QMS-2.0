"""
认证策略模块。
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Optional
import re

import bcrypt
from jose import JWTError, jwt
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.timezone import utc_now_naive

if TYPE_CHECKING:
    from app.models.user import User


class AuthenticationError(Exception):
    """认证异常基类。"""


class InvalidCredentialsError(AuthenticationError):
    """用户名或密码错误。"""


class AccountLockedError(AuthenticationError):
    """账号已锁定。"""


class PasswordExpiredError(AuthenticationError):
    """密码已过期。"""


class AccountInactiveError(AuthenticationError):
    """账号不可用。"""


class AuthStrategy(ABC):
    """认证策略抽象基类。"""

    @abstractmethod
    async def authenticate(self, db: AsyncSession, username: str, password: str) -> "User":
        raise NotImplementedError

    @abstractmethod
    def create_access_token(self, user_id: int) -> str:
        raise NotImplementedError

    @abstractmethod
    def verify_token(self, token: str) -> dict:
        raise NotImplementedError


class LocalAuthStrategy(AuthStrategy):
    """本地认证策略。"""

    def __init__(self):
        self.SECRET_KEY = settings.SECRET_KEY
        self.ALGORITHM = settings.ALGORITHM
        self.ACCESS_TOKEN_EXPIRE_HOURS = settings.ACCESS_TOKEN_EXPIRE_HOURS
        self.PASSWORD_MIN_LENGTH = settings.PASSWORD_MIN_LENGTH
        self.PASSWORD_EXPIRE_DAYS = settings.PASSWORD_EXPIRE_DAYS
        self.MAX_LOGIN_ATTEMPTS = settings.MAX_LOGIN_ATTEMPTS
        self.ACCOUNT_LOCKOUT_MINUTES = settings.ACCOUNT_LOCKOUT_MINUTES

    async def authenticate(self, db: AsyncSession, username: str, password: str) -> "User":
        from app.models.supplier import Supplier, SupplierStatus
        from app.models.user import User, UserStatus, UserType

        result = await db.execute(select(User).where(User.username == username))
        user = result.scalar_one_or_none()

        if not user:
            raise InvalidCredentialsError("用户名或密码错误")

        if user.status != UserStatus.ACTIVE:
            if user.status == UserStatus.PENDING:
                raise AccountInactiveError("账号待审核，请联系管理员")
            if user.status == UserStatus.FROZEN:
                raise AccountInactiveError("账号已冻结，请联系管理员")
            if user.status == UserStatus.REJECTED:
                raise AccountInactiveError("账号已被驳回")

        if user.user_type == UserType.SUPPLIER:
            if not user.supplier_id:
                raise AccountInactiveError("账号当前不可用，请联系管理员")

            supplier_result = await db.execute(
                select(Supplier).where(Supplier.id == user.supplier_id)
            )
            supplier = supplier_result.scalar_one_or_none()
            if not supplier or supplier.status != SupplierStatus.ACTIVE:
                raise AccountInactiveError("账号当前不可用，请联系管理员")

        if user.is_account_locked():
            remaining_minutes = int((user.locked_until - utc_now_naive()).total_seconds() / 60)
            raise AccountLockedError(f"账号已锁定，请在 {remaining_minutes} 分钟后重试")

        if not self.verify_password(password, user.password_hash):
            await self._handle_login_failure(db, user)
            raise InvalidCredentialsError("用户名或密码错误")

        await self._reset_login_attempts(db, user)

        if user.is_password_expired(self.PASSWORD_EXPIRE_DAYS):
            raise PasswordExpiredError("密码已过期，请修改密码")

        await self.record_successful_login(db, user)

        return user

    async def record_successful_login(self, db: AsyncSession, user: "User") -> None:
        from app.models.user import User

        login_time = utc_now_naive()
        await db.execute(
            update(User).where(User.id == user.id).values(last_login_at=login_time)
        )
        user.last_login_at = login_time
        await db.commit()

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))

    def hash_password(self, password: str) -> str:
        salt = bcrypt.gensalt()
        hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
        return hashed.decode("utf-8")

    def validate_password_complexity(self, password: str) -> tuple[bool, str]:
        if len(password) < self.PASSWORD_MIN_LENGTH:
            return False, f"密码长度必须大于 {self.PASSWORD_MIN_LENGTH} 位"

        has_upper = bool(re.search(r"[A-Z]", password))
        has_lower = bool(re.search(r"[a-z]", password))
        has_digit = bool(re.search(r"\d", password))
        has_special = bool(re.search(r'[!@#$%^&*(),.?":{}|<>]', password))

        if sum([has_upper, has_lower, has_digit, has_special]) < 3:
            return False, "密码必须包含大写字母、小写字母、数字、特殊字符中的至少三种"

        return True, ""

    async def _handle_login_failure(self, db: AsyncSession, user: "User"):
        from app.models.user import User

        new_attempts = user.failed_login_attempts + 1
        if new_attempts >= self.MAX_LOGIN_ATTEMPTS:
            locked_until = utc_now_naive() + timedelta(minutes=self.ACCOUNT_LOCKOUT_MINUTES)
            await db.execute(
                update(User)
                .where(User.id == user.id)
                .values(failed_login_attempts=new_attempts, locked_until=locked_until)
            )
        else:
            await db.execute(
                update(User)
                .where(User.id == user.id)
                .values(failed_login_attempts=new_attempts)
            )
        await db.commit()

    async def _reset_login_attempts(self, db: AsyncSession, user: "User"):
        from app.models.user import User

        await db.execute(
            update(User)
            .where(User.id == user.id)
            .values(failed_login_attempts=0, locked_until=None)
        )
        await db.commit()

    def create_access_token(self, user_id: int) -> str:
        expire = utc_now_naive() + timedelta(hours=self.ACCESS_TOKEN_EXPIRE_HOURS)
        payload = {"sub": str(user_id), "exp": expire, "iat": utc_now_naive()}
        return jwt.encode(payload, self.SECRET_KEY, algorithm=self.ALGORITHM)

    def verify_token(self, token: str) -> dict:
        try:
            return jwt.decode(token, self.SECRET_KEY, algorithms=[self.ALGORITHM])
        except JWTError as exc:
            raise JWTError(f"Token 验证失败: {exc}") from exc


class LDAPAuthStrategy(AuthStrategy):
    """LDAP 认证策略占位实现。"""

    def __init__(self):
        self.SECRET_KEY = settings.SECRET_KEY
        self.ALGORITHM = settings.ALGORITHM
        self.ACCESS_TOKEN_EXPIRE_HOURS = settings.ACCESS_TOKEN_EXPIRE_HOURS
        self.LDAP_SERVER = settings.LDAP_SERVER
        self.LDAP_BASE_DN = settings.LDAP_BASE_DN
        self.LDAP_BIND_DN = settings.LDAP_BIND_DN
        self.LDAP_BIND_PASSWORD = settings.LDAP_BIND_PASSWORD

    async def authenticate(self, db: AsyncSession, username: str, password: str) -> "User":
        raise NotImplementedError(
            "LDAP 认证功能预留给 Phase 2，实现前请先完成 LDAP 参数配置与集成逻辑。"
        )

    def create_access_token(self, user_id: int) -> str:
        expire = utc_now_naive() + timedelta(hours=self.ACCESS_TOKEN_EXPIRE_HOURS)
        payload = {"sub": str(user_id), "exp": expire, "iat": utc_now_naive()}
        return jwt.encode(payload, self.SECRET_KEY, algorithm=self.ALGORITHM)

    def verify_token(self, token: str) -> dict:
        try:
            return jwt.decode(token, self.SECRET_KEY, algorithms=[self.ALGORITHM])
        except JWTError as exc:
            raise JWTError(f"Token 验证失败: {exc}") from exc


class AuthService:
    """统一认证服务。"""

    def __init__(self):
        self.local_strategy = LocalAuthStrategy()
        self.ldap_strategy = LDAPAuthStrategy()

    def get_strategy(self, user_type: str) -> AuthStrategy:
        if user_type == "internal" and settings.LDAP_ENABLED:
            return self.ldap_strategy
        return self.local_strategy

    async def login(
        self,
        db: AsyncSession,
        username: str,
        password: str,
        user_type: str = "internal",
    ) -> dict:
        strategy = self.get_strategy(user_type)
        user = await strategy.authenticate(db, username, password)
        access_token = strategy.create_access_token(user.id)
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user_info": user.to_dict(),
        }

    async def verify_token(self, token: str, db: AsyncSession) -> "User":
        from app.models.supplier import Supplier, SupplierStatus
        from app.models.user import User, UserStatus, UserType

        payload = self.local_strategy.verify_token(token)
        user_id = int(payload.get("sub"))

        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            raise JWTError("用户不存在")

        if user.status != UserStatus.ACTIVE:
            raise JWTError("用户账号未激活")

        if user.user_type == UserType.SUPPLIER:
            if not user.supplier_id:
                raise JWTError("用户账号当前不可用")

            supplier_result = await db.execute(
                select(Supplier).where(Supplier.id == user.supplier_id)
            )
            supplier = supplier_result.scalar_one_or_none()
            if not supplier or supplier.status != SupplierStatus.ACTIVE:
                raise JWTError("用户账号当前不可用")

        return user


auth_service = AuthService()
