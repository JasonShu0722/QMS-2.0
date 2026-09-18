"""add after sales complaint fields

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-05-29 11:45:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b8c9d0e1f2a3"
down_revision: Union[str, None] = "a7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("customer_complaints", sa.Column("return_month", sa.String(length=20), nullable=True, comment="退件月份"))
    op.add_column("customer_complaints", sa.Column("service_months", sa.Integer(), nullable=True, comment="服务月数"))
    op.add_column(
        "customer_complaints",
        sa.Column("service_month_category", sa.String(length=50), nullable=True, comment="服务月分类"),
    )
    op.add_column(
        "customer_complaints",
        sa.Column("mileage_category", sa.String(length=50), nullable=True, comment="里程分类"),
    )


def downgrade() -> None:
    raise NotImplementedError(
        "This migration is intentionally forward-only. "
        "Destructive downgrade operations are disabled by repository policy."
    )
