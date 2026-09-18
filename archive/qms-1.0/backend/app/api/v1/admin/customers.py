"""
系统管理下的客户基础信息维护 API。
"""
from __future__ import annotations

from collections.abc import Iterable

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.platform_admin import get_current_platform_admin
from app.models.customer_master import CustomerMaster, CustomerStatus
from app.models.user import User
from app.schemas.admin import (
    CustomerMasterBulkCreateRequest,
    CustomerMasterBulkCreateResponse,
    CustomerMasterCreateRequest,
    CustomerMasterResponse,
    CustomerMasterStatusUpdateRequest,
    CustomerMasterUpdateRequest,
)


router = APIRouter(prefix="/admin/customers", tags=["Admin - Customer Master"])


async def _get_customer_or_404(db: AsyncSession, customer_id: int) -> CustomerMaster:
    result = await db.execute(select(CustomerMaster).where(CustomerMaster.id == customer_id))
    customer = result.scalar_one_or_none()
    if not customer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="客户不存在")
    return customer


async def _ensure_customer_code_unique(
    db: AsyncSession,
    code: str,
    *,
    exclude_customer_id: int | None = None,
) -> None:
    query = select(CustomerMaster).where(CustomerMaster.code == code)
    if exclude_customer_id is not None:
        query = query.where(CustomerMaster.id != exclude_customer_id)

    result = await db.execute(query)
    existing_customer = result.scalar_one_or_none()
    if existing_customer:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"客户代码已存在: {code}",
        )


def _normalize_customer_status(value: str) -> CustomerStatus:
    return CustomerStatus(value)


def _build_customer_responses(customers: Iterable[CustomerMaster]) -> list[CustomerMasterResponse]:
    return [
        CustomerMasterResponse(
            id=customer.id,
            code=customer.code,
            name=customer.name,
            contact_person=customer.contact_person,
            contact_email=customer.contact_email,
            contact_phone=customer.contact_phone,
            status=str(customer.status.value if hasattr(customer.status, "value") else customer.status),
            created_at=customer.created_at,
            updated_at=customer.updated_at,
        )
        for customer in customers
    ]


@router.get(
    "",
    response_model=list[CustomerMasterResponse],
    summary="获取客户基础信息列表",
)
async def get_customers(
    keyword: str | None = Query(None, description="按客户代码或名称搜索"),
    status_filter: str | None = Query(None, alias="status", description="按状态筛选"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_platform_admin),
):
    query = select(CustomerMaster)

    if keyword:
        like_value = f"%{keyword.strip()}%"
        query = query.where(
            or_(
                CustomerMaster.code.ilike(like_value),
                CustomerMaster.name.ilike(like_value),
            )
        )

    if status_filter:
        try:
            customer_status = _normalize_customer_status(status_filter)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"无效的客户状态: {status_filter}",
            ) from exc
        query = query.where(CustomerMaster.status == customer_status)

    result = await db.execute(query.order_by(CustomerMaster.code.asc()))
    return _build_customer_responses(result.scalars().all())


@router.post(
    "",
    response_model=CustomerMasterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="新增客户基础信息",
)
async def create_customer(
    request: CustomerMasterCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_platform_admin),
):
    await _ensure_customer_code_unique(db, request.code)

    customer = CustomerMaster(
        code=request.code,
        name=request.name,
        contact_person=request.contact_person,
        contact_email=request.contact_email,
        contact_phone=request.contact_phone,
        status=_normalize_customer_status(request.status),
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(customer)
    await db.commit()
    await db.refresh(customer)

    return _build_customer_responses([customer])[0]


@router.post(
    "/bulk",
    response_model=CustomerMasterBulkCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="批量导入客户基础信息",
)
async def bulk_create_customers(
    request: CustomerMasterBulkCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_platform_admin),
):
    seen_codes: dict[str, int] = {}
    errors: list[str] = []

    for row_number, item in enumerate(request.items, start=1):
        if item.code in seen_codes:
            errors.append(f"第 {row_number} 行客户代码与第 {seen_codes[item.code]} 行重复")
        else:
            seen_codes[item.code] = row_number

    if seen_codes:
        result = await db.execute(select(CustomerMaster.code).where(CustomerMaster.code.in_(list(seen_codes.keys()))))
        for (existing_code,) in result.all():
            errors.append(f"第 {seen_codes[existing_code]} 行客户代码已存在: {existing_code}")

    if errors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="批量导入校验失败: " + "；".join(errors),
        )

    customers: list[CustomerMaster] = []
    default_status = _normalize_customer_status(request.status)
    for item in request.items:
        customer = CustomerMaster(
            code=item.code,
            name=item.name,
            contact_person=item.contact_person,
            contact_email=item.contact_email,
            contact_phone=item.contact_phone,
            status=default_status,
            created_by=current_user.id,
            updated_by=current_user.id,
        )
        db.add(customer)
        customers.append(customer)

    await db.commit()
    for customer in customers:
        await db.refresh(customer)

    response_customers = _build_customer_responses(customers)
    return CustomerMasterBulkCreateResponse(
        message=f"批量导入完成，共创建 {len(response_customers)} 家客户",
        total_count=len(request.items),
        created_count=len(response_customers),
        customers=response_customers,
    )


@router.patch(
    "/{customer_id}",
    response_model=CustomerMasterResponse,
    summary="编辑客户基础信息",
)
async def update_customer(
    customer_id: int,
    request: CustomerMasterUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_platform_admin),
):
    await _get_customer_or_404(db, customer_id)
    await _ensure_customer_code_unique(db, request.code, exclude_customer_id=customer_id)

    await db.execute(
        update(CustomerMaster)
        .where(CustomerMaster.id == customer_id)
        .values(
            code=request.code,
            name=request.name,
            contact_person=request.contact_person,
            contact_email=request.contact_email,
            contact_phone=request.contact_phone,
            status=_normalize_customer_status(request.status),
            updated_by=current_user.id,
        )
    )
    await db.commit()

    updated_customer = await _get_customer_or_404(db, customer_id)
    return _build_customer_responses([updated_customer])[0]


@router.post(
    "/{customer_id}/status",
    response_model=CustomerMasterResponse,
    summary="更新客户状态",
)
async def update_customer_status(
    customer_id: int,
    request: CustomerMasterStatusUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_platform_admin),
):
    await _get_customer_or_404(db, customer_id)
    await db.execute(
        update(CustomerMaster)
        .where(CustomerMaster.id == customer_id)
        .values(
            status=_normalize_customer_status(request.status),
            updated_by=current_user.id,
        )
    )
    await db.commit()

    updated_customer = await _get_customer_or_404(db, customer_id)
    return _build_customer_responses([updated_customer])[0]
