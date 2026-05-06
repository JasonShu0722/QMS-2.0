"""add_customer_8d_report_number

Revision ID: a6b5c4d3e2f1
Revises: c1d2e3f4a5b6
Create Date: 2026-04-29 18:10:00
"""

from alembic import op
import sqlalchemy as sa


revision = "a6b5c4d3e2f1"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "eight_d_customer",
        sa.Column("report_number", sa.String(length=30), nullable=True, comment="8D report number"),
    )
    op.create_index(
        "ix_eight_d_customer_report_number",
        "eight_d_customer",
        ["report_number"],
        unique=True,
    )


def downgrade() -> None:
    raise NotImplementedError(
        "This migration is intentionally forward-only. "
        "Destructive downgrade operations are disabled by repository policy."
    )
