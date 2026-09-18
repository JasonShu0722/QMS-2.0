"""
供应商生命周期管理 API 测试
Supplier Lifecycle Management API Tests
"""
import pytest
from datetime import datetime, timedelta
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, UserType, UserStatus
from app.models.supplier import Supplier, SupplierStatus
from app.models.supplier_document import SupplierDocument
from app.models.supplier_pcn import SupplierPCN
from app.models.supplier_audit import SupplierAuditPlan, SupplierAudit, SupplierAuditNC


# ==================== 供应商准入审核测试 ====================

@pytest.mark.asyncio
async def test_qualify_supplier(
    async_client: AsyncClient,
    db_session: AsyncSession,
    test_supplier: Supplier,
    test_internal_user: User,
    auth_headers_internal: dict
):
    """测试供应商准入审核"""
    # 准备测试数据
    qualification_data = {
        "supplier_id": test_supplier.id,
        "qualification_type": "new_supplier",
        "review_comment": "资质审核通过"
    }
    
    # 发送请求
    response = await async_client.post(
        "/api/v1/suppliers/qualification",
        json=qualification_data,
        headers=auth_headers_internal
    )
    
    # 验证响应
    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "供应商准入审核成功"
    assert data["supplier"]["status"] == "active"


# ==================== 资质文件管理测试 ====================

@pytest.mark.asyncio
async def test_upload_supplier_document(
    async_client: AsyncClient,
    db_session: AsyncSession,
    test_supplier: Supplier,
    test_supplier_user: User,
    auth_headers_supplier: dict
):
    """测试上传供应商资质文件"""
    # 准备测试数据
    document_data = {
        "supplier_id": test_supplier.id,
        "document_type": "iso9001",
        "document_name": "ISO9001证书.pdf",
        "file_path": "/uploads/certificates/iso9001_2024.pdf",
        "file_size": 1024000,
        "issue_date": "2024-01-01T00:00:00",
        "expiry_date": "2027-01-01T00:00:00"
    }
    
    # 发送请求
    response = await async_client.post(
        f"/api/v1/suppliers/{test_supplier.id}/documents",
        json=document_data,
        headers=auth_headers_supplier
    )
    
    # 验证响应
    assert response.status_code == 201
    data = response.json()
    assert data["document_type"] == "iso9001"
    assert data["review_status"] == "pending"
    assert data["supplier_id"] == test_supplier.id


