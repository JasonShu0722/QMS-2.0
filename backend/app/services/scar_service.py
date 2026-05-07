"""
SCAR 和 8D 报告业务逻辑服务
"""
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from sqlalchemy import select, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.scar import SCAR, SCARStatus, SCARSeverity
from app.models.eight_d import EightD, EightDStatus
from app.models.supplier import Supplier
from app.models.user import User, UserStatus, UserType
from app.schemas.scar import (
    SCARCreate, SCARUpdate, SCARListQuery,
    EightDSubmit, EightDReview
)
from app.services.notification_service import NotificationHub
from app.core.exceptions import NotFoundException, BusinessException


class SCARService:
    """SCAR 管理服务"""
    
    @staticmethod
    async def generate_scar_number(db: AsyncSession) -> str:
        """
        生成 SCAR 编号
        格式：SCAR-YYYYMMDD-XXXX
        """
        today = datetime.utcnow().strftime("%Y%m%d")
        prefix = f"SCAR-{today}-"
        
        # 查询今天已有的最大序号
        result = await db.execute(
            select(func.max(SCAR.scar_number))
            .where(SCAR.scar_number.like(f"{prefix}%"))
        )
        max_number = result.scalar()
        
        if max_number:
            # 提取序号并加1
            seq = int(max_number.split('-')[-1]) + 1
        else:
            seq = 1
        
        return f"{prefix}{seq:04d}"
    
    @staticmethod
    async def create_scar(
        db: AsyncSession,
        scar_data: SCARCreate,
        created_by: int
    ) -> SCAR:
        """
        创建 SCAR 单
        
        业务逻辑：
        1. 生成 SCAR 编号
        2. 创建 SCAR 记录
        3. 查找供应商联系人并设置为当前处理人
        4. 发送邮件通知供应商
        """
        # 生成 SCAR 编号
        scar_number = await SCARService.generate_scar_number(db)
        
        # 查询供应商信息
        supplier_result = await db.execute(
            select(Supplier).where(Supplier.id == scar_data.supplier_id)
        )
        supplier = supplier_result.scalar_one_or_none()
        if not supplier:
            raise NotFoundException(f"Supplier with id {scar_data.supplier_id} not found")
        
        # 查找供应商的用户账号作为当前处理人
        user_result = await db.execute(
            select(User)
            .where(and_(
                User.supplier_id == scar_data.supplier_id,
                User.status == "active"
            ))
            .limit(1)
        )
        supplier_user = user_result.scalar_one_or_none()
        
        # 创建 SCAR
        scar = SCAR(
            scar_number=scar_number,
            supplier_id=scar_data.supplier_id,
            material_code=scar_data.material_code,
            material_category=scar_data.material_category,
            defect_description=scar_data.defect_description,
            defect_qty=scar_data.defect_qty,
            severity=scar_data.severity,
            status=SCARStatus.OPEN,
            current_handler_id=supplier_user.id if supplier_user else None,
            deadline=scar_data.deadline,
            created_by=created_by,
            updated_by=created_by
        )
        
        db.add(scar)
        await db.commit()
        await db.refresh(scar)
        
        # 发送通知
        if supplier_user:
            await NotificationHub.send_notification(
                db=db,
                user_ids=[supplier_user.id],
                message_type="workflow_exception",
                title=f"新 SCAR 单：{scar_number}",
                content=f"物料 {scar_data.material_code} 发现质量问题，请及时提交 8D 报告。截止日期：{scar_data.deadline.strftime('%Y-%m-%d')}",
                link=f"/supplier/scar?focusId={scar.id}"
            )
            
            # TODO: 发送邮件通知（需要集成 SMTP 服务）
            # await EmailService.send_scar_notification(supplier.contact_email, scar)
        
        return scar

    @staticmethod
    async def update_scar(
        db: AsyncSession,
        scar_id: int,
        scar_data: SCARUpdate,
        updated_by: int,
        current_user: User
    ) -> SCAR:
        """更新 SCAR 基础字段。"""
        scar = await SCARService.get_scar_by_id(db, scar_id, current_user)
        update_data = scar_data.dict(exclude_unset=True)
        supplier_id_changed = (
            "supplier_id" in update_data
            and update_data["supplier_id"] is not None
            and update_data["supplier_id"] != scar.supplier_id
        )

        if supplier_id_changed:
            supplier_result = await db.execute(
                select(Supplier).where(Supplier.id == update_data["supplier_id"])
            )
            supplier = supplier_result.scalar_one_or_none()
            if not supplier:
                raise NotFoundException(f"Supplier with id {update_data['supplier_id']} not found")

        for field, value in update_data.items():
            setattr(scar, field, value)

        if supplier_id_changed:
            user_result = await db.execute(
                select(User)
                .where(and_(
                    User.supplier_id == scar.supplier_id,
                    User.status == UserStatus.ACTIVE
                ))
                .limit(1)
            )
            supplier_user = user_result.scalar_one_or_none()
            scar.current_handler_id = supplier_user.id if supplier_user else None

        scar.updated_by = updated_by
        scar.updated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(scar)
        return scar
    
    @staticmethod
    async def get_scar_list(
        db: AsyncSession,
        query: SCARListQuery,
        current_user: User
    ) -> tuple[List[SCAR], int]:
        """
        获取 SCAR 列表
        
        权限控制：
        - 供应商用户只能看到自己的 SCAR
        - 内部用户可以看到所有 SCAR
        """
        # 构建查询条件
        conditions = []
        
        # 供应商用户数据过滤
        if current_user.user_type == "supplier" and current_user.supplier_id:
            conditions.append(SCAR.supplier_id == current_user.supplier_id)
        
        # 其他筛选条件
        if query.supplier_id:
            conditions.append(SCAR.supplier_id == query.supplier_id)
        if query.material_code:
            conditions.append(SCAR.material_code.like(f"%{query.material_code}%"))
        if query.status:
            conditions.append(SCAR.status == query.status)
        if query.severity:
            conditions.append(SCAR.severity == query.severity)
        
        # 查询总数
        count_stmt = select(func.count(SCAR.id))
        if conditions:
            count_stmt = count_stmt.where(and_(*conditions))
        
        count_result = await db.execute(count_stmt)
        total = count_result.scalar()
        
        # 查询列表
        stmt = select(SCAR)
        if conditions:
            stmt = stmt.where(and_(*conditions))
        
        stmt = stmt.order_by(SCAR.created_at.desc())
        stmt = stmt.offset((query.page - 1) * query.page_size).limit(query.page_size)
        
        result = await db.execute(stmt)
        scars = result.scalars().all()
        
        return list(scars), total
    
    @staticmethod
    async def get_scar_by_id(
        db: AsyncSession,
        scar_id: int,
        current_user: User
    ) -> SCAR:
        """
        获取 SCAR 详情
        
        权限控制：供应商用户只能查看自己的 SCAR
        """
        result = await db.execute(
            select(SCAR).where(SCAR.id == scar_id)
        )
        scar = result.scalar_one_or_none()
        
        if not scar:
            raise NotFoundException(f"SCAR with id {scar_id} not found")
        
        # 权限检查
        if current_user.user_type == "supplier" and current_user.supplier_id:
            if scar.supplier_id != current_user.supplier_id:
                raise BusinessException("No permission to access this SCAR")
        
        return scar


