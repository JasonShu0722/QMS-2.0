# 供应商生命周期管理实施文档
# Supplier Lifecycle Management Implementation Guide

## 概述 (Overview)

本文档描述供应商生命周期管理模块（Task 10.4）的完整实现，涵盖供应商准入审核、资质文件管理、变更管理(PCN)、审核计划与记录、不符合项(NC)跟踪等功能。

## 功能模块 (Feature Modules)

### 1. 供应商准入审核 (Supplier Qualification)

**功能描述**：
- 新供应商准入审核
- 供应商重新认证
- 审核通过后自动激活供应商状态

**API端点**：
```
POST /api/v1/suppliers/qualification
```

**请求示例**：
```json
{
  "supplier_id": 1,
  "qualification_type": "new_supplier",
  "review_comment": "资质审核通过"
}
```

### 2. 资质文件管理 (Document Management)

**功能描述**：
- 供应商上传ISO9001、IATF16949、营业执照等资质文件
- SQE/采购工程师审核资质文件
- 证书有效期自动预警（Celery定时任务）

**API端点**：
```
POST   /api/v1/suppliers/{supplier_id}/documents     # 上传文件
PUT    /api/v1/suppliers/documents/{document_id}/review  # 审核文件
GET    /api/v1/suppliers/documents/expiring         # 获取即将到期证书
```

**上传文件示例**：
```json
{
  "supplier_id": 1,
  "document_type": "iso9001",
  "document_name": "ISO9001证书.pdf",
  "file_path": "/uploads/certificates/iso9001_2024.pdf",
  "file_size": 1024000,
  "issue_date": "2024-01-01T00:00:00",
  "expiry_date": "2027-01-01T00:00:00"
}
```

**审核文件示例**：
```json
{
  "review_status": "approved",
  "review_comment": "证书有效，审核通过"
}
```

### 3. 供应商变更管理 (PCN - Product Change Notification)

**功能描述**：
- 供应商在线提交变更申请（物料、工艺、设备、地点、设计）
- 采购工程师/SQE进行内部评估
- 验证通过后供应商执行切换并上传断点信息

**API端点**：
```
POST   /api/v1/suppliers/pcn           # 创建PCN申请
PUT    /api/v1/suppliers/pcn/{pcn_id}  # 更新PCN状态
```

**创建PCN示例**：
```json
{
  "supplier_id": 1,
  "change_type": "material",
  "material_code": "MAT-001",
  "change_description": "原材料供应商变更",
  "change_reason": "原供应商停产",
  "risk_level": "medium",
  "planned_implementation_date": "2024-03-01T00:00:00",
  "impact_assessment": {
    "quality_impact": "低",
    "cost_impact": "无",
    "delivery_impact": "无"
  }
}
```

**更新PCN示例**：
```json
{
  "status": "approved",
  "review_comment": "变更方案合理，批准实施",
  "actual_implementation_date": "2024-03-05T00:00:00",
  "cutoff_info": {
    "old_material_last_batch": "BATCH-20240304-001",
    "new_material_first_batch": "BATCH-20240305-001"
  }
}
```

### 4. 审核计划管理 (Audit Planning)

**功能描述**：
- 设定年度供应商审核计划
- 指定审核月份、审核类型、审核员
- 支持按年度、供应商、审核员查询

**API端点**：
```
GET    /api/v1/suppliers/audits/plan   # 获取审核计划
POST   /api/v1/suppliers/audits/plan   # 创建审核计划
```

**创建审核计划示例**：
```json
{
  "supplier_id": 1,
  "audit_year": 2024,
  "audit_month": 6,
  "audit_type": "system",
  "auditor_id": 10,
  "notes": "年度体系审核"
}
```

### 5. 审核记录管理 (Audit Execution)

**功能描述**：
- 创建实际执行的审核记录
- 记录审核结果、得分、不符合项统计
- 自动生成审核编号
- 关联审核计划（可选）

**API端点**：
```
POST   /api/v1/suppliers/audits        # 创建审核记录
```

**创建审核记录示例**：
```json
{
  "audit_plan_id": 1,
  "supplier_id": 1,
  "audit_type": "system",
  "audit_date": "2024-06-15T09:00:00",
  "auditor_id": 10,
  "audit_team": {
    "lead_auditor": 10,
    "team_members": [11, 12]
  },
  "audit_result": "passed",
  "score": 85,
  "nc_major_count": 0,
  "nc_minor_count": 2,
  "nc_observation_count": 3,
  "audit_report_path": "/uploads/audit_reports/AUDIT-20240615-0001.pdf",
  "summary": "整体表现良好，存在少量改进项"
}
```

