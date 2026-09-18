"""
任务管理 API 测试
Test Tasks API Endpoints
"""
import pytest
from httpx import AsyncClient
from app.main import app


class TestTasksAPI:
    """任务管理 API 测试类"""
    
    @pytest.mark.asyncio
    async def test_get_my_tasks_unauthorized(self, async_client: AsyncClient):
        """测试未授权访问待办任务接口"""
        response = await async_client.get("/api/v1/tasks/my-tasks")
        
        assert response.status_code == 401
        assert "detail" in response.json()
    
    @pytest.mark.asyncio
    async def test_get_my_tasks_authorized(
        self,
        async_client: AsyncClient,
        test_user_token: str
    ):
        """测试授权访问待办任务接口"""
        headers = {"Authorization": f"Bearer {test_user_token}"}
        response = await async_client.get("/api/v1/tasks/my-tasks", headers=headers)
        
        assert response.status_code == 200
        
        data = response.json()
        assert "total" in data
        assert "tasks" in data
        assert isinstance(data["tasks"], list)
        
        # Phase 1 阶段，业务表未创建，应该返回空列表
        assert data["total"] == 0
        assert len(data["tasks"]) == 0
    
    @pytest.mark.asyncio
    async def test_get_task_statistics_unauthorized(self, async_client: AsyncClient):
        """测试未授权访问任务统计接口"""
        response = await async_client.get("/api/v1/tasks/statistics")
        
        assert response.status_code == 401
        assert "detail" in response.json()
    
    @pytest.mark.asyncio
    async def test_get_task_statistics_authorized(
        self,
        async_client: AsyncClient,
        test_user_token: str
    ):
        """测试授权访问任务统计接口"""
        headers = {"Authorization": f"Bearer {test_user_token}"}
        response = await async_client.get("/api/v1/tasks/statistics", headers=headers)
        
        assert response.status_code == 200
        
        data = response.json()
        assert "total" in data
        assert "overdue" in data
        assert "urgent" in data
        assert "normal" in data
        
        # Phase 1 阶段，业务表未创建，应该返回全0统计
        assert data["total"] == 0
        assert data["overdue"] == 0
        assert data["urgent"] == 0
        assert data["normal"] == 0
    
    @pytest.mark.asyncio
    async def test_tasks_api_response_schema(
        self,
        async_client: AsyncClient,
        test_user_token: str
    ):
        """测试任务 API 响应数据结构"""
        headers = {"Authorization": f"Bearer {test_user_token}"}
        response = await async_client.get("/api/v1/tasks/my-tasks", headers=headers)
        
        assert response.status_code == 200
        
        data = response.json()
        
        # 验证响应结构
        assert isinstance(data["total"], int)
        assert isinstance(data["tasks"], list)
        
        # 如果有任务数据，验证任务项结构
        if len(data["tasks"]) > 0:
            task = data["tasks"][0]
            assert "task_type" in task
            assert "task_id" in task
            assert "task_number" in task
            assert "deadline" in task
            assert "urgency" in task
            assert "color" in task
            assert "remaining_hours" in task
            assert "link" in task

