"""
条码校验服务
Barcode Validation Service - 关键件防错与追溯扫描
"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
import re

from app.models.barcode_validation import BarcodeValidation, BarcodeScanRecord
from app.models.supplier import Supplier
from app.schemas.barcode_validation import (
    BarcodeValidationCreate,
    BarcodeValidationUpdate,
    BarcodeScanRequest,
    BarcodeScanResponse,
    BatchSubmitRequest,
    BatchSubmitResponse,
    ScanStatisticsResponse,
)


class BarcodeValidationService:
    """条码校验服务类"""
    
    @staticmethod
    async def create_validation_rule(
        db: AsyncSession,
        data: BarcodeValidationCreate,
        created_by: int
    ) -> BarcodeValidation:
        """
        创建条码校验规则
        
        Args:
            db: 数据库会话
            data: 校验规则数据
            created_by: 创建人ID
            
        Returns:
            BarcodeValidation: 创建的校验规则
        """
        # 检查物料编码是否已存在规则
        stmt = select(BarcodeValidation).where(
            BarcodeValidation.material_code == data.material_code
        )
        result = await db.execute(stmt)
        existing = result.scalar_one_or_none()
        
        if existing:
            raise ValueError(f"物料编码 {data.material_code} 的校验规则已存在")
        
        # 转换 validation_rules 为字典
        validation_rules_dict = None
        if data.validation_rules:
            validation_rules_dict = data.validation_rules.model_dump(exclude_none=True)
        
        # 创建新规则
        validation_rule = BarcodeValidation(
            material_code=data.material_code,
            validation_rules=validation_rules_dict,
            regex_pattern=data.regex_pattern,
            is_unique_check=data.is_unique_check,
            created_by=created_by,
            updated_by=created_by,
        )
        
        db.add(validation_rule)
        await db.commit()
        await db.refresh(validation_rule)
        
        return validation_rule
    
    @staticmethod
    async def update_validation_rule(
        db: AsyncSession,
        material_code: str,
        data: BarcodeValidationUpdate,
        updated_by: int
    ) -> BarcodeValidation:
        """
        更新条码校验规则
        
        Args:
            db: 数据库会话
            material_code: 物料编码
            data: 更新数据
            updated_by: 更新人ID
            
        Returns:
            BarcodeValidation: 更新后的校验规则
        """
        stmt = select(BarcodeValidation).where(
            BarcodeValidation.material_code == material_code
        )
        result = await db.execute(stmt)
        validation_rule = result.scalar_one_or_none()
        
        if not validation_rule:
            raise ValueError(f"物料编码 {material_code} 的校验规则不存在")
        
        # 更新字段
        if data.validation_rules is not None:
            validation_rule.validation_rules = data.validation_rules.model_dump(exclude_none=True)
        if data.regex_pattern is not None:
            validation_rule.regex_pattern = data.regex_pattern
        if data.is_unique_check is not None:
            validation_rule.is_unique_check = data.is_unique_check
        
        validation_rule.updated_by = updated_by
        validation_rule.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(validation_rule)
        
        return validation_rule
    
    @staticmethod
    async def get_validation_rule(
        db: AsyncSession,
        material_code: str
    ) -> Optional[BarcodeValidation]:
        """
        获取条码校验规则
        
        Args:
            db: 数据库会话
            material_code: 物料编码
            
        Returns:
            Optional[BarcodeValidation]: 校验规则
        """
        stmt = select(BarcodeValidation).where(
            BarcodeValidation.material_code == material_code
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()
    
    @staticmethod
    async def list_validation_rules(
        db: AsyncSession,
        skip: int = 0,
        limit: int = 100
    ) -> List[BarcodeValidation]:
        """
        获取校验规则列表
        
        Args:
            db: 数据库会话
            skip: 跳过记录数
            limit: 返回记录数
            
        Returns:
            List[BarcodeValidation]: 校验规则列表
        """
        stmt = select(BarcodeValidation).offset(skip).limit(limit)
        result = await db.execute(stmt)
        return list(result.scalars().all())
    
    @staticmethod
    async def validate_barcode(
        db: AsyncSession,
        barcode_content: str,
        validation_rule: BarcodeValidation
    ) -> tuple[bool, Optional[str]]:
        """
        验证条码是否符合规则
        
        Args:
            db: 数据库会话
            barcode_content: 条码内容
            validation_rule: 校验规则
            
        Returns:
            tuple[bool, Optional[str]]: (是否通过, 错误原因)
        """
        # 1. 正则表达式校验
        if validation_rule.regex_pattern:
            try:
                if not re.match(validation_rule.regex_pattern, barcode_content):
                    return False, f"条码格式不符合正则表达式: {validation_rule.regex_pattern}"
            except re.error as e:
                return False, f"正则表达式错误: {str(e)}"
        
        # 2. 特征校验（前缀、后缀、长度）
        if validation_rule.validation_rules:
            rules = validation_rule.validation_rules
            
            # 前缀校验
            if rules.get('prefix') and not barcode_content.startswith(rules['prefix']):
                return False, f"条码前缀不匹配，期望: {rules['prefix']}"
            
            # 后缀校验
            if rules.get('suffix') and not barcode_content.endswith(rules['suffix']):
                return False, f"条码后缀不匹配，期望: {rules['suffix']}"
            
            # 最小长度校验
            if rules.get('min_length') and len(barcode_content) < rules['min_length']:
                return False, f"条码长度不足，最小长度: {rules['min_length']}"
            
            # 最大长度校验
            if rules.get('max_length') and len(barcode_content) > rules['max_length']:
                return False, f"条码长度超限，最大长度: {rules['max_length']}"
        
        # 3. 唯一性校验（防重逻辑）
        if validation_rule.is_unique_check:
            stmt = select(BarcodeScanRecord).where(
                and_(
                    BarcodeScanRecord.material_code == validation_rule.material_code,
                    BarcodeScanRecord.barcode_content == barcode_content,
                    BarcodeScanRecord.is_pass == True  # 只检查通过的记录
                )
            )
            result = await db.execute(stmt)
            existing = result.scalar_one_or_none()
            
            if existing:
                return False, f"条码重复，已于 {existing.scanned_at.strftime('%Y-%m-%d %H:%M:%S')} 扫描"
        
        return True, None
    
    @staticmethod
    async def scan_barcode(
        db: AsyncSession,
        data: BarcodeScanRequest,
        scanned_by: int
    ) -> BarcodeScanResponse:
        """
        扫码验证
        
        Args:
            db: 数据库会话
            data: 扫码请求数据
            scanned_by: 扫描人ID
            
        Returns:
            BarcodeScanResponse: 扫码验证响应
        """
        # 1. 获取校验规则
        validation_rule = await BarcodeValidationService.get_validation_rule(
            db, data.material_code
        )
        
        if not validation_rule:
            # 如果没有配置规则，默认通过
            is_pass = True
            error_reason = None
            message = "PASS - 无校验规则，默认通过"
        else:
            # 2. 执行校验
            is_pass, error_reason = await BarcodeValidationService.validate_barcode(
                db, data.barcode_content, validation_rule
            )
            message = "PASS" if is_pass else f"NG - {error_reason}"
        
        # 3. 记录扫描结果
        scan_record = BarcodeScanRecord(
            material_code=data.material_code,
            supplier_id=data.supplier_id,
            batch_number=data.batch_number,
            barcode_content=data.barcode_content,
            is_pass=is_pass,
            error_reason=error_reason,
            scanned_by=scanned_by,
            scanned_at=datetime.utcnow(),
            device_ip=data.device_ip,
            is_archived=False,
        )
        
        db.add(scan_record)
        await db.commit()
        await db.refresh(scan_record)
        
        return BarcodeScanResponse(
            is_pass=is_pass,
            message=message,
            error_reason=error_reason,
            record_id=scan_record.id,
            scanned_at=scan_record.scanned_at,
        )
    
    @staticmethod
    async def submit_batch(
        db: AsyncSession,
        data: BatchSubmitRequest,
        submitted_by: int
    ) -> BatchSubmitResponse:
        """
        批次提交归档
        
        Args:
            db: 数据库会话
            data: 批次提交请求
            submitted_by: 提交人ID
            
        Returns:
            BatchSubmitResponse: 批次提交响应
        """
        # 1. 查询该批次的所有未归档记录
        stmt = select(BarcodeScanRecord).where(
            and_(
                BarcodeScanRecord.material_code == data.material_code,
                BarcodeScanRecord.batch_number == data.batch_number,
                BarcodeScanRecord.supplier_id == data.supplier_id,
                BarcodeScanRecord.is_archived == False
            )
        )
        result = await db.execute(stmt)
        records = list(result.scalars().all())
        
        if not records:
            raise ValueError(f"批次 {data.batch_number} 没有待归档的扫描记录")
        
        # 2. 批量更新为已归档
        archived_at = datetime.utcnow()
        for record in records:
            record.is_archived = True
            record.archived_at = archived_at
        
        await db.commit()
        
        return BatchSubmitResponse(
            success=True,
            message=f"批次 {data.batch_number} 归档成功",
            archived_count=len(records),
            batch_number=data.batch_number,
            archived_at=archived_at,
        )
    
    @staticmethod
    async def get_scan_records(
        db: AsyncSession,
        material_code: Optional[str] = None,
        supplier_id: Optional[int] = None,
        batch_number: Optional[str] = None,
        is_archived: Optional[bool] = None,
        is_pass: Optional[bool] = None,
        skip: int = 0,
        limit: int = 100
    ) -> tuple[List[BarcodeScanRecord], int]:
        """
        查询扫描记录
        
        Args:
            db: 数据库会话
            material_code: 物料编码（可选）
            supplier_id: 供应商ID（可选）
            batch_number: 批次号（可选）
            is_archived: 是否已归档（可选）
            is_pass: 是否通过（可选）
            skip: 跳过记录数
            limit: 返回记录数
            
        Returns:
            tuple[List[BarcodeScanRecord], int]: (记录列表, 总数)
        """
        # 构建查询条件
        conditions = []
        if material_code:
            conditions.append(BarcodeScanRecord.material_code == material_code)
        if supplier_id:
            conditions.append(BarcodeScanRecord.supplier_id == supplier_id)
        if batch_number:
            conditions.append(BarcodeScanRecord.batch_number == batch_number)
        if is_archived is not None:
            conditions.append(BarcodeScanRecord.is_archived == is_archived)
        if is_pass is not None:
            conditions.append(BarcodeScanRecord.is_pass == is_pass)
        
        # 查询总数
        count_stmt = select(func.count(BarcodeScanRecord.id))
        if conditions:
            count_stmt = count_stmt.where(and_(*conditions))
        count_result = await db.execute(count_stmt)
        total = count_result.scalar()
        
        # 查询记录
        stmt = select(BarcodeScanRecord).order_by(BarcodeScanRecord.scanned_at.desc())
        if conditions:
            stmt = stmt.where(and_(*conditions))
        stmt = stmt.offset(skip).limit(limit)
        
        result = await db.execute(stmt)
        records = list(result.scalars().all())
        
        return records, total
    
    @staticmethod
    async def get_scan_statistics(
        db: AsyncSession,
        material_code: str,
        batch_number: Optional[str] = None,
        supplier_id: Optional[int] = None,
        target_quantity: Optional[int] = None
    ) -> ScanStatisticsResponse:
        """
        获取扫码统计
        
        Args:
            db: 数据库会话
            material_code: 物料编码
            batch_number: 批次号（可选）
            supplier_id: 供应商ID（可选）
            target_quantity: 目标数量（可选）
            
        Returns:
            ScanStatisticsResponse: 扫码统计响应
        """
        # 构建查询条件
        conditions = [
            BarcodeScanRecord.material_code == material_code,
            BarcodeScanRecord.is_archived == False  # 只统计未归档的
        ]
        if batch_number:
            conditions.append(BarcodeScanRecord.batch_number == batch_number)
        if supplier_id:
            conditions.append(BarcodeScanRecord.supplier_id == supplier_id)
        
        # 统计总数
        total_stmt = select(func.count(BarcodeScanRecord.id)).where(and_(*conditions))
        total_result = await db.execute(total_stmt)
        total_scanned = total_result.scalar() or 0
        
        # 统计通过数
        pass_stmt = select(func.count(BarcodeScanRecord.id)).where(
            and_(*conditions, BarcodeScanRecord.is_pass == True)
        )
        pass_result = await db.execute(pass_stmt)
        pass_count = pass_result.scalar() or 0
        
        # 计算失败数和通过率
        fail_count = total_scanned - pass_count
        pass_rate = (pass_count / total_scanned * 100) if total_scanned > 0 else 0.0
        
        # 计算剩余数量
        remaining_quantity = None
        if target_quantity is not None:
            remaining_quantity = max(0, target_quantity - pass_count)
        
        return ScanStatisticsResponse(
            material_code=material_code,
            batch_number=batch_number,
            total_scanned=total_scanned,
            pass_count=pass_count,
            fail_count=fail_count,
            pass_rate=round(pass_rate, 2),
            target_quantity=target_quantity,
            remaining_quantity=remaining_quantity,
        )
