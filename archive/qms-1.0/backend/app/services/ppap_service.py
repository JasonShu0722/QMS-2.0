"""
PPAP 服务层
Production Part Approval Process Service
"""
from datetime import date, datetime, timedelta
from typing import Optional, List, Dict, Tuple
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ppap import PPAP, PPAPStatus, PPAPLevel
from app.models.supplier import Supplier
from app.models.user import User
from app.schemas.ppap import PPAP_STANDARD_DOCUMENTS, PPAPDocumentItem


class PPAPService:
    """PPAP 业务逻辑服务"""
    
    @staticmethod
    def _initialize_documents_structure(ppap_level: str, required_documents: Optional[List[str]] = None) -> Dict:
        """
        初始化文件清单结构
        
        根据 PPAP 等级自动生成需要提交的文件清单
        """
        documents = {}
        
        # 如果指定了具体文件清单，使用指定的
        if required_documents:
            for doc_key in required_documents:
                if doc_key in PPAP_STANDARD_DOCUMENTS:
                    doc_info = PPAP_STANDARD_DOCUMENTS[doc_key]
                    documents[doc_key] = {
                        "name": doc_info["name"],
                        "name_cn": doc_info["name_cn"],
                        "required": True,
                        "uploaded": False,
                        "file_path": None,
                        "uploaded_at": None,
                        "uploaded_by": None,
                        "review_status": "pending",
                        "review_comments": None,
                        "reviewed_at": None,
                        "reviewed_by": None
                    }
        else:
            # 根据 PPAP 等级自动生成
            # Level 1: 仅 PSW
            if ppap_level == PPAPLevel.LEVEL_1:
                required_keys = ["psw"]
            # Level 2: PSW + 样品
            elif ppap_level == PPAPLevel.LEVEL_2:
                required_keys = ["psw", "sample_products"]
            # Level 3: PSW + 样品 + 部分支持文件（默认）
            elif ppap_level == PPAPLevel.LEVEL_3:
                required_keys = [
                    "psw", "process_flow", "pfmea", "control_plan",
                    "msa", "dimensional_results", "material_test",
                    "initial_process", "sample_products"
                ]
            # Level 4: PSW + 样品 + 全部支持文件
            elif ppap_level == PPAPLevel.LEVEL_4:
                required_keys = list(PPAP_STANDARD_DOCUMENTS.keys())
            # Level 5: PSW + 样品 + 全部支持文件 + 现场评审
            else:  # LEVEL_5
                required_keys = list(PPAP_STANDARD_DOCUMENTS.keys())
            
            for doc_key in required_keys:
                doc_info = PPAP_STANDARD_DOCUMENTS[doc_key]
                documents[doc_key] = {
                    "name": doc_info["name"],
                    "name_cn": doc_info["name_cn"],
                    "required": doc_info["required"],
                    "uploaded": False,
                    "file_path": None,
                    "uploaded_at": None,
                    "uploaded_by": None,
                    "review_status": "pending",
                    "review_comments": None,
                    "reviewed_at": None,
                    "reviewed_by": None
                }
        
        return documents
    
    @staticmethod
    async def create_ppap_submission(
        db: AsyncSession,
        supplier_id: int,
        material_code: str,
        ppap_level: str = "level_3",
        required_documents: Optional[List[str]] = None,
        submission_deadline: Optional[date] = None,
        created_by: Optional[int] = None
    ) -> PPAP:
        """
        创建 PPAP 提交任务
        
        Args:
            db: 数据库会话
            supplier_id: 供应商ID
            material_code: 物料编码
            ppap_level: PPAP等级
            required_documents: 要求提交的文件清单（可选）
            submission_deadline: 提交截止日期（可选）
            created_by: 创建人ID
        
        Returns:
            PPAP: 创建的PPAP记录
        """
        # 初始化文件清单
        documents = PPAPService._initialize_documents_structure(ppap_level, required_documents)
        
        # 创建 PPAP 记录
        ppap = PPAP(
            supplier_id=supplier_id,
            material_code=material_code,
            ppap_level=ppap_level,
            status=PPAPStatus.PENDING,
            documents=documents,
            created_by=created_by,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        db.add(ppap)
        await db.commit()
        await db.refresh(ppap)
        
        return ppap
    
    @staticmethod
    async def get_ppap_by_id(db: AsyncSession, ppap_id: int) -> Optional[PPAP]:
        """根据ID获取PPAP记录"""
        stmt = select(PPAP).where(PPAP.id == ppap_id)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()
    
    @staticmethod
    async def list_ppap_submissions(
        db: AsyncSession,
        supplier_id: Optional[int] = None,
        material_code: Optional[str] = None,
        status: Optional[str] = None,
        ppap_level: Optional[str] = None,
        page: int = 1,
        page_size: int = 20
    ) -> Tuple[List[PPAP], int]:
        """
        查询 PPAP 列表
        
        Returns:
            Tuple[List[PPAP], int]: (PPAP列表, 总记录数)
        """
        # 构建查询条件
        conditions = []
        
        if supplier_id:
            conditions.append(PPAP.supplier_id == supplier_id)
        
        if material_code:
            conditions.append(PPAP.material_code.ilike(f"%{material_code}%"))
        
        if status:
            conditions.append(PPAP.status == status)
        
        if ppap_level:
            conditions.append(PPAP.ppap_level == ppap_level)
        
        # 查询总数
        count_stmt = select(func.count(PPAP.id))
        if conditions:
            count_stmt = count_stmt.where(and_(*conditions))
        
        count_result = await db.execute(count_stmt)
        total = count_result.scalar()
        
        # 查询列表
        stmt = select(PPAP)
        if conditions:
            stmt = stmt.where(and_(*conditions))
        
        stmt = stmt.order_by(PPAP.created_at.desc())
        stmt = stmt.offset((page - 1) * page_size).limit(page_size)
        
        result = await db.execute(stmt)
        ppap_list = result.scalars().all()
        
        return list(ppap_list), total
    
    @staticmethod
    async def upload_document(
        db: AsyncSession,
        ppap_id: int,
        document_key: str,
        file_path: str,
        uploaded_by: int
    ) -> PPAP:
        """
        供应商上传文件
        
        Args:
            db: 数据库会话
            ppap_id: PPAP ID
            document_key: 文件键名
            file_path: 文件路径
            uploaded_by: 上传人ID
        
        Returns:
            PPAP: 更新后的PPAP记录
        """
        ppap = await PPAPService.get_ppap_by_id(db, ppap_id)
        
        if not ppap:
            raise ValueError(f"PPAP记录不存在: {ppap_id}")
        
        # 检查文件键名是否存在
        if document_key not in ppap.documents:
            raise ValueError(f"无效的文件键名: {document_key}")
        
        # 更新文件信息
        ppap.documents[document_key].update({
            "uploaded": True,
            "file_path": file_path,
            "uploaded_at": datetime.utcnow().isoformat(),
            "uploaded_by": uploaded_by,
            "review_status": "pending"
        })
        
        # 标记为已修改（触发 JSONB 更新）
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(ppap, "documents")
        
        # 检查是否所有必需文件都已上传
        all_required_uploaded = all(
            doc["uploaded"] for doc in ppap.documents.values() if doc["required"]
        )
        
        # 如果所有必需文件都已上传，更新状态为"已提交"
        if all_required_uploaded and ppap.status == PPAPStatus.PENDING:
            ppap.status = PPAPStatus.SUBMITTED
            ppap.submission_date = datetime.utcnow().date()
        
        ppap.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(ppap)
        
        return ppap
    
    @staticmethod
    async def review_document(
        db: AsyncSession,
        ppap_id: int,
        document_key: str,
        review_status: str,
        review_comments: Optional[str],
        reviewed_by: int
    ) -> PPAP:
        """
        SQE 审核单个文件
        
        Args:
            db: 数据库会话
            ppap_id: PPAP ID
            document_key: 文件键名
            review_status: 审核状态（approved/rejected）
            review_comments: 审核意见
            reviewed_by: 审核人ID
        
        Returns:
            PPAP: 更新后的PPAP记录
        """
        ppap = await PPAPService.get_ppap_by_id(db, ppap_id)
        
        if not ppap:
            raise ValueError(f"PPAP记录不存在: {ppap_id}")
        
        # 检查文件键名是否存在
        if document_key not in ppap.documents:
            raise ValueError(f"无效的文件键名: {document_key}")
        
        # 更新审核信息
        ppap.documents[document_key].update({
            "review_status": review_status,
            "review_comments": review_comments,
            "reviewed_at": datetime.utcnow().isoformat(),
            "reviewed_by": reviewed_by
        })
        
        # 标记为已修改
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(ppap, "documents")
        
        # 更新整体状态为"审核中"
        if ppap.status == PPAPStatus.SUBMITTED:
            ppap.status = PPAPStatus.UNDER_REVIEW
        
        ppap.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(ppap)
        
        return ppap
    
    @staticmethod
    async def batch_review_and_approve(
        db: AsyncSession,
        ppap_id: int,
        reviews: List[Dict],
        overall_decision: str,
        overall_comments: Optional[str],
        reviewed_by: int
    ) -> PPAP:
        """
        批量审核并做出整体决策
        
        Args:
            db: 数据库会话
            ppap_id: PPAP ID
            reviews: 审核列表 [{"document_key": "psw", "review_status": "approved", "review_comments": "..."}]
            overall_decision: 整体决策（approve/reject）
            overall_comments: 整体审核意见
            reviewed_by: 审核人ID
        
        Returns:
            PPAP: 更新后的PPAP记录
        """
        ppap = await PPAPService.get_ppap_by_id(db, ppap_id)
        
        if not ppap:
            raise ValueError(f"PPAP记录不存在: {ppap_id}")
        
        # 批量更新审核信息
        for review in reviews:
            document_key = review["document_key"]
            if document_key in ppap.documents:
                ppap.documents[document_key].update({
                    "review_status": review["review_status"],
                    "review_comments": review.get("review_comments"),
                    "reviewed_at": datetime.utcnow().isoformat(),
                    "reviewed_by": reviewed_by
                })
        
        # 标记为已修改
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(ppap, "documents")
        
        # 更新整体状态
        if overall_decision == "approve":
            ppap.status = PPAPStatus.APPROVED
            ppap.approved_at = datetime.utcnow()
            # 设置年度再鉴定日期（批准后1年）
            ppap.revalidation_due_date = (datetime.utcnow() + timedelta(days=365)).date()
        else:  # reject
            ppap.status = PPAPStatus.REJECTED
        
        ppap.reviewer_id = reviewed_by
        ppap.review_comments = overall_comments
        ppap.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(ppap)
        
        return ppap
    
    @staticmethod
    async def get_revalidation_reminders(
        db: AsyncSession,
        days_threshold: int = 30
    ) -> List[PPAP]:
        """
        获取需要年度再鉴定的 PPAP 记录
        
        Args:
            db: 数据库会话
            days_threshold: 提前提醒天数（默认30天）
        
        Returns:
            List[PPAP]: 需要再鉴定的PPAP列表
        """
        today = date.today()
        threshold_date = today + timedelta(days=days_threshold)
        
        stmt = select(PPAP).where(
            and_(
                PPAP.status == PPAPStatus.APPROVED,
                PPAP.revalidation_due_date.isnot(None),
                PPAP.revalidation_due_date <= threshold_date
            )
        ).order_by(PPAP.revalidation_due_date)
        
        result = await db.execute(stmt)
        return list(result.scalars().all())
    
    @staticmethod
    async def mark_as_expired(db: AsyncSession, ppap_id: int) -> PPAP:
        """
        标记 PPAP 为已过期（需要再鉴定）
        
        Args:
            db: 数据库会话
            ppap_id: PPAP ID
        
        Returns:
            PPAP: 更新后的PPAP记录
        """
        ppap = await PPAPService.get_ppap_by_id(db, ppap_id)
        
        if not ppap:
            raise ValueError(f"PPAP记录不存在: {ppap_id}")
        
        ppap.status = PPAPStatus.EXPIRED
        ppap.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(ppap)
        
        return ppap
    
    @staticmethod
    def calculate_completion_rate(documents: Dict) -> float:
        """
        计算文件完成率
        
        Args:
            documents: 文件清单字典
        
        Returns:
            float: 完成率（0-100）
        """
        if not documents:
            return 0.0
        
        required_docs = [doc for doc in documents.values() if doc.get("required", False)]
        if not required_docs:
            return 100.0
        
        uploaded_docs = [doc for doc in required_docs if doc.get("uploaded", False)]
        
        return round((len(uploaded_docs) / len(required_docs)) * 100, 2)
    
    @staticmethod
    async def get_statistics(
        db: AsyncSession,
        supplier_id: Optional[int] = None,
        year: Optional[int] = None
    ) -> Dict:
        """
        获取 PPAP 统计数据
        
        Args:
            db: 数据库会话
            supplier_id: 供应商ID（可选）
            year: 年份（可选）
        
        Returns:
            Dict: 统计数据
        """
        conditions = []
        
        if supplier_id:
            conditions.append(PPAP.supplier_id == supplier_id)
        
        if year:
            start_date = date(year, 1, 1)
            end_date = date(year, 12, 31)
            conditions.append(PPAP.created_at >= start_date)
            conditions.append(PPAP.created_at <= end_date)
        
        # 总提交数
        total_stmt = select(func.count(PPAP.id))
        if conditions:
            total_stmt = total_stmt.where(and_(*conditions))
        total_result = await db.execute(total_stmt)
        total_submissions = total_result.scalar() or 0
        
        # 按状态统计
        status_counts = {}
        for status in PPAPStatus:
            status_stmt = select(func.count(PPAP.id))
            status_conditions = conditions + [PPAP.status == status.value]
            status_stmt = status_stmt.where(and_(*status_conditions))
            status_result = await db.execute(status_stmt)
            status_counts[status.value] = status_result.scalar() or 0
        
        return {
            "total_submissions": total_submissions,
            "pending_submissions": status_counts.get("pending", 0),
            "under_review": status_counts.get("under_review", 0),
            "approved": status_counts.get("approved", 0),
            "rejected": status_counts.get("rejected", 0),
            "expired": status_counts.get("expired", 0)
        }
