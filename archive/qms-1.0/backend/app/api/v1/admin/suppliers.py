"""
系统管理下的供应商基础信息维护 API。
"""
from __future__ import annotations

from collections.abc import Iterable

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.platform_admin import get_current_platform_admin
from app.models.supplier import Supplier, SupplierStatus
from app.models.user import User, UserStatus
from app.schemas.admin import (
    SupplierMasterBulkCreateRequest,
    SupplierMasterBulkCreateResponse,
    SupplierMasterCreateRequest,
    SupplierMasterResponse,
    SupplierMasterStatusUpdateRequest,
    SupplierMasterUpdateRequest,
)


router = APIRouter(prefix="/admin/suppliers", tags=["Admin - Supplier Master"])


async def _get_supplier_or_404(db: AsyncSession, supplier_id: int) -> Supplier:
    result = await db.execute(select(Supplier).where(Supplier.id == supplier_id))
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="供应商不存在")
    return supplier


async def _ensure_supplier_code_unique(
    db: AsyncSession,
    code: str,
    *,
    exclude_supplier_id: int | None = None,
) -> None:
    query = select(Supplier).where(Supplier.code == code)
    if exclude_supplier_id is not None:
        query = query.where(Supplier.id != exclude_supplier_id)

    result = await db.execute(query)
    existing_supplier = result.scalar_one_or_none()
    if existing_supplier:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"供应商代码已存在: {code}",
        )


async def _build_supplier_responses(
    db: AsyncSession,
    suppliers: Iterable[Supplier],
) -> list[SupplierMasterResponse]:
    supplier_list = list(suppliers)
    supplier_ids = [supplier.id for supplier in supplier_list]
    if not supplier_ids:
        return []

    count_result = await db.execute(
        select(
            User.supplier_id,
            func.count(User.id).label("linked_user_count"),
            func.sum(case((User.status == UserStatus.ACTIVE, 1), else_=0)).label("active_user_count"),
        )
        .where(User.supplier_id.in_(supplier_ids))
        .group_by(User.supplier_id)
    )
    count_map = {
        supplier_id: {
            "linked_user_count": linked_user_count or 0,
            "active_user_count": active_user_count or 0,
        }
        for supplier_id, linked_user_count, active_user_count in count_result.all()
    }

    return [
        SupplierMasterResponse(
            id=supplier.id,
            code=supplier.code,
            name=supplier.name,
            contact_person=supplier.contact_person,
            contact_email=supplier.contact_email,
            contact_phone=supplier.contact_phone,
            status=str(supplier.status.value if hasattr(supplier.status, "value") else supplier.status),
            linked_user_count=count_map.get(supplier.id, {}).get("linked_user_count", 0),
            active_user_count=count_map.get(supplier.id, {}).get("active_user_count", 0),
            created_at=supplier.created_at,
            updated_at=supplier.updated_at,
        )
        for supplier in supplier_list
    ]


def _normalize_supplier_status(value: str) -> SupplierStatus:
    return SupplierStatus(value)


@router.get(
    "",
    response_model=list[SupplierMasterResponse],
    summary="获取供应商基础信息列表",
)
async def get_suppliers(
    keyword: str | None = Query(None, description="按供应商代码或名称搜索"),
    status_filter: str | None = Query(None, alias="status", description="按状态筛选"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_platform_admin),
):
    query = select(Supplier)

    if keyword:
        like_value = f"%{keyword.strip()}%"
        query = query.where(
            or_(
                Supplier.code.ilike(like_value),
                Supplier.name.ilike(like_value),
            )
        )

    if status_filter:
        try:
            supplier_status = _normalize_supplier_status(status_filter)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"无效的供应商状态: {status_filter}",
            ) from exc
        query = query.where(Supplier.status == supplier_status)

    query = query.order_by(Supplier.code.asc())
    result = await db.execute(query)
    return await _build_supplier_responses(db, result.scalars().all())


