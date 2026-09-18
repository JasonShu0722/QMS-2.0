"""
审计中间件 - Audit Middleware

拦截所有 POST/PUT/DELETE 请求，自动记录操作日志，包括：
- 操作人、操作时间、操作类型
- 目标对象（模块、ID）
- 数据快照（before_data, after_data）
- 请求信息（IP、User-Agent）
"""
import json
import time
from typing import Callable, Optional
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.operation_log import OperationLog


class AuditMiddleware(BaseHTTPMiddleware):
    """
    审计中间件
    
    自动拦截所有修改性操作（POST/PUT/DELETE），记录操作日志。
    """
    
    # 需要记录审计日志的 HTTP 方法
    AUDIT_METHODS = {"POST", "PUT", "DELETE", "PATCH"}
    
    # 排除的路径（不记录审计日志）
    EXCLUDED_PATHS = {
        "/api/v1/auth/login",  # 登录操作单独记录
        "/api/v1/auth/logout",  # 登出操作单独记录
        "/api/v1/auth/captcha",  # 验证码生成不记录
        "/health",  # 健康检查
        "/",  # 根路径
        "/api/docs",  # API 文档
        "/api/redoc",  # API 文档
        "/api/openapi.json",  # OpenAPI 规范
    }
    
    def __init__(self, app: ASGIApp):
        super().__init__(app)
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """
        中间件主逻辑
        
        Args:
            request: FastAPI 请求对象
            call_next: 下一个中间件或路由处理函数
            
        Returns:
            Response: HTTP 响应
        """
        # 检查是否需要记录审计日志
        if not self._should_audit(request):
            return await call_next(request)
        
        # 提取请求信息
        user_id = await self._extract_user_id(request)
        operation_type = self._map_operation_type(request.method)
        target_module, target_id = self._extract_target_info(request)
        ip_address = self._get_client_ip(request)
        user_agent = request.headers.get("user-agent", "")
        
        # 提取请求体（用于记录 after_data）
        request_body = await self._get_request_body(request)
        
        # 执行实际的路由处理
        start_time = time.time()
        response = await call_next(request)
        process_time = time.time() - start_time
        
        # 仅在请求成功时记录日志（2xx 状态码）
        if 200 <= response.status_code < 300:
            # 异步记录审计日志（不阻塞响应）
            await self._log_operation(
                user_id=user_id,
                operation_type=operation_type,
                target_module=target_module,
                target_id=target_id,
                before_data=None,  # 中间件层面无法获取修改前数据，需在 Service 层补充
                after_data=request_body,
                ip_address=ip_address,
                user_agent=user_agent,
            )
        
        return response
    
    def _should_audit(self, request: Request) -> bool:
        """
        判断是否需要记录审计日志
        
        Args:
            request: FastAPI 请求对象
            
        Returns:
            bool: 是否需要审计
        """
        # 检查 HTTP 方法
        if request.method not in self.AUDIT_METHODS:
            return False
        
        # 检查路径是否在排除列表中
        path = request.url.path
        if path in self.EXCLUDED_PATHS:
            return False
        
        # 排除以特定前缀开头的路径
        if path.startswith("/api/docs") or path.startswith("/api/redoc"):
            return False
        
        return True
    
    async def _extract_user_id(self, request: Request) -> Optional[int]:
        """
        从请求中提取用户 ID
        
        Args:
            request: FastAPI 请求对象
            
        Returns:
            Optional[int]: 用户 ID，未认证时返回 None
        """
        # 尝试从请求状态中获取用户信息（由 get_current_user 依赖注入设置）
        if hasattr(request.state, "user"):
            return request.state.user.id
        
        # 尝试从 Authorization Header 解析 JWT Token
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            try:
                from jose import jwt
                from app.core.config import settings
                
                payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
                user_id = payload.get("sub")
                return int(user_id) if user_id else None
            except:
                pass
        
        return None
    
    def _map_operation_type(self, method: str) -> str:
        """
        将 HTTP 方法映射为操作类型
        
        Args:
            method: HTTP 方法（POST/PUT/DELETE/PATCH）
            
        Returns:
            str: 操作类型（create/update/delete）
        """
        mapping = {
            "POST": "create",
            "PUT": "update",
            "PATCH": "update",
            "DELETE": "delete",
        }
        return mapping.get(method, "unknown")
    
    def _extract_target_info(self, request: Request) -> tuple[str, Optional[int]]:
        """
        从请求路径中提取目标模块和目标 ID
        
        Args:
            request: FastAPI 请求对象
            
        Returns:
            tuple[str, Optional[int]]: (目标模块, 目标ID)
            
        Examples:
            /api/v1/admin/users/123 -> ("users", 123)
            /api/v1/admin/permissions -> ("permissions", None)
        """
        path = request.url.path
        parts = [p for p in path.split("/") if p]
        
        # 提取模块名称（通常是路径的最后一个或倒数第二个部分）
        target_module = "unknown"
        target_id = None
        
        if len(parts) >= 3:
            # 尝试提取模块名称
            if parts[-1].isdigit():
                # 路径以 ID 结尾，如 /api/v1/admin/users/123
                target_module = parts[-2]
                target_id = int(parts[-1])
            else:
                # 路径以模块名称结尾，如 /api/v1/admin/users
                target_module = parts[-1]
        
        return target_module, target_id
    
    def _get_client_ip(self, request: Request) -> str:
        """
        获取客户端真实 IP 地址
        
        优先从 X-Forwarded-For 或 X-Real-IP 头获取（Nginx 代理场景）
        
        Args:
            request: FastAPI 请求对象
            
        Returns:
            str: 客户端 IP 地址
        """
        # 优先从代理头获取
        forwarded_for = request.headers.get("x-forwarded-for")
        if forwarded_for:
            # X-Forwarded-For 可能包含多个 IP，取第一个
            return forwarded_for.split(",")[0].strip()
        
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip
        
        # 回退到直接连接的客户端 IP
        if request.client:
            return request.client.host
        
        return "unknown"
    
    async def _get_request_body(self, request: Request) -> Optional[dict]:
        """
        提取请求体（JSON 格式）
        
        Args:
            request: FastAPI 请求对象
            
        Returns:
            Optional[dict]: 请求体字典，解析失败时返回 None
        """
        try:
            # 检查 Content-Type
            content_type = request.headers.get("content-type", "")
            if "application/json" not in content_type:
                return None
            
            # 读取请求体
            body = await request.body()
            if not body:
                return None
            
            # 解析 JSON
            return json.loads(body.decode("utf-8"))
        except:
            return None
    
    async def _log_operation(
        self,
        user_id: Optional[int],
        operation_type: str,
        target_module: str,
        target_id: Optional[int],
        before_data: Optional[dict],
        after_data: Optional[dict],
        ip_address: str,
        user_agent: str,
    ):
        """
        异步记录操作日志到数据库
        
        Args:
            user_id: 操作用户 ID
            operation_type: 操作类型
            target_module: 目标模块
            target_id: 目标对象 ID
            before_data: 操作前数据快照
            after_data: 操作后数据快照
            ip_address: 客户端 IP
            user_agent: 浏览器 User-Agent
        """
        try:
            async with AsyncSessionLocal() as db:
                log_entry = OperationLog(
                    user_id=user_id,
                    operation_type=operation_type,
                    target_module=target_module,
                    target_id=target_id,
                    before_data=before_data,
                    after_data=after_data,
                    ip_address=ip_address,
                    user_agent=user_agent,
                )
                
                db.add(log_entry)
                await db.commit()
        except Exception as e:
            # 审计日志记录失败不应影响主业务流程
            # 仅记录错误日志，不抛出异常
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"Failed to log operation: {e}")


def setup_audit_middleware(app):
    """
    注册审计中间件到 FastAPI 应用
    
    Args:
        app: FastAPI 应用实例
        
    Usage:
        from app.core.audit_middleware import setup_audit_middleware
        setup_audit_middleware(app)
    """
    app.add_middleware(AuditMiddleware)
