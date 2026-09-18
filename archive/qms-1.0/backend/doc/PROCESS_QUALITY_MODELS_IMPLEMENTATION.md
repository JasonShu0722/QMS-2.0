# Process Quality Management Models Implementation

## Overview
本文档记录任务 11.1 的实现：设计过程质量数据模型。

## Implementation Date
2026-02-14

## Task Reference
- Task: 11.1 设计过程质量数据模型
- Requirements: 2.6.2, 2.6.3

## Created Files

### 1. ProcessDefect Model
**File**: `backend/app/models/process_defect.py`

**Purpose**: 制程不良品记录模型，用于记录生产过程中发现的不合格品数据。

**Key Features**:
- 记录不良发生日期、工单号、工序、产线等基础信息
- 支持责任分类统计（物料不良、作业不良、设备不良、工艺不良、设计不良）
- 关联操作员、记录人、供应商等相关人员
- 支持物料编码和供应商关联（当责任类别为物料不良时）

**Fields**:
- `id`: 主键
- `defect_date`: 不良发生日期
- `work_order`: 工单号
- `process_id`: 工序ID
- `line_id`: 产线ID
- `defect_type`: 不良类型/失效模式
- `defect_qty`: 不良数量
- `responsibility_category`: 责任类别（枚举）
- `operator_id`: 操作员ID（可选）
- `recorded_by`: 记录人ID
- `material_code`: 物料编码（可选）
- `supplier_id`: 供应商ID（可选）
- `remarks`: 备注
- `created_at`, `updated_at`: 审计字段

**Enums**:
```python
class ResponsibilityCategory(str, enum.Enum):
    MATERIAL_DEFECT = "material_defect"      # 物料不良
    OPERATION_DEFECT = "operation_defect"    # 作业不良
    EQUIPMENT_DEFECT = "equipment_defect"    # 设备不良
    PROCESS_DEFECT = "process_defect"        # 工艺不良
    DESIGN_DEFECT = "design_defect"          # 设计不良
```

### 2. ProcessIssue Model
**File**: `backend/app/models/process_issue.py`

**Purpose**: 制程质量问题单模型，用于跟踪制程质量异常的闭环管理。

**Key Features**:
- 自动生成问题单编号（格式：PQI-YYYYMMDD-XXXX）
- 支持完整的问题闭环流程（开立 -> 分析 -> 验证 -> 关闭）
- 记录根本原因分析、围堵措施、纠正措施
- 支持验证期管理和逾期判断
- 关联不良品记录和改善证据附件

**Fields**:
- `id`: 主键
- `issue_number`: 问题单编号（唯一）
- `issue_description`: 问题描述
- `responsibility_category`: 责任类别（复用 ResponsibilityCategory 枚举）
- `assigned_to`: 当前处理人ID
- `root_cause`: 根本原因分析
- `containment_action`: 围堵措施
- `corrective_action`: 纠正措施
- `verification_period`: 验证期（天数）
- `verification_start_date`: 验证开始日期
- `verification_end_date`: 验证结束日期
- `status`: 问题单状态（枚举）
- `related_defect_ids`: 关联的不良品记录ID
- `evidence_files`: 改善证据附件路径（JSON格式）
- `created_by`: 发起人ID
- `verified_by`: 验证人ID
- `closed_by`: 关闭人ID
- `closed_at`: 关闭时间
- `created_at`, `updated_at`: 审计字段

**Enums**:
```python
class ProcessIssueStatus(str, enum.Enum):
    OPEN = "open"                          # 已开立
    IN_ANALYSIS = "in_analysis"            # 分析中
    IN_VERIFICATION = "in_verification"    # 验证中
    CLOSED = "closed"                      # 已关闭
    CANCELLED = "cancelled"                # 已取消
```

**Helper Methods**:
- `is_overdue()`: 判断问题单是否逾期

### 3. Database Migration
**File**: `backend/alembic/versions/2026_02_14_1000-008_add_process_quality_models.py`

**Purpose**: 创建过程质量管理相关数据表的数据库迁移脚本。

**Migration Details**:
- Revision ID: 008
- Revises: 007
- Creates tables: `process_defects`, `process_issues`
- Creates indexes for optimal query performance
- Follows non-destructive migration principles (all new fields are nullable or have defaults)

**Indexes Created**:

For `process_defects`:
- `ix_process_defects_defect_date`
- `ix_process_defects_work_order`
- `ix_process_defects_process_id`
- `ix_process_defects_line_id`
- `ix_process_defects_responsibility_category`
- `ix_process_defects_material_code`
- `ix_process_defects_supplier_id`

For `process_issues`:
- `ix_process_issues_issue_number` (unique)
- `ix_process_issues_responsibility_category`
- `ix_process_issues_assigned_to`
- `ix_process_issues_status`

### 4. Model Exports
**File**: `backend/app/models/__init__.py`

**Updates**:
- Added imports for `ProcessDefect`, `ResponsibilityCategory`
- Added imports for `ProcessIssue`, `ProcessIssueStatus`
- Added exports to `__all__` list

## Database Schema Compliance

