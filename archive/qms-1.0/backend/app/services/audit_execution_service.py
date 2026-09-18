"""
审核执行服务
Audit Execution Service - 处理审核实施、在线打分、自动评分和报告生成
"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import selectinload
import json
import os
from pathlib import Path

from app.models.audit import AuditExecution, AuditPlan, AuditTemplate, AuditNC
from app.schemas.audit_execution import (
    AuditExecutionCreate,
    ChecklistSubmit,
    ChecklistItemScore,
    AuditExecutionUpdate
)
from app.core.exceptions import NotFoundException, ValidationException


class AuditExecutionService:
    """审核执行服务类"""
    
    @staticmethod
    async def create_audit_execution(
        db: AsyncSession,
        data: AuditExecutionCreate,
        current_user_id: int
    ) -> AuditExecution:
        """
        创建审核执行记录
        
        Args:
            db: 数据库会话
            data: 审核执行创建数据
            current_user_id: 当前用户ID
            
        Returns:
            创建的审核执行记录
        """
        # 验证审核计划是否存在
        audit_plan = await db.get(AuditPlan, data.audit_plan_id)
        if not audit_plan:
            raise NotFoundException(f"审核计划 ID {data.audit_plan_id} 不存在")
        
        # 验证审核模板是否存在
        template = await db.get(AuditTemplate, data.template_id)
        if not template:
            raise NotFoundException(f"审核模板 ID {data.template_id} 不存在")
        
        # 创建审核执行记录
        audit_execution = AuditExecution(
            audit_plan_id=data.audit_plan_id,
            template_id=data.template_id,
            audit_date=data.audit_date,
            auditor_id=data.auditor_id,
            audit_team=data.audit_team,
            summary=data.summary,
            checklist_results={},  # 初始为空，后续通过打分接口填充
            status="draft",
            created_by=current_user_id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        db.add(audit_execution)
        await db.commit()
        await db.refresh(audit_execution)
        
        # 更新审核计划状态为进行中
        audit_plan.status = "in_progress"
        await db.commit()
        
        return audit_execution
    
    @staticmethod
    async def submit_checklist(
        db: AsyncSession,
        execution_id: int,
        data: ChecklistSubmit,
        current_user_id: int
    ) -> AuditExecution:
        """
        提交检查表打分结果（支持移动端在线打分）
        
        实现逻辑：
        1. 接收检查表条款评分数据
        2. 挂载证据照片到对应条款
        3. 自动计算最终得分（应用VDA 6.3降级规则）
        4. 自动生成不符合项(NC)记录
        
        Args:
            db: 数据库会话
            execution_id: 审核执行记录ID
            data: 检查表提交数据
            current_user_id: 当前用户ID
            
        Returns:
            更新后的审核执行记录
        """
        # 获取审核执行记录
        audit_execution = await db.get(AuditExecution, execution_id)
        if not audit_execution:
            raise NotFoundException(f"审核执行记录 ID {execution_id} 不存在")
        
        # 获取审核模板
        template = await db.get(AuditTemplate, audit_execution.template_id)
        if not template:
            raise NotFoundException(f"审核模板 ID {audit_execution.template_id} 不存在")
        
        # 构建检查表结果JSON
        checklist_results = {
            "items": [],
            "submitted_at": datetime.utcnow().isoformat(),
            "submitted_by": current_user_id
        }
        
        nc_items = []  # 收集不符合项
        
        for item_score in data.checklist_results:
            item_result = {
                "item_id": item_score.item_id,
                "score": item_score.score,
                "comment": item_score.comment,
                "evidence_photos": item_score.evidence_photos or [],
                "is_nc": item_score.is_nc,
                "nc_description": item_score.nc_description
            }
            checklist_results["items"].append(item_result)
            
            # 如果是不符合项，收集用于后续创建NC记录
            if item_score.is_nc:
                nc_items.append({
                    "item_id": item_score.item_id,
                    "score": item_score.score,
                    "nc_description": item_score.nc_description,
                    "evidence_photos": item_score.evidence_photos
                })
        
        # 自动评分：应用VDA 6.3降级规则
        final_score, grade = await AuditExecutionService._calculate_score_with_vda63_rules(
            checklist_results["items"],
            template.scoring_rules
        )
        
        # 更新审核执行记录
        audit_execution.checklist_results = checklist_results
        audit_execution.final_score = final_score
        audit_execution.grade = grade
        audit_execution.status = "completed" if not nc_items else "nc_open"
        audit_execution.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(audit_execution)
        
        # 自动生成不符合项记录
        if nc_items:
            await AuditExecutionService._create_nc_records(
                db,
                audit_execution,
                nc_items,
                current_user_id
            )
        
        return audit_execution
    
    @staticmethod
    async def _calculate_score_with_vda63_rules(
        items: List[Dict[str, Any]],
        scoring_rules: Dict[str, Any]
    ) -> tuple[int, str]:
        """
        应用VDA 6.3评分规则计算最终得分
        
        VDA 6.3核心规则：
        1. 单项0分降级规则：任何一个条款得0分，整体等级自动降一级
        2. 百分制计算：(实际得分 / 总分) * 100
        3. 等级划分：A (90-100), B (80-89), C (70-79), D (<70)
        
        Args:
            items: 检查表条款评分列表
            scoring_rules: 评分规则配置
            
        Returns:
            (最终得分, 等级)
        """
        if not items:
            return 0, "D"
        
        # 计算总分和实际得分
        total_score = 0
        actual_score = 0
        has_zero_score = False
        
        for item in items:
            score = item.get("score", 0)
            max_score = scoring_rules.get("max_score_per_item", 10)
            
            total_score += max_score
            actual_score += score
            
            # 检查是否有0分项
            if score == 0:
                has_zero_score = True
        
        # 计算百分制得分
        if total_score == 0:
            percentage_score = 0
        else:
            percentage_score = int((actual_score / total_score) * 100)
        
        # 等级评定
        if percentage_score >= 90:
            grade = "A"
        elif percentage_score >= 80:
            grade = "B"
        elif percentage_score >= 70:
            grade = "C"
        else:
            grade = "D"
        
        # 应用VDA 6.3单项0分降级规则
        if has_zero_score and grade != "D":
            # 降一级
            grade_map = {"A": "B", "B": "C", "C": "D"}
            grade = grade_map.get(grade, "D")
        
        return percentage_score, grade
    
    @staticmethod
    async def _create_nc_records(
        db: AsyncSession,
        audit_execution: AuditExecution,
        nc_items: List[Dict[str, Any]],
        current_user_id: int
    ):
        """
        自动创建不符合项记录
        
        Args:
            db: 数据库会话
            audit_execution: 审核执行记录
            nc_items: 不符合项列表
            current_user_id: 当前用户ID
        """
        # 获取审核计划以获取被审核部门
        audit_plan = await db.get(AuditPlan, audit_execution.audit_plan_id)
        
        for nc_item in nc_items:
            # 将证据照片列表转换为逗号分隔的字符串
            evidence_photos = nc_item.get("evidence_photos", [])
            evidence_photo_path = ",".join(evidence_photos) if evidence_photos else None
            
            # 创建NC记录
            nc = AuditNC(
                audit_id=audit_execution.id,
                nc_item=nc_item.get("item_id", ""),
                nc_description=nc_item.get("nc_description", ""),
                evidence_photo_path=evidence_photo_path,
                responsible_dept=audit_plan.auditee_dept if audit_plan else "",
                verification_status="open",
                deadline=datetime.utcnow(),  # 默认期限，后续可由审核员调整
                created_by=current_user_id,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(nc)
        
        await db.commit()
    
    @staticmethod
    async def get_audit_execution(
        db: AsyncSession,
        execution_id: int
    ) -> Optional[AuditExecution]:
        """
        获取审核执行记录详情
        
        Args:
            db: 数据库会话
            execution_id: 审核执行记录ID
            
        Returns:
            审核执行记录或None
        """
        return await db.get(AuditExecution, execution_id)
    
    @staticmethod
    async def update_audit_execution(
        db: AsyncSession,
        execution_id: int,
        data: AuditExecutionUpdate
    ) -> AuditExecution:
        """
        更新审核执行记录
        
        Args:
            db: 数据库会话
            execution_id: 审核执行记录ID
            data: 更新数据
            
        Returns:
            更新后的审核执行记录
        """
        audit_execution = await db.get(AuditExecution, execution_id)
        if not audit_execution:
            raise NotFoundException(f"审核执行记录 ID {execution_id} 不存在")
        
        # 更新字段
        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(audit_execution, field, value)
        
        audit_execution.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(audit_execution)
        
        return audit_execution
    
    @staticmethod
    async def list_audit_executions(
        db: AsyncSession,
        audit_plan_id: Optional[int] = None,
        auditor_id: Optional[int] = None,
        status: Optional[str] = None,
        page: int = 1,
        page_size: int = 20
    ) -> tuple[List[AuditExecution], int]:
        """
        获取审核执行记录列表
        
        Args:
            db: 数据库会话
            audit_plan_id: 审核计划ID（可选）
            auditor_id: 审核员ID（可选）
            status: 状态（可选）
            page: 页码
            page_size: 每页记录数
            
        Returns:
            (审核执行记录列表, 总记录数)
        """
        # 构建查询条件
        conditions = []
        if audit_plan_id:
            conditions.append(AuditExecution.audit_plan_id == audit_plan_id)
        if auditor_id:
            conditions.append(AuditExecution.auditor_id == auditor_id)
        if status:
            conditions.append(AuditExecution.status == status)
        
        # 查询总数
        count_query = select(func.count(AuditExecution.id))
        if conditions:
            count_query = count_query.where(and_(*conditions))
        result = await db.execute(count_query)
        total = result.scalar_one()
        
        # 查询列表
        query = select(AuditExecution)
        if conditions:
            query = query.where(and_(*conditions))
        query = query.order_by(AuditExecution.audit_date.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)
        
        result = await db.execute(query)
        executions = result.scalars().all()
        
        return list(executions), total
