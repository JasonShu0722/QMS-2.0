"""
过程质量不良品数据服务
Process Defect Service - 制程不合格品记录的业务逻辑
"""
from datetime import date, datetime
from typing import List, Tuple, Optional
from sqlalchemy import select, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.process_defect import ProcessDefect, ResponsibilityCategory
from app.models.user import User, UserType
from app.schemas.process_defect import (
    ProcessDefectCreate, 
    ProcessDefectUpdate, 
    ProcessDefectListQuery,
    DefectTypeOption,
    ResponsibilityCategoryOption
)
from app.core.exceptions import NotFoundException, BusinessException


class ProcessDefectService:
    @staticmethod
    async def generate_defect_number(db: AsyncSession) -> str:
        today = datetime.utcnow().strftime("%Y%m%d")
        prefix = f"PD-{today}-"
        result = await db.execute(
            select(ProcessDefect.defect_number)
            .where(ProcessDefect.defect_number.like(f"{prefix}%"))
            .order_by(ProcessDefect.defect_number.desc())
            .limit(1)
        )
        latest_number = result.scalar_one_or_none()
        if latest_number:
            try:
                sequence = int(str(latest_number).rsplit("-", 1)[-1]) + 1
            except ValueError:
                sequence = 1
        else:
            sequence = 1
        return f"{prefix}{sequence:03d}"

    """过程质量不良品数据服务"""
    
    # 预设失效类型选项（可根据实际业务扩展）
    DEFECT_TYPE_OPTIONS = [
        # 焊接类
        DefectTypeOption(value="solder_bridge", label="焊接桥接", category="焊接"),
        DefectTypeOption(value="cold_solder", label="冷焊", category="焊接"),
        DefectTypeOption(value="solder_void", label="焊接空洞", category="焊接"),
        DefectTypeOption(value="insufficient_solder", label="焊锡不足", category="焊接"),
        DefectTypeOption(value="excess_solder", label="焊锡过多", category="焊接"),
        
        # 组装类
        DefectTypeOption(value="missing_component", label="漏装元件", category="组装"),
        DefectTypeOption(value="wrong_component", label="错装元件", category="组装"),
        DefectTypeOption(value="reversed_polarity", label="极性反装", category="组装"),
        DefectTypeOption(value="component_damage", label="元件损坏", category="组装"),
        DefectTypeOption(value="loose_component", label="元件松动", category="组装"),
        
        # 外观类
        DefectTypeOption(value="scratch", label="划伤", category="外观"),
        DefectTypeOption(value="contamination", label="污染", category="外观"),
        DefectTypeOption(value="discoloration", label="变色", category="外观"),
        DefectTypeOption(value="deformation", label="变形", category="外观"),
        DefectTypeOption(value="crack", label="裂纹", category="外观"),
        
        # 功能类
        DefectTypeOption(value="short_circuit", label="短路", category="功能"),
        DefectTypeOption(value="open_circuit", label="开路", category="功能"),
        DefectTypeOption(value="parameter_out_of_spec", label="参数超标", category="功能"),
        DefectTypeOption(value="functional_failure", label="功能失效", category="功能"),
        
        # 尺寸类
        DefectTypeOption(value="dimension_out_of_tolerance", label="尺寸超差", category="尺寸"),
        DefectTypeOption(value="position_deviation", label="位置偏移", category="尺寸"),
    ]
    
    # 责任类别选项及说明
    RESPONSIBILITY_CATEGORY_OPTIONS = [
        ResponsibilityCategoryOption(
            value="material_defect",
            label="物料不良",
            description="来料本身存在质量问题导致的不良",
            links_to_metric="物料上线不良PPM"
        ),
        ResponsibilityCategoryOption(
            value="operation_defect",
            label="作业不良",
            description="操作员未按SOP执行或操作失误导致的不良",
            links_to_metric="制程不合格率（作业类）"
        ),
        ResponsibilityCategoryOption(
            value="equipment_defect",
            label="设备不良",
            description="设备故障、精度不足或参数异常导致的不良",
            links_to_metric="制程不合格率（设备类）"
        ),
        ResponsibilityCategoryOption(
            value="process_defect",
            label="工艺不良",
            description="工艺参数设置不当或工艺流程缺陷导致的不良",
            links_to_metric="制程不合格率（工艺类）"
        ),
        ResponsibilityCategoryOption(
            value="design_defect",
            label="设计不良",
            description="产品设计缺陷或设计参数不合理导致的不良",
            links_to_metric="制程不合格率（设计类）"
        ),
    ]
    
    @staticmethod
    async def create_defect(
        db: AsyncSession,
        defect_data: ProcessDefectCreate,
        recorded_by: int
    ) -> ProcessDefect:
        """
        创建不良品记录
        
        业务逻辑：
        1. 验证供应商存在性（如果是物料不良）
        2. 创建不良品记录
        3. 自动关联质量指标计算（通过责任类别）
        """
        # 如果是物料不良，验证供应商存在
        if defect_data.responsibility_category == ResponsibilityCategory.MATERIAL_DEFECT.value:
            if not defect_data.supplier_id:
                raise BusinessException("Material defect requires supplier_id")
            
            from app.models.supplier import Supplier
            supplier_result = await db.execute(
                select(Supplier).where(Supplier.id == defect_data.supplier_id)
            )
            supplier = supplier_result.scalar_one_or_none()
            if not supplier:
                raise NotFoundException(f"Supplier with id {defect_data.supplier_id} not found")
        
        # 创建不良品记录
        defect = ProcessDefect(
            defect_number=await ProcessDefectService.generate_defect_number(db),
            defect_date=defect_data.defect_date,
            work_order=defect_data.work_order,
            process_id=defect_data.process_id,
            line_id=defect_data.line_id,
            defect_type=defect_data.defect_type,
            defect_qty=defect_data.defect_qty,
            responsibility_category=defect_data.responsibility_category,
            operator_id=defect_data.operator_id,
            recorded_by=recorded_by,
            material_code=defect_data.material_code,
            supplier_id=defect_data.supplier_id,
            remarks=defect_data.remarks
        )
        
        db.add(defect)
        await db.commit()
        await db.refresh(defect)
        
        return defect
    
    @staticmethod
    async def get_defect_list(
        db: AsyncSession,
        query: ProcessDefectListQuery,
        current_user: User
    ) -> Tuple[List[ProcessDefect], int]:
        """
        获取不良品记录列表
        
        权限控制：
        - 供应商用户只能查看关联到自己的物料不良记录
        - 内部用户可以查看所有记录
        
        支持筛选：日期范围、工单号、工序、产线、不良类型、责任类别、供应商、物料编码
        """
        # 构建基础查询
        stmt = select(ProcessDefect)
        
        # 权限过滤：供应商用户只能看自己的数据
        if current_user.user_type == UserType.SUPPLIER:
            stmt = stmt.where(
                and_(
                    ProcessDefect.responsibility_category == ResponsibilityCategory.MATERIAL_DEFECT.value,
                    ProcessDefect.supplier_id == current_user.supplier_id
                )
            )
        
        # 日期范围筛选
        if query.defect_date_start:
            stmt = stmt.where(ProcessDefect.defect_date >= query.defect_date_start)
        if query.defect_date_end:
            stmt = stmt.where(ProcessDefect.defect_date <= query.defect_date_end)
        
        # 工单号筛选
        if query.work_order:
            stmt = stmt.where(ProcessDefect.work_order.ilike(f"%{query.work_order}%"))
        
        # 工序筛选
        if query.process_id:
            stmt = stmt.where(ProcessDefect.process_id == query.process_id)
        
        # 产线筛选
        if query.line_id:
            stmt = stmt.where(ProcessDefect.line_id == query.line_id)
        
        # 不良类型筛选
        if query.defect_type:
            stmt = stmt.where(ProcessDefect.defect_type.ilike(f"%{query.defect_type}%"))
        
        # 责任类别筛选
        if query.responsibility_category:
            stmt = stmt.where(ProcessDefect.responsibility_category == query.responsibility_category)
        
        # 供应商筛选
        if query.supplier_id:
            stmt = stmt.where(ProcessDefect.supplier_id == query.supplier_id)
        
        # 物料编码筛选
        if query.material_code:
            stmt = stmt.where(ProcessDefect.material_code.ilike(f"%{query.material_code}%"))
        
        # 计算总数
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total_result = await db.execute(count_stmt)
        total = total_result.scalar()
        
        # 分页
        stmt = stmt.order_by(ProcessDefect.defect_date.desc(), ProcessDefect.id.desc())
        stmt = stmt.offset((query.page - 1) * query.page_size).limit(query.page_size)
        
        # 执行查询
        result = await db.execute(stmt)
        defects = result.scalars().all()
        
        return list(defects), total
    
    @staticmethod
    async def get_defect_by_id(
        db: AsyncSession,
        defect_id: int,
        current_user: User
    ) -> ProcessDefect:
        """
        获取不良品记录详情
        
        权限控制：供应商用户只能查看自己的记录
        """
        stmt = select(ProcessDefect).where(ProcessDefect.id == defect_id)
        
        # 权限过滤
        if current_user.user_type == UserType.SUPPLIER:
            stmt = stmt.where(
                and_(
                    ProcessDefect.responsibility_category == ResponsibilityCategory.MATERIAL_DEFECT.value,
                    ProcessDefect.supplier_id == current_user.supplier_id
                )
            )
        
        result = await db.execute(stmt)
        defect = result.scalar_one_or_none()
        
        if not defect:
            raise NotFoundException(f"Process defect with id {defect_id} not found")
        
        return defect
    
    @staticmethod
    async def update_defect(
        db: AsyncSession,
        defect_id: int,
        defect_data: ProcessDefectUpdate,
        current_user: User
    ) -> ProcessDefect:
        """
        更新不良品记录
        
        权限控制：只有内部用户可以更新
        """
        # 权限检查
        if current_user.user_type != UserType.INTERNAL:
            raise BusinessException("Only internal users can update defect records")
        
        # 获取记录
        defect = await ProcessDefectService.get_defect_by_id(db, defect_id, current_user)
        
        # 更新字段
        update_data = defect_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(defect, field, value)
        
        await db.commit()
        await db.refresh(defect)
        
        return defect
    
    @staticmethod
    async def delete_defect(
        db: AsyncSession,
        defect_id: int,
        current_user: User
    ) -> None:
        """
        删除不良品记录（软删除）
        
        权限控制：只有内部用户可以删除
        """
        # 权限检查
        if current_user.user_type != UserType.INTERNAL:
            raise BusinessException("Only internal users can delete defect records")
        
        # 获取记录
        defect = await ProcessDefectService.get_defect_by_id(db, defect_id, current_user)
        
        # 执行删除
        await db.delete(defect)
        await db.commit()
    
    @staticmethod
    def get_defect_type_options() -> List[DefectTypeOption]:
        """获取失效类型预设选项"""
        return ProcessDefectService.DEFECT_TYPE_OPTIONS
    
    @staticmethod
    def get_responsibility_category_options() -> List[ResponsibilityCategoryOption]:
        """获取责任类别选项及说明"""
        return ProcessDefectService.RESPONSIBILITY_CATEGORY_OPTIONS
