"""
预置角色模板与权限模板初始化服务。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permission_catalog import AVAILABLE_MODULES, OPERATION_SEQUENCE
from app.models.role_permission import RolePermission
from app.models.role_tag import RoleTag
from app.models.user_role_assignment import UserRoleAssignment


READ_ONLY = ("read", "export")
REVIEW = ("read", "update", "export")
OPERATE = ("create", "read", "update", "export")
ENTRY = ("create", "read", "update")
ENTRY_READ = ("create", "read")
COLLABORATE = ("read", "update")
SYSTEM_FULL = tuple(OPERATION_SEQUENCE)

QUALITY_OVERVIEW = ("quality.data_panel",)
SUPPLIER_MODULES = (
    "supplier.management",
    "supplier.performance",
    "supplier.audit",
    "supplier.ppap",
    "supplier.scar",
)
INCOMING_MODULES = ("quality.incoming",)
PROCESS_MODULES = ("quality.process",)
CUSTOMER_MODULES = ("quality.customer",)
AUDIT_MODULES = ("audit.system", "audit.process", "audit.product")
NEWPRODUCT_MODULES = ("newproduct.management", "newproduct.trial")
SYSTEM_MODULES = (
    "system.users",
    "system.permissions",
    "system.tasks",
    "system.logs",
    "system.feature_flags",
    "system.notification_rules",
    "system.system_config",
    "system.announcements",
    "system.master_data",
    "system.release",
    "system.integrations",
)


def _grant(modules: Iterable[str], operations: Iterable[str]) -> dict[str, tuple[str, ...]]:
    return {module: tuple(operations) for module in modules}


def _merge(*grant_maps: dict[str, tuple[str, ...]]) -> dict[str, tuple[str, ...]]:
    merged: dict[str, list[str]] = {}
    for grant_map in grant_maps:
        for module, operations in grant_map.items():
            merged.setdefault(module, [])
            for operation in operations:
                if operation not in merged[module]:
                    merged[module].append(operation)

    operation_order = {name: index for index, name in enumerate(OPERATION_SEQUENCE)}
    return {
        module: tuple(sorted(operations, key=lambda item: operation_order[item]))
        for module, operations in merged.items()
    }


@dataclass(frozen=True)
class DefaultRoleTemplate:
    role_key: str
    role_name: str
    description: str
    applicable_user_type: str | None
    permissions: dict[str, tuple[str, ...]]


DEFAULT_ROLE_TEMPLATES = [
    DefaultRoleTemplate(
        role_key="sys.super_admin",
        role_name="超级管理员",
        description="系统级最高控制权限，负责全局配置、发布和审计。",
        applicable_user_type="internal",
        permissions=_grant(AVAILABLE_MODULES, SYSTEM_FULL),
    ),
    DefaultRoleTemplate(
        role_key="sys.business_admin",
        role_name="系统管理员",
        description="负责账号治理、角色分配、主数据模板和流程运维。",
        applicable_user_type="internal",
        permissions=_merge(
            _grant(("system.users", "system.tasks", "system.notification_rules", "system.announcements", "system.master_data"), OPERATE),
            _grant(("system.permissions",), COLLABORATE),
            _grant(("system.logs",), READ_ONLY),
            _grant(("system.feature_flags", "system.system_config", "system.release", "system.integrations"), ("read",)),
            _grant(QUALITY_OVERVIEW, READ_ONLY),
        ),
    ),
    DefaultRoleTemplate(
        role_key="leadership.executive",
        role_name="高管团队",
        description="经营层全局只读看板角色。",
        applicable_user_type="internal",
        permissions=_merge(
            _grant(QUALITY_OVERVIEW, READ_ONLY),
            _grant(("supplier.performance", "quality.process", "quality.customer", "newproduct.management", "newproduct.trial", "audit.system"), READ_ONLY),
        ),
    ),
    DefaultRoleTemplate(
        role_key="quality.minister",
        role_name="质量管理部部长",
        description="负责全局质量监控、审核结果和重大质量问题把关。",
        applicable_user_type="internal",
        permissions=_merge(
            _grant(QUALITY_OVERVIEW, READ_ONLY),
            _grant(SUPPLIER_MODULES + PROCESS_MODULES + CUSTOMER_MODULES + AUDIT_MODULES + NEWPRODUCT_MODULES + INCOMING_MODULES, REVIEW),
        ),
    ),
    DefaultRoleTemplate(
        role_key="quality.system.engineer",
        role_name="体系工程师",
        description="负责体系统筹、审核闭环与经验沉淀。",
        applicable_user_type="internal",
        permissions=_merge(
            _grant(AUDIT_MODULES, OPERATE),
            _grant(QUALITY_OVERVIEW, READ_ONLY),
            _grant(("system.announcements", "system.notification_rules", "system.master_data"), COLLABORATE),
        ),
    ),
    DefaultRoleTemplate(
        role_key="quality.process.manager",
        role_name="制程质量室经理",
        description="监控制程质量状况并审批重大制程问题。",
        applicable_user_type="internal",
        permissions=_merge(
            _grant(PROCESS_MODULES, REVIEW),
            _grant(QUALITY_OVERVIEW, READ_ONLY),
            _grant(("audit.process",), REVIEW),
        ),
    ),
    DefaultRoleTemplate(
        role_key="quality.process.engineer",
        role_name="制程质量工程师",
        description="主导制程质量问题跟进、分析和闭环。",
        applicable_user_type="internal",
        permissions=_merge(
            _grant(PROCESS_MODULES, OPERATE),
            _grant(QUALITY_OVERVIEW, READ_ONLY),
            _grant(("audit.process",), COLLABORATE),
        ),
    ),
    DefaultRoleTemplate(
        role_key="quality.process.pqc.lead",
        role_name="检验班长（PQC）",
        description="负责现场检验统筹、审核和班组数据复核。",
        applicable_user_type="internal",
        permissions=_grant(PROCESS_MODULES, REVIEW),
    ),
    DefaultRoleTemplate(
        role_key="quality.process.pqc.inspector",
        role_name="检验员（PQC）",
        description="负责制程质量数据和问题录入。",
        applicable_user_type="internal",
        permissions=_grant(PROCESS_MODULES, ENTRY_READ),
    ),
    DefaultRoleTemplate(
        role_key="quality.customer.manager",
        role_name="客户质量室经理",
        description="负责客户质量趋势监控、审核把关和客户索赔审批。",
        applicable_user_type="internal",
        permissions=_merge(
            _grant(CUSTOMER_MODULES, REVIEW),
            _grant(QUALITY_OVERVIEW, READ_ONLY),
            _grant(("audit.product",), REVIEW),
        ),
    ),
    DefaultRoleTemplate(
        role_key="quality.customer.engineer",
        role_name="客户质量工程师",
        description="主导客诉闭环、审核问题跟进和客户索赔发起。",
        applicable_user_type="internal",
        permissions=_grant(CUSTOMER_MODULES, OPERATE),
    ),
    DefaultRoleTemplate(
        role_key="quality.customer.failure_analyst",
        role_name="失效分析工程师",
        description="负责客户质量问题分析与检测数据录入。",
        applicable_user_type="internal",
        permissions=_grant(CUSTOMER_MODULES, COLLABORATE),
    ),
    DefaultRoleTemplate(
        role_key="quality.customer.field_support",
        role_name="市场技术支持工程师",
        description="负责客户现场质量问题登录和初步数据采集。",
        applicable_user_type="internal",
        permissions=_grant(CUSTOMER_MODULES, ENTRY_READ),
    ),
    DefaultRoleTemplate(
        role_key="quality.project.manager",
        role_name="项目质量室经理",
        description="统筹新品质量状态并审批新品重大问题。",
        applicable_user_type="internal",
        permissions=_merge(
            _grant(NEWPRODUCT_MODULES, REVIEW),
            _grant(QUALITY_OVERVIEW, READ_ONLY),
        ),
    ),
    DefaultRoleTemplate(
        role_key="quality.project.engineer",
        role_name="项目质量工程师",
        description="负责新品试产、流动生产质量数据与经验教训点检。",
        applicable_user_type="internal",
        permissions=_grant(NEWPRODUCT_MODULES, OPERATE),
    ),
    DefaultRoleTemplate(
        role_key="quality.supplier.manager",
        role_name="供应商质量室经理",
        description="统筹供应链质量、审核、索赔和供应商变更。",
        applicable_user_type="internal",
        permissions=_merge(
            _grant(SUPPLIER_MODULES + INCOMING_MODULES, REVIEW),
            _grant(QUALITY_OVERVIEW, READ_ONLY),
        ),
    ),
    DefaultRoleTemplate(
        role_key="quality.supplier.engineer",
        role_name="供应商质量工程师",
        description="主导供应商审核、绩效、索赔和变更跟进。",
        applicable_user_type="internal",
        permissions=_merge(
            _grant(SUPPLIER_MODULES, OPERATE),
            _grant(INCOMING_MODULES, COLLABORATE),
        ),
    ),
    DefaultRoleTemplate(
        role_key="quality.supplier.iqc.lead",
        role_name="来料检验班长",
        description="负责 IQC 现场统筹与来料数据复核。",
        applicable_user_type="internal",
        permissions=_merge(
            _grant(INCOMING_MODULES, REVIEW),
            _grant(("supplier.performance",), READ_ONLY),
        ),
    ),
    DefaultRoleTemplate(
        role_key="quality.supplier.iqc.inspector",
        role_name="来料检验员（IQC）",
        description="负责来料质量数据和问题录入。",
        applicable_user_type="internal",
        permissions=_grant(INCOMING_MODULES, ENTRY_READ),
    ),
    DefaultRoleTemplate(
        role_key="quality.supplier.cmm_operator",
        role_name="三坐标测量员",
        description="负责精密尺寸检验数据录入。",
        applicable_user_type="internal",
        permissions=_grant(INCOMING_MODULES, ENTRY),
    ),
    DefaultRoleTemplate(
        role_key="procurement.minister",
        role_name="采购部部长",
        description="负责供应商绩效和重大供应链质量议题的商务协同决策。",
        applicable_user_type="internal",
        permissions=_merge(
            _grant(("supplier.management", "supplier.performance", "supplier.audit", "supplier.scar"), READ_ONLY),
            _grant(QUALITY_OVERVIEW, READ_ONLY),
        ),
    ),
    DefaultRoleTemplate(
        role_key="procurement.engineer",
        role_name="采购工程师",
        description="负责供应商质量问题、索赔和变更流程的业务协同。",
        applicable_user_type="internal",
        permissions=_merge(
            _grant(("supplier.management", "supplier.scar"), COLLABORATE),
            _grant(("supplier.performance",), ("read",)),
        ),
    ),
    DefaultRoleTemplate(
        role_key="rd.manager",
        role_name="研发经理",
        description="督导研发责任问题闭环并关注新品质量状态。",
        applicable_user_type="internal",
        permissions=_merge(
            _grant(CUSTOMER_MODULES + NEWPRODUCT_MODULES + ("audit.product",), READ_ONLY),
            _grant(QUALITY_OVERVIEW, READ_ONLY),
        ),
    ),
    DefaultRoleTemplate(
        role_key="rd.engineer",
        role_name="研发工程师",
        description="负责技术应答、整改对策和新品协同跟进。",
        applicable_user_type="internal",
        permissions=_merge(
            _grant(CUSTOMER_MODULES + NEWPRODUCT_MODULES, COLLABORATE),
            _grant(("audit.product",), COLLABORATE),
        ),
    ),
    DefaultRoleTemplate(
        role_key="manufacturing.manager",
        role_name="制造经理",
        description="督导制造责任问题闭环并关注过程质量状态。",
        applicable_user_type="internal",
        permissions=_merge(
            _grant(PROCESS_MODULES + NEWPRODUCT_MODULES, READ_ONLY),
            _grant(("audit.process",), READ_ONLY),
            _grant(QUALITY_OVERVIEW, READ_ONLY),
        ),
    ),
    DefaultRoleTemplate(
        role_key="manufacturing.engineer",
        role_name="制造工程师",
        description="负责过程问题应答和新品阶段的制造协同。",
        applicable_user_type="internal",
        permissions=_merge(
            _grant(PROCESS_MODULES + NEWPRODUCT_MODULES, COLLABORATE),
            _grant(("audit.process",), COLLABORATE),
        ),
    ),
    DefaultRoleTemplate(
        role_key="cross_function.manager",
        role_name="其他部门经理",
        description="督导被分派问题和审核整改任务按期闭环。",
        applicable_user_type="internal",
        permissions=_grant(CUSTOMER_MODULES + PROCESS_MODULES + AUDIT_MODULES, READ_ONLY),
    ),
    DefaultRoleTemplate(
        role_key="cross_function.engineer",
        role_name="其他责任工程师",
        description="处理被分派质量问题、审核整改和对策录入。",
        applicable_user_type="internal",
        permissions=_grant(CUSTOMER_MODULES + PROCESS_MODULES + AUDIT_MODULES, COLLABORATE),
    ),
    DefaultRoleTemplate(
        role_key="supplier.external",
        role_name="外部供应商账号",
        description="负责供应商侧问题应答、绩效确认、索赔和变更提交。",
        applicable_user_type="supplier",
        permissions=_merge(
            _grant(QUALITY_OVERVIEW, ("read",)),
            _grant(("supplier.management", "supplier.audit", "supplier.ppap", "supplier.scar"), COLLABORATE),
            _grant(("supplier.performance",), ("read",)),
        ),
    ),
]


@dataclass
class RoleTemplateSeedResult:
    created_roles: int
    existing_roles: int
    created_permissions: int
    role_keys: list[str]


async def seed_default_role_templates(
    db: AsyncSession,
    *,
    actor_user_id: int | None = None,
) -> RoleTemplateSeedResult:
    created_roles = 0
    existing_roles = 0
    created_permissions = 0
    role_keys: list[str] = []

    role_result = await db.execute(select(RoleTag))
    existing_roles_by_key = {role.role_key: role for role in role_result.scalars().all()}

    for template in DEFAULT_ROLE_TEMPLATES:
        role_tag = existing_roles_by_key.get(template.role_key)
        if role_tag is None:
            role_tag = RoleTag(
                role_key=template.role_key,
                role_name=template.role_name,
                description=template.description,
                applicable_user_type=template.applicable_user_type,
                is_active=True,
                created_by=actor_user_id,
                updated_by=actor_user_id,
            )
            db.add(role_tag)
            await db.flush()
            existing_roles_by_key[template.role_key] = role_tag
            created_roles += 1
        else:
            existing_roles += 1

        role_keys.append(template.role_key)
        permission_result = await db.execute(
            select(RolePermission).where(RolePermission.role_tag_id == role_tag.id)
        )
        existing_permission_keys = {
            (permission.module_path, str(permission.operation_type.value if hasattr(permission.operation_type, "value") else permission.operation_type))
            for permission in permission_result.scalars().all()
        }

        for module_path, operations in template.permissions.items():
            for operation in operations:
                permission_key = (module_path, operation)
                if permission_key in existing_permission_keys:
                    continue

                db.add(
                    RolePermission(
                        role_tag_id=role_tag.id,
                        module_path=module_path,
                        operation_type=operation,
                        is_granted=True,
                        created_by=actor_user_id,
                        updated_by=actor_user_id,
                    )
                )
                existing_permission_keys.add(permission_key)
                created_permissions += 1

    if actor_user_id:
        super_admin_role = existing_roles_by_key.get("sys.super_admin")
        if super_admin_role:
            assignment_result = await db.execute(
                select(UserRoleAssignment).where(
                    UserRoleAssignment.user_id == actor_user_id,
                    UserRoleAssignment.role_tag_id == super_admin_role.id,
                )
            )
            existing_assignment = assignment_result.scalar_one_or_none()
            if existing_assignment is None:
                db.add(
                    UserRoleAssignment(
                        user_id=actor_user_id,
                        role_tag_id=super_admin_role.id,
                        assigned_by=actor_user_id,
                    )
                )

    await db.commit()

    return RoleTemplateSeedResult(
        created_roles=created_roles,
        existing_roles=existing_roles,
        created_permissions=created_permissions,
        role_keys=role_keys,
    )
