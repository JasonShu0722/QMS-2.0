"""add_customer_master_table

Revision ID: 2c8b0e4d5f61
Revises: 1d9a6b5c3f20
Create Date: 2026-04-21 21:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "2c8b0e4d5f61"
down_revision = "1d9a6b5c3f20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "customers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=False, comment="客户代码"),
        sa.Column("name", sa.String(length=200), nullable=False, comment="客户名称"),
        sa.Column("contact_person", sa.String(length=100), nullable=True, comment="联系人"),
        sa.Column("contact_email", sa.String(length=100), nullable=True, comment="联系邮箱"),
        sa.Column("contact_phone", sa.String(length=20), nullable=True, comment="联系电话"),
        sa.Column(
            "status",
            sa.Enum("ACTIVE", "SUSPENDED", name="customerstatus", native_enum=False, length=20),
            nullable=False,
            comment="客户状态",
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False, comment="创建时间"),
        sa.Column("updated_at", sa.DateTime(), nullable=False, comment="更新时间"),
        sa.Column("created_by", sa.Integer(), nullable=True, comment="创建人ID"),
        sa.Column("updated_by", sa.Integer(), nullable=True, comment="更新人ID"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_customers_id"), "customers", ["id"], unique=False)
    op.create_index(op.f("ix_customers_code"), "customers", ["code"], unique=True)
    op.create_index(op.f("ix_customers_name"), "customers", ["name"], unique=False)
    op.create_index(op.f("ix_customers_status"), "customers", ["status"], unique=False)


def downgrade() -> None:
    raise NotImplementedError(
        "This migration is intentionally forward-only. "
        "Destructive downgrade operations are disabled by repository policy."
    )
