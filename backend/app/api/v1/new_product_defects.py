"""New product defect source ledger APIs."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.new_product_defect import (
    NewProductDefectCreate,
    NewProductDefectListResponse,
    NewProductDefectProblemReportCreate,
    NewProductDefectProblemReportResponse,
    NewProductDefectResponse,
    NewProductDefectUpdate,
)
from app.services.new_product_defect_service import NewProductDefectService
from app.services.problem_management_service import ProblemManagementService


router = APIRouter(prefix="/new-product-defects", tags=["New Product Defects"])


def _build_response(defect) -> NewProductDefectResponse:
    response = NewProductDefectResponse.model_validate(defect)
    report = getattr(defect, "problem_report", None)
    if report:
        response.problem_number = report.problem_number
        response.eight_d_number = report.eight_d_number
    if getattr(defect, "problem_number", None):
        response.problem_number = defect.problem_number
    if getattr(defect, "eight_d_number", None):
        response.eight_d_number = defect.eight_d_number
    return response


@router.post("", response_model=NewProductDefectResponse, status_code=status.HTTP_201_CREATED)
async def create_new_product_defect(
    defect_data: NewProductDefectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        defect = await NewProductDefectService.create_defect(
            db=db,
            defect_data=defect_data,
            recorded_by=current_user.id,
        )
        return _build_response(defect)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("", response_model=NewProductDefectListResponse)
async def list_new_product_defects(
    source_type: str | None = Query(None),
    keyword: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ = current_user
    defects, total = await NewProductDefectService.list_defects(
        db=db,
        source_type=source_type,
        keyword=keyword,
        page=page,
        page_size=page_size,
    )
    await NewProductDefectService.attach_problem_report_numbers(db, defects)
    return NewProductDefectListResponse(
        items=[_build_response(defect) for defect in defects],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{defect_id}", response_model=NewProductDefectResponse)
async def get_new_product_defect(
    defect_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ = current_user
    defect = await NewProductDefectService.get_defect_by_id(db, defect_id)
    if not defect:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="New product defect not found")
    await NewProductDefectService.attach_problem_report_numbers(db, [defect])
    return _build_response(defect)


@router.put("/{defect_id}", response_model=NewProductDefectResponse)
async def update_new_product_defect(
    defect_id: int,
    defect_data: NewProductDefectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ = current_user
    try:
        defect = await NewProductDefectService.update_defect(db, defect_id, defect_data)
        await NewProductDefectService.attach_problem_report_numbers(db, [defect])
        return _build_response(defect)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/{defect_id}/problem-report", response_model=NewProductDefectProblemReportResponse)
async def create_new_product_defect_problem_report(
    defect_id: int,
    report_data: NewProductDefectProblemReportCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        defect, report = await NewProductDefectService.create_problem_report(
            db=db,
            defect_id=defect_id,
            report_data=report_data,
            created_by=current_user.id,
        )
        report_response = ProblemManagementService.build_report_response(report)
        defect_response = _build_response(defect)
        defect_response.problem_number = report_response.problem_number
        defect_response.eight_d_number = report_response.eight_d_number
        return NewProductDefectProblemReportResponse(defect=defect_response, report=report_response)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
