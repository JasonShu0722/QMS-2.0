"""fix allowed_environments column

Revision ID: 6f3b2d4c1a9e
Revises: 0255a0347193
Create Date: 2026-03-30 10:30:00+08:00

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = "6f3b2d4c1a9e"
down_revision = "0255a0347193"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("users")}

    if "allowed_environments" not in columns:
        op.add_column(
            "users",
            sa.Column(
                "allowed_environments",
                sa.String(length=50),
                nullable=True,
                server_default="stable",
                comment="??????????????????",
            ),
        )


def downgrade() -> None:
    raise NotImplementedError(
        "This migration is intentionally forward-only. "
        "Destructive downgrade operations are disabled by repository policy."
    )
