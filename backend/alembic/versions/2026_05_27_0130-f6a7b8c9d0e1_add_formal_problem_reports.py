"""add formal problem reports

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-05-27 01:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "problem_reports",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("problem_number", sa.String(length=50), nullable=False),
        sa.Column("eight_d_number", sa.String(length=50), nullable=True),
        sa.Column("module_key", sa.String(length=50), nullable=False),
        sa.Column("problem_category_key", sa.String(length=10), nullable=False),
        sa.Column("problem_category_label", sa.String(length=100), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("risk_level", sa.String(length=20), nullable=False),
        sa.Column("response_mode", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("responsible_dept", sa.String(length=100), nullable=True),
        sa.Column("assigned_to", sa.Integer(), nullable=True),
        sa.Column("action_owner_id", sa.Integer(), nullable=True),
        sa.Column("owner_id", sa.Integer(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("verified_by", sa.Integer(), nullable=True),
        sa.Column("closed_by", sa.Integer(), nullable=True),
        sa.Column("brief_response", sa.JSON(), nullable=True),
        sa.Column("eight_d_payload", sa.JSON(), nullable=True),
        sa.Column("due_at", sa.DateTime(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.Column("rejected_reason", sa.Text(), nullable=True),
        sa.Column("reopened_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["action_owner_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["assigned_to"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["closed_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["verified_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_problem_reports_id"), "problem_reports", ["id"], unique=False)
    op.create_index(op.f("ix_problem_reports_problem_number"), "problem_reports", ["problem_number"], unique=True)
    op.create_index(op.f("ix_problem_reports_eight_d_number"), "problem_reports", ["eight_d_number"], unique=True)
    op.create_index(op.f("ix_problem_reports_module_key"), "problem_reports", ["module_key"], unique=False)
    op.create_index(op.f("ix_problem_reports_problem_category_key"), "problem_reports", ["problem_category_key"], unique=False)
    op.create_index(op.f("ix_problem_reports_risk_level"), "problem_reports", ["risk_level"], unique=False)
    op.create_index(op.f("ix_problem_reports_response_mode"), "problem_reports", ["response_mode"], unique=False)
    op.create_index(op.f("ix_problem_reports_status"), "problem_reports", ["status"], unique=False)
    op.create_index(op.f("ix_problem_reports_assigned_to"), "problem_reports", ["assigned_to"], unique=False)
    op.create_index(op.f("ix_problem_reports_action_owner_id"), "problem_reports", ["action_owner_id"], unique=False)
    op.create_index(op.f("ix_problem_reports_owner_id"), "problem_reports", ["owner_id"], unique=False)
    op.create_index(op.f("ix_problem_reports_created_by"), "problem_reports", ["created_by"], unique=False)
    op.create_index(op.f("ix_problem_reports_due_at"), "problem_reports", ["due_at"], unique=False)

    op.create_table(
        "problem_report_sources",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("problem_report_id", sa.Integer(), nullable=False),
        sa.Column("source_type", sa.String(length=50), nullable=False),
        sa.Column("source_id", sa.Integer(), nullable=False),
        sa.Column("source_parent_id", sa.Integer(), nullable=True),
        sa.Column("source_number", sa.String(length=100), nullable=True),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["problem_report_id"], ["problem_reports.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_type", "source_id", "problem_report_id", name="uq_problem_report_source"),
    )
    op.create_index(op.f("ix_problem_report_sources_id"), "problem_report_sources", ["id"], unique=False)
    op.create_index(op.f("ix_problem_report_sources_problem_report_id"), "problem_report_sources", ["problem_report_id"], unique=False)
    op.create_index(op.f("ix_problem_report_sources_source_type"), "problem_report_sources", ["source_type"], unique=False)
    op.create_index(op.f("ix_problem_report_sources_source_id"), "problem_report_sources", ["source_id"], unique=False)
    op.create_index(op.f("ix_problem_report_sources_source_parent_id"), "problem_report_sources", ["source_parent_id"], unique=False)

    op.add_column("process_defects", sa.Column("defect_number", sa.String(length=50), nullable=True))
    op.create_index(op.f("ix_process_defects_defect_number"), "process_defects", ["defect_number"], unique=True)

    op.add_column("process_issues", sa.Column("problem_report_id", sa.Integer(), nullable=True))
    op.create_index(op.f("ix_process_issues_problem_report_id"), "process_issues", ["problem_report_id"], unique=False)
    op.create_foreign_key(
        "fk_process_issues_problem_report_id_problem_reports",
        "process_issues",
        "problem_reports",
        ["problem_report_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.add_column("trial_issues", sa.Column("problem_report_id", sa.Integer(), nullable=True))
    op.create_index(op.f("ix_trial_issues_problem_report_id"), "trial_issues", ["problem_report_id"], unique=False)
    op.create_foreign_key(
        "fk_trial_issues_problem_report_id_problem_reports",
        "trial_issues",
        "problem_reports",
        ["problem_report_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "new_product_defects",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("defect_number", sa.String(length=50), nullable=False),
        sa.Column("source_type", sa.String(length=30), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("defect_date", sa.Date(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("trial_id", sa.Integer(), nullable=True),
        sa.Column("customer_name", sa.String(length=200), nullable=True),
        sa.Column("customer_complaint_number", sa.String(length=100), nullable=True),
        sa.Column("product_code", sa.String(length=100), nullable=True),
        sa.Column("product_name", sa.String(length=200), nullable=True),
        sa.Column("defect_type", sa.String(length=200), nullable=False),
        sa.Column("defect_description", sa.Text(), nullable=False),
        sa.Column("defect_qty", sa.Integer(), nullable=True),
        sa.Column("responsible_dept", sa.String(length=100), nullable=True),
        sa.Column("recorded_by", sa.Integer(), nullable=False),
        sa.Column("problem_report_id", sa.Integer(), nullable=True),
        sa.Column("remarks", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["problem_report_id"], ["problem_reports.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["new_product_projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["recorded_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["trial_id"], ["trial_productions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_new_product_defects_id"), "new_product_defects", ["id"], unique=False)
    op.create_index(op.f("ix_new_product_defects_defect_number"), "new_product_defects", ["defect_number"], unique=True)
    op.create_index(op.f("ix_new_product_defects_source_type"), "new_product_defects", ["source_type"], unique=False)
    op.create_index(op.f("ix_new_product_defects_status"), "new_product_defects", ["status"], unique=False)
    op.create_index(op.f("ix_new_product_defects_defect_date"), "new_product_defects", ["defect_date"], unique=False)
    op.create_index(op.f("ix_new_product_defects_project_id"), "new_product_defects", ["project_id"], unique=False)
    op.create_index(op.f("ix_new_product_defects_trial_id"), "new_product_defects", ["trial_id"], unique=False)
    op.create_index(op.f("ix_new_product_defects_customer_name"), "new_product_defects", ["customer_name"], unique=False)
    op.create_index(op.f("ix_new_product_defects_customer_complaint_number"), "new_product_defects", ["customer_complaint_number"], unique=False)
    op.create_index(op.f("ix_new_product_defects_product_code"), "new_product_defects", ["product_code"], unique=False)
    op.create_index(op.f("ix_new_product_defects_recorded_by"), "new_product_defects", ["recorded_by"], unique=False)
    op.create_index(op.f("ix_new_product_defects_problem_report_id"), "new_product_defects", ["problem_report_id"], unique=False)


def downgrade() -> None:
    pass
