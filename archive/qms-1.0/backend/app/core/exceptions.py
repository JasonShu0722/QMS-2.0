"""
自定义异常类
"""


class NotFoundException(Exception):
    """资源未找到异常"""
    pass


class BusinessException(Exception):
    """业务逻辑异常"""
    pass


class PermissionDeniedException(Exception):
    """权限拒绝异常"""
    pass


class ValidationException(Exception):
    """数据验证异常"""
    pass
