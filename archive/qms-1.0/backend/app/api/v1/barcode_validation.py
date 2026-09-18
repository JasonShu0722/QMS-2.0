"""
条码校验 API 路由
Barcode Validation API Routes - 关键件防错与追溯扫描
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.barcode_validation import (
    BarcodeValidationCreate,
    BarcodeValidationUpdate,
    BarcodeValidationResponse,
    BarcodeScanRequest,
    BarcodeScanResponse,
    BatchSubmitRequest,
    BatchSubmitResponse,
    BarcodeScanRecordResponse,
    BarcodeScanRecordListResponse,
    ScanStatisticsResponse,
)
from app.services.barcode_validation_service import BarcodeValidationService

router = APIRouter(prefix="/barcode-validation", tags=["barcode-validation"])


# ============ 校验规则配置接口 ============

@router.post(
    "/rules",
    response_model=BarcodeValidationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建条码校验规则",
    description="SQE 为特定物料配置条码校验规则（正则匹配、特征校验、防重逻辑）"
)
async def create_validation_rule(
    data: BarcodeValidationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    创建条码校验规则
    
    - **material_code**: 物料编码
    - **validation_rules**: 校验规则（前缀、后缀、长度限制）
    - **regex_pattern**: 正则表达式
    - **is_unique_check**: 是否启用唯一性校验（防重）
    """
    try:
        validation_rule = await BarcodeValidationService.create_validation_rule(
            db, data, current_user.id
        )
        return validation_rule
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"创建校验规则失败: {str(e)}"
        )


@router.put(
    "/rules/{material_code}",
    response_model=BarcodeValidationResponse,
    summary="更新条码校验规则",
    description="更新指定物料的条码校验规则"
)
async def update_validation_rule(
    material_code: str,
    data: BarcodeValidationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    更新条码校验规则
    
    - **material_code**: 物料编码
    - **validation_rules**: 校验规则（可选）
    - **regex_pattern**: 正则表达式（可选）
    - **is_unique_check**: 是否启用唯一性校验（可选）
    """
    try:
        validation_rule = await BarcodeValidationService.update_validation_rule(
            db, material_code, data, current_user.id
        )
        return validation_rule
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"更新校验规则失败: {str(e)}"
        )


@router.get(
    "/rules/{material_code}",
    response_model=BarcodeValidationResponse,
    summary="获取条码校验规则",
    description="获取指定物料的条码校验规则"
)
async def get_validation_rule(
    material_code: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取条码校验规则
    
    - **material_code**: 物料编码
    """
    validation_rule = await BarcodeValidationService.get_validation_rule(db, material_code)
    if not validation_rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"物料编码 {material_code} 的校验规则不存在"
        )
    return validation_rule