@router.post(
    "",
    response_model=SupplierMasterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="新增供应商基础信息",
)
async def create_supplier(
    request: SupplierMasterCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_platform_admin),
):
    await _ensure_supplier_code_unique(db, request.code)

    supplier = Supplier(
        code=request.code,
        name=request.name,
        contact_person=request.contact_person,
        contact_email=request.contact_email,
        contact_phone=request.contact_phone,
        status=_normalize_supplier_status(request.status),
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(supplier)
    await db.commit()
    await db.refresh(supplier)

    return (await _build_supplier_responses(db, [supplier]))[0]


@router.post(
    "/bulk",
    response_model=SupplierMasterBulkCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="批量导入供应商基础信息",
)
async def bulk_create_suppliers(
    request: SupplierMasterBulkCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_platform_admin),
):
    seen_codes: dict[str, int] = {}
    errors: list[str] = []

    for row_number, item in enumerate(request.items, start=1):
        if item.code in seen_codes:
            errors.append(f"第 {row_number} 行供应商代码与第 {seen_codes[item.code]} 行重复")
        else:
            seen_codes[item.code] = row_number

    if seen_codes:
        result = await db.execute(select(Supplier.code).where(Supplier.code.in_(list(seen_codes.keys()))))
        for (existing_code,) in result.all():
            errors.append(f"第 {seen_codes[existing_code]} 行供应商代码已存在: {existing_code}")

    if errors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="批量导入校验失败: " + "；".join(errors),
        )

    suppliers: list[Supplier] = []
    default_status = _normalize_supplier_status(request.status)
    for item in request.items:
        supplier = Supplier(
            code=item.code,
            name=item.name,
            contact_person=item.contact_person,
            contact_email=item.contact_email,
            contact_phone=item.contact_phone,
            status=default_status,
            created_by=current_user.id,
            updated_by=current_user.id,
        )
        db.add(supplier)
        suppliers.append(supplier)

    await db.commit()
    for supplier in suppliers:
        await db.refresh(supplier)

    response_suppliers = await _build_supplier_responses(db, suppliers)
    return SupplierMasterBulkCreateResponse(
        message=f"批量导入完成，共创建 {len(response_suppliers)} 家供应商",
        total_count=len(request.items),
        created_count=len(response_suppliers),
        suppliers=response_suppliers,
    )


@router.patch(
    "/{supplier_id}",
    response_model=SupplierMasterResponse,
    summary="编辑供应商基础信息",
)
async def update_supplier(
    supplier_id: int,
    request: SupplierMasterUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_platform_admin),
):
    supplier = await _get_supplier_or_404(db, supplier_id)
    await _ensure_supplier_code_unique(db, request.code, exclude_supplier_id=supplier_id)

    await db.execute(
        update(Supplier)
        .where(Supplier.id == supplier_id)
        .values(
            code=request.code,
            name=request.name,
            contact_person=request.contact_person,
            contact_email=request.contact_email,
            contact_phone=request.contact_phone,
            status=_normalize_supplier_status(request.status),
            updated_by=current_user.id,
        )
    )
    await db.commit()

    updated_supplier = await _get_supplier_or_404(db, supplier_id)
    return (await _build_supplier_responses(db, [updated_supplier]))[0]


@router.post(
    "/{supplier_id}/status",
    response_model=SupplierMasterResponse,
    summary="更新供应商状态",
)
async def update_supplier_status(
    supplier_id: int,
    request: SupplierMasterStatusUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_platform_admin),
):
    await _get_supplier_or_404(db, supplier_id)
    await db.execute(
        update(Supplier)
        .where(Supplier.id == supplier_id)
        .values(
            status=_normalize_supplier_status(request.status),
            updated_by=current_user.id,
        )
    )
    await db.commit()

    updated_supplier = await _get_supplier_or_404(db, supplier_id)
    return (await _build_supplier_responses(db, [updated_supplier]))[0]
