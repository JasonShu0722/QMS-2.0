"""
FastAPI 依赖注入函数
Dependencies - 用于路由的依赖注入，如用户认证、权限检查等
"""
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from jose import JWTError

from app.core.database import get_db
from app.core.auth_strategy import auth_service
from app.models.user import User


# HTTP Bearer Token 认证方案
security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db)
) -> User:
    """
    依赖注入函数：从 JWT Token 提取当前用户
    
    用于需要认证的路由，自动验证 Token 并返回用户对象。
    
    Args:
        credentials: HTTP Bearer Token
        db: 数据库会话
        
    Returns:
        User: 当前登录用户对象
        
    Raises:
        HTTPException: Token 无效或用户不存在时抛出 401 错误
        
    Usage:
        @router.get("/protected")
        async def protected_route(current_user: User = Depends(get_current_user)):
            return {"user": current_user.username}
    """
    # 提取 Token
    token = credentials.credentials
    
    # 验证 Token 并获取用户
    try:
        user = await auth_service.verify_token(token, db)
        return user
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"无效的认证凭证: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="认证失败",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """
    依赖注入函数：获取当前激活的用户
    
    在 get_current_user 的基础上，额外检查用户状态是否为 active。
    
    Args:
        current_user: 当前用户
        
    Returns:
        User: 当前激活用户对象
        
    Raises:
        HTTPException: 用户未激活时抛出 403 错误
    """
    from app.models.user import UserStatus
    
    if current_user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"用户账号状态为 {current_user.status}，无法访问"
        )
    
    return current_user


async def get_optional_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(auto_error=False)),
    db: AsyncSession = Depends(get_db)
) -> Optional[User]:
    """
    依赖注入函数：获取可选的当前用户
    
    用于既支持匿名访问又支持认证访问的路由。
    如果提供了 Token 则验证并返回用户，否则返回 None。
    
    Args:
        credentials: HTTP Bearer Token（可选）
        db: 数据库会话
        
    Returns:
        Optional[User]: 当前用户对象或 None
    """
    if credentials is None:
        return None
    
    try:
        token = credentials.credentials
        user = await auth_service.verify_token(token, db)
        return user
    except:
        return None