### 6. 不符合项管理 (NC - Non-Conformance)

**功能描述**：
- 录入审核中发现的不符合项
- 指派责任部门和责任人
- 跟踪整改措施和验证结果
- 自动检查审核记录的NC状态

**API端点**：
```
POST   /api/v1/suppliers/audits/{audit_id}/nc  # 创建NC
PUT    /api/v1/suppliers/audits/nc/{nc_id}     # 更新NC
```

**创建NC示例**：
```json
{
  "audit_id": 1,
  "nc_type": "minor",
  "nc_item": "7.1.3 基础设施",
  "nc_description": "生产车间照明不足",
  "evidence_photos": {
    "photos": [
      "/uploads/nc_photos/photo1.jpg",
      "/uploads/nc_photos/photo2.jpg"
    ]
  },
  "responsible_dept": "生产部",
  "assigned_to": 20,
  "deadline": "2024-07-15T00:00:00"
}
```

**更新NC示例**：
```json
{
  "root_cause": "照明设备老化",
  "corrective_action": "更换LED照明设备",
  "corrective_evidence": {
    "before_photos": ["/uploads/before1.jpg"],
    "after_photos": ["/uploads/after1.jpg"],
    "purchase_order": "PO-20240620-001"
  },
  "verification_status": "submitted",
  "verification_comment": "整改措施有效，验证通过"
}
```

## 数据模型 (Data Models)

### 1. SupplierDocument（供应商资质文件）

```python
class SupplierDocument(Base):
    id: int
    supplier_id: int
    document_type: str  # iso9001, iatf16949, business_license, other
    document_name: str
    file_path: str
    file_size: int
    issue_date: datetime
    expiry_date: datetime
    review_status: str  # pending, approved, rejected
    review_comment: str
    reviewed_by: int
    reviewed_at: datetime
    created_at: datetime
    updated_at: datetime
    uploaded_by: int
```

### 2. SupplierPCN（供应商变更通知）

```python
class SupplierPCN(Base):
    id: int
    pcn_number: str
    supplier_id: int
    change_type: str  # material, process, equipment, location, design
    material_code: str
    change_description: str
    change_reason: str
    impact_assessment: dict
    risk_level: str  # low, medium, high
    planned_implementation_date: datetime
    actual_implementation_date: datetime
    cutoff_info: dict
    status: str  # submitted, under_review, approved, rejected, implemented
    current_reviewer_id: int
    review_comments: dict
    approved_by: int
    approved_at: datetime
    attachments: dict
    created_at: datetime
    updated_at: datetime
    submitted_by: int
```

### 3. SupplierAuditPlan（供应商审核计划）

```python
class SupplierAuditPlan(Base):
    id: int
    supplier_id: int
    audit_year: int
    audit_month: int
    audit_type: str  # system, process, product, qualification
    auditor_id: int
    status: str  # planned, in_progress, completed, postponed, cancelled
    notes: str
    created_at: datetime
    updated_at: datetime
    created_by: int
```

### 4. SupplierAudit（供应商审核记录）

```python
class SupplierAudit(Base):
    id: int
    audit_plan_id: int
    supplier_id: int
    audit_number: str
    audit_type: str
    audit_date: datetime
    auditor_id: int
    audit_team: dict
    audit_result: str  # passed, conditional_passed, failed
    score: int
    nc_major_count: int
    nc_minor_count: int
    nc_observation_count: int
    audit_report_path: str
    summary: str
    status: str  # completed, nc_open, nc_closed
    created_at: datetime
    updated_at: datetime
    created_by: int
```

### 5. SupplierAuditNC（供应商审核不符合项）

```python
class SupplierAuditNC(Base):
    id: int
    audit_id: int
    nc_number: str
    nc_type: str  # major, minor, observation
    nc_item: str
    nc_description: str
    evidence_photos: dict
    responsible_dept: str
    assigned_to: int
    root_cause: str
    corrective_action: str
    corrective_evidence: dict
    verification_status: str  # open, submitted, verified, closed
    verified_by: int
    verified_at: datetime
    verification_comment: str
    deadline: datetime
    closed_at: datetime
    created_at: datetime
    updated_at: datetime
    created_by: int
```

## Celery 定时任务 (Scheduled Tasks)

### 1. 证书到期预警

**任务名称**：`check_certificate_expiry`

**执行时间**：每日凌晨02:00

**功能**：
- 检查30天内到期的供应商资质证书
- 按预警级别分类（critical, warning, info）
- 发送通知给相关人员（SQE、采购工程师）

