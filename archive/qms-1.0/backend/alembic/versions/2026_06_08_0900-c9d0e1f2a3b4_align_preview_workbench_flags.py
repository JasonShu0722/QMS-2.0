"""Align preview workbench baseline feature flags.

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-06-08 09:00:00.000000
"""

from typing import Union

from alembic import op


revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, None] = "b8c9d0e1f2a3"
branch_labels: Union[str, tuple[str, ...], None] = None
depends_on: Union[str, tuple[str, ...], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE feature_flags
        SET is_enabled = FALSE
        WHERE environment = 'PREVIEW'
          AND feature_key IN (
              'foundation.workbench.metrics',
              'foundation.workbench.announcements'
          )
          AND created_by IS NULL
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE feature_flags
        SET is_enabled = TRUE
        WHERE environment = 'PREVIEW'
          AND feature_key IN (
              'foundation.workbench.metrics',
              'foundation.workbench.announcements'
          )
          AND created_by IS NULL
        """
    )
