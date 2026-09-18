"""add_customer_8d_complaint_links

Revision ID: c1d2e3f4a5b6
Revises: 91c2d3e4f563
Create Date: 2026-04-22 14:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "c1d2e3f4a5b6"
down_revision = "91c2d3e4f563"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "eight_d_customer_complaint_links",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("report_id", sa.Integer(), nullable=False, comment="8D report id"),
        sa.Column("complaint_id", sa.Integer(), nullable=False, comment="Complaint id"),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.false(), comment="Whether this complaint is the primary source record"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP"), comment="Created at"),
        sa.ForeignKeyConstraint(["report_id"], ["eight_d_customer.id"]),
        sa.ForeignKeyConstraint(["complaint_id"], ["customer_complaints.id"]),
        sa.UniqueConstraint("report_id", "complaint_id", name="uq_eight_d_customer_complaint_link"),
    )
    op.create_index(
        "ix_eight_d_customer_complaint_links_report_id",
        "eight_d_customer_complaint_links",
        ["report_id"],
    )
    op.create_index(
        "ix_eight_d_customer_complaint_links_complaint_id",
        "eight_d_customer_complaint_links",
        ["complaint_id"],
    )

    op.execute(
        """
        INSERT INTO eight_d_customer_complaint_links (report_id, complaint_id, is_primary, created_at)
        SELECT id, complaint_id, TRUE, CURRENT_TIMESTAMP
        FROM eight_d_customer
        """
    )

    op.alter_column("eight_d_customer_complaint_links", "is_primary", server_default=None)
    op.alter_column("eight_d_customer_complaint_links", "created_at", server_default=None)


def downgrade() -> None:
    raise NotImplementedError(
        "This migration is intentionally forward-only. "
        "Destructive downgrade operations are disabled by repository policy."
    )
