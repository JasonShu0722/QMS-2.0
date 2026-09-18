"""add_role_tag_permission_tables

Revision ID: 1d9a6b5c3f20
Revises: 4d2c8f1b7e3a
Create Date: 2026-04-12 12:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "1d9a6b5c3f20"
down_revision = "4d2c8f1b7e3a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "role_tags",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("role_key", sa.String(length=100), nullable=False, comment="角色唯一键"),
        sa.Column("role_name", sa.String(length=100), nullable=False, comment="角色名称"),
        sa.Column("description", sa.String(length=255), nullable=True, comment="角色描述"),
        sa.Column(
            "applicable_user_type",
            sa.Enum("INTERNAL", "SUPPLIER", name="usertype", native_enum=False, length=20),
            nullable=True,
            comment="适用用户类型，为空表示全部",
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, comment="是否启用"),
        sa.Column("created_at", sa.DateTime(), nullable=False, comment="创建时间"),
        sa.Column("updated_at", sa.DateTime(), nullable=False, comment="更新时间"),
        sa.Column("created_by", sa.Integer(), nullable=True, comment="创建人ID"),
        sa.Column("updated_by", sa.Integer(), nullable=True, comment="更新人ID"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_role_tags_id"), "role_tags", ["id"], unique=False)
    op.create_index(op.f("ix_role_tags_is_active"), "role_tags", ["is_active"], unique=False)
    op.create_index(op.f("ix_role_tags_role_key"), "role_tags", ["role_key"], unique=True)
    op.create_index(
        op.f("ix_role_tags_applicable_user_type"),
        "role_tags",
        ["applicable_user_type"],
        unique=False,
    )

    op.create_table(
        "role_permissions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("role_tag_id", sa.Integer(), nullable=False, comment="角色标签ID"),
        sa.Column("module_path", sa.String(length=255), nullable=False, comment="功能模块路径"),
        sa.Column(
            "operation_type",
            sa.Enum("CREATE", "READ", "UPDATE", "DELETE", "EXPORT", name="operationtype", native_enum=False, length=20),
            nullable=False,
            comment="操作类型",
        ),
        sa.Column("is_granted", sa.Boolean(), nullable=False, comment="是否授予"),
        sa.Column("created_at", sa.DateTime(), nullable=False, comment="创建时间"),
        sa.Column("updated_at", sa.DateTime(), nullable=False, comment="更新时间"),
        sa.Column("created_by", sa.Integer(), nullable=True, comment="创建人ID"),
        sa.Column("updated_by", sa.Integer(), nullable=True, comment="更新人ID"),
        sa.ForeignKeyConstraint(["role_tag_id"], ["role_tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("role_tag_id", "module_path", "operation_type", name="uq_role_module_operation"),
    )
    op.create_index(op.f("ix_role_permissions_id"), "role_permissions", ["id"], unique=False)
    op.create_index(op.f("ix_role_permissions_role_tag_id"), "role_permissions", ["role_tag_id"], unique=False)
    op.create_index(op.f("ix_role_permissions_module_path"), "role_permissions", ["module_path"], unique=False)
    op.create_index(op.f("ix_role_permissions_operation_type"), "role_permissions", ["operation_type"], unique=False)

    op.create_table(
        "user_role_assignments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False, comment="用户ID"),
        sa.Column("role_tag_id", sa.Integer(), nullable=False, comment="角色标签ID"),
        sa.Column("assigned_at", sa.DateTime(), nullable=False, comment="分配时间"),
        sa.Column("assigned_by", sa.Integer(), nullable=True, comment="分配人ID"),
        sa.ForeignKeyConstraint(["role_tag_id"], ["role_tags.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "role_tag_id", name="uq_user_role_assignment"),
    )
    op.create_index(op.f("ix_user_role_assignments_id"), "user_role_assignments", ["id"], unique=False)
    op.create_index(op.f("ix_user_role_assignments_user_id"), "user_role_assignments", ["user_id"], unique=False)
    op.create_index(op.f("ix_user_role_assignments_role_tag_id"), "user_role_assignments", ["role_tag_id"], unique=False)


def downgrade() -> None:
    raise NotImplementedError(
        "This migration is intentionally forward-only. "
        "Destructive downgrade operations are disabled by repository policy."
    )
