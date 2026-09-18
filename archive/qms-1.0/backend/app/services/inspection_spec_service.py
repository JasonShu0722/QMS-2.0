"""
物料检验规范服务层
Inspection Specification Service - 业务逻辑处理
"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from sqlalchemy import select, and_, or_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inspection_spec import InspectionSpec, InspectionSpecStatus
from app.models.user import User
from app.schemas.inspection_spec import (
    InspectionSpecCreate,
    InspectionSpecSubmit,
    InspectionSpecApprove,
    InspectionSpecUpdate
)


class InspectionSpecService:
    """物料检验规范服务"""
    
    @staticmethod
    async def create_spec_task(
        db: AsyncSession,
        material_code: str,
        supplier_id: int,
        report_frequency_type: str,
        created_by: int
    ) -> InspectionSpec:
        """
        SQE 发起规范提交任务
        创建新的检验规范记录，状态为 DRAFT
        """
        # 查询该物料+供应商的最新版本号
        latest_version = await InspectionSpecService._get_latest_version(
            db, material_code, supplier_id
        )
        
        # 生成新版本号
        new_version = InspectionSpecService._increment_version(latest_version)
        
        # 创建新规范
        new_spec = InspectionSpec(
            material_code=material_code,
            supplier_id=supplier_id,
            version=new_version,
            report_frequency_type=report_frequency_type,
            status=InspectionSpecStatus.DRAFT,
            created_by=created_by,
            updated_by=created_by
        )
        
        db.add(new_spec)
        await db.commit()
        await db.refresh(new_spec)
        
        return new_spec
    
    @staticmethod
    async def submit_sip(
        db: AsyncSession,
        spec_id: int,
        key_characteristics: List[Dict[str, Any]],
        sip_file_path: str,
        supplier_id: int
    ) -> InspectionSpec:
        """
        供应商提交 SIP（检验规范）
        填写关键检验项目并上传双方签字版 SIP 文件
        """
        # 查询规范
        result = await db.execute(
            select(InspectionSpec).where(InspectionSpec.id == spec_id)
        )
        spec = result.scalar_one_or_none()
        
        if not spec:
            raise ValueError(f"检验规范 ID {spec_id} 不存在")
        
        # 验证供应商权限
        if spec.supplier_id != supplier_id:
            raise PermissionError("无权限操作此检验规范")
        
        # 验证状态
        if spec.status not in [InspectionSpecStatus.DRAFT, InspectionSpecStatus.PENDING_REVIEW]:
            raise ValueError(f"当前状态 {spec.status} 不允许提交")
        
        # 更新规范
        spec.key_characteristics = key_characteristics
        spec.sip_file_path = sip_file_path
        spec.status = InspectionSpecStatus.PENDING_REVIEW
        spec.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(spec)
        
        return spec
    
    @staticmethod
    async def approve_spec(
        db: AsyncSession,
        spec_id: int,
        approved: bool,
        review_comments: Optional[str],
        effective_date: Optional[datetime],
        reviewer_id: int
    ) -> InspectionSpec:
        """
        SQE 审批检验规范
        批准后状态变为 APPROVED，旧版本自动归档
        """
        # 查询规范
        result = await db.execute(
            select(InspectionSpec).where(InspectionSpec.id == spec_id)
        )
        spec = result.scalar_one_or_none()
        
        if not spec:
            raise ValueError(f"检验规范 ID {spec_id} 不存在")
        
        # 验证状态
        if spec.status != InspectionSpecStatus.PENDING_REVIEW:
            raise ValueError(f"当前状态 {spec.status} 不允许审批")
        
        if approved:
            # 批准：归档旧版本
            await InspectionSpecService._archive_old_versions(
                db, spec.material_code, spec.supplier_id, spec.id
            )
            
            # 更新当前规范
            spec.status = InspectionSpecStatus.APPROVED
            spec.reviewer_id = reviewer_id
            spec.review_comments = review_comments
            spec.approved_at = datetime.utcnow()
            spec.effective_date = effective_date
            spec.updated_at = datetime.utcnow()
            spec.updated_by = reviewer_id
        else:
            # 驳回：状态回退到 DRAFT
            spec.status = InspectionSpecStatus.DRAFT
            spec.reviewer_id = reviewer_id
            spec.review_comments = review_comments
            spec.updated_at = datetime.utcnow()
            spec.updated_by = reviewer_id
        
        await db.commit()
        await db.refresh(spec)
        
        return spec
    
    @staticmethod
    async def get_spec_by_id(
        db: AsyncSession,
        spec_id: int
    ) -> Optional[InspectionSpec]:
        """根据 ID 获取检验规范"""
        result = await db.execute(
            select(InspectionSpec).where(InspectionSpec.id == spec_id)
        )
        return result.scalar_one_or_none()
    
    @staticmethod
    async def list_specs(
        db: AsyncSession,
        material_code: Optional[str] = None,
        supplier_id: Optional[int] = None,
        status: Optional[str] = None,
        page: int = 1,
        page_size: int = 20
    ) -> tuple[List[InspectionSpec], int]:
        """
        查询检验规范列表
        支持按物料编码、供应商、状态筛选
        """
        # 构建查询条件
        conditions = []
        if material_code:
            conditions.append(InspectionSpec.material_code.ilike(f"%{material_code}%"))
        if supplier_id:
            conditions.append(InspectionSpec.supplier_id == supplier_id)
        if status:
            conditions.append(InspectionSpec.status == status)
        
        # 查询总数
        count_query = select(InspectionSpec).where(and_(*conditions)) if conditions else select(InspectionSpec)
        count_result = await db.execute(count_query)
        total = len(count_result.all())
        
        # 分页查询
        query = select(InspectionSpec)
        if conditions:
            query = query.where(and_(*conditions))
        query = query.order_by(desc(InspectionSpec.created_at))
        query = query.offset((page - 1) * page_size).limit(page_size)
        
        result = await db.execute(query)
        specs = result.scalars().all()
        
        return list(specs), total
    
    @staticmethod
    async def get_active_spec(
        db: AsyncSession,
        material_code: str,
        supplier_id: int
    ) -> Optional[InspectionSpec]:
        """
        获取当前生效的检验规范
        用于 IQC 检验参照
        """
        result = await db.execute(
            select(InspectionSpec).where(
                and_(
                    InspectionSpec.material_code == material_code,
                    InspectionSpec.supplier_id == supplier_id,
                    InspectionSpec.status == InspectionSpecStatus.APPROVED
                )
            ).order_by(desc(InspectionSpec.effective_date))
        )
        return result.scalars().first()
    
    @staticmethod
    async def update_report_frequency(
        db: AsyncSession,
        spec_id: int,
        report_frequency_type: str,
        updated_by: int
    ) -> InspectionSpec:
        """更新报告频率策略"""
        result = await db.execute(
            select(InspectionSpec).where(InspectionSpec.id == spec_id)
        )
        spec = result.scalar_one_or_none()
        
        if not spec:
            raise ValueError(f"检验规范 ID {spec_id} 不存在")
        
        spec.report_frequency_type = report_frequency_type
        spec.updated_at = datetime.utcnow()
        spec.updated_by = updated_by
        
        await db.commit()
        await db.refresh(spec)
        
        return spec
    
    # ==================== 私有辅助方法 ====================
    
    @staticmethod
    async def _get_latest_version(
        db: AsyncSession,
        material_code: str,
        supplier_id: int
    ) -> Optional[str]:
        """获取最新版本号"""
        result = await db.execute(
            select(InspectionSpec.version).where(
                and_(
                    InspectionSpec.material_code == material_code,
                    InspectionSpec.supplier_id == supplier_id
                )
            ).order_by(desc(InspectionSpec.created_at))
        )
        return result.scalars().first()
    
    @staticmethod
    def _increment_version(current_version: Optional[str]) -> str:
        """
        版本号递增逻辑
        V1.0 -> V1.1 -> V1.2 -> ... -> V2.0
        """
        if not current_version:
            return "V1.0"
        
        # 解析版本号（格式：V1.0）
        try:
            version_str = current_version.replace("V", "").replace("v", "")
            major, minor = map(int, version_str.split("."))
            
            # 小版本递增
            new_version = f"V{major}.{minor + 1}"
            return new_version
        except Exception:
            # 解析失败，返回默认版本
            return "V1.0"
    
    @staticmethod
    async def _archive_old_versions(
        db: AsyncSession,
        material_code: str,
        supplier_id: int,
        exclude_id: int
    ):
        """
        归档旧版本
        将同一物料+供应商的其他 APPROVED 版本状态改为 ARCHIVED
        """
        result = await db.execute(
            select(InspectionSpec).where(
                and_(
                    InspectionSpec.material_code == material_code,
                    InspectionSpec.supplier_id == supplier_id,
                    InspectionSpec.status == InspectionSpecStatus.APPROVED,
                    InspectionSpec.id != exclude_id
                )
            )
        )
        old_specs = result.scalars().all()
        
        for old_spec in old_specs:
            old_spec.status = InspectionSpecStatus.ARCHIVED
            old_spec.updated_at = datetime.utcnow()
        
        await db.commit()


class ReportTaskService:
    """定期报告任务服务（预留功能）"""
    
    @staticmethod
    async def generate_periodic_tasks(db: AsyncSession):
        """
        定期报告任务推送（Celery 定时任务）
        根据 report_frequency_type 自动生成待办任务
        
        预留功能：待 ASN 发货数据流打通后启用
        """
        # TODO: 实现定期任务生成逻辑
        # 1. 查询所有 APPROVED 状态且 report_frequency_type != 'batch' 的规范
        # 2. 根据频率（weekly/monthly/quarterly）计算下次提交日期
        # 3. 生成待办任务推送给供应商
        pass
    
    @staticmethod
    async def check_asn_report_requirement(
        db: AsyncSession,
        material_code: str,
        supplier_id: int
    ) -> tuple[bool, Optional[str]]:
        """
        ASN 强关联检查（预留功能）
        检查该物料是否需要上传报告才能提交发货单
        
        返回：(是否需要报告, 报告频率类型)
        """
        # 查询生效的检验规范
        spec = await InspectionSpecService.get_active_spec(
            db, material_code, supplier_id
        )
        
        if not spec:
            return False, None
        
        # 如果是"按批次"，则需要上传报告
        if spec.report_frequency_type == "batch":
            return True, spec.report_frequency_type
        
        return False, spec.report_frequency_type

