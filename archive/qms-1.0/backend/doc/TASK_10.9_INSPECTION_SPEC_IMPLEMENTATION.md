# Task 10.9: 物料检验规范管理实现文档

## 实施概述

本任务实现了物料检验规范管理模块（Inspection Specification Management），对应需求 2.5.8。该模块建立数字化检验标准库，并基于物料风险等级设定差异化的出货报告管控频率。

## 核心功能

### 1. 检验规范生命周期管理

#### 1.1 SQE 发起规范提交任务
- **接口**: `POST /api/v1/inspection-specs`
- **功能**: SQE 针对特定物料（或物料族）发起"规范提交"或"版本升级"任务
- **版本管理**: 系统自动生成版本号（V1.0, V1.1, V2.0...）
- **状态**: 创建后状态为 `DRAFT`

#### 1.2 供应商提交 SIP
- **接口**: `POST /api/v1/inspection-specs/{id}/submit`
- **功能**: 供应商在线填写关键检验项目（SIP Key Characteristics）并上传双方签字版 SIP 文件（PDF）
- **数据结构**: 
  ```json
  {
    "key_characteristics": [
      {
        "item": "外观",
        "spec": "无划伤",
        "method": "目视",
        "sample_size": 5,
        "acceptance_criteria": "AQL 1.0"
      }
    ],
    "sip_file_path": "/uploads/sip/supplier_123_material_ABC_v1.0.pdf"
  }
  ```
- **状态变更**: `DRAFT` → `PENDING_REVIEW`

#### 1.3 SQE 审批
- **接口**: `POST /api/v1/inspection-specs/{id}/approve`
- **批准逻辑**:
  - 状态变为 `APPROVED`
  - 旧版本自动归档（状态变为 `ARCHIVED`）
  - 记录生效日期
  - 自动同步通知至 IQC 供进料检验参照
- **驳回逻辑**:
  - 状态回退到 `DRAFT`
  - 必须填写审核意见
  - 供应商可重新提交

### 2. 报告频率策略配置

#### 2.1 频率类型
- **batch**: 按批次（每一笔发货单都需要对应一份报告）- 默认选项
- **weekly**: 每周提交一次
- **monthly**: 每月提交一次
- **quarterly**: 每季度提交一次

#### 2.2 更新接口
- **接口**: `PATCH /api/v1/inspection-specs/{id}/report-frequency`
- **权限**: 仅 SQE 可修改

### 3. 报告收集与互锁（预留功能）

#### 3.1 ASN 强关联（按批次）
- **接口**: `GET /api/v1/inspection-specs/asn-check/{material_code}/{supplier_id}`
- **逻辑**: 
  - 当供应商在门户创建发货单 (ASN) 时，系统自动检查该物料的策略
  - 若为"按批次"，供应商必须上传附件（COC/OQC报告）才能提交 ASN
  - 否则系统拦截发货
- **状态**: 待 ASN 发货数据流打通后启用

#### 3.2 定期任务推送（按时间）
- **Celery 任务**: `inspection_spec.generate_periodic_report_tasks`
- **执行频率**: 每日凌晨 01:00
- **逻辑**:
  1. 查询所有 APPROVED 状态且 report_frequency_type != 'batch' 的规范
  2. 根据频率（weekly/monthly/quarterly）计算下次提交日期
  3. 生成待办任务推送给供应商
- **逾期处理**: 若任务逾期未关闭，自动触发 2.5.6 绩效评价中的扣分逻辑
- **状态**: 待 ASN 发货数据流打通后启用

## 数据模型

### InspectionSpec 表结构

