"""
任务转派服务模块
Task Reassignment Service - 批量转派任务与全局统计
"""
from typing import List, Dict, Any, Optional
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select
from collections import defaultdict

from app.models.user import User
from app.services.notification_service import notification_service


class TaskReassignmentService:
    """
    任务转派服务
    
    功能：
    - 批量转派任务
    - 按部门统计待办任务
    - 按人员统计待办任务
    - 统计逾期任务清单
    """
    
    # 业务表配置（与 TaskAggregator 保持一致）
    BUSINESS_TABLES = [
        {
            "table": "scar_reports",
            "handler_field": "current_handler_id",
            "task_type": "SCAR报告处理",
            "deadline_field": "deadline",
            "number_field": "report_number",
            "enabled": False  # Phase 1 暂不启用
        },
        {
            "table": "ppap_submissions",
            "handler_field": "reviewer_id",
            "task_type": "PPAP审批",
            "deadline_field": "review_deadline",
            "number_field": "submission_number",
            "enabled": False  # Phase 1 暂不启用
        },
        {
            "table": "audit_nc_items",
            "handler_field": "responsible_user_id",
            "task_type": "审核整改项",
            "deadline_field": "correction_deadline",
            "number_field": "nc_number",
            "enabled": False  # Phase 1 暂不启用
        },
        {
            "table": "customer_complaints",
            "handler_field": "current_handler_id",
            "task_type": "客诉8D报告",
            "deadline_field": "response_deadline",
            "number_field": "complaint_number",
            "enabled": False  # Phase 1 暂不启用
        },
        {
            "table": "supplier_change_requests",
            "handler_field": "reviewer_id",
            "task_type": "供应商变更审批",
            "deadline_field": "review_deadline",
            "number_field": "change_number",
            "enabled": False  # Phase 1 暂不启用
        }
    ]
    
    async def reassign_tasks(
        self,
        db: AsyncSession,
        from_user_id: int,
        to_user_id: int,
        task_ids: Optional[List[str]] = None,
        operator_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        批量转派任务
        
        Args:
            db: 数据库会话
            from_user_id: 原处理人ID
            to_user_id: 新处理人ID
            task_ids: 任务ID列表（格式：table_name:id），如果为空则转派所有任务
            operator_id: 操作人ID
            
        Returns:
            Dict[str, Any]: 转派结果
                - success_count: 成功转派数量
                - failed_count: 失败转派数量
                - details: 详细信息
        """
        # 验证用户存在性
        from_user = await db.get(User, from_user_id)
        to_user = await db.get(User, to_user_id)
        
        if not from_user:
            raise ValueError(f"原处理人不存在: user_id={from_user_id}")
        if not to_user:
            raise ValueError(f"新处理人不存在: user_id={to_user_id}")
        
        success_count = 0
        failed_count = 0
        details = []
        
        # 解析任务ID列表
        task_map = defaultdict(list)
        if task_ids:
            for task_id in task_ids:
                try:
                    table_name, record_id = task_id.split(":", 1)
                    task_map[table_name].append(int(record_id))
                except (ValueError, AttributeError):
                    failed_count += 1
                    details.append({
                        "task_id": task_id,
                        "status": "failed",
                        "reason": "无效的任务ID格式"
                    })
        
        # 遍历所有业务表
        for config in self.BUSINESS_TABLES:
            # 跳过未启用的表
            if not config.get("enabled", False):
                continue
            
            table_name = config["table"]
            handler_field = config["handler_field"]
            
            try:
                # 如果指定了任务ID，只转派指定的任务
                if task_ids and table_name in task_map:
                    record_ids = task_map[table_name]
                    
                    # 构建更新 SQL
                    update_query = text(f"""
                        UPDATE {table_name}
                        SET {handler_field} = :to_user_id,
                            updated_at = :updated_at
                        WHERE id = ANY(:record_ids)
                        AND {handler_field} = :from_user_id
                        AND status NOT IN ('closed', 'completed', 'cancelled')
                        RETURNING id
                    """)
                    
                    result = await db.execute(
                        update_query,
                        {
                            "to_user_id": to_user_id,
                            "from_user_id": from_user_id,
                            "record_ids": record_ids,
                            "updated_at": datetime.utcnow()
                        }
                    )
                    
                    updated_ids = [row.id for row in result.fetchall()]
                    success_count += len(updated_ids)
                    
                    for record_id in updated_ids:
                        details.append({
                            "task_id": f"{table_name}:{record_id}",
                            "status": "success",
                            "from_user": from_user.full_name,
                            "to_user": to_user.full_name
                        })
                
                # 如果未指定任务ID，转派该用户在此表的所有任务
                elif not task_ids:
                    update_query = text(f"""
                        UPDATE {table_name}
                        SET {handler_field} = :to_user_id,
                            updated_at = :updated_at
                        WHERE {handler_field} = :from_user_id
                        AND status NOT IN ('closed', 'completed', 'cancelled')
                        RETURNING id
                    """)
                    
                    result = await db.execute(
                        update_query,
                        {
                            "to_user_id": to_user_id,
                            "from_user_id": from_user_id,
                            "updated_at": datetime.utcnow()
                        }
                    )
                    
                    updated_ids = [row.id for row in result.fetchall()]
                    success_count += len(updated_ids)
                    
                    for record_id in updated_ids:
                        details.append({
                            "task_id": f"{table_name}:{record_id}",
                            "status": "success",
                            "from_user": from_user.full_name,
                            "to_user": to_user.full_name
                        })
                
            except Exception as e:
                # 记录错误但继续处理其他表
                print(f"警告：转派表 {table_name} 的任务失败: {str(e)}")
                if task_ids and table_name in task_map:
                    for record_id in task_map[table_name]:
                        failed_count += 1
                        details.append({
                            "task_id": f"{table_name}:{record_id}",
                            "status": "failed",
                            "reason": str(e)
                        })
        
        # 提交事务
        await db.commit()
        
        # 发送通知给新处理人
        if success_count > 0:
            try:
                await notification_service.send_notification(
                    db=db,
                    user_ids=[to_user_id],
                    title="任务转派通知",
                    content=f"管理员已将 {from_user.full_name} 的 {success_count} 个待办任务转派给您，请及时处理。",
                    notification_type="system",
                    link="/tasks/my-tasks"
                )
            except Exception as e:
                print(f"警告：发送通知失败: {str(e)}")
        
        return {
            "success_count": success_count,
            "failed_count": failed_count,
            "from_user": {
                "id": from_user_id,
                "name": from_user.full_name
            },
            "to_user": {
                "id": to_user_id,
                "name": to_user.full_name
            },
            "details": details
        }
    
    async def get_task_statistics(
        self,
        db: AsyncSession
    ) -> Dict[str, Any]:
        """
        获取全局任务统计信息
        
        Args:
            db: 数据库会话
            
        Returns:
            Dict[str, Any]: 统计信息
                - by_department: 按部门统计
                - by_user: 按人员统计
                - overdue_tasks: 逾期任务清单
        """
        # 按部门统计
        department_stats = await self._get_statistics_by_department(db)
        
        # 按人员统计
        user_stats = await self._get_statistics_by_user(db)
        
        # 逾期任务清单
        overdue_tasks = await self._get_overdue_tasks(db)
        
        return {
            "by_department": department_stats,
            "by_user": user_stats,
            "overdue_tasks": overdue_tasks
        }
    
    async def _get_statistics_by_department(
        self,
        db: AsyncSession
    ) -> List[Dict[str, Any]]:
        """
        按部门统计待办任务数量
        
        Args:
            db: 数据库会话
            
        Returns:
            List[Dict[str, Any]]: 部门统计列表
        """
        department_counts = defaultdict(lambda: {
            "total": 0,
            "overdue": 0,
            "urgent": 0,
            "normal": 0
        })
        
        # 遍历所有业务表
        for config in self.BUSINESS_TABLES:
            if not config.get("enabled", False):
                continue
            
            try:
                query = text(f"""
                    SELECT 
                        u.department,
                        COUNT(*) as total,
                        SUM(CASE WHEN {config['deadline_field']} < NOW() THEN 1 ELSE 0 END) as overdue,
                        SUM(CASE WHEN {config['deadline_field']} >= NOW() 
                            AND {config['deadline_field']} <= NOW() + INTERVAL '72 hours' THEN 1 ELSE 0 END) as urgent,
                        SUM(CASE WHEN {config['deadline_field']} > NOW() + INTERVAL '72 hours' THEN 1 ELSE 0 END) as normal
                    FROM {config['table']} t
                    JOIN users u ON t.{config['handler_field']} = u.id
                    WHERE t.status NOT IN ('closed', 'completed', 'cancelled')
                    AND u.department IS NOT NULL
                    GROUP BY u.department
                """)
                
                result = await db.execute(query)
                rows = result.fetchall()
                
                for row in rows:
                    dept = row.department or "未分配"
                    department_counts[dept]["total"] += row.total
                    department_counts[dept]["overdue"] += row.overdue
                    department_counts[dept]["urgent"] += row.urgent
                    department_counts[dept]["normal"] += row.normal
                    
            except Exception as e:
                print(f"警告：统计表 {config['table']} 失败: {str(e)}")
                continue
        
        # 转换为列表格式
        result = [
            {
                "department": dept,
                "total": stats["total"],
                "overdue": stats["overdue"],
                "urgent": stats["urgent"],
                "normal": stats["normal"]
            }
            for dept, stats in department_counts.items()
        ]
        
        # 按总任务数降序排序
        result.sort(key=lambda x: x["total"], reverse=True)
        
        return result
    
    async def _get_statistics_by_user(
        self,
        db: AsyncSession
    ) -> List[Dict[str, Any]]:
        """
        按人员统计待办任务数量
        
        Args:
            db: 数据库会话
            
        Returns:
            List[Dict[str, Any]]: 人员统计列表
        """
        user_counts = defaultdict(lambda: {
            "user_id": None,
            "user_name": None,
            "department": None,
            "total": 0,
            "overdue": 0,
            "urgent": 0,
            "normal": 0
        })
        
        # 遍历所有业务表
        for config in self.BUSINESS_TABLES:
            if not config.get("enabled", False):
                continue
            
            try:
                query = text(f"""
                    SELECT 
                        u.id as user_id,
                        u.full_name as user_name,
                        u.department,
                        COUNT(*) as total,
                        SUM(CASE WHEN {config['deadline_field']} < NOW() THEN 1 ELSE 0 END) as overdue,
                        SUM(CASE WHEN {config['deadline_field']} >= NOW() 
                            AND {config['deadline_field']} <= NOW() + INTERVAL '72 hours' THEN 1 ELSE 0 END) as urgent,
                        SUM(CASE WHEN {config['deadline_field']} > NOW() + INTERVAL '72 hours' THEN 1 ELSE 0 END) as normal
                    FROM {config['table']} t
                    JOIN users u ON t.{config['handler_field']} = u.id
                    WHERE t.status NOT IN ('closed', 'completed', 'cancelled')
                    GROUP BY u.id, u.full_name, u.department
                """)
                
                result = await db.execute(query)
                rows = result.fetchall()
                
                for row in rows:
                    user_id = row.user_id
                    if user_counts[user_id]["user_id"] is None:
                        user_counts[user_id]["user_id"] = user_id
                        user_counts[user_id]["user_name"] = row.user_name
                        user_counts[user_id]["department"] = row.department
                    
                    user_counts[user_id]["total"] += row.total
                    user_counts[user_id]["overdue"] += row.overdue
                    user_counts[user_id]["urgent"] += row.urgent
                    user_counts[user_id]["normal"] += row.normal
                    
            except Exception as e:
                print(f"警告：统计表 {config['table']} 失败: {str(e)}")
                continue
        
        # 转换为列表格式
        result = list(user_counts.values())
        
        # 按总任务数降序排序
        result.sort(key=lambda x: x["total"], reverse=True)
        
        return result
    
    async def _get_overdue_tasks(
        self,
        db: AsyncSession
    ) -> List[Dict[str, Any]]:
        """
        获取逾期任务清单
        
        Args:
            db: 数据库会话
            
        Returns:
            List[Dict[str, Any]]: 逾期任务列表
        """
        overdue_tasks = []
        
        # 遍历所有业务表
        for config in self.BUSINESS_TABLES:
            if not config.get("enabled", False):
                continue
            
            try:
                query = text(f"""
                    SELECT 
                        t.id,
                        '{config['task_type']}' as task_type,
                        t.{config['number_field']} as task_number,
                        t.{config['deadline_field']} as deadline,
                        u.id as handler_id,
                        u.full_name as handler_name,
                        u.department,
                        EXTRACT(EPOCH FROM (NOW() - t.{config['deadline_field']})) / 3600 as overdue_hours
                    FROM {config['table']} t
                    JOIN users u ON t.{config['handler_field']} = u.id
                    WHERE t.status NOT IN ('closed', 'completed', 'cancelled')
                    AND t.{config['deadline_field']} < NOW()
                    ORDER BY t.{config['deadline_field']} ASC
                """)
                
                result = await db.execute(query)
                rows = result.fetchall()
                
                for row in rows:
                    overdue_tasks.append({
                        "task_id": f"{config['table']}:{row.id}",
                        "task_type": row.task_type,
                        "task_number": row.task_number,
                        "deadline": row.deadline.isoformat() if row.deadline else None,
                        "handler_id": row.handler_id,
                        "handler_name": row.handler_name,
                        "department": row.department,
                        "overdue_hours": round(row.overdue_hours, 2)
                    })
                    
            except Exception as e:
                print(f"警告：查询表 {config['table']} 的逾期任务失败: {str(e)}")
                continue
        
        # 按逾期时长降序排序（最严重的在前）
        overdue_tasks.sort(key=lambda x: x["overdue_hours"], reverse=True)
        
        return overdue_tasks


# 创建全局任务转派服务实例
task_reassignment_service = TaskReassignmentService()


