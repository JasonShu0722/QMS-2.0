"""
SCAR 和 8D 报告业务逻辑服务
"""
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from sqlalchemy import select, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import flag_modified

from app.core.problem_management import build_8d_number
from app.models.operation_log import OperationLog
from app.models.role_tag import RoleTag
from app.models.scar import SCAR, SCARStatus, SCARSeverity
from app.models.eight_d import EightD, EightDStatus
from app.models.supplier import Supplier
from app.models.user import User, UserStatus, UserType
from app.models.user_role_assignment import UserRoleAssignment
from app.schemas.scar import (
    SCARCreate, SCARUpdate, SCARListQuery,
    EightDSubmit, EightDReview
)
from app.services.notification_service import NotificationHub
from app.core.exceptions import NotFoundException, BusinessException


class SCARService:
    """SCAR 管理服务"""

    @staticmethod
    def _enum_value(value) -> str:
        return value.value if hasattr(value, "value") else str(value)

    @staticmethod
    def _snapshot_scar(scar: SCAR) -> dict:
        data = scar.to_dict()
        data["status"] = SCARService._enum_value(scar.status)
        data["severity"] = SCARService._enum_value(scar.severity)
        data["created_by"] = scar.created_by
        data["updated_by"] = scar.updated_by
        return data

    @staticmethod
    def _record_history(
        db: AsyncSession,
        *,
        scar_id: int,
        user_id: Optional[int],
        operation_type: str,
        action: str,
        content: Optional[str] = None,
        before_data: Optional[dict] = None,
        after_data: Optional[dict] = None,
    ) -> None:
        payload = dict(after_data or {})
        payload["action"] = action
        if content:
            payload["content"] = content

        db.add(
            OperationLog(
                user_id=user_id,
                operation_type=operation_type,
                target_module="scar",
                target_id=scar_id,
                before_data=before_data,
                after_data=payload,
                created_at=datetime.utcnow(),
            )
        )
    
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
            evidence_files=scar_data.evidence_files,
            severity=scar_data.severity,
            status=SCARStatus.OPEN,
            current_handler_id=supplier_user.id if supplier_user else None,
            deadline=scar_data.deadline,
            created_by=created_by,
            updated_by=created_by
        )
        
        db.add(scar)
        await db.flush()
        SCARService._record_history(
            db,
            scar_id=scar.id,
            user_id=created_by,
            operation_type="create",
            action="发单",
            content=f"创建供应商质量问题：{scar.scar_number}",
            after_data=SCARService._snapshot_scar(scar),
        )
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
        before_data = SCARService._snapshot_scar(scar)
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
        SCARService._record_history(
            db,
            scar_id=scar.id,
            user_id=updated_by,
            operation_type="update",
            action="修改",
            content=f"修改供应商质量问题：{scar.scar_number}",
            before_data=before_data,
            after_data=SCARService._snapshot_scar(scar),
        )
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

    APPROVAL_LEVEL_LABELS = {
        "engineer": "工程师",
        "manager": "科室经理",
        "minister": "部长",
    }
    APPROVAL_LEVEL_ROLE_KEYS = {
        "engineer": "quality.supplier.engineer",
        "manager": "quality.supplier.manager",
        "minister": "quality.minister",
    }
    APPROVAL_LEVEL_FALLBACK_KEYWORDS = {
        "engineer": ["供应商", "工程师"],
        "manager": ["供应商", "经理"],
        "minister": ["部长"],
    }
    APPROVAL_LEVELS_BY_SEVERITY = {
        SCARSeverity.LOW.value: ["engineer"],
        SCARSeverity.MEDIUM.value: ["engineer", "manager"],
        SCARSeverity.HIGH.value: ["engineer", "manager"],
        SCARSeverity.CRITICAL.value: ["engineer", "manager", "minister"],
    }

    @staticmethod
    def get_approval_level_label(level: Optional[str]) -> Optional[str]:
        if not level:
            return None
        return EightDService.APPROVAL_LEVEL_LABELS.get(level, level)

    @staticmethod
    def _get_approval_levels(scar: SCAR) -> list[str]:
        severity = SCARService._enum_value(scar.severity)
        return list(
            EightDService.APPROVAL_LEVELS_BY_SEVERITY.get(
                severity,
                EightDService.APPROVAL_LEVELS_BY_SEVERITY[SCARSeverity.MEDIUM.value],
            )
        )

    @staticmethod
    def _with_approval_workflow(d8_data: Optional[dict], workflow: dict) -> dict:
        next_data = dict(d8_data or {})
        next_data["approval_workflow"] = workflow
        return next_data

    @staticmethod
    def _build_approval_workflow(scar: SCAR, first_reviewer: User) -> dict:
        required_levels = EightDService._get_approval_levels(scar)
        current_level = required_levels[0] if required_levels else None
        return {
            "severity": SCARService._enum_value(scar.severity),
            "required_levels": required_levels,
            "current_index": 0,
            "current_level": current_level,
            "current_level_label": EightDService.get_approval_level_label(current_level),
            "current_user_id": first_reviewer.id if current_level else None,
            "current_user_name": first_reviewer.full_name if current_level else None,
            "status": "pending" if current_level else "approved",
            "history": [],
        }

    @staticmethod
    def get_approval_workflow(eight_d: EightD, scar: SCAR) -> dict:
        d8_data = eight_d.d8_data or {}
        existing = d8_data.get("approval_workflow") if isinstance(d8_data, dict) else None
        if isinstance(existing, dict):
            return existing

        required_levels = EightDService._get_approval_levels(scar)
        current_level = required_levels[0] if required_levels else None
        return {
            "severity": SCARService._enum_value(scar.severity),
            "required_levels": required_levels,
            "current_index": 0,
            "current_level": current_level,
            "current_level_label": EightDService.get_approval_level_label(current_level),
            "current_user_id": scar.current_handler_id,
            "current_user_name": None,
            "status": "pending" if eight_d.status == EightDStatus.SUBMITTED else SCARService._enum_value(eight_d.status),
            "history": [],
        }

    @staticmethod
    def _set_approval_workflow(eight_d: EightD, workflow: dict) -> None:
        eight_d.d8_data = EightDService._with_approval_workflow(eight_d.d8_data, workflow)
        flag_modified(eight_d, "d8_data")

    @staticmethod
    async def _find_internal_user_by_role(
        db: AsyncSession,
        role_key: str,
        fallback_keywords: Optional[list[str]] = None,
    ) -> Optional[User]:
        result = await db.execute(
            select(User)
            .join(UserRoleAssignment, UserRoleAssignment.user_id == User.id)
            .join(RoleTag, RoleTag.id == UserRoleAssignment.role_tag_id)
            .where(
                RoleTag.role_key == role_key,
                RoleTag.is_active.is_(True),
                User.user_type == UserType.INTERNAL,
                User.status == UserStatus.ACTIVE,
            )
            .order_by(User.id.asc())
            .limit(1)
        )
        user = result.scalar_one_or_none()
        if user:
            return user

        if fallback_keywords:
            keyword_conditions = []
            for keyword in fallback_keywords:
                like_value = f"%{keyword}%"
                keyword_conditions.extend([
                    User.full_name.ilike(like_value),
                    User.department.ilike(like_value),
                    User.position.ilike(like_value),
                ])
            fallback_result = await db.execute(
                select(User)
                .where(
                    User.user_type == UserType.INTERNAL,
                    User.status == UserStatus.ACTIVE,
                    or_(*keyword_conditions),
                )
                .order_by(User.id.asc())
                .limit(1)
            )
            return fallback_result.scalar_one_or_none()

        return None

    @staticmethod
    async def _find_next_approval_user(db: AsyncSession, level: str) -> Optional[User]:
        return await EightDService._find_internal_user_by_role(
            db,
            EightDService.APPROVAL_LEVEL_ROLE_KEYS[level],
            EightDService.APPROVAL_LEVEL_FALLBACK_KEYWORDS.get(level),
        )

    @staticmethod
    def _format_scar_report_number(scar: SCAR) -> str:
        category_key = "IQ1" if scar.material_category == "electronic" else "IQ0"
        created_at = scar.created_at or datetime.utcnow()
        sequence = ((scar.id - 1) % 999) + 1 if scar.id else 1
        return build_8d_number(category_key, sequence, created_at)

    @staticmethod
    def _build_supplier_report_link(scar_id: int) -> str:
        return f"/supplier/eight-d/{scar_id}?sourceRouteName=SCARList&sourceFocusId={scar_id}"

    @staticmethod
    def _snapshot_report(eight_d: EightD, scar: SCAR) -> dict:
        return {
            "scar_id": scar.id,
            "scar_number": scar.scar_number,
            "report_number": EightDService._format_scar_report_number(scar),
            "status": SCARService._enum_value(eight_d.status),
            "scar_status": SCARService._enum_value(scar.status),
            "submitted_by": eight_d.submitted_by,
            "reviewed_by": eight_d.reviewed_by,
            "review_comments": eight_d.review_comments,
            "submitted_at": eight_d.submitted_at.isoformat() if eight_d.submitted_at else None,
            "reviewed_at": eight_d.reviewed_at.isoformat() if eight_d.reviewed_at else None,
            "approval_workflow": EightDService.get_approval_workflow(eight_d, scar),
        }
    
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
        d8_data = dict(eight_d_data.d8_data or {})

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

            approval_workflow = EightDService._build_approval_workflow(scar, reviewer)
            d8_data = EightDService._with_approval_workflow(d8_data, approval_workflow)
        
        if eight_d:
            # 更新现有报告
            eight_d.d0_d3_data = eight_d_data.d0_d3_data
            eight_d.d4_d7_data = eight_d_data.d4_d7_data
            eight_d.d8_data = d8_data
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
                d8_data=d8_data,
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

        SCARService._record_history(
            db,
            scar_id=scar.id,
            user_id=submitted_by,
            operation_type="draft" if is_draft else "submit",
            action="保存草稿" if is_draft else "提交",
            content=f"{EightDService._format_scar_report_number(scar)} {'保存草稿' if is_draft else '提交审核'}",
            after_data=EightDService._snapshot_report(eight_d, scar),
        )
        
        await db.commit()
        await db.refresh(eight_d)
        
        # 通知 SQE（查找创建 SCAR 的人）
        if not is_draft and reviewer:
            report_number = EightDService._format_scar_report_number(scar)
            await NotificationHub.send_notification(
                db=db,
                user_ids=[reviewer.id],
                message_type="workflow_exception",
                title=f"8D 报告已提交：{report_number}",
                content="供应商已提交 8D 报告，请审核。",
                link=f"/quality/scar/eight-d/{scar.id}?action=review&sourceRouteName=ScarManagement&sourceFocusId={scar.id}"
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

        if scar.current_handler_id and scar.current_handler_id != reviewed_by:
            raise BusinessException("当前用户不是该节点审批人")

        reviewer_result = await db.execute(select(User).where(User.id == reviewed_by))
        reviewer = reviewer_result.scalar_one_or_none()
        if not reviewer:
            raise NotFoundException(f"User with id {reviewed_by} not found")

        workflow = EightDService.get_approval_workflow(eight_d, scar)
        required_levels = list(workflow.get("required_levels") or EightDService._get_approval_levels(scar))
        try:
            current_index = int(workflow.get("current_index") or 0)
        except (TypeError, ValueError):
            current_index = 0

        if current_index >= len(required_levels):
            current_index = 0

        current_level = workflow.get("current_level")
        if not current_level and required_levels:
            current_level = required_levels[current_index]

        current_level_label = EightDService.get_approval_level_label(current_level) or "审批"
        review_comments = review_data.review_comments or "无"
        now = datetime.utcnow()
        history = list(workflow.get("history") or [])
        history.append({
            "level": current_level,
            "level_label": current_level_label,
            "approver_id": reviewed_by,
            "approver_name": reviewer.full_name,
            "approved": review_data.approved,
            "comments": review_comments,
            "reviewed_at": now.isoformat(),
        })

        eight_d.reviewed_by = reviewed_by
        eight_d.review_comments = review_comments
        eight_d.reviewed_at = now
        eight_d.updated_at = now

        if not review_data.approved:
            workflow.update({
                "status": "rejected",
                "rejected_level": current_level,
                "rejected_level_label": current_level_label,
                "current_level": None,
                "current_level_label": None,
                "current_index": current_index,
                "current_user_id": eight_d.submitted_by,
                "current_user_name": None,
                "history": history,
            })
            eight_d.status = EightDStatus.REJECTED
            scar.status = SCARStatus.REJECTED
            scar.current_handler_id = eight_d.submitted_by
            scar.updated_at = now
            EightDService._set_approval_workflow(eight_d, workflow)

            SCARService._record_history(
                db,
                scar_id=scar.id,
                user_id=reviewed_by,
                operation_type="reject",
                action="驳回",
                content=review_comments,
                after_data=EightDService._snapshot_report(eight_d, scar),
            )

            await db.commit()
            await db.refresh(eight_d)

            if scar.current_handler_id:
                report_number = EightDService._format_scar_report_number(scar)
                await NotificationHub.send_notification(
                    db=db,
                    user_ids=[scar.current_handler_id],
                    message_type="workflow_exception",
                    title=f"8D 报告被驳回：{report_number}",
                    content=f"{current_level_label}驳回：{review_comments}",
                    link=EightDService._build_supplier_report_link(scar.id)
                )

            return eight_d

        next_index = current_index + 1
        if next_index < len(required_levels):
            next_level = required_levels[next_index]
            next_user = await EightDService._find_next_approval_user(db, next_level)
            next_level_label = EightDService.get_approval_level_label(next_level) or "下一节点"
            if not next_user:
                raise BusinessException(f"未找到{next_level_label}审批人，请先维护角色标签")

            workflow.update({
                "status": "pending",
                "current_index": next_index,
                "current_level": next_level,
                "current_level_label": next_level_label,
                "current_user_id": next_user.id,
                "current_user_name": next_user.full_name,
                "history": history,
            })
            eight_d.status = EightDStatus.SUBMITTED
            scar.status = SCARStatus.UNDER_REVIEW
            scar.current_handler_id = next_user.id
            scar.updated_at = now
            EightDService._set_approval_workflow(eight_d, workflow)

            SCARService._record_history(
                db,
                scar_id=scar.id,
                user_id=reviewed_by,
                operation_type="approve",
                action=f"{current_level_label}审批",
                content=review_comments,
                after_data=EightDService._snapshot_report(eight_d, scar),
            )

            await db.commit()
            await db.refresh(eight_d)

            report_number = EightDService._format_scar_report_number(scar)
            await NotificationHub.send_notification(
                db=db,
                user_ids=[next_user.id],
                message_type="workflow_exception",
                title=f"8D 报告待审批：{report_number}",
                content=f"{next_level_label}审批",
                link=f"/quality/scar/eight-d/{scar.id}?action=review&sourceRouteName=ScarManagement&sourceFocusId={scar.id}"
            )

            return eight_d

        workflow.update({
            "status": "approved",
            "current_index": current_index,
            "current_level": None,
            "current_level_label": None,
            "current_user_id": None,
            "current_user_name": None,
            "history": history,
        })
        eight_d.status = EightDStatus.CLOSED
        scar.status = SCARStatus.CLOSED
        scar.current_handler_id = None
        scar.updated_at = now
        EightDService._set_approval_workflow(eight_d, workflow)

        SCARService._record_history(
            db,
            scar_id=scar.id,
            user_id=reviewed_by,
            operation_type="approve",
            action=f"{current_level_label}审批关闭",
            content=review_comments,
            after_data=EightDService._snapshot_report(eight_d, scar),
        )

        await db.commit()
        await db.refresh(eight_d)

        if eight_d.submitted_by:
            report_number = EightDService._format_scar_report_number(scar)
            await NotificationHub.send_notification(
                db=db,
                user_ids=[eight_d.submitted_by],
                message_type="workflow_exception",
                title=f"8D 报告已关闭：{report_number}",
                content=f"{current_level_label}审批通过",
                link=EightDService._build_supplier_report_link(scar.id)
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
