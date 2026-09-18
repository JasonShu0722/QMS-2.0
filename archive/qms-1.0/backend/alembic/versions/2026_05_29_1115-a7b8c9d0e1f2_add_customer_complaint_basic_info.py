"""add customer complaint basic information fields

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-05-29 11:15:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, None] = "f6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("customer_complaints", sa.Column("received_date", sa.Date(), nullable=True, comment="收件日期"))
    op.add_column("customer_complaints", sa.Column("occurrence_date", sa.Date(), nullable=True, comment="发生/故障日期"))
    op.add_column("customer_complaints", sa.Column("production_date", sa.Date(), nullable=True, comment="生产/出厂日期"))
    op.add_column("customer_complaints", sa.Column("product_model", sa.String(length=100), nullable=True, comment="产品型号"))
    op.add_column("customer_complaints", sa.Column("project_stage", sa.String(length=100), nullable=True, comment="项目阶段"))
    op.add_column("customer_complaints", sa.Column("batch_code", sa.String(length=100), nullable=True, comment="批次号/条码"))
    op.add_column("customer_complaints", sa.Column("trace_code", sa.String(length=100), nullable=True, comment="产品追溯码"))
    op.add_column("customer_complaints", sa.Column("return_type", sa.String(length=50), nullable=True, comment="零星退件/集中退件"))
    op.add_column("customer_complaints", sa.Column("dealer_name", sa.String(length=200), nullable=True, comment="4S 店名称"))
    op.add_column("customer_complaints", sa.Column("occurrence_region", sa.String(length=100), nullable=True, comment="发生区域"))
    op.add_column("customer_complaints", sa.Column("fault_category", sa.String(length=100), nullable=True, comment="故障分类"))
    op.add_column("customer_complaints", sa.Column("service_method", sa.String(length=100), nullable=True, comment="服务方式"))
    op.add_column("customer_complaints", sa.Column("analysis_priority", sa.String(length=50), nullable=True, comment="解析优先级"))
    op.add_column("customer_complaints", sa.Column("failure_count", sa.Integer(), nullable=True, comment="故障数"))


def downgrade() -> None:
    raise NotImplementedError(
        "This migration is intentionally forward-only. "
        "Destructive downgrade operations are disabled by repository policy."
    )