### Non-Destructive Migration Principles ✅
- All new columns are nullable or have default values
- No existing columns are modified or deleted
- Compatible with dual-track deployment (Preview/Stable)

### Foreign Key Relationships
- `process_defects.operator_id` -> `users.id` (SET NULL on delete)
- `process_defects.recorded_by` -> `users.id` (RESTRICT on delete)
- `process_defects.supplier_id` -> `suppliers.id` (SET NULL on delete)
- `process_issues.assigned_to` -> `users.id` (RESTRICT on delete)
- `process_issues.created_by` -> `users.id` (RESTRICT on delete)
- `process_issues.verified_by` -> `users.id` (SET NULL on delete)
- `process_issues.closed_by` -> `users.id` (SET NULL on delete)

## Integration Points

### With Quality Metrics (2.4.1)
- `ProcessDefect.responsibility_category` 用于关联质量指标计算
- 当责任类别为 `MATERIAL_DEFECT` 时，自动关联到"物料上线不良 PPM"指标

### With Supplier Quality (2.5)
- `ProcessDefect.supplier_id` 关联供应商，用于供应商绩效评价
- 物料不良数据可作为供应商扣分依据

### With Task Aggregation (2.2.3)
- `ProcessIssue.assigned_to` 用于待办任务聚合
- 系统自动将未关闭的问题单展示在处理人的待办列表中

## Usage Examples

### Creating a Process Defect Record
```python
from app.models import ProcessDefect, ResponsibilityCategory

defect = ProcessDefect(
    defect_date=date.today(),
    work_order="WO-2026-001",
    process_id="P001",
    line_id="LINE-A",
    defect_type="焊接不良",
    defect_qty=5,
    responsibility_category=ResponsibilityCategory.OPERATION_DEFECT,
    recorded_by=user_id,
    remarks="操作员未按SOP执行"
)
```

### Creating a Process Issue
```python
from app.models import ProcessIssue, ProcessIssueStatus, ResponsibilityCategory

issue = ProcessIssue(
    issue_number="PQI-20260214-0001",
    issue_description="产线A焊接不良率异常升高",
    responsibility_category=ResponsibilityCategory.EQUIPMENT_DEFECT,
    assigned_to=engineer_id,
    status=ProcessIssueStatus.OPEN,
    created_by=pqe_id
)
```

### Querying Defects by Responsibility
```python
# 查询物料不良记录
material_defects = session.query(ProcessDefect).filter(
    ProcessDefect.responsibility_category == ResponsibilityCategory.MATERIAL_DEFECT
).all()

# 查询特定供应商的不良记录
supplier_defects = session.query(ProcessDefect).filter(
    ProcessDefect.supplier_id == supplier_id,
    ProcessDefect.defect_date >= start_date
).all()
```

### Checking Overdue Issues
```python
# 查询逾期的问题单
overdue_issues = [
    issue for issue in session.query(ProcessIssue).filter(
        ProcessIssue.status.in_([
            ProcessIssueStatus.OPEN,
            ProcessIssueStatus.IN_ANALYSIS,
            ProcessIssueStatus.IN_VERIFICATION
        ])
    ).all()
    if issue.is_overdue()
]
```

## Next Steps

### Task 11.2: 实现生产数据集成
- 扩展 IMSIntegrationService 类
- 实现 sync_production_output() 同步成品入库数据
- 实现 sync_first_pass_test() 同步一次测试数据
- 实现 sync_process_defects() 同步制程不良记录

### Task 11.3: 实现不合格品数据录入与分类
- 创建 POST /api/v1/process-defects 人工补录接口
- 实现失效类型预设选项
- 实现责任类别选择和自动关联指标

### Task 11.4: 实现制程质量问题发单管理
- 创建 POST /api/v1/process-issues 创建问题单接口
- 实现问题指派和闭环流程
- 实现验证和关闭逻辑

## Testing Recommendations

### Unit Tests
- Test ResponsibilityCategory enum values
- Test ProcessDefect model creation and validation
- Test ProcessIssue model creation and validation
- Test ProcessIssue.is_overdue() method logic

### Integration Tests
- Test database migration (upgrade/downgrade)
- Test foreign key constraints
- Test index creation and query performance
- Test model relationships with User and Supplier models

### Data Validation Tests
- Test required fields validation
- Test enum value validation
- Test date field validation
- Test foreign key validation

## Verification Checklist

- [x] ProcessDefect model created with all required fields
- [x] ProcessIssue model created with all required fields
- [x] ResponsibilityCategory enum defined
- [x] ProcessIssueStatus enum defined
- [x] Database migration script created
- [x] Models exported in __init__.py
- [x] All files compile without syntax errors
- [x] Migration follows non-destructive principles
- [x] Foreign key relationships defined correctly
- [x] Indexes created for query optimization
- [x] Helper methods implemented (to_dict, is_overdue)
- [x] Documentation completed

## Conclusion

Task 11.1 has been successfully implemented. The process quality data models are now ready for use in the QMS system. The models follow best practices for SQLAlchemy ORM design and comply with the dual-track deployment requirements.
