# Process Defect Data Entry and Classification API Implementation

## Overview
本文档记录任务 11.3 的实现：实现不合格品数据录入与分类。

## Implementation Date
2026-02-14

## Task Reference
- Task: 11.3 实现不合格品数据录入与分类
- Requirements: 2.6.2

## Created Files

### 1. Pydantic Schemas
**File**: `backend/app/schemas/process_defect.py`

**Purpose**: 定义过程质量不良品数据的请求/响应模型。

**Key Schemas**:

#### ProcessDefectCreate
创建不良品记录的请求模型，包含：
- 基础信息：不良日期、工单号、工序、产线
- 不良详情：不良类型、不良数量
- 责任分类：责任类别（必填）
- 关联信息：操作员、物料编码、供应商（物料不良时必填）
- 备注信息

**验证逻辑**:
- 责任类别必须是预定义的5种之一
- 当责任类别为 `material_defect` 时，`supplier_id` 和 `material_code` 必填
- 不良数量必须大于0

#### ProcessDefectUpdate
更新不良品记录的请求模型，所有字段可选。

#### ProcessDefectResponse
不良品记录的响应模型，包含：
- 所有数据库字段
- 关联数据：操作员名称、记录人名称、供应商名称

#### ProcessDefectListQuery
列表查询参数模型，支持：
- 日期范围筛选
- 工单号、工序、产线筛选
- 不良类型、责任类别筛选
- 供应商、物料编码筛选
- 分页参数

#### DefectTypeOption & DefectTypeListResponse
失效类型预设选项模型，用于前端下拉选择。

#### ResponsibilityCategoryOption & ResponsibilityCategoryListResponse
责任类别选项模型，包含类别说明和关联的质量指标。

### 2. Service Layer
**File**: `backend/app/services/process_defect_service.py`

**Purpose**: 实现不良品数据的业务逻辑。

**Key Features**:

#### 预设选项管理
- **失效类型选项** (DEFECT_TYPE_OPTIONS):
  - 焊接类：焊接桥接、冷焊、焊接空洞、焊锡不足、焊锡过多
  - 组装类：漏装元件、错装元件、极性反装、元件损坏、元件松动
  - 外观类：划伤、污染、变色、变形、裂纹
  - 功能类：短路、开路、参数超标、功能失效
  - 尺寸类：尺寸超差、位置偏移

- **责任类别选项** (RESPONSIBILITY_CATEGORY_OPTIONS):
  - material_defect: 物料不良 -> 关联"物料上线不良PPM"
  - operation_defect: 作业不良 -> 关联"制程不合格率（作业类）"
  - equipment_defect: 设备不良 -> 关联"制程不合格率（设备类）"
  - process_defect: 工艺不良 -> 关联"制程不合格率（工艺类）"
  - design_defect: 设计不良 -> 关联"制程不合格率（设计类）"

#### 核心方法

**create_defect()**
- 验证供应商存在性（物料不良时）
- 创建不良品记录
- 自动关联质量指标计算（通过责任类别）

**get_defect_list()**
- 权限控制：供应商用户只能看自己的物料不良记录
- 支持多维度筛选
- 分页查询

**get_defect_by_id()**
- 获取单条记录详情
- 权限控制

**update_defect()**
- 更新不良品记录
- 仅内部用户可操作

**delete_defect()**
- 删除不良品记录
- 仅内部用户可操作

**get_defect_type_options()**
- 返回失效类型预设选项

**get_responsibility_category_options()**
- 返回责任类别选项及说明

### 3. API Routes
**File**: `backend/app/api/v1/process_defects.py`

**Purpose**: 提供不良品数据管理的 RESTful API 接口。

**Endpoints**:

#### POST /api/v1/process-defects
创建不良品记录（人工补录）
- 权限：内部用户
- 请求体：ProcessDefectCreate
- 响应：ProcessDefectResponse (201 Created)
- 业务流程：
  1. 验证责任类别
  2. 验证供应商（物料不良时）
  3. 创建记录
  4. 自动关联质量指标

#### GET /api/v1/process-defects
获取不良品数据清单
- 权限：内部用户可见全部，供应商用户仅见自己的
- 查询参数：支持多维度筛选和分页
- 响应：分页列表 + 关联数据

