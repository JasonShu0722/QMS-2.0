"""add_customer_complaint_disposition_fields

Revision ID: 7b1c3d4e5f62
Revises: f94e2a1c7b8d
Create Date: 2026-04-21 23:55:00
"""

from alembic import op
import sqlalchemy as sa


revision = "7b1c3d4e5f62"
down_revision = "f94e2a1c7b8d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    disposition_status_enum = sa.Enum(
        "pending",
        "in_progress",
        "completed",
        name="physicaldispositionstatus",
    )
    disposition_status_enum.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "customer_complaints",
        sa.Column(
            "physical_disposition_status", disposition_status_enum,
            nullable=False,
            server_default="pending",
            comment="实物处理备案状态",
        ),
    )
    op.add_column(
        "customer_complaints",
        sa.Column("physical_disposition_plan", sa.Text(), nullable=True, comment="实物处理方案"),
    )
    op.add_column(
        "customer_complaints",
        sa.Column("physical_disposition_notes", sa.Text(), nullable=True, comment="实物处理备注"),
    )
    op.add_column(
        "customer_complaints",
        sa.Column("physical_disposition_updated_at", sa.DateTime(), nullable=True, comment="实物处理更新时间"),
    )
    op.add_column(
        "customer_complaints",
        sa.Column("physical_disposition_updated_by", sa.Integer(), nullable=True, comment="实物处理更新人 ID"),
    )
    op.create_foreign_key(
        "fk_customer_complaints_disposition_updated_by",
        "customer_complaints",
        "users",
        ["physical_disposition_updated_by"],
        ["id"],
    )
    op.alter_column("customer_complaints", "physical_disposition_status", server_default=None)


def downgrade() -> None:
    raise NotImplementedError(
        "This migration is intentionally forward-only. "
        "Destructive downgrade operations are disabled by repository policy."
    )
