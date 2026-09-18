"""
任务转派服务测试
Tests for Task Reassignment Service
"""
import pytest
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, UserType, UserStatus
from app.services.task_reassignment_service import task_reassignment_service


@pytest.mark.asyncio
class TestTaskReassignmentService:
    """任务转派服务测试类"""
    
    async def test_reassign_all_tasks(
        self,
        db_session: AsyncSession,
        test_user: User
    ):
        """
        测试：转派所有任务
        
        场景：
        - 不指定 task_ids，转派用户的所有待办任务
        - 系统应更新所有业务表的 current_handler_id
        """
        # 创建目标用户
        to_user = User(
            username="target_user",
            password_hash="hashed_password",
            full_name="目标用户",
            email="target@example.com",
            user_type=UserType.INTERNAL,
            status=UserStatus.ACTIVE,
            department="质量部",
            position="SQE"
        )
        db_session.add(to_user)
        await db_session.commit()
        await db_session.refresh(to_user)
        
        # 执行转派（不指定 task_ids）
        result = await task_reassignment_service.reassign_tasks(
            db=db_session,
            from_user_id=test_user.id,
            to_user_id=to_user.id,
            task_ids=None,
            operator_id=1
        )
        
        # 验证结果
        assert "success_count" in result
        assert "failed_count" in result
        assert "from_user" in result
        assert "to_user" in result
        assert "details" in result
        
        assert result["from_user"]["id"] == test_user.id
        assert result["to_user"]["id"] == to_user.id
        
        # Phase 1 阶段，业务表未启用，success_count 应为 0
        assert result["success_count"] == 0
    
    async def test_reassign_specific_tasks(
        self,
        db_session: AsyncSession,
        test_user: User
    ):
        """
        测试：转派指定任务
        
        场景：
        - 指定 task_ids，仅转派指定的任务
        - 其他任务不受影响
        """
        # 创建目标用户
        to_user = User(
            username="target_user_2",
            password_hash="hashed_password",
            full_name="目标用户2",
            email="target2@example.com",
            user_type=UserType.INTERNAL,
            status=UserStatus.ACTIVE,
            department="质量部",
            position="QE"
        )
        db_session.add(to_user)
        await db_session.commit()
        await db_session.refresh(to_user)
        
        # 执行转派（指定 task_ids）
        result = await task_reassignment_service.reassign_tasks(
            db=db_session,
            from_user_id=test_user.id,
            to_user_id=to_user.id,
            task_ids=["scar_reports:123", "ppap_submissions:456"],
            operator_id=1
        )
        
        # 验证结果
        assert "success_count" in result
        assert "failed_count" in result
        assert isinstance(result["details"], list)
    
    async def test_reassign_tasks_invalid_from_user(
        self,
        db_session: AsyncSession
    ):
        """
        测试：原处理人不存在
        
        场景：
        - from_user_id 不存在
        - 系统应抛出 ValueError
        """
        with pytest.raises(ValueError, match="原处理人不存在"):
            await task_reassignment_service.reassign_tasks(
                db=db_session,
                from_user_id=99999,  # 不存在的用户
                to_user_id=1,
                task_ids=None,
                operator_id=1
            )
    
    async def test_reassign_tasks_invalid_to_user(
        self,
        db_session: AsyncSession,
        test_user: User
    ):
        """
        测试：新处理人不存在
        
        场景：
        - to_user_id 不存在
        - 系统应抛出 ValueError
        """
        with pytest.raises(ValueError, match="新处理人不存在"):
            await task_reassignment_service.reassign_tasks(
                db=db_session,
                from_user_id=test_user.id,
                to_user_id=99999,  # 不存在的用户
                task_ids=None,
                operator_id=1
            )
    
    async def test_get_task_statistics(
        self,
        db_session: AsyncSession
    ):
        """
        测试：获取任务统计信息
        
        场景：
        - 获取全局任务统计
        - 系统应返回按部门、按人员、逾期任务的统计
        """
        # 获取统计信息
        statistics = await task_reassignment_service.get_task_statistics(db_session)
        
        # 验证结果结构
        assert "by_department" in statistics
        assert "by_user" in statistics
        assert "overdue_tasks" in statistics
        
        assert isinstance(statistics["by_department"], list)
        assert isinstance(statistics["by_user"], list)
        assert isinstance(statistics["overdue_tasks"], list)
    
    async def test_get_statistics_by_department(
        self,
        db_session: AsyncSession
    ):
        """
        测试：按部门统计任务
        
        场景：
        - 获取各部门的待办任务分布
        - 系统应返回每个部门的任务统计
        """
        # 获取部门统计
        statistics = await task_reassignment_service._get_statistics_by_department(db_session)
        
        # 验证结果
        assert isinstance(statistics, list)
        
        # Phase 1 阶段，业务表未启用，统计应为空
        # 后续业务表启用后，此处应有数据
    
    async def test_get_statistics_by_user(
        self,
        db_session: AsyncSession
    ):
        """
        测试：按人员统计任务
        
        场景：
        - 获取各人员的待办任务分布
        - 系统应返回每个人员的任务统计
        """
        # 获取人员统计
        statistics = await task_reassignment_service._get_statistics_by_user(db_session)
        
        # 验证结果
        assert isinstance(statistics, list)
        
        # Phase 1 阶段，业务表未启用，统计应为空
        # 后续业务表启用后，此处应有数据
    
    async def test_get_overdue_tasks(
        self,
        db_session: AsyncSession
    ):
        """
        测试：获取逾期任务清单
        
        场景：
        - 获取所有逾期任务
        - 系统应按逾期时长降序排序
        """
        # 获取逾期任务
        overdue_tasks = await task_reassignment_service._get_overdue_tasks(db_session)
        
        # 验证结果
        assert isinstance(overdue_tasks, list)
        
        # Phase 1 阶段，业务表未启用，逾期任务应为空
        # 后续业务表启用后，此处应有数据
        
        # 验证排序（如果有数据）
        if len(overdue_tasks) > 1:
            for i in range(len(overdue_tasks) - 1):
                assert overdue_tasks[i]["overdue_hours"] >= overdue_tasks[i + 1]["overdue_hours"]
    
    async def test_reassign_tasks_with_invalid_task_id_format(
        self,
        db_session: AsyncSession,
        test_user: User
    ):
        """
        测试：无效的任务ID格式
        
        场景：
        - task_ids 格式不正确（缺少冒号分隔符）
        - 系统应记录失败并继续处理其他任务
        """
        # 创建目标用户
        to_user = User(
            username="target_user_3",
            password_hash="hashed_password",
            full_name="目标用户3",
            email="target3@example.com",
            user_type=UserType.INTERNAL,
            status=UserStatus.ACTIVE,
            department="质量部",
            position="PQE"
        )
        db_session.add(to_user)
        await db_session.commit()
        await db_session.refresh(to_user)
        
        # 执行转派（包含无效格式的 task_id）
        result = await task_reassignment_service.reassign_tasks(
            db=db_session,
            from_user_id=test_user.id,
            to_user_id=to_user.id,
            task_ids=["invalid_format", "scar_reports:123"],
            operator_id=1
        )
        
        # 验证结果
        assert result["failed_count"] >= 1
        
        # 检查详细信息中是否包含失败记录
        failed_details = [d for d in result["details"] if d["status"] == "failed"]
        assert len(failed_details) >= 1
        assert any("无效的任务ID格式" in d.get("reason", "") for d in failed_details)


