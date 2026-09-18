"""add_customer_complaint_analysis_fields

Revision ID: 91c2d3e4f563
Revises: 7b1c3d4e5f62
Create Date: 2026-04-22 00:30:00
"""

from alembic import op
import sqlalchemy as sa


revision = "91c2d3e4f563"
down_revision = "7b1c3d4e5f62"
branch_labels = None
depends_on = None


def upgrade() -> None:
    analysis_status_enum = sa.Enum(
        "pending",
        "assigned",
        "completed",
        name="physicalanalysisstatus",
    )
    analysis_status_enum.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "customer_complaints",
        sa.Column(
            "physical_analysis_status", analysis_status_enum,
            nullable=False,
            server_default="pending",
            comment="实物解析任务状态",
        ),
    )
    op.add_column(
        "customer_complaints",
        sa.Column("physical_analysis_responsible_dept", sa.String(length=100), nullable=True, comment="实物解析责任部门"),
    )
    op.add_column(
        "customer_complaints",
        sa.Column("physical_analysis_responsible_user_id", sa.Integer(), nullable=True, comment="实物解析责任人 ID"),
    )
    op.add_column(
        "customer_complaints",
        sa.Column("failed_part_number", sa.String(length=100), nullable=True, comment="失效零部件料号"),
    )
    op.add_column(
        "customer_complaints",
        sa.Column("physical_analysis_summary", sa.Text(), nullable=True, comment="一次原因分析"),
    )
    op.add_column(
        "customer_complaints",
        sa.Column("physical_analysis_notes", sa.Text(), nullable=True, comment="实物解析备注"),
    )
    op.add_column(
        "customer_complaints",
        sa.Column("physical_analysis_updated_at", sa.DateTime(), nullable=True, comment="实物解析更新时间"),
    )
    op.add_column(
        "customer_complaints",
        sa.Column("physical_analysis_updated_by", sa.Integer(), nullable=True, comment="实物解析更新人 ID"),
    )
    op.create_foreign_key(
        "fk_customer_complaints_analysis_responsible_user",
        "customer_complaints",
        "users",
        ["physical_analysis_responsible_user_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_customer_complaints_analysis_updated_by",
        "customer_complaints",
        "users",
        ["physical_analysis_updated_by"],
        ["id"],
    )
    op.alter_column("customer_complaints", "physical_analysis_status", server_default=None)


def downgrade() -> None:
    raise NotImplementedError(
        "This migration is intentionally forward-only. "
        "Destructive downgrade operations are disabled by repository policy."
    )