@pytest.mark.asyncio
async def test_review_supplier_document(
    async_client: AsyncClient,
    db_session: AsyncSession,
    test_supplier: Supplier,
    test_internal_user: User,
    auth_headers_internal: dict
):
    """测试审核供应商资质文件"""
    # 创建测试文件
    document = SupplierDocument(
        supplier_id=test_supplier.id,
        document_type="iso9001",
        document_name="ISO9001证书.pdf",
        file_path="/uploads/certificates/iso9001_2024.pdf",
        review_status="pending",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db_session.add(document)
    await db_session.commit()
    await db_session.refresh(document)
    
    # 准备审核数据
    review_data = {
        "review_status": "approved",
        "review_comment": "证书有效，审核通过"
    }
    
    # 发送请求
    response = await async_client.put(
        f"/api/v1/suppliers/documents/{document.id}/review",
        json=review_data,
        headers=auth_headers_internal
    )
    
    # 验证响应
    assert response.status_code == 200
    data = response.json()
    assert data["review_status"] == "approved"
    assert data["review_comment"] == "证书有效，审核通过"


@pytest.mark.asyncio
async def test_get_expiring_certificates(
    async_client: AsyncClient,
    db_session: AsyncSession,
    test_supplier: Supplier,
    test_internal_user: User,
    auth_headers_internal: dict
):
    """测试获取即将到期的证书"""
    # 创建即将到期的证书
    expiry_date = datetime.utcnow() + timedelta(days=15)
    document = SupplierDocument(
        supplier_id=test_supplier.id,
        document_type="iatf16949",
        document_name="IATF16949证书.pdf",
        file_path="/uploads/certificates/iatf16949_2024.pdf",
        expiry_date=expiry_date,
        review_status="approved",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db_session.add(document)
    await db_session.commit()
    
    # 发送请求
    response = await async_client.get(
        "/api/v1/suppliers/documents/expiring?days=30",
        headers=auth_headers_internal
    )
    
    # 验证响应
    assert response.status_code == 200
    data = response.json()
    assert len(data) > 0
    assert data[0]["supplier_id"] == test_supplier.id
    assert data[0]["warning_level"] in ["critical", "warning", "info"]


# ==================== 供应商变更管理测试 ====================

@pytest.mark.asyncio
async def test_create_supplier_pcn(
    async_client: AsyncClient,
    db_session: AsyncSession,
    test_supplier: Supplier,
    test_supplier_user: User,
    auth_headers_supplier: dict
):
    """测试创建供应商变更申请"""
    # 准备测试数据
    pcn_data = {
        "supplier_id": test_supplier.id,
        "change_type": "material",
        "material_code": "MAT-001",
        "change_description": "原材料供应商变更",
        "change_reason": "原供应商停产",
        "risk_level": "medium",
        "planned_implementation_date": (datetime.utcnow() + timedelta(days=30)).isoformat()
    }
    
    # 发送请求
    response = await async_client.post(
        "/api/v1/suppliers/pcn",
        json=pcn_data,
        headers=auth_headers_supplier
    )
    
    # 验证响应
    assert response.status_code == 201
    data = response.json()
    assert data["change_type"] == "material"
    assert data["status"] == "submitted"
    assert "pcn_number" in data


@pytest.mark.asyncio
async def test_update_supplier_pcn(
    async_client: AsyncClient,
    db_session: AsyncSession,
    test_supplier: Supplier,
    test_internal_user: User,
    auth_headers_internal: dict
):
    """测试更新供应商变更申请"""
    # 创建测试PCN
    pcn = SupplierPCN(
        pcn_number="PCN-20240120-0001",
        supplier_id=test_supplier.id,
        change_type="process",
        change_description="工艺流程优化",
        change_reason="提高生产效率",
        status="submitted",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db_session.add(pcn)
    await db_session.commit()
    await db_session.refresh(pcn)
    
    # 准备更新数据
    update_data = {
        "status": "approved",
        "review_comment": "变更方案合理，批准实施"
    }
    
    # 发送请求
    response = await async_client.put(
        f"/api/v1/suppliers/pcn/{pcn.id}",
        json=update_data,
        headers=auth_headers_internal
    )
    
    # 验证响应
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "approved"


# ==================== 审核计划管理测试 ====================

@pytest.mark.asyncio
async def test_create_audit_plan(
    async_client: AsyncClient,
    db_session: AsyncSession,
    test_supplier: Supplier,
    test_internal_user: User,
    auth_headers_internal: dict
):
    """测试创建审核计划"""
    # 准备测试数据
    plan_data = {
        "supplier_id": test_supplier.id,
        "audit_year": 2024,
        "audit_month": 6,
        "audit_type": "system",
        "auditor_id": test_internal_user.id,
        "notes": "年度体系审核"
    }
    
    # 发送请求
    response = await async_client.post(
        "/api/v1/suppliers/audits/plan",
        json=plan_data,
        headers=auth_headers_internal
    )
    
    # 验证响应
    assert response.status_code == 201
    data = response.json()
    assert data["audit_year"] == 2024
    assert data["audit_month"] == 6
    assert data["status"] == "planned"


@pytest.mark.asyncio
async def test_get_audit_plans(
    async_client: AsyncClient,
    db_session: AsyncSession,
    test_supplier: Supplier,
    test_internal_user: User,
    auth_headers_internal: dict
):
    """测试获取审核计划列表"""
    # 创建测试审核计划
    plan = SupplierAuditPlan(
        supplier_id=test_supplier.id,
        audit_year=2024,
        audit_month=6,
        audit_type="system",
        auditor_id=test_internal_user.id,
        status="planned",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db_session.add(plan)
    await db_session.commit()
    
    # 发送请求
    response = await async_client.get(
        f"/api/v1/suppliers/audits/plan?audit_year=2024&supplier_id={test_supplier.id}",
        headers=auth_headers_internal
    )
    
    # 验证响应
    assert response.status_code == 200
    data = response.json()
    assert len(data) > 0
    assert data[0]["audit_year"] == 2024


# ==================== 审核记录管理测试 ====================

@pytest.mark.asyncio
async def test_create_supplier_audit(
    async_client: AsyncClient,
    db_session: AsyncSession,
    test_supplier: Supplier,
    test_internal_user: User,
    auth_headers_internal: dict
):
    """测试创建供应商审核记录"""
    # 准备测试数据
    audit_data = {
        "supplier_id": test_supplier.id,
        "audit_type": "system",
        "audit_date": datetime.utcnow().isoformat(),
        "auditor_id": test_internal_user.id,
        "audit_result": "passed",
        "score": 85,
        "nc_major_count": 0,
        "nc_minor_count": 2,
        "nc_observation_count": 3,
        "summary": "整体表现良好，存在少量改进项"
    }
    
    # 发送请求
    response = await async_client.post(
        "/api/v1/suppliers/audits",
        json=audit_data,
        headers=auth_headers_internal
    )
    
    # 验证响应
    assert response.status_code == 201
    data = response.json()
    assert data["audit_result"] == "passed"
    assert data["score"] == 85
    assert "audit_number" in data


# ==================== 不符合项管理测试 ====================

@pytest.mark.asyncio
async def test_create_audit_nc(
    async_client: AsyncClient,
    db_session: AsyncSession,
    test_supplier: Supplier,
    test_internal_user: User,
    auth_headers_internal: dict
):
    """测试创建审核不符合项"""
    # 创建测试审核记录
    audit = SupplierAudit(
        supplier_id=test_supplier.id,
        audit_number="AUDIT-20240120-0001",
        audit_type="system",
        audit_date=datetime.utcnow(),
        auditor_id=test_internal_user.id,
        audit_result="conditional_passed",
        nc_major_count=0,
        nc_minor_count=1,
        nc_observation_count=0,
        status="nc_open",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db_session.add(audit)
    await db_session.commit()
    await db_session.refresh(audit)
    
    # 准备测试数据
    nc_data = {
        "audit_id": audit.id,
        "nc_type": "minor",
        "nc_item": "7.1.3 基础设施",
        "nc_description": "生产车间照明不足",
        "responsible_dept": "生产部",
        "deadline": (datetime.utcnow() + timedelta(days=30)).isoformat()
    }
    
    # 发送请求
    response = await async_client.post(
        f"/api/v1/suppliers/audits/{audit.id}/nc",
        json=nc_data,
        headers=auth_headers_internal
    )
    
    # 验证响应
    assert response.status_code == 201
    data = response.json()
    assert data["nc_type"] == "minor"
    assert data["verification_status"] == "open"
    assert "nc_number" in data


@pytest.mark.asyncio
async def test_update_audit_nc(
    async_client: AsyncClient,
    db_session: AsyncSession,
    test_supplier: Supplier,
    test_internal_user: User,
    auth_headers_internal: dict
):
    """测试更新审核不符合项"""
    # 创建测试审核记录和NC
    audit = SupplierAudit(
        supplier_id=test_supplier.id,
        audit_number="AUDIT-20240120-0002",
        audit_type="system",
        audit_date=datetime.utcnow(),
        auditor_id=test_internal_user.id,
        audit_result="conditional_passed",
        nc_major_count=0,
        nc_minor_count=1,
        nc_observation_count=0,
        status="nc_open",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db_session.add(audit)
    await db_session.commit()
    await db_session.refresh(audit)
    
    nc = SupplierAuditNC(
        audit_id=audit.id,
        nc_number="AUDIT-20240120-0002-NC-001",
        nc_type="minor",
        nc_item="7.1.3 基础设施",
        nc_description="生产车间照明不足",
        verification_status="open",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db_session.add(nc)
    await db_session.commit()
    await db_session.refresh(nc)
    
    # 准备更新数据
    update_data = {
        "root_cause": "照明设备老化",
        "corrective_action": "更换LED照明设备",
        "verification_status": "submitted"
    }
    
    # 发送请求
    response = await async_client.put(
        f"/api/v1/suppliers/audits/nc/{nc.id}",
        json=update_data,
        headers=auth_headers_internal
    )
    
    # 验证响应
    assert response.status_code == 200
    data = response.json()
    assert data["root_cause"] == "照明设备老化"
    assert data["verification_status"] == "submitted"
