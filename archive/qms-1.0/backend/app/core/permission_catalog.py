"""
统一维护权限模块目录，供权限矩阵、角色模板和前端分组展示共用。
"""
from __future__ import annotations

from app.models.permission import OperationType


PERMISSION_MODULE_CATALOG = [
    {
        "module_path": "quality.data_panel",
        "module_name": "质量数据看板",
        "group_key": "quality-overview",
        "group_name": "质量总览",
    },
    {
        "module_path": "supplier.management",
        "module_name": "供应商管理",
        "group_key": "supplier-quality",
        "group_name": "供应商质量",
    },
    {
        "module_path": "supplier.performance",
        "module_name": "供应商绩效",
        "group_key": "supplier-quality",
        "group_name": "供应商质量",
    },
    {
        "module_path": "supplier.audit",
        "module_name": "供应商审核",
        "group_key": "supplier-quality",
        "group_name": "供应商质量",
    },
    {
        "module_path": "supplier.ppap",
        "module_name": "PPAP",
        "group_key": "supplier-quality",
        "group_name": "供应商质量",
    },
    {
        "module_path": "supplier.scar",
        "module_name": "SCAR",
        "group_key": "supplier-quality",
        "group_name": "供应商质量",
    },
    {
        "module_path": "quality.incoming",
        "module_name": "来料质量",
        "group_key": "quality-ops",
        "group_name": "质量业务",
    },
    {
        "module_path": "quality.process",
        "module_name": "制程质量",
        "group_key": "quality-ops",
        "group_name": "质量业务",
    },
    {
        "module_path": "quality.customer",
        "module_name": "客户质量",
        "group_key": "quality-ops",
        "group_name": "质量业务",
    },
    {
        "module_path": "audit.system",
        "module_name": "体系审核",
        "group_key": "audit-management",
        "group_name": "审核管理",
    },
    {
        "module_path": "audit.process",
        "module_name": "过程审核",
        "group_key": "audit-management",
        "group_name": "审核管理",
    },
    {
        "module_path": "audit.product",
        "module_name": "产品审核",
        "group_key": "audit-management",
        "group_name": "审核管理",
    },
    {
        "module_path": "newproduct.management",
        "module_name": "新品管理",
        "group_key": "newproduct-quality",
        "group_name": "新品质量",
    },
    {
        "module_path": "newproduct.trial",
        "module_name": "试产管理",
        "group_key": "newproduct-quality",
        "group_name": "新品质量",
    },
    {
        "module_path": "system.users",
        "module_name": "用户管理",
        "group_key": "system-admin",
        "group_name": "系统管理",
    },
    {
        "module_path": "system.permissions",
        "module_name": "权限管理",
        "group_key": "system-admin",
        "group_name": "系统管理",
    },
    {
        "module_path": "system.tasks",
        "module_name": "任务监控",
        "group_key": "system-admin",
        "group_name": "系统管理",
    },
    {
        "module_path": "system.logs",
        "module_name": "操作日志",
        "group_key": "system-admin",
        "group_name": "系统管理",
    },
    {
        "module_path": "system.feature_flags",
        "module_name": "功能开关",
        "group_key": "system-admin",
        "group_name": "系统管理",
    },
    {
        "module_path": "system.notification_rules",
        "module_name": "通知规则",
        "group_key": "system-admin",
        "group_name": "系统管理",
    },
    {
        "module_path": "system.system_config",
        "module_name": "系统配置",
        "group_key": "system-admin",
        "group_name": "系统管理",
    },
    {
        "module_path": "system.announcements",
        "module_name": "公告管理",
        "group_key": "system-admin",
        "group_name": "系统管理",
    },
    {
        "module_path": "system.master_data",
        "module_name": "主数据模板",
        "group_key": "system-admin",
        "group_name": "系统管理",
    },
    {
        "module_path": "system.release",
        "module_name": "版本发布",
        "group_key": "system-admin",
        "group_name": "系统管理",
    },
    {
        "module_path": "system.integrations",
        "module_name": "集成配置",
        "group_key": "system-admin",
        "group_name": "系统管理",
    },
]

AVAILABLE_MODULES = [item["module_path"] for item in PERMISSION_MODULE_CATALOG]
MODULE_LABELS = {item["module_path"]: item["module_name"] for item in PERMISSION_MODULE_CATALOG}
MODULE_GROUPS = {
    item["module_path"]: {
        "group_key": item["group_key"],
        "group_name": item["group_name"],
    }
    for item in PERMISSION_MODULE_CATALOG
}
OPERATION_SEQUENCE = [operation.value for operation in OperationType]