**预警级别**：
- **Critical（关键）**：已过期或7天内到期
- **Warning（警告）**：8-30天内到期
- **Info（信息）**：30天后到期

### 2. 审核计划提醒

**任务名称**：`check_audit_plan_reminders`

**执行时间**：每日凌晨03:00

**功能**：
- 检查下个月的审核计划
- 提前7天通知审核员准备审核资料
- 发送通知给审核员和供应商

## 业务流程 (Business Workflows)

### 1. 供应商准入流程

```
1. 供应商注册账号（状态：pending）
2. 供应商上传资质文件（ISO9001、IATF16949、营业执照等）
3. SQE/采购工程师审核资质文件
4. 审核通过后，执行准入审核API
5. 供应商状态更新为active
6. 供应商可以正常使用系统
```

### 2. PCN变更流程

```
1. 供应商在线提交PCN申请
2. 系统自动生成PCN编号（PCN-YYYYMMDD-XXXX）
3. 采购工程师/SQE进行内部评估
4. 评估通过后批准PCN（status: approved）
5. 供应商执行变更切换
6. 供应商上传断点信息（旧料最后批次、新料首批次）
7. PCN状态更新为implemented
```

### 3. 审核与NC闭环流程

```
1. 创建年度审核计划
2. 审核月份到来时，系统自动提醒审核员
3. 审核员执行现场审核
4. 审核员录入审核结果和NC
5. 系统自动生成NC编号（AUDIT-YYYYMMDD-XXXX-NC-XXX）
6. NC指派给责任部门/责任人
7. 责任人填写根本原因和纠正措施
8. 责任人上传整改证据
9. 审核员验证整改结果
10. 验证通过后关闭NC
11. 所有NC关闭后，审核记录状态更新为nc_closed
```

## 数据库迁移 (Database Migration)

**迁移文件**：`backend/alembic/versions/004_add_supplier_lifecycle_tables.py`

**执行迁移**：
```bash
# 升级到最新版本
alembic upgrade head

# 或指定版本
alembic upgrade 004
```

**回滚迁移**：
```bash
alembic downgrade 003
```

## 测试 (Testing)

**测试文件**：`backend/tests/test_supplier_lifecycle_api.py`

**运行测试**：
```bash
# 运行所有供应商生命周期测试
pytest backend/tests/test_supplier_lifecycle_api.py -v

# 运行特定测试
pytest backend/tests/test_supplier_lifecycle_api.py::test_qualify_supplier -v
```

**测试覆盖**：
- ✅ 供应商准入审核
- ✅ 资质文件上传
- ✅ 资质文件审核
- ✅ 证书到期预警
- ✅ PCN创建
- ✅ PCN更新
- ✅ 审核计划创建
- ✅ 审核计划查询
- ✅ 审核记录创建
- ✅ NC创建
- ✅ NC更新

## 权限控制 (Permission Control)

所有API端点都需要用户认证（JWT Token）。建议配置以下权限：

- **供应商准入审核**：仅SQE、采购经理
- **资质文件上传**：供应商、采购工程师
- **资质文件审核**：SQE、采购工程师
- **PCN创建**：供应商
- **PCN审核**：采购工程师、SQE
- **审核计划管理**：SQE、质量经理
- **审核记录创建**：SQE
- **NC管理**：SQE、责任部门

## 注意事项 (Important Notes)

1. **文件存储**：
   - 当前实现使用本地文件系统存储
   - 生产环境建议使用对象存储（如MinIO、阿里云OSS）

2. **通知机制**：
   - Celery任务中的通知功能需要集成notification_service
   - 需要配置SMTP服务器或企业微信Webhook

3. **数据库兼容性**：
   - 所有新增字段都设置为nullable或带有默认值
   - 遵循双轨发布架构的非破坏性迁移原则

4. **性能优化**：
   - 证书到期检查使用索引（expiry_date）
   - 审核计划查询使用复合索引（audit_year, audit_month）

5. **扩展性**：
   - 支持自定义审核类型
   - 支持自定义NC类型
   - 支持自定义变更类型

## 下一步工作 (Next Steps)

1. 集成文件上传服务（支持多种存储后端）
2. 完善通知服务集成
3. 添加审核报告自动生成功能
4. 添加NC统计分析功能
5. 添加供应商绩效评价关联

## 相关文档 (Related Documents)

- Requirements: `.kiro/specs/qms-foundation-and-auth/requirements.md` - Requirement 2.5.3
- Design: `.kiro/specs/qms-foundation-and-auth/design.md`
- Product Spec: `.kiro/steering/product.md` - Section 2.5.3
- Tasks: `.kiro/specs/qms-foundation-and-auth/tasks.md` - Task 10.4