@router.get(
    "/rules",
    response_model=list[BarcodeValidationResponse],
    summary="获取校验规则列表",
    description="获取所有条码校验规则列表"
)
async def list_validation_rules(
    skip: int = Query(0, ge=0, description="跳过记录数"),
    limit: int = Query(100, ge=1, le=1000, description="返回记录数"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取校验规则列表
    
    - **skip**: 跳过记录数
    - **limit**: 返回记录数
    """
    rules = await BarcodeValidationService.list_validation_rules(db, skip, limit)
    return rules


# ============ 扫码验证接口 ============

@router.post(
    "/scan",
    response_model=BarcodeScanResponse,
    summary="扫码验证",
    description="执行条码扫描验证，即时反馈 PASS/NG"
)
async def scan_barcode(
    data: BarcodeScanRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    扫码验证
    
    - **material_code**: 物料编码
    - **barcode_content**: 条码内容
    - **supplier_id**: 供应商ID
    - **batch_number**: 批次号（可选）
    - **device_ip**: 设备IP（可选）
    
    返回：
    - **is_pass**: 是否通过（true=PASS, false=NG）
    - **message**: 验证消息
    - **error_reason**: 错误原因（NG时）
    - **record_id**: 扫描记录ID
    - **scanned_at**: 扫描时间
    """
    try:
        response = await BarcodeValidationService.scan_barcode(
            db, data, current_user.id
        )
        return response
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"扫码验证失败: {str(e)}"
        )


# ============ 批次提交归档接口 ============

@router.post(
    "/submit",
    response_model=BatchSubmitResponse,
    summary="批次提交归档",
    description="供应商完成发货批次扫码录入后提交归档，推送给 SQE 和 IQC"
)
async def submit_batch(
    data: BatchSubmitRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    批次提交归档
    
    - **material_code**: 物料编码
    - **batch_number**: 批次号
    - **supplier_id**: 供应商ID
    
    返回：
    - **success**: 是否成功
    - **message**: 提交消息
    - **archived_count**: 归档记录数
    - **batch_number**: 批次号
    - **archived_at**: 归档时间
    """
    try:
        response = await BarcodeValidationService.submit_batch(
            db, data, current_user.id
        )
        
        # TODO: 发送通知给 SQE 和 IQC
        # await NotificationService.send_notification(
        #     user_ids=[sqe_id, iqc_id],
        #     title="批次扫码归档通知",
        #     content=f"供应商已完成批次 {data.batch_number} 的扫码归档",
        #     notification_type="workflow"
        # )
        
        return response
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"批次提交归档失败: {str(e)}"
        )


# ============ 扫描记录查询接口 ============

@router.get(
    "/records",
    response_model=BarcodeScanRecordListResponse,
    summary="查询扫描记录",
    description="查询条码扫描记录，支持多条件筛选"
)
async def get_scan_records(
    material_code: Optional[str] = Query(None, description="物料编码"),
    supplier_id: Optional[int] = Query(None, description="供应商ID"),
    batch_number: Optional[str] = Query(None, description="批次号"),
    is_archived: Optional[bool] = Query(None, description="是否已归档"),
    is_pass: Optional[bool] = Query(None, description="是否通过"),
    skip: int = Query(0, ge=0, description="跳过记录数"),
    limit: int = Query(100, ge=1, le=1000, description="返回记录数"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    查询扫描记录
    
    支持按以下条件筛选：
    - **material_code**: 物料编码
    - **supplier_id**: 供应商ID
    - **batch_number**: 批次号
    - **is_archived**: 是否已归档
    - **is_pass**: 是否通过
    - **skip**: 跳过记录数
    - **limit**: 返回记录数
    """
    try:
        records, total = await BarcodeValidationService.get_scan_records(
            db,
            material_code=material_code,
            supplier_id=supplier_id,
            batch_number=batch_number,
            is_archived=is_archived,
            is_pass=is_pass,
            skip=skip,
            limit=limit
        )
        
        return BarcodeScanRecordListResponse(
            total=total,
            records=records
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"查询扫描记录失败: {str(e)}"
        )


# ============ 统计接口 ============

@router.get(
    "/statistics",
    response_model=ScanStatisticsResponse,
    summary="获取扫码统计",
    description="获取指定物料/批次的扫码统计信息（总数、通过数、失败数、通过率）"
)
async def get_scan_statistics(
    material_code: str = Query(..., description="物料编码"),
    batch_number: Optional[str] = Query(None, description="批次号"),
    supplier_id: Optional[int] = Query(None, description="供应商ID"),
    target_quantity: Optional[int] = Query(None, description="目标数量"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取扫码统计
    
    - **material_code**: 物料编码（必填）
    - **batch_number**: 批次号（可选）
    - **supplier_id**: 供应商ID（可选）
    - **target_quantity**: 目标数量（可选，用于计算剩余数量）
    
    返回：
    - **total_scanned**: 总扫描数
    - **pass_count**: 通过数
    - **fail_count**: 失败数
    - **pass_rate**: 通过率
    - **target_quantity**: 目标数量
    - **remaining_quantity**: 剩余数量
    """
    try:
        statistics = await BarcodeValidationService.get_scan_statistics(
            db,
            material_code=material_code,
            batch_number=batch_number,
            supplier_id=supplier_id,
            target_quantity=target_quantity
        )
        return statistics
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取扫码统计失败: {str(e)}"
        )


# ============ 数据导出接口 ============

@router.get(
    "/export",
    summary="导出扫描记录",
    description="导出扫描记录为 Excel 文件（预留接口）"
)
async def export_scan_records(
    material_code: Optional[str] = Query(None, description="物料编码"),
    supplier_id: Optional[int] = Query(None, description="供应商ID"),
    batch_number: Optional[str] = Query(None, description="批次号"),
    is_archived: Optional[bool] = Query(None, description="是否已归档"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    导出扫描记录
    
    TODO: 实现 Excel 导出功能
    - 使用 openpyxl 或 xlsxwriter 生成 Excel 文件
    - 返回文件流供下载
    """
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="导出功能尚未实现"
    )