```python
class InspectionSpec(Base):
    __tablename__ = "inspection_specs"
    
    id: int                                    # 主键
    material_code: str                         # 物料编码
    supplier_id: int                           # 供应商ID
    version: str                               # 版本号（V1.0, V1.1...）
    sip_file_path: Optional[str]               # SIP 文件路径
    key_characteristics: Optional[dict]        # 关键检验项目（JSON）
    report_frequency_type: Optional[str]       # 报告频率类型
    status: str                                # 状态（draft/pending_review/approved/archived）
    reviewer_id: Optional[int]                 # 审核人ID（SQE）
    review_comments: Optional[str]             # 审核意见
    approved_at: Optional[datetime]            # 批准时间
    effective_date: Optional[datetime]         # 生效日期
    created_at: datetime                       # 创建时间
    updated_at: datetime                       # 更新时间
    created_by: Optional[int]                  # 创建人ID
    updated_by: Optional[int]                  # 更新人ID
```

### 状态流转

```
DRAFT (草稿)
  ↓ 供应商提交 SIP
PENDING_REVIEW (待审核)
  ↓ SQE 批准              ↓ SQE 驳回
APPROVED (已批准)        DRAFT (回退)
  ↓ 新版本批准
ARCHIVED (已归档)
```

## API 接口清单

| 方法 | 路径 | 功能 | 权限 |
|------|------|------|------|
| POST | `/api/v1/inspection-specs` | SQE 发起规范提交任务 | 内部员工 |
| POST | `/api/v1/inspection-specs/{id}/submit` | 供应商提交 SIP | 供应商 |
| POST | `/api/v1/inspection-specs/{id}/approve` | SQE 审批检验规范 | 内部员工 |
| GET | `/api/v1/inspection-specs` | 查询检验规范列表 | 全部用户 |
| GET | `/api/v1/inspection-specs/{id}` | 获取检验规范详情 | 全部用户 |
| PATCH | `/api/v1/inspection-specs/{id}/report-frequency` | 更新报告频率策略 | 内部员工 |
| GET | `/api/v1/inspection-specs/active/{material_code}/{supplier_id}` | 获取当前生效的检验规范 | 全部用户 |
| POST | `/api/v1/inspection-specs/report-tasks/generate` | 生成定期报告提交任务（预留） | 系统管理员 |
| GET | `/api/v1/inspection-specs/asn-check/{material_code}/{supplier_id}` | ASN 强关联检查（预留） | 全部用户 |

## 权限控制

### 供应商用户
- 仅能查看和操作自己的检验规范（通过 `supplier_id` 过滤）
- 可以提交 SIP
- 不能发起新规范或审批

### 内部员工（SQE）
- 可以查看所有检验规范
- 可以发起新规范提交任务
- 可以审批供应商提交的 SIP
- 可以修改报告频率策略

## 版本管理逻辑

### 版本号生成规则
- 初始版本: `V1.0`
- 小版本递增: `V1.0` → `V1.1` → `V1.2` → ...
- 大版本升级: 手动指定（如 `V2.0`）

### 版本归档机制
- 当新版本被批准时，系统自动将同一物料+供应商的其他 `APPROVED` 版本状态改为 `ARCHIVED`
- 归档版本仍可查询，但不再作为生效版本使用
- IQC 检验时，系统自动调用最新的 `APPROVED` 版本

## 集成点

### 与 IQC 模块集成
- **接口**: `GET /api/v1/inspection-specs/active/{material_code}/{supplier_id}`
- **用途**: IQC 检验时，系统自动调取该物料+供应商的生效检验规范
- **数据**: 返回关键检验项目、规格要求、检验方法、抽样方案等

### 与绩效评价模块集成（2.5.6）
- **触发条件**: 定期报告任务逾期未关闭
- **扣分逻辑**: 自动在"配合度"项扣分
- **状态**: 待实现

### 与 ASN 发货模块集成（预留）
- **触发条件**: 供应商创建发货单 (ASN)
- **互锁逻辑**: 若物料的 `report_frequency_type` 为 `batch`，必须上传报告才能提交 ASN
- **状态**: 待 ASN 发货数据流打通后启用

## Celery 定时任务

### 任务 1: 生成定期报告任务
- **任务名**: `inspection_spec.generate_periodic_report_tasks`
- **执行频率**: 每日凌晨 01:00
- **功能**: 根据报告频率自动生成待办任务推送给供应商
- **状态**: 预留功能

