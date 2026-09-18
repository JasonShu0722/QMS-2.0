# Task 10.8 - PPAP 管理实现文档

## 概述

本文档记录 PPAP（Production Part Approval Process - 生产件批准程序）管理功能的完整实现。

## 实现的功能

### 1. 核心功能

#### 1.1 创建 PPAP 提交任务
- **接口**: `POST /api/v1/ppap`
- **功能**: SQE 创建 PPAP 提交任务，指定供应商、物料和等级
- **权限**: 仅内部员工（SQE）可创建
- **特性**:
  - 支持 5 个 PPAP 等级（Level 1-5）
  - 根据等级自动生成文件清单
  - 支持自定义文件清单
  - 可设置提交截止日期

#### 1.2 18项标准文件清单配置
- **标准文件清单**:
  1. PSW (Part Submission Warrant) - 零件提交保证书
  2. Design Records - 设计记录
  3. Engineering Change Documents - 工程更改文件
  4. Customer Engineering Approval - 客户工程批准
  5. Design FMEA - 设计FMEA
  6. Process Flow Diagram - 过程流程图
  7. Process FMEA - 过程FMEA
  8. Control Plan - 控制计划
  9. Measurement System Analysis (MSA) - 测量系统分析
  10. Dimensional Results - 尺寸测量结果
  11. Material/Performance Test Results - 材料/性能测试结果
  12. Initial Process Studies - 初始过程研究
  13. Qualified Laboratory Documentation - 合格实验室文件
  14. Appearance Approval Report - 外观批准报告
  15. Sample Production Parts - 样品生产件
  16. Master Sample - 标准样品
  17. Checking Aids - 检查辅具
  18. Customer-Specific Requirements - 客户特殊要求

- **接口**: `GET /api/v1/ppap/document-checklist`
- **功能**: 获取18项标准文件清单配置

#### 1.3 供应商上传文件
- **接口**: `POST /api/v1/ppap/{id}/documents`
- **功能**: 供应商逐项上传 PPAP 文件
- **权限**: 仅对应的供应商可上传
- **特性**:
  - 支持单个文件上传
  - 自动记录上传时间和上传人
  - 所有必需文件上传后自动更新状态为"已提交"
  - 实时计算文件完成率

#### 1.4 SQE 审核（单项驳回/整体批准）
- **接口**: `POST /api/v1/ppap/{id}/review`
- **功能**: SQE 审核 PPAP 文件
- **权限**: 仅内部员工（SQE）可审核
- **审核模式**:
  - **单项审核**: 逐个文件审核，可单独驳回
  - **整体批准**: 批量审核后做出整体决策（approve/reject）
- **特性**:
  - 支持为每个文件添加审核意见
  - 整体批准后自动设置年度再鉴定日期（+1年）
  - 驳回后供应商可重新上传

#### 1.5 年度再鉴定自动提醒（Celery 定时任务）
- **定时任务**: `ppap.check_revalidation_reminders`
- **执行频率**: 每日凌晨 2:00
- **功能**:
  - 检查即将到期的 PPAP（提前30天提醒）
  - 自动标记已过期的 PPAP 为 expired 状态
  - 发送通知给 SQE 和供应商
  - 提醒节点：30天、7天、已过期

- **定时任务**: `ppap.check_submission_deadlines`
- **执行频率**: 每日凌晨 3:00
- **功能**:
  - 检查即将逾期的 PPAP 提交任务（提前7天提醒）
  - 检查已逾期的 PPAP 提交任务
  - 发送通知给供应商和 SQE

### 2. 辅助功能

#### 2.1 查询功能
- **列表查询**: `GET /api/v1/ppap`
  - 支持按供应商、物料编码、状态、等级筛选
  - 支持分页
  - 供应商用户仅见自己的数据
  
- **详情查询**: `GET /api/v1/ppap/{id}`
  - 获取完整的 PPAP 信息
  - 包含文件清单和审核状态

#### 2.2 统计功能
- **接口**: `GET /api/v1/ppap/statistics`
- **统计维度**:
  - 总提交数
  - 待提交数
  - 审核中数量
  - 已批准数量
  - 已驳回数量
  - 已过期数量（需再鉴定）
  - 逾期未提交数量
  - 平均文件完成率

#### 2.3 再鉴定提醒列表
- **接口**: `GET /api/v1/ppap/revalidation-reminders`
- **功能**: 获取需要年度再鉴定的 PPAP 列表
- **参数**: 提前提醒天数（默认30天）

