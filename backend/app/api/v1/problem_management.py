"""
Shared problem-management metadata and first-batch read-only issue summary APIs.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.problem_management import (
    EIGHT_D_NUMBER_PREFIX,
    ISSUE_NUMBER_PREFIX,
    PROBLEM_CATEGORY_CATALOG,
    HandlingLevel,
    ResponseMode,
)
from app.models.user import User
from app.schemas.problem_management import (
    InternalUserOption,
    NumberingRuleItem,
    ProblemReportBriefResponse,
    ProblemReportClose,
    ProblemReportCreate,
    ProblemReportResponse,
    ProblemReportReview,
    ProblemReportSourcesUpdate,
    ProblemCategoryItem,
    ProblemIssueSummaryListResponse,
    ProblemIssueSummaryQuery,
    ProblemManagementCatalogResponse,
    UnifiedProblemStatus,
)
from app.services.problem_management_service import ProblemManagementService

router = APIRouter(
    prefix="/problem-management",
    tags=["Problem Management - Shared Capabilities"],
)


@router.get(
    "/catalog",
    response_model=ProblemManagementCatalogResponse,
    summary="Get shared problem-management catalog",
)
async def get_problem_management_catalog(
    current_user: User = Depends(get_current_user),
):
    """Return the confirmed cross-module problem-management metadata."""

    return ProblemManagementCatalogResponse(
        response_modes=[mode.value for mode in ResponseMode],
        handling_levels=[level.value for level in HandlingLevel],
        categories=[
            ProblemCategoryItem(
                key=item.key,
                category_code=item.category_code,
                subcategory_code=item.subcategory_code,
                module_key=item.module_key,
                label=item.label,
            )
            for item in PROBLEM_CATEGORY_CATALOG.values()
        ],
        numbering_rule=NumberingRuleItem(
            issue_prefix=ISSUE_NUMBER_PREFIX,
            report_prefix=EIGHT_D_NUMBER_PREFIX,
            issue_pattern="ZXQ-<分类子类>-<YYMM>-<SEQ3>",
            report_pattern="ZX8D-<分类子类>-<YYMM>-<SEQ3>",
        ),
    )


@router.get(
    "/internal-users",
    response_model=list[InternalUserOption],
    summary="Get shared internal assignment user options",
)
async def list_internal_user_options(
    keyword: str | None = Query(None, description="Keyword"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return active internal users for cross-module assignment dialogs."""

    return await ProblemManagementService.list_internal_user_options(
        db=db,
        keyword=keyword,
    )


@router.post(
    "/reports",
    response_model=ProblemReportResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a formal problem report",
)
async def create_problem_report(
    report_data: ProblemReportCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a ZXQ formal problem report from one or more source ledgers."""

    try:
        report = await ProblemManagementService.create_problem_report(
            db=db,
            report_data=report_data,
            created_by=current_user.id,
        )
        return ProblemManagementService.build_report_response(report)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "/reports/{report_id}",
    response_model=ProblemReportResponse,
    summary="Get a formal problem report",
)
async def get_problem_report(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ = current_user
    report = await ProblemManagementService.get_report_by_id(db, report_id)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Problem report not found")
    return ProblemManagementService.build_report_response(report)


@router.put(
    "/reports/{report_id}/sources",
    response_model=ProblemReportResponse,
    summary="Replace the source range of a formal problem report",
)
async def update_problem_report_sources(
    report_id: int,
    source_data: ProblemReportSourcesUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ = current_user
    try:
        report = await ProblemManagementService.replace_report_sources(
            db=db,
            report_id=report_id,
            source_data=source_data,
        )
        return ProblemManagementService.build_report_response(report)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post(
    "/reports/{report_id}/brief-response",
    response_model=ProblemReportResponse,
    summary="Submit a brief response for a formal problem report",
)
async def submit_problem_report_brief_response(
    report_id: int,
    response_data: ProblemReportBriefResponse,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        report = await ProblemManagementService.submit_brief_response(
            db=db,
            report_id=report_id,
            response_data=response_data,
            user_id=current_user.id,
        )
        return ProblemManagementService.build_report_response(report)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/reports/{report_id}/review",
    response_model=ProblemReportResponse,
    summary="Review a formal problem report response",
)
async def review_problem_report(
    report_id: int,
    review_data: ProblemReportReview,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        report = await ProblemManagementService.review_problem_report(
            db=db,
            report_id=report_id,
            review_data=review_data,
            reviewer_id=current_user.id,
        )
        return ProblemManagementService.build_report_response(report)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/reports/{report_id}/close",
    response_model=ProblemReportResponse,
    summary="Close a formal problem report",
)
async def close_problem_report(
    report_id: int,
    close_data: ProblemReportClose,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        report = await ProblemManagementService.close_problem_report(
            db=db,
            report_id=report_id,
            close_data=close_data,
            closed_by=current_user.id,
        )
        return ProblemManagementService.build_report_response(report)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "/issues",
    response_model=ProblemIssueSummaryListResponse,
    summary="Get first-batch unified problem summaries",
)
async def list_problem_issue_summaries(
    module_key: str | None = Query(None, description="Module key"),
    problem_category_key: str | None = Query(None, description="Problem category key"),
    risk_level: str | None = Query(None, description="Risk level"),
    response_mode: str | None = Query(None, description="Response mode"),
    unified_status: UnifiedProblemStatus | None = Query(None, description="Unified status"),
    keyword: str | None = Query(None, description="Keyword"),
    only_assigned_to_me: bool = Query(False, description="Only include items assigned to the current user"),
    only_actionable_to_me: bool = Query(
        False,
        description="Only include items that the current user can handle directly from the problem center",
    ),
    only_created_by_me: bool = Query(False, description="Only include items created by the current user"),
    only_overdue: bool = Query(False, description="Only include overdue items"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Page size"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the first read-only unified issue summary list across confirmed modules."""

    query = ProblemIssueSummaryQuery(
        module_key=module_key,
        problem_category_key=problem_category_key,
        risk_level=risk_level,
        response_mode=response_mode,
        unified_status=unified_status,
        keyword=keyword,
        only_assigned_to_me=only_assigned_to_me,
        only_actionable_to_me=only_actionable_to_me,
        only_created_by_me=only_created_by_me,
        only_overdue=only_overdue,
        page=page,
        page_size=page_size,
    )

    return await ProblemManagementService.list_problem_issue_summaries(
        db=db,
        current_user=current_user,
        query=query,
    )
