"""
Tests for New Product Projects API
新品项目管理API测试 - 阶段评审与交付物管理
"""
import pytest
from datetime import datetime, timedelta
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.new_product_project import NewProductProject, ProjectStage, ProjectStatus
from app.models.stage_review import StageReview, ReviewResult
from app.models.user import User


@pytest.fixture
async def test_user(db_session: AsyncSession):
    """创建测试用户"""
    user = User(
        username="testuser",
        hashed_password="hashed_password",
        full_name="Test User",
        email="test@example.com",
        user_type="internal",
        status="active"
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
async def test_project(db_session: AsyncSession, test_user: User):
    """创建测试项目"""
    project = NewProductProject(
        project_code="TEST-2024-001",
        project_name="测试新品项目",
        product_type="控制器",
        project_manager="张三",
        project_manager_id=test_user.id,
        current_stage=ProjectStage.CONCEPT,
        status=ProjectStatus.ACTIVE,
        planned_sop_date=datetime.utcnow() + timedelta(days=180),
        created_by=test_user.id,
        updated_by=test_user.id
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)
    return project


@pytest.mark.asyncio
class TestNewProductProjects:
    """新品项目管理测试"""
    
    async def test_create_project(self, async_async_client: AsyncClient, test_user: User):
        """测试创建新品项目"""
        project_data = {
            "project_code": "NP-2024-001",
            "project_name": "新能源控制器项目",
            "product_type": "MCU控制器",
            "project_manager": "李工",
            "project_manager_id": test_user.id,
            "planned_sop_date": (datetime.utcnow() + timedelta(days=180)).isoformat()
        }
        
        response = await async_client.post(
            "/api/v1/projects",
            json=project_data,
            headers={"Authorization": f"Bearer {test_user.id}"}
        )
        
        assert response.status_code == 201
        data = response.json()
        assert data["project_code"] == "NP-2024-001"
        assert data["project_name"] == "新能源控制器项目"
        assert data["current_stage"] == "concept"
        assert data["status"] == "active"
    
    async def test_create_project_duplicate_code(self, async_client: AsyncClient, test_user: User, test_project: NewProductProject):
        """测试创建重复项目代码"""
        project_data = {
            "project_code": test_project.project_code,
            "project_name": "重复项目",
            "product_type": "控制器"
        }
        
        response = await async_client.post(
            "/api/v1/projects",
            json=project_data,
            headers={"Authorization": f"Bearer {test_user.id}"}
        )
        
        assert response.status_code == 400
        assert "已存在" in response.json()["detail"]
    
    async def test_get_project(self, async_client: AsyncClient, test_user: User, test_project: NewProductProject):
        """测试获取项目详情"""
        response = await async_client.get(
            f"/api/v1/projects/{test_project.id}",
            headers={"Authorization": f"Bearer {test_user.id}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == test_project.id
        assert data["project_code"] == test_project.project_code
    
    async def test_update_project(self, async_client: AsyncClient, test_user: User, test_project: NewProductProject):
        """测试更新项目信息"""
        update_data = {
            "project_name": "更新后的项目名称",
            "current_stage": "design"
        }
        
        response = await async_client.put(
            f"/api/v1/projects/{test_project.id}",
            json=update_data,
            headers={"Authorization": f"Bearer {test_user.id}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["project_name"] == "更新后的项目名称"
        assert data["current_stage"] == "design"


@pytest.mark.asyncio
class TestStageReviews:
    """阶段评审测试"""
    
    async def test_create_stage_review(self, async_client: AsyncClient, test_user: User, test_project: NewProductProject):
        """测试配置阶段评审节点"""
        review_data = {
            "stage_name": "概念评审",
            "planned_review_date": (datetime.utcnow() + timedelta(days=30)).isoformat(),
            "deliverables": [
                {
                    "name": "项目立项书",
                    "required": True,
                    "status": "missing"
                },
                {
                    "name": "可行性分析报告",
                    "required": True,
                    "status": "missing"
                },
                {
                    "name": "初步设计方案",
                    "required": False,
                    "status": "missing"
                }
            ],
            "reviewer_ids": f"{test_user.id}"
        }
        
        response = await async_client.post(
            f"/api/v1/projects/{test_project.id}/stage-reviews",
            json=review_data,
            headers={"Authorization": f"Bearer {test_user.id}"}
        )
        
        assert response.status_code == 201
        data = response.json()
        assert data["stage_name"] == "概念评审"
        assert len(data["deliverables"]) == 3
        assert data["review_result"] == "pending"
    
    async def test_upload_deliverable(self, async_client: AsyncClient, test_user: User, test_project: NewProductProject, db_session: AsyncSession):
        """测试上传交付物"""
        # 先创建阶段评审
        stage_review = StageReview(
            project_id=test_project.id,
            stage_name="设计评审",
            deliverables=[
                {
                    "name": "DFMEA",
                    "required": True,
                    "status": "missing"
                },
                {
                    "name": "控制计划",
                    "required": True,
                    "status": "missing"
                }
            ],
            review_result=ReviewResult.PENDING,
            created_by=test_user.id
        )
        db_session.add(stage_review)
        await db_session.commit()
        await db_session.refresh(stage_review)
        
        # 上传交付物
        upload_data = {
            "deliverable_name": "DFMEA",
            "file_path": "/uploads/dfmea_v1.0.xlsx",
            "description": "设计失效模式分析"
        }
        
        response = await async_client.post(
            f"/api/v1/projects/{test_project.id}/deliverables?stage_review_id={stage_review.id}",
            json=upload_data,
            headers={"Authorization": f"Bearer {test_user.id}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # 验证交付物状态已更新
        dfmea = next((d for d in data["deliverables"] if d["name"] == "DFMEA"), None)
        assert dfmea is not None
        assert dfmea["status"] == "submitted"
        assert dfmea["file_path"] == "/uploads/dfmea_v1.0.xlsx"
    
    async def test_upload_nonexistent_deliverable(self, async_client: AsyncClient, test_user: User, test_project: NewProductProject, db_session: AsyncSession):
        """测试上传不在清单中的交付物"""
        stage_review = StageReview(
            project_id=test_project.id,
            stage_name="设计评审",
            deliverables=[
                {
                    "name": "DFMEA",
                    "required": True,
                    "status": "missing"
                }
            ],
            review_result=ReviewResult.PENDING,
            created_by=test_user.id
        )
        db_session.add(stage_review)
        await db_session.commit()
        await db_session.refresh(stage_review)
        
        upload_data = {
            "deliverable_name": "不存在的交付物",
            "file_path": "/uploads/file.pdf"
        }
        
        response = await async_client.post(
            f"/api/v1/projects/{test_project.id}/deliverables?stage_review_id={stage_review.id}",
            json=upload_data,
            headers={"Authorization": f"Bearer {test_user.id}"}
        )
        
        assert response.status_code == 400
        assert "不在清单中" in response.json()["detail"]
    
    async def test_approve_stage_review_with_missing_deliverables(
        self, 
        async_client: AsyncClient, 
        test_user: User, 
        test_project: NewProductProject,
        db_session: AsyncSession
    ):
        """测试交付物缺失时无法批准评审（锁定项目进度）"""
        # 创建阶段评审，包含必需的交付物
        stage_review = StageReview(
            project_id=test_project.id,
            stage_name="设计评审",
            deliverables=[
                {
                    "name": "DFMEA",
                    "required": True,
                    "status": "missing"  # 缺失
                },
                {
                    "name": "控制计划",
                    "required": True,
                    "status": "missing"  # 缺失
                }
            ],
            review_result=ReviewResult.PENDING,
            created_by=test_user.id
        )
        db_session.add(stage_review)
        await db_session.commit()
        await db_session.refresh(stage_review)
        
        # 尝试批准评审
        approval_data = {
            "review_result": "passed",
            "review_comments": "评审通过"
        }
        
        response = await async_client.post(
            f"/api/v1/projects/{test_project.id}/stage-reviews/{stage_review.id}/approve",
            json=approval_data,
            headers={"Authorization": f"Bearer {test_user.id}"}
        )
        
        # 应该返回400错误，提示交付物不完整
        assert response.status_code == 400
        assert "交付物不完整" in response.json()["detail"]
        assert "DFMEA" in response.json()["detail"]
        assert "控制计划" in response.json()["detail"]
    
    async def test_approve_stage_review_with_complete_deliverables(
        self, 
        async_client: AsyncClient, 
        test_user: User, 
        test_project: NewProductProject,
        db_session: AsyncSession
    ):
        """测试交付物完整时可以批准评审"""
        # 创建阶段评审，所有必需交付物已提交
        stage_review = StageReview(
            project_id=test_project.id,
            stage_name="设计评审",
            deliverables=[
                {
                    "name": "DFMEA",
                    "required": True,
                    "status": "submitted",
                    "file_path": "/uploads/dfmea.xlsx"
                },
                {
                    "name": "控制计划",
                    "required": True,
                    "status": "submitted",
                    "file_path": "/uploads/control_plan.xlsx"
                },
                {
                    "name": "可选文档",
                    "required": False,
                    "status": "missing"  # 可选项缺失不影响
                }
            ],
            review_result=ReviewResult.PENDING,
            created_by=test_user.id
        )
        db_session.add(stage_review)
        await db_session.commit()
        await db_session.refresh(stage_review)
        
        # 批准评审
        approval_data = {
            "review_result": "passed",
            "review_comments": "所有交付物齐全，评审通过"
        }
        
        response = await async_client.post(
            f"/api/v1/projects/{test_project.id}/stage-reviews/{stage_review.id}/approve",
            json=approval_data,
            headers={"Authorization": f"Bearer {test_user.id}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["review_result"] == "passed"
        assert data["review_comments"] == "所有交付物齐全，评审通过"
        assert data["review_date"] is not None
    
    async def test_conditional_pass_requires_requirements(
        self, 
        async_client: AsyncClient, 
        test_user: User, 
        test_project: NewProductProject,
        db_session: AsyncSession
    ):
        """测试有条件通过时必须填写整改要求"""
        stage_review = StageReview(
            project_id=test_project.id,
            stage_name="设计评审",
            deliverables=[
                {
                    "name": "DFMEA",
                    "required": True,
                    "status": "submitted",
                    "file_path": "/uploads/dfmea.xlsx"
                }
            ],
            review_result=ReviewResult.PENDING,
            created_by=test_user.id
        )
        db_session.add(stage_review)
        await db_session.commit()
        await db_session.refresh(stage_review)
        
        # 有条件通过但未填写整改要求
        approval_data = {
            "review_result": "conditional_pass",
            "review_comments": "有条件通过"
            # 缺少 conditional_requirements
        }
        
        response = await async_client.post(
            f"/api/v1/projects/{test_project.id}/stage-reviews/{stage_review.id}/approve",
            json=approval_data,
            headers={"Authorization": f"Bearer {test_user.id}"}
        )
        
        assert response.status_code == 422  # Validation error
    
    async def test_get_stage_reviews(self, async_client: AsyncClient, test_user: User, test_project: NewProductProject, db_session: AsyncSession):
        """测试获取项目的所有阶段评审"""
        # 创建多个阶段评审
        reviews = [
            StageReview(
                project_id=test_project.id,
                stage_name="概念评审",
                review_result=ReviewResult.PASSED,
                created_by=test_user.id
            ),
            StageReview(
                project_id=test_project.id,
                stage_name="设计评审",
                review_result=ReviewResult.PENDING,
                created_by=test_user.id
            )
        ]
        
        for review in reviews:
            db_session.add(review)
        await db_session.commit()
        
        response = await async_client.get(
            f"/api/v1/projects/{test_project.id}/stage-reviews",
            headers={"Authorization": f"Bearer {test_user.id}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert data[0]["stage_name"] == "概念评审"
        assert data[1]["stage_name"] == "设计评审"