## 数据模型

### PPAP 模型
```python
class PPAP(Base):
    id: int                          # 主键
    supplier_id: int                 # 供应商ID
    material_code: str               # 物料编码
    ppap_level: str                  # PPAP等级（level_1-5）
    submission_date: date            # 提交日期
    status: str                      # 状态（pending/submitted/under_review/rejected/approved/expired）
    documents: dict                  # 文件清单（JSON）
    reviewer_id: int                 # 审核人ID
    review_comments: str             # 审核意见
    approved_at: datetime            # 批准时间
    revalidation_due_date: date      # 再鉴定到期日期
    created_at: datetime             # 创建时间
    updated_at: datetime             # 更新时间
    created_by: int                  # 创建人ID
```

### 文件清单结构（documents 字段）
```json
{
  "psw": {
    "name": "Part Submission Warrant (PSW)",
    "name_cn": "零件提交保证书",
    "required": true,
    "uploaded": true,
    "file_path": "/uploads/ppap/123/psw.pdf",
    "uploaded_at": "2024-01-15T10:30:00",
    "uploaded_by": 456,
    "review_status": "approved",
    "review_comments": "符合要求",
    "reviewed_at": "2024-01-16T14:20:00",
    "reviewed_by": 789
  },
  "pfmea": {
    "name": "Process FMEA",
    "name_cn": "过程FMEA",
    "required": true,
    "uploaded": false,
    "file_path": null,
    "uploaded_at": null,
    "uploaded_by": null,
    "review_status": "pending",
    "review_comments": null,
    "reviewed_at": null,
    "reviewed_by": null
  }
}
```

## 状态流转

```
PENDING (待提交)
    ↓ [供应商上传所有必需文件]
SUBMITTED (已提交)
    ↓ [SQE 开始审核]
UNDER_REVIEW (审核中)
    ↓ [SQE 审核完成]
    ├─→ APPROVED (已批准) → [1年后] → EXPIRED (已过期)
    └─→ REJECTED (已驳回) → [供应商重新上传] → SUBMITTED
```

## API 端点列表

| 方法 | 端点 | 功能 | 权限 |
|------|------|------|------|
| POST | /api/v1/ppap | 创建 PPAP 提交任务 | 内部员工 |
| GET | /api/v1/ppap | 获取 PPAP 列表 | 所有用户 |
| GET | /api/v1/ppap/{id} | 获取 PPAP 详情 | 所有用户 |
| PUT | /api/v1/ppap/{id} | 更新 PPAP 基本信息 | 内部员工 |
| POST | /api/v1/ppap/{id}/documents | 供应商上传文件 | 供应商 |
| POST | /api/v1/ppap/{id}/review | SQE 审核 | 内部员工 |
| GET | /api/v1/ppap/revalidation-reminders | 获取再鉴定提醒列表 | 内部员工 |
| POST | /api/v1/ppap/{id}/mark-expired | 标记为已过期 | 内部员工 |
| GET | /api/v1/ppap/statistics | 获取统计数据 | 所有用户 |
| GET | /api/v1/ppap/document-checklist | 获取18项标准文件清单 | 所有用户 |

## 文件结构

```
backend/
├── app/
│   ├── api/
│   │   └── v1/
│   │       ├── __init__.py          # 已更新：注册 PPAP 路由
│   │       └── ppap.py              # 新增：PPAP API 路由
│   ├── models/
│   │   └── ppap.py                  # 已存在：PPAP 数据模型
│   ├── schemas/
│   │   └── ppap.py                  # 新增：PPAP Pydantic 模型
│   ├── services/
│   │   └── ppap_service.py          # 新增：PPAP 业务逻辑服务
│   └── tasks/
│       └── ppap_tasks.py            # 新增：PPAP 定时任务
└── TASK_10.8_PPAP_IMPLEMENTATION.md # 本文档
```

## 使用示例

### 1. 创建 PPAP 提交任务
```bash
curl -X POST "http://localhost:8000/api/v1/ppap" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "supplier_id": 123,
    "material_code": "MAT-001",
    "ppap_level": "level_3",
    "submission_deadline": "2024-02-28"
  }'
```