#### GET /api/v1/process-defects/{defect_id}
获取不良品记录详情
- 权限：供应商用户只能查看自己的
- 响应：ProcessDefectResponse

#### PUT /api/v1/process-defects/{defect_id}
更新不良品记录
- 权限：仅内部用户
- 请求体：ProcessDefectUpdate
- 响应：ProcessDefectResponse

#### DELETE /api/v1/process-defects/{defect_id}
删除不良品记录
- 权限：仅内部用户
- 响应：204 No Content

#### GET /api/v1/process-defects/options/defect-types
获取失效类型预设选项
- 权限：所有登录用户
- 响应：DefectTypeListResponse
- 用途：前端下拉选择

#### GET /api/v1/process-defects/options/responsibility-categories
获取责任类别选项及说明
- 权限：所有登录用户
- 响应：ResponsibilityCategoryListResponse
- 用途：前端下拉选择 + 显示关联指标说明

### 4. Router Registration
**Files Updated**:
- `backend/app/api/v1/__init__.py`: 注册 process_defects 路由
- `backend/app/schemas/__init__.py`: 导出 process_defect 相关 schemas

## Key Features Implemented

### 1. 失效类型预设选项 ✅
- 系统内置 21 种常见失效类型
- 按类别分组（焊接、组装、外观、功能、尺寸）
- 支持前端下拉选择
- 可扩展设计

### 2. 责任类别选择与自动关联指标 ✅
- 5 种责任类别：物料、作业、设备、工艺、设计
- 每种类别关联到对应的质量指标（2.4.1）
- 物料不良 -> 自动关联"物料上线不良PPM"
- 其他类别 -> 自动关联"制程不合格率（按类别）"

### 3. 数据录入与验证 ✅
- 人工补录接口（POST /api/v1/process-defects）
- 完整的数据验证（Pydantic）
- 物料不良时强制填写供应商和物料编码
- 不良数量必须大于0

### 4. 数据清单与筛选 ✅
- 获取不良品数据清单（GET /api/v1/process-defects）
- 支持多维度筛选：
  - 日期范围
  - 工单号、工序、产线
  - 不良类型、责任类别
  - 供应商、物料编码
- 分页查询
- 权限控制（供应商用户数据隔离）

### 5. 权限控制 ✅
- 内部用户：可录入、查看、修改、删除所有记录
- 供应商用户：只能查看关联到自己的物料不良记录
- 基于 UserType 的权限判断

## Integration Points

### With Quality Metrics (2.4.1)
- 责任类别自动关联质量指标计算
- `material_defect` -> "物料上线不良PPM"
- 其他类别 -> "制程不合格率（按类别统计）"

### With Supplier Quality (2.5)
- 物料不良记录关联供应商
- 可用于供应商绩效评价的扣分依据

### With Process Issue Management (2.6.3)
- 不良品记录可作为问题发单的数据源
- PQE 可从不良品清单发起制程问题单

## Usage Examples

### 创建不良品记录（物料不良）
```bash
POST /api/v1/process-defects
Content-Type: application/json

{
  "defect_date": "2026-02-14",
  "work_order": "WO-2026-001",
  "process_id": "P001",
  "line_id": "LINE-A",
  "defect_type": "solder_bridge",
  "defect_qty": 5,
  "responsibility_category": "material_defect",
  "material_code": "MAT-001",
  "supplier_id": 1,
  "remarks": "来料焊盘氧化导致焊接桥接"
}
```

### 创建不良品记录（作业不良）
```bash
POST /api/v1/process-defects
Content-Type: application/json

{
  "defect_date": "2026-02-14",
  "work_order": "WO-2026-002",
  "process_id": "P002",
  "line_id": "LINE-B",
  "defect_type": "missing_component",
  "defect_qty": 3,
  "responsibility_category": "operation_defect",
  "operator_id": 10,
  "remarks": "操作员未按SOP检查导致漏装"
}
```

### 查询不良品清单（按责任类别筛选）
```bash
GET /api/v1/process-defects?responsibility_category=material_defect&page=1&page_size=20
```