### 任务 2: 逾期报告提醒
- **任务名**: `inspection_spec.send_overdue_reminders`
- **执行频率**: 每日上午 09:00
- **功能**: 
  - 查询所有逾期未提交的报告任务
  - 发送催办通知给供应商
  - 超过 7 天未提交，升级通知给 SQE
- **状态**: 预留功能

## 文件结构

```
backend/
├── app/
│   ├── models/
│   │   └── inspection_spec.py          # 数据模型（已存在）
│   ├── schemas/
│   │   └── inspection_spec.py          # Pydantic 模型（新建）
│   ├── services/
│   │   └── inspection_spec_service.py  # 业务逻辑（新建）
│   ├── api/
│   │   └── v1/
│   │       ├── inspection_specs.py     # API 路由（新建）
│   │       └── __init__.py             # 注册路由（已更新）
│   └── tasks/
│       └── inspection_spec_tasks.py    # Celery 任务（新建）
```

## 测试建议

### 单元测试
1. 版本号生成逻辑测试
2. 版本归档逻辑测试
3. 权限控制测试（供应商仅见自己的数据）
4. 状态流转测试

### 集成测试
1. 完整的规范提交-审批流程测试
2. 多版本并存场景测试
3. 报告频率策略切换测试

### API 测试
```bash
# 1. SQE 发起规范提交任务
curl -X POST http://localhost:8000/api/v1/inspection-specs \
  -H "Authorization: Bearer {sqe_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "material_code": "MAT-001",
    "supplier_id": 1,
    "report_frequency_type": "batch"
  }'

# 2. 供应商提交 SIP
curl -X POST http://localhost:8000/api/v1/inspection-specs/1/submit \
  -H "Authorization: Bearer {supplier_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "key_characteristics": [
      {
        "item": "外观",
        "spec": "无划伤",
        "method": "目视",
        "sample_size": 5
      }
    ],
    "sip_file_path": "/uploads/sip/test.pdf"
  }'

# 3. SQE 审批
curl -X POST http://localhost:8000/api/v1/inspection-specs/1/approve \
  -H "Authorization: Bearer {sqe_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "approved": true,
    "review_comments": "符合要求",
    "effective_date": "2024-02-01T00:00:00Z"
  }'

# 4. 查询生效规范
curl -X GET http://localhost:8000/api/v1/inspection-specs/active/MAT-001/1 \
  -H "Authorization: Bearer {token}"
```

## 注意事项

1. **数据库兼容性**: 所有新增字段已设置为 `nullable=True`，符合双轨发布架构要求
2. **权限控制**: 供应商用户通过 `supplier_id` 过滤数据，确保数据隔离
3. **版本管理**: 批准新版本时自动归档旧版本，避免多个生效版本并存
4. **预留功能**: ASN 强关联和定期任务推送功能已实现接口，待后续启用
5. **文件上传**: SIP 文件路径需要配合文件上传服务使用，建议使用对象存储（如 MinIO）

## 后续扩展

1. **文件上传服务**: 实现 SIP 文件的上传和存储
2. **ASN 模块集成**: 打通发货数据流，启用 ASN 强关联功能
3. **待办任务模块**: 实现定期报告任务的创建和推送
4. **通知服务集成**: 实现逾期提醒和升级通知
5. **绩效评价联动**: 实现逾期扣分逻辑

## 实施状态

✅ 数据模型（已存在）
✅ Pydantic 模型
✅ 业务逻辑服务
✅ API 路由
✅ Celery 定时任务（预留）
✅ 路由注册

## 参考文档

- 需求文档: `.kiro/specs/qms-foundation-and-auth/requirements.md` - Requirement 2.5.8
- 产品文档: `.kiro/steering/product.md` - 2.5.8 物料检验规范及定期报告管理
- 设计文档: `.kiro/specs/qms-foundation-and-auth/design.md`