### 2. 供应商上传文件
```bash
curl -X POST "http://localhost:8000/api/v1/ppap/1/documents" \
  -H "Authorization: Bearer {supplier_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "document_key": "psw",
    "file_path": "/uploads/ppap/1/psw.pdf"
  }'
```

### 3. SQE 审核
```bash
curl -X POST "http://localhost:8000/api/v1/ppap/1/review" \
  -H "Authorization: Bearer {sqe_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "reviews": [
      {
        "document_key": "psw",
        "review_status": "approved",
        "review_comments": "符合要求"
      },
      {
        "document_key": "pfmea",
        "review_status": "approved",
        "review_comments": "FMEA 分析完整"
      }
    ],
    "overall_decision": "approve",
    "overall_comments": "所有文件符合要求，批准通过"
  }'
```

## 定时任务配置

在 `celery_config.py` 中添加以下配置：

```python
from celery.schedules import crontab

beat_schedule = {
    # PPAP 年度再鉴定提醒（每日凌晨 2:00 执行）
    'ppap-revalidation-reminders': {
        'task': 'ppap.check_revalidation_reminders',
        'schedule': crontab(hour=2, minute=0),
    },
    # PPAP 提交截止日期检查（每日凌晨 3:00 执行）
    'ppap-submission-deadlines': {
        'task': 'ppap.check_submission_deadlines',
        'schedule': crontab(hour=3, minute=0),
    },
}
```

## 业务规则

### 1. PPAP 等级与文件要求

| 等级 | 文件要求 | 说明 |
|------|---------|------|
| Level 1 | 仅 PSW | 最低要求 |
| Level 2 | PSW + 样品 | 增加样品提交 |
| Level 3 | PSW + 样品 + 部分支持文件 | 默认等级，包含9项核心文件 |
| Level 4 | PSW + 样品 + 全部支持文件 | 完整的18项文件 |
| Level 5 | PSW + 样品 + 全部支持文件 + 现场评审 | 最高要求 |

### 2. 权限控制

- **创建任务**: 仅内部员工（SQE）
- **上传文件**: 仅对应的供应商
- **审核**: 仅内部员工（SQE）
- **查看**: 供应商仅见自己的数据，内部员工可见所有数据

### 3. 状态限制

- **上传文件**: 仅在 PENDING 或 REJECTED 状态可上传
- **审核**: 仅在 SUBMITTED 或 UNDER_REVIEW 状态可审核
- **再鉴定**: APPROVED 状态满1年后自动标记为 EXPIRED

## 后续扩展

### 1. 通知集成
- 集成邮件通知服务
- 集成企业微信/钉钉通知
- 实现多级提醒机制

### 2. 文件管理
- 集成文件上传服务
- 实现文件版本管理
- 支持在线预览

### 3. 报表功能
- PPAP 完成率报表
- 供应商 PPAP 绩效报表
- 逾期分析报表

### 4. 工作流优化
- 支持多级审批
- 支持审批流程配置
- 支持审批意见模板

## 测试建议

### 1. 单元测试
- 测试 PPAP 创建逻辑
- 测试文件上传逻辑
- 测试审核逻辑
- 测试状态流转
- 测试完成率计算

### 2. 集成测试
- 测试完整的 PPAP 流程
- 测试权限控制
- 测试定时任务

### 3. 性能测试
- 测试大量 PPAP 记录的查询性能
- 测试文件清单的 JSON 操作性能

## 注意事项

1. **数据库兼容性**: documents 字段使用 JSON 类型，需要 PostgreSQL 9.4+
2. **文件存储**: 当前仅存储文件路径，需要配合文件上传服务使用
3. **定时任务**: 需要启动 Celery Beat 服务才能执行定时任务
4. **通知服务**: 当前通知功能为 TODO，需要后续集成

## 完成状态

✅ 所有子任务已完成：
- ✅ 实现 POST /api/v1/ppap 创建 PPAP 提交任务
- ✅ 实现 18 项文件检查表配置
- ✅ 实现 POST /api/v1/ppap/{id}/documents 供应商上传文件
- ✅ 实现 POST /api/v1/ppap/{id}/review SQE 审核（单项驳回/整体批准）
- ✅ 实现年度再鉴定自动提醒（Celery 定时任务）

## 参考资料

- AIAG PPAP 第4版标准
- Requirements: 2.5.7
- Design Document: `.kiro/specs/qms-foundation-and-auth/design.md`
- Product Requirements: `.kiro/steering/product.md` Section 2.5.7
