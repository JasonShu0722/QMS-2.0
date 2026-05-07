"""add_scar_material_category

Revision ID: d4e5f6a7b8c9
Revises: a6b5c4d3e2f1
Create Date: 2026-05-07 14:45:00
"""

from alembic import op
import sqlalchemy as sa


revision = "d4e5f6a7b8c9"
down_revision = "a6b5c4d3e2f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "scars",
        sa.Column(
            "material_category",
            sa.String(length=20),
            nullable=True,
            comment="Incoming material category: structure/electronic",
        ),
    )
    op.create_index(
        "ix_scars_material_category",
        "scars",
        ["material_category"],
    )


def downgrade() -> None:
    raise NotImplementedError(
        "This migration is intentionally forward-only. "
        "Destructive downgrade operations are disabled by repository policy."
    )
