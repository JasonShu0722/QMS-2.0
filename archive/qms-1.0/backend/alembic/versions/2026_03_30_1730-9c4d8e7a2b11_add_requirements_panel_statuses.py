"""add requirements panel users and statuses

Revision ID: 9c4d8e7a2b11
Revises: 6f3b2d4c1a9e
Create Date: 2026-03-30 17:30:00+08:00

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = "9c4d8e7a2b11"
down_revision = "6f3b2d4c1a9e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if "requirements_panel_users" not in inspector.get_table_names():
        op.create_table(
            "requirements_panel_users",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("username", sa.String(length=50), nullable=False),
            sa.Column("password_hash", sa.String(length=255), nullable=False),
            sa.Column("full_name", sa.String(length=100), nullable=False),
            sa.Column("role", sa.String(length=20), nullable=False, comment="admin/viewer"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("last_login_at", sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("username"),
        )
        op.create_index(
            op.f("ix_requirements_panel_users_id"),
            "requirements_panel_users",
            ["id"],
            unique=False,
        )
        op.create_index(
            op.f("ix_requirements_panel_users_is_active"),
            "requirements_panel_users",
            ["is_active"],
            unique=False,
        )
        op.create_index(
            op.f("ix_requirements_panel_users_role"),
            "requirements_panel_users",
            ["role"],
            unique=False,
        )
        op.create_index(
            op.f("ix_requirements_panel_users_username"),
            "requirements_panel_users",
            ["username"],
            unique=True,
        )

    if "requirements_panel_statuses" not in inspector.get_table_names():
        op.create_table(
            "requirements_panel_statuses",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("item_id", sa.String(length=120), nullable=False, comment="Requirement item identifier"),
            sa.Column("status", sa.String(length=20), nullable=False, comment="Requirement status value"),
            sa.Column("updated_at", sa.DateTime(), nullable=False, comment="Last updated time"),
            sa.Column(
                "updated_by",
                sa.Integer(),
                sa.ForeignKey("requirements_panel_users.id", ondelete="SET NULL"),
                nullable=True,
                comment="Panel user ID who last updated the status",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("item_id", name="uq_requirements_panel_item_id"),
        )
        op.create_index(
            op.f("ix_requirements_panel_statuses_id"),
            "requirements_panel_statuses",
            ["id"],
            unique=False,
        )
        op.create_index(
            op.f("ix_requirements_panel_statuses_item_id"),
            "requirements_panel_statuses",
            ["item_id"],
            unique=True,
        )
        op.create_index(
            op.f("ix_requirements_panel_statuses_status"),
            "requirements_panel_statuses",
            ["status"],
            unique=False,
        )


def downgrade() -> None:
    # This repository forbids destructive migration operations such as
    # drop_table/drop_column in order to stay compatible with stable deployments.
    # Keep this migration forward-only and perform any eventual cleanup in a
    # later non-destructive migration sequence after all environments converge.
    raise NotImplementedError(
        "This migration is intentionally forward-only. "
        "Destructive downgrade operations are disabled by repository policy."
    )