class EightDService:
    """8D 报告管理服务"""
    
    @staticmethod
    async def submit_8d_report(
        db: AsyncSession,
        scar_id: int,
        eight_d_data: EightDSubmit,
        submitted_by: int,
        current_user: User
    ) -> EightD:
        """
        供应商提交 8D 报告
        
        业务逻辑：
        1. 验证 SCAR 存在且属于当前供应商
        2. 检查是否已有 8D 报告
        3. 创建或更新 8D 报告
        4. 更新 SCAR 状态为"审核中"
        5. 通知 SQE 审核
        """
        # 查询 SCAR
        scar = await SCARService.get_scar_by_id(db, scar_id, current_user)
        
        # 检查 SCAR 状态
        if scar.status in [SCARStatus.CLOSED, SCARStatus.APPROVED]:
            raise BusinessException("SCAR is already closed or approved")
        
        # 查询是否已有 8D 报告
        result = await db.execute(
            select(EightD).where(EightD.scar_id == scar_id)
        )
        eight_d = result.scalar_one_or_none()
        is_draft = eight_d_data.status == "draft"
        now = datetime.utcnow()
        next_status = EightDStatus.DRAFT if is_draft else EightDStatus.SUBMITTED
        reviewer = None

        if not is_draft:
            reviewer_id = eight_d_data.reviewer_id or scar.created_by
            if not reviewer_id:
                raise BusinessException("Please select a supplier quality engineer for 8D review")

            reviewer_result = await db.execute(
                select(User).where(and_(
                    User.id == reviewer_id,
                    User.user_type == UserType.INTERNAL,
                    User.status == UserStatus.ACTIVE,
                ))
            )
            reviewer = reviewer_result.scalar_one_or_none()
            if not reviewer:
                raise BusinessException("Selected supplier quality engineer is unavailable")
        
        if eight_d:
            # 更新现有报告
            eight_d.d0_d3_data = eight_d_data.d0_d3_data
            eight_d.d4_d7_data = eight_d_data.d4_d7_data
            eight_d.d8_data = eight_d_data.d8_data
            eight_d.status = next_status
            eight_d.submitted_by = submitted_by
            if not is_draft:
                eight_d.submitted_at = now
            eight_d.updated_at = now
        else:
            # 创建新报告
            eight_d = EightD(
                scar_id=scar_id,
                d0_d3_data=eight_d_data.d0_d3_data,
                d4_d7_data=eight_d_data.d4_d7_data,
                d8_data=eight_d_data.d8_data,
                status=next_status,
                submitted_by=submitted_by,
                submitted_at=None if is_draft else now
            )
            db.add(eight_d)
        
        # 更新 SCAR 状态
        if is_draft:
            scar.status = SCARStatus.SUPPLIER_RESPONDING
        else:
            scar.status = SCARStatus.UNDER_REVIEW
            scar.current_handler_id = reviewer.id
        scar.updated_at = now
        
        await db.commit()
        await db.refresh(eight_d)
        
        # 通知 SQE（查找创建 SCAR 的人）
        if not is_draft and reviewer:
            await NotificationHub.send_notification(
                db=db,
                user_ids=[reviewer.id],
                message_type="workflow_exception",
                title=f"8D 报告已提交：{scar.scar_number}",
                content=f"供应商已提交 8D 报告，请及时审核。",
                link=f"/quality/scar/eight-d/{scar.id}?action=review"
            )
        
        return eight_d
    
    @staticmethod
    async def review_8d_report(
        db: AsyncSession,
        scar_id: int,
        review_data: EightDReview,
        reviewed_by: int
    ) -> EightD:
        """
        SQE 审核 8D 报告
        
        业务逻辑：
        1. 查询 8D 报告
        2. 更新审核状态和意见
        3. 更新 SCAR 状态
        4. 通知供应商审核结果
        """
        # 查询 8D 报告
        result = await db.execute(
            select(EightD).where(EightD.scar_id == scar_id)
        )
        eight_d = result.scalar_one_or_none()
        
        if not eight_d:
            raise NotFoundException(f"8D report for SCAR {scar_id} not found")
        
        if eight_d.status != EightDStatus.SUBMITTED:
            raise BusinessException("8D report is not in submitted status")
        
        # 查询 SCAR
        scar_result = await db.execute(
            select(SCAR).where(SCAR.id == scar_id)
        )
        scar = scar_result.scalar_one()
        
        # 更新 8D 报告
        eight_d.status = EightDStatus.APPROVED if review_data.approved else EightDStatus.REJECTED
        eight_d.reviewed_by = reviewed_by
        eight_d.review_comments = review_data.review_comments
        eight_d.reviewed_at = datetime.utcnow()
        eight_d.updated_at = datetime.utcnow()
        
        # 更新 SCAR 状态
        if review_data.approved:
            scar.status = SCARStatus.APPROVED
        else:
            scar.status = SCARStatus.REJECTED
            # 驳回时，重新指派给供应商
            scar.current_handler_id = eight_d.submitted_by
        
        scar.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(eight_d)
        
        # 通知供应商
        if eight_d.submitted_by:
            status_text = "已批准" if review_data.approved else "已驳回"
            await NotificationHub.send_notification(
                db=db,
                user_ids=[eight_d.submitted_by],
                message_type="workflow_exception",
                title=f"8D 报告审核结果：{scar.scar_number}",
                content=f"您的 8D 报告{status_text}。审核意见：{review_data.review_comments}",
                link=f"/supplier/eight-d/{scar.id}"
            )
        
        return eight_d
    
    @staticmethod
    async def get_8d_report(
        db: AsyncSession,
        scar_id: int,
        current_user: User
    ) -> Optional[EightD]:
        """
        获取 8D 报告
        
        权限控制：供应商用户只能查看自己的报告
        """
        # 先验证 SCAR 权限
        scar = await SCARService.get_scar_by_id(db, scar_id, current_user)
        
        # 查询 8D 报告
        result = await db.execute(
            select(EightD).where(EightD.scar_id == scar_id)
        )
        eight_d = result.scalar_one_or_none()
        
        return eight_d


