"""expand_customer_complaint_ledger_fields

Revision ID: f94e2a1c7b8d
Revises: 2c8b0e4d5f61
Create Date: 2026-04-21 22:30:00
"""

from alembic import op
import sqlalchemy as sa


revision = "f94e2a1c7b8d"
down_revision = "2c8b0e4d5f61"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "customer_complaints",
        sa.Column("customer_id", sa.Integer(), nullable=True, comment="客户主数据ID"),
    )
    op.add_column(
        "customer_complaints",
        sa.Column("customer_name_snapshot", sa.String(length=200), nullable=True, comment="客户名称快照"),
    )
    op.add_column(
        "customer_complaints",
        sa.Column("end_customer_name", sa.String(length=200), nullable=True, comment="终端客户名称"),
    )
    op.add_column(
        "customer_complaints",
        sa.Column(
            "is_return_required", sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
            comment="是否涉及退件",
        ),
    )
    op.add_column(
        "customer_complaints",
        sa.Column(
            "requires_physical_analysis", sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
            comment="是否需要实物解析",
        ),
    )
    op.create_index(op.f("ix_customer_complaints_customer_id"), "customer_complaints", ["customer_id"], unique=False)
    op.create_foreign_key(
        "fk_customer_complaints_customer_id",
        "customer_complaints",
        "customers",
        ["customer_id"],
        ["id"],
    )
    op.execute(
        """
        UPDATE customer_complaints
        SET customer_name_snapshot = customer_code
        WHERE customer_name_snapshot IS NULL
        """
    )
    op.alter_column("customer_complaints", "is_return_required", server_default=None)
    op.alter_column("customer_complaints", "requires_physical_analysis", server_default=None)


def downgrade() -> None:
    raise NotImplementedError(
        "This migration is intentionally forward-only. "
        "Destructive downgrade operations are disabled by repository policy."
    )
