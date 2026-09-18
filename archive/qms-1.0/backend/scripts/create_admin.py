"""
初始化超级管理员账号脚本

用途：在系统首次部署时，创建一个拥有全部权限的超级管理员账号。
该账号状态直接设为 active（跳过审核流程），并自动授予所有功能模块的全部操作权限。

使用方式：
    cd backend
    python -m scripts.create_admin
"""
import asyncio
import sys
import os
from datetime import datetime

# 确保可以导入 app 包
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.auth_strategy import LocalAuthStrategy
from app.models.user import User, UserType, UserStatus
from app.models.permission import Permission, OperationType


# ========================
# 管理员账号配置
# ========================
ADMIN_CONFIG = {
    "username": "Admin",
    "password": "Shu465847601!",
    "full_name": "Jason",
    "email": "shu465847601@gmail.com",
    "user_type": UserType.INTERNAL,
    "department": "信息技术部",
    "position": "系统管理员",
    "allowed_environments": "stable,preview",
}

# 系统中所有可用的功能模块（与 admin/permissions.py 中 AVAILABLE_MODULES 保持一致）
ALL_MODULES = [
    "supplier.management",
    "supplier.performance",
    "supplier.audit",
    "supplier.ppap",
    "supplier.scar",
    "quality.incoming",
    "quality.process",
    "quality.customer",
    "quality.data_panel",
    "quality.dashboard",
    "audit.system",
    "audit.process",
    "audit.product",
    "audit.execution",
    "newproduct.management",
    "newproduct.trial",
    "system.config",
    "system.users",
    "system.notifications",
    "instruments.management",
    "quality_costs.management",
]

# 所有操作类型（使用 .value 存储纯字符串值）
ALL_OPERATIONS = [op.value for op in OperationType]


async def create_admin():
    """
    创建超级管理员账号并授予全部权限

    流程：
    1. 检查用户名是否已存在（存在则跳过创建，仅补全权限）
    2. 创建管理员用户（状态为 active）
    3. 为管理员授予所有模块的所有操作权限
    """
    auth_strategy = LocalAuthStrategy()

    async with AsyncSessionLocal() as session:
        try:
            # ====== 第一步：检查用户是否已存在 ======
            result = await session.execute(
                select(User).where(User.username == ADMIN_CONFIG["username"])
            )
            existing_user = result.scalar_one_or_none()

            if existing_user:
                print(f"⚠️  用户 '{ADMIN_CONFIG['username']}' 已存在（ID: {existing_user.id}）")
                admin_user = existing_user

                # 确保状态为 active
                if admin_user.status != UserStatus.ACTIVE:
                    admin_user.status = UserStatus.ACTIVE
                    print(f"   → 已将账号状态更新为 active")

                # 确保管理员默认拥有正式版和预览版访问权限
                if admin_user.allowed_environments != ADMIN_CONFIG["allowed_environments"]:
                    admin_user.allowed_environments = ADMIN_CONFIG["allowed_environments"]
                    print(f"   → 已将环境权限更新为 {ADMIN_CONFIG['allowed_environments']}")
            else:
                # ====== 第二步：创建管理员用户 ======
                hashed_password = auth_strategy.hash_password(ADMIN_CONFIG["password"])

                admin_user = User(
                    username=ADMIN_CONFIG["username"],
                    password_hash=hashed_password,
                    full_name=ADMIN_CONFIG["full_name"],
                    email=ADMIN_CONFIG["email"],
                    user_type=ADMIN_CONFIG["user_type"],
                    status=UserStatus.ACTIVE,  # 直接激活，跳过审核
                    department=ADMIN_CONFIG.get("department"),
                    position=ADMIN_CONFIG.get("position"),
                    allowed_environments=ADMIN_CONFIG["allowed_environments"],
                    password_changed_at=datetime.utcnow(),  # 避免首次登录强制改密
                )

                session.add(admin_user)
                await session.flush()  # 获取分配的 ID
                print(f"✅  管理员用户创建成功！")
                print(f"   用户名: {ADMIN_CONFIG['username']}")
                print(f"   姓  名: {ADMIN_CONFIG['full_name']}")
                print(f"   邮  箱: {ADMIN_CONFIG['email']}")
                print(f"   用户ID: {admin_user.id}")

            # ====== 第三步：清理旧的错误权限数据 ======
            # 之前的版本可能存储了 'OperationType.CREATE' 格式的枚举字符串
            # 而非正确的 'create' 值，需要先清理
            from sqlalchemy import delete, or_
            bad_patterns = [f"OperationType.{op.name}" for op in OperationType]
            for bad_val in bad_patterns:
                await session.execute(
                    delete(Permission).where(
                        Permission.user_id == admin_user.id,
                        Permission.operation_type == bad_val,
                    )
                )
            print(f"   → 已清理旧格式的权限数据")

            # ====== 第四步：授予全部权限 ======
            perm_created = 0
            perm_skipped = 0

            for module in ALL_MODULES:
                for operation in ALL_OPERATIONS:
                    # 检查权限是否已存在
                    perm_result = await session.execute(
                        select(Permission).where(
                            Permission.user_id == admin_user.id,
                            Permission.module_path == module,
                            Permission.operation_type == operation,
                        )
                    )
                    existing_perm = perm_result.scalar_one_or_none()

                    if existing_perm:
                        # 确保已授予
                        if not existing_perm.is_granted:
                            existing_perm.is_granted = True
                            perm_created += 1
                        else:
                            perm_skipped += 1
                    else:
                        # 创建新权限记录
                        new_perm = Permission(
                            user_id=admin_user.id,
                            module_path=module,
                            operation_type=operation,
                            is_granted=True,
                            created_by=admin_user.id,
                        )
                        session.add(new_perm)
                        perm_created += 1

            await session.commit()

            # ====== 输出结果 ======
            total_modules = len(ALL_MODULES)
            total_operations = len(ALL_OPERATIONS)

            print(f"\n📋  权限配置完成:")
            print(f"   覆盖模块数: {total_modules}")
            print(f"   操作类型数: {total_operations}")
            print(f"   新建/更新权限: {perm_created} 条")
            print(f"   已存在权限: {perm_skipped} 条")
            print(f"   权限总计: {total_modules * total_operations} 条")

            print(f"\n🎉  超级管理员配置完成！")
            print(f"   登录地址: http://localhost:5173/login")
            print(f"   用户名: {ADMIN_CONFIG['username']}")
            print(f"   用户类型: 内部员工 (internal)")

        except Exception as e:
            await session.rollback()
            print(f"\n❌  创建失败: {e}")
            raise


if __name__ == "__main__":
    print("=" * 50)
    print("  QMS 质量管理系统 - 初始化超级管理员")
    print("=" * 50)
    print()
    asyncio.run(create_admin())