class AIPreReviewService:
    """AI 预审服务"""
    
    @staticmethod
    async def pre_review_8d(
        db: AsyncSession,
        eight_d_data: Dict[str, Any],
        supplier_id: int
    ) -> Dict[str, Any]:
        """
        AI 预审 8D 报告
        
        检查项：
        1. 关键词检测（空洞词汇）
        2. 历史查重（根本原因重复）
        """
        issues = []
        suggestions = []
        
        # 1. 关键词检测
        empty_keywords = ["加强培训", "加强管理", "加强监督", "提高意识"]
        d4_d7_data = eight_d_data.get("d4_d7_data", {})
        
        corrective_action = d4_d7_data.get("corrective_action", "")
        preventive_action = d4_d7_data.get("preventive_action", "")
        
        for keyword in empty_keywords:
            if keyword in corrective_action or keyword in preventive_action:
                issues.append(f"检测到空洞词汇：'{keyword}'")
                suggestions.append(f"请将'{keyword}'替换为具体的措施，并上传相关证据（如作业指导书、培训记录等）")
        
        # 2. 历史查重
        root_cause = d4_d7_data.get("root_cause", "")
        if root_cause:
            # 查询该供应商过去 3 个月的 8D 报告
            three_months_ago = datetime.utcnow() - timedelta(days=90)
            
            result = await db.execute(
                select(EightD)
                .join(SCAR, EightD.scar_id == SCAR.id)
                .where(and_(
                    SCAR.supplier_id == supplier_id,
                    EightD.created_at >= three_months_ago,
                    EightD.status.in_([EightDStatus.APPROVED, EightDStatus.CLOSED])
                ))
            )
            historical_reports = result.scalars().all()
            
            # 简单的文本相似度检查（实际应用中可以使用更复杂的算法）
            duplicate_found = False
            for report in historical_reports:
                if report.d4_d7_data:
                    historical_root_cause = report.d4_d7_data.get("root_cause", "")
                    # 简单的包含检查（实际应用中应使用编辑距离或语义相似度）
                    if len(root_cause) > 20 and root_cause in historical_root_cause:
                        duplicate_found = True
                        issues.append("根本原因与历史 8D 报告高度重复")
                        suggestions.append("该问题在过去 3 个月内已出现，请检查之前的纠正措施是否有效执行")
                        break
        
        # 判断是否通过预审
        passed = len(issues) == 0
        
        return {
            "passed": passed,
            "issues": issues,
            "suggestions": suggestions,
            "duplicate_check": {
                "checked": True,
                "duplicate_found": duplicate_found if root_cause else False
            }
        }
