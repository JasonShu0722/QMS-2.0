"""feature_flag_env_unique

Revision ID: 4d2c8f1b7e3a
Revises: 9c4d8e7a2b11
Create Date: 2026-03-31 10:15:00
"""

from alembic import op
import sqlalchemy as sa


revision = "4d2c8f1b7e3a"
down_revision = "9c4d8e7a2b11"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_feature_flags_feature_key", table_name="feature_flags")
    op.create_index("ix_feature_flags_feature_key", "feature_flags", ["feature_key"], unique=False)
    op.create_unique_constraint(
        "uq_feature_flags_key_environment",
        "feature_flags",
        ["feature_key", "environment"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_feature_flags_key_environment", "feature_flags", type_="unique")
    op.drop_index("ix_feature_flags_feature_key", table_name="feature_flags")
    op.create_index("ix_feature_flags_feature_key", "feature_flags", ["feature_key"], unique=True)
