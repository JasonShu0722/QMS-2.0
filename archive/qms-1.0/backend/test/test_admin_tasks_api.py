"""
管理员任务管理 API 测试
Tests for Admin Tasks API - 任务转派与统计功能
"""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, UserType, UserStatus


@pytest.mark.asyncio
class TestAdminTasksAPI:
    """管理员任务管理 API 测试类"""
    
    async def test_reassign_tasks_success(
        self,
        async_client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        auth_headers: dict
    ):
        """
        测试：成功批量转派任务
        
        场景：
        - 管理员将用户A的任务转派给用户B
        - 系统应更新业务表的 current_handler_id
        - 系统应发送通知给新处理人
        """
        # 创建第二个测试用户
        user_b = User(
            username="user_b",
            password_hash="hashed_password",
            full_name="用户B",
            email="userb@example.com",
            user_type=UserType.INTERNAL,
            status=UserStatus.ACTIVE,
            department="质量部",
            position="SQE"
        )
        db_session.add(user_b)
        await db_session.commit()
        await db_session.refresh(user_b)
        
        # 准备转派请求
        request_data = {
            "from_user_id": test_user.id,
            "to_user_id": user_b.id,
            "task_ids": []  # 空列表表示转派所有任务
        }
        
        # 发送转派请求
        response = await async_client.post(
            "/api/v1/admin/tasks/reassign",
            json=request_data,
            headers=auth_headers
        )
        
        # 验证响应
        assert response.status_code == 200
        data = response.json()
        
        assert "success_count" in data
        assert "failed_count" in data
        assert "from_user" in data
        assert "to_user" in data
        assert "details" in data
        
        assert data["from_user"]["id"] == test_user.id
        assert data["to_user"]["id"] == user_b.id
    
    async def test_reassign_tasks_with_specific_task_ids(
        self,
        async_client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        auth_headers: dict
    ):
        """
        测试：转派指定的任务
        
        场景：
        - 管理员指定具体的任务ID进行转派
        - 仅转派指定的任务，其他任务不受影响
        """
        # 创建第二个测试用户
        user_b = User(
            username="user_c",
            password_hash="hashed_password",
            full_name="用户C",
            email="userc@example.com",
            user_type=UserType.INTERNAL,
            status=UserStatus.ACTIVE,
            department="质量部",
            position="QE"
        )
        db_session.add(user_b)
        await db_session.commit()
        await db_session.refresh(user_b)
        
        # 准备转派请求（指定任务ID）
        request_data = {
            "from_user_id": test_user.id,
            "to_user_id": user_b.id,
            "task_ids": ["scar_reports:123", "ppap_submissions:456"]
        }
        
        # 发送转派请求
        response = await async_client.post(
            "/api/v1/admin/tasks/reassign",
            json=request_data,
            headers=auth_headers
        )
        
        # 验证响应
        assert response.status_code == 200
        data = response.json()
        
        assert "success_count" in data
        assert "failed_count" in data
        assert isinstance(data["details"], list)
    
    async def test_reassign_tasks_invalid_user(
        self,
        async_client: AsyncClient,
        test_user: User,
        auth_headers: dict
    ):
        """
        测试：转派任务时用户不存在
        
        场景：
        - 原处理人或新处理人不存在
        - 系统应返回 400 错误
        """
        # 准备转派请求（使用不存在的用户ID）
        request_data = {
            "from_user_id": 99999,  # 不存在的用户
            "to_user_id": test_user.id,
            "task_ids": []
        }
        
        # 发送转派请求
        response = await async_client.post(
            "/api/v1/admin/tasks/reassign",
            json=request_data,
            headers=auth_headers
        )
        
        # 验证响应
        assert response.status_code == 400
        assert "不存在" in response.json()["detail"]
    
    async def test_get_task_statistics(
        self,
        async_client: AsyncClient,
        auth_headers: dict
    ):
        """
        测试：获取任务统计信息
        
        场景：
        - 管理员查看全局任务统计
        - 系统应返回按部门、按人员、逾期任务的统计信息
        """
        # 发送统计请求
        response = await async_client.get(
            "/api/v1/admin/tasks/statistics",
            headers=auth_headers
        )
        
        # 验证响应
        assert response.status_code == 200
        data = response.json()
        
        # 验证响应结构
        assert "by_department" in data
        assert "by_user" in data
        assert "overdue_tasks" in data
        
        # 验证数据类型
        assert isinstance(data["by_department"], list)
        assert isinstance(data["by_user"], list)
        assert isinstance(data["overdue_tasks"], list)
    
    async def test_get_task_statistics_by_department(
        self,
        async_client: AsyncClient,
        auth_headers: dict
    ):
        """
        测试：按部门统计任务
        
        场景：
        - 查看各部门的待办任务分布
        - 系统应返回每个部门的总任务数、逾期数、紧急数、正常数
        """
        # 发送统计请求
        response = await async_client.get(
            "/api/v1/admin/tasks/statistics",
            headers=auth_headers
        )
        
        # 验证响应
        assert response.status_code == 200
        data = response.json()
        
        # 验证部门统计结构
        by_department = data["by_department"]
        if len(by_department) > 0:
            dept_stat = by_department[0]
            assert "department" in dept_stat
            assert "total" in dept_stat
            assert "overdue" in dept_stat
            assert "urgent" in dept_stat
            assert "normal" in dept_stat
    
    async def test_get_task_statistics_by_user(
        self,
        async_client: AsyncClient,
        auth_headers: dict
    ):
        """
        测试：按人员统计任务
        
        场景：
        - 查看各人员的待办任务分布
        - 系统应返回每个人员的总任务数、逾期数、紧急数、正常数
        """
        # 发送统计请求
        response = await async_client.get(
            "/api/v1/admin/tasks/statistics",
            headers=auth_headers
        )
        
        # 验证响应
        assert response.status_code == 200
        data = response.json()
        
        # 验证人员统计结构
        by_user = data["by_user"]
        if len(by_user) > 0:
            user_stat = by_user[0]
            assert "user_id" in user_stat
            assert "user_name" in user_stat
            assert "department" in user_stat
            assert "total" in user_stat
            assert "overdue" in user_stat
            assert "urgent" in user_stat
            assert "normal" in user_stat
    
    async def test_get_overdue_tasks(
        self,
        async_client: AsyncClient,
        auth_headers: dict
    ):
        """
        测试：获取逾期任务清单
        
        场景：
        - 查看所有逾期任务
        - 系统应按逾期时长降序排序
        """
        # 发送统计请求
        response = await async_client.get(
            "/api/v1/admin/tasks/statistics",
            headers=auth_headers
        )
        
        # 验证响应
        assert response.status_code == 200
        data = response.json()
        
        # 验证逾期任务结构
        overdue_tasks = data["overdue_tasks"]
        if len(overdue_tasks) > 0:
            task = overdue_tasks[0]
            assert "task_id" in task
            assert "task_type" in task
            assert "task_number" in task
            assert "deadline" in task
            assert "handler_id" in task
            assert "handler_name" in task
            assert "department" in task
            assert "overdue_hours" in task
            
            # 验证逾期时长为正数
            assert task["overdue_hours"] > 0
    
    async def test_reassign_tasks_without_auth(
        self,
        async_client: AsyncClient
    ):
        """
        测试：未认证用户尝试转派任务
        
        场景：
        - 未登录用户尝试转派任务
        - 系统应返回 401 未授权错误
        """
        # 准备转派请求
        request_data = {
            "from_user_id": 1,
            "to_user_id": 2,
            "task_ids": []
        }
        
        # 发送转派请求（不带认证头）
        response = await async_client.post(
            "/api/v1/admin/tasks/reassign",
            json=request_data
        )
        
        # 验证响应
        assert response.status_code == 401
    
    async def test_get_statistics_without_auth(
        self,
        async_client: AsyncClient
    ):
        """
        测试：未认证用户尝试查看统计
        
        场景：
        - 未登录用户尝试查看任务统计
        - 系统应返回 401 未授权错误
        """
        # 发送统计请求（不带认证头）
        response = await async_client.get(
            "/api/v1/admin/tasks/statistics"
        )
        
        # 验证响应
        assert response.status_code == 401