### 查询不良品清单（按供应商筛选）
```bash
GET /api/v1/process-defects?supplier_id=1&defect_date_start=2026-02-01&defect_date_end=2026-02-14
```

### 获取失效类型选项
```bash
GET /api/v1/process-defects/options/defect-types
```

Response:
```json
{
  "defect_types": [
    {
      "value": "solder_bridge",
      "label": "焊接桥接",
      "category": "焊接"
    },
    {
      "value": "missing_component",
      "label": "漏装元件",
      "category": "组装"
    },
    ...
  ]
}
```

### 获取责任类别选项
```bash
GET /api/v1/process-defects/options/responsibility-categories
```

Response:
```json
{
  "categories": [
    {
      "value": "material_defect",
      "label": "物料不良",
      "description": "来料本身存在质量问题导致的不良",
      "links_to_metric": "物料上线不良PPM"
    },
    {
      "value": "operation_defect",
      "label": "作业不良",
      "description": "操作员未按SOP执行或操作失误导致的不良",
      "links_to_metric": "制程不合格率（作业类）"
    },
    ...
  ]
}
```

## Testing Recommendations

### Unit Tests
- Test ProcessDefectCreate validation logic
- Test responsibility category validation
- Test material defect supplier requirement
- Test defect type options retrieval
- Test responsibility category options retrieval

### Integration Tests
- Test create defect API with valid data
- Test create defect API with invalid data (missing supplier for material defect)
- Test get defect list with filters
- Test permission control (supplier user data isolation)
- Test update and delete operations

### API Tests
- Test all endpoints with different user types
- Test query parameter validation
- Test pagination
- Test error responses

## Security Considerations

### Permission Control
- Internal users: Full CRUD access
- Supplier users: Read-only access to their own material defects
- All endpoints require authentication

### Data Validation
- Pydantic models enforce data types and constraints
- Responsibility category must be one of predefined values
- Material defect requires supplier_id and material_code
- Defect quantity must be positive

### SQL Injection Prevention
- SQLAlchemy ORM prevents SQL injection
- All queries use parameterized statements

## Performance Considerations

### Database Indexes
- Existing indexes on process_defects table:
  - defect_date (for date range queries)
  - work_order (for work order lookup)
  - process_id, line_id (for process/line filtering)
  - responsibility_category (for category filtering)
  - supplier_id, material_code (for supplier/material filtering)

### Query Optimization
- Use pagination to limit result set size
- Filter at database level before loading into memory
- Lazy loading of related entities (User, Supplier)

## Next Steps

### Task 11.4: 实现制程质量问题发单管理
- 创建 POST /api/v1/process-issues 接口
- 实现从不良品清单发起问题单
- 实现问题指派和闭环流程

### Task 11.5: 实现过程质量管理前端
- 创建不良品录入表单
- 创建不良品数据清单页面
- 集成失效类型和责任类别下拉选择
- 实现筛选和分页

## Verification Checklist

- [x] ProcessDefectCreate schema created with validation
- [x] ProcessDefectUpdate schema created
- [x] ProcessDefectResponse schema created
- [x] ProcessDefectListQuery schema created
- [x] DefectTypeOption and DefectTypeListResponse schemas created
- [x] ResponsibilityCategoryOption and ResponsibilityCategoryListResponse schemas created
- [x] ProcessDefectService created with all methods
- [x] Defect type options predefined (21 types)
- [x] Responsibility category options predefined (5 categories)
- [x] API routes created for all CRUD operations
- [x] API routes created for options endpoints
- [x] Router registered in API v1
- [x] Schemas exported in __init__.py
- [x] All files compile without syntax errors
- [x] Permission control implemented
- [x] Data validation implemented
- [x] Documentation completed

## Conclusion

Task 11.3 has been successfully implemented. The process defect data entry and classification system is now ready for use. The implementation includes:

1. Complete CRUD API for process defect records
2. Predefined defect type options (21 types across 5 categories)
3. Responsibility category options with metric linkage
4. Multi-dimensional filtering and pagination
5. Permission control for internal and supplier users
6. Automatic linkage to quality metrics (2.4.1)

The system is ready for frontend integration and can be extended with additional defect types as needed.
