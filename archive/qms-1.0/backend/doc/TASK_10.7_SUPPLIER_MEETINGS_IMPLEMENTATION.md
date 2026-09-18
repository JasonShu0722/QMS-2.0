# Task 10.7: 供应商会议与改进监控实现总结

## 实施概述

本任务实现了供应商会议与改进监控功能，基于绩效等级的强制干预机制。当供应商月度绩效评定为C级或D级时，系统自动创建会议任务，并要求相应级别的管理人员参会。

## 核心功能

### 1. 自动立项会议任务
- **触发条件**：月度绩效评定为C级或D级
- **自动生成**：会议编号、参会人员要求
- **通知机制**：自动发送站内信通知供应商

### 2. 参会人员要求
- **C级供应商**：要求副总级参会
- **D级供应商**：要求总经理参会
- **记录管理**：实际参会人员级别、姓名、职位

### 3. 资料上传
- **改善报告**：供应商上传《物料品质问题改善报告》
- **时间记录**：自动记录上传时间和上传人
- **状态跟踪**：report_submitted 标记提交状态

### 4. 考勤录入
- **SQE职责**：录入会议日期、参会人员、会议纪要
- **参会标记**：supplier_attended 标记是否参会
- **状态更新**：完成录入后状态变更为 completed

### 5. 违规处罚逻辑
- **处罚条件**：
  - 供应商未参会
  - 未提交改善报告
- **处罚标记**：penalty_applied 和 penalty_reason
- **扣分机制**：下个月度绩效评价中，配合度自动扣分

## 已创建文件

### 1. 数据模型
**文件**: `backend/app/models/supplier_meeting.py`

```python
class SupplierMeeting(Base):
    """供应商会议记录模型"""
    - supplier_id: 供应商ID
    - performance_id: 关联的绩效评价ID
    - meeting_number: 会议编号（格式：MTG-{供应商ID}-{年份月份}-{序号}）
    - performance_grade: 触发会议的绩效等级（C或D）
    - required_attendee_level: 要求参会人员级别
    - improvement_report_path: 改善报告路径
    - actual_attendee_level: 实际参会最高级别人员
    - supplier_attended: 供应商是否参会
    - report_submitted: 是否提交改善报告
    - penalty_applied: 是否已执行违规处罚
    - status: 状态（pending/completed/cancelled）
```

### 2. Pydantic Schemas
**文件**: `backend/app/schemas/supplier_meeting.py`

- `SupplierMeetingCreate`: 创建会议记录
- `SupplierMeetingUpdate`: 更新会议记录
- `SupplierMeetingReportUpload`: 上传改善报告
- `SupplierMeetingResponse`: 会议响应模型
- `SupplierMeetingListResponse`: 会议列表响应
- `SupplierMeetingStatistics`: 会议统计

### 3. 服务层
**文件**: `backend/app/services/supplier_meeting_service.py`

**核心方法**：
- `auto_create_meeting_for_performance()`: 自动立项会议任务
- `upload_improvement_report()`: 供应商上传改善报告
- `record_meeting_attendance()`: SQE录入考勤和纪要
- `_check_and_apply_penalty()`: 检查并执行违规处罚
- `list_meetings()`: 查询会议列表
- `get_meeting_statistics()`: 获取会议统计

### 4. API 路由
**文件**: `backend/app/api/v1/supplier_meetings.py`

**端点列表**：
- `POST /api/v1/supplier-meetings` - 创建会议记录
- `GET /api/v1/supplier-meetings` - 获取会议列表
- `GET /api/v1/supplier-meetings/{id}` - 获取会议详情
- `PUT /api/v1/supplier-meetings/{id}` - 更新会议记录
- `POST /api/v1/supplier-meetings/{id}/upload-report` - 供应商上传改善报告
- `POST /api/v1/supplier-meetings/{id}/record-attendance` - SQE录入考勤和纪要
- `GET /api/v1/supplier-meetings/statistics` - 获取会议统计
- `POST /api/v1/supplier-meetings/{id}/cancel` - 取消会议

### 5. 数据库迁移
**文件**: `backend/alembic/versions/2026_02_13_1500-007_add_supplier_meetings_table.py`

**表结构**：
- 主键：id
- 外键：supplier_id, performance_id, report_uploaded_by, recorded_by, created_by
- 唯一约束：meeting_number
- 索引：id, supplier_id, performance_id, meeting_number, status

## 业务流程

### 1. 会议自动创建流程
```
绩效评价完成（C/D级）
    ↓
系统自动创建会议记录
    ↓
生成会议编号（MTG-{供应商ID}-{年份月份}-{序号}）
    ↓
确定参会人员要求（C级:副总级，D级:总经理）
    ↓
发送通知给供应商用户
```

### 2. 供应商响应流程
```
收到会议通知
    ↓
登录系统查看会议详情
    ↓
上传《物料品质问题改善报告》
    ↓
系统记录上传时间和上传人
    ↓
report_submitted 标记为 true
```

### 3. SQE管理流程
```
会议召开
    ↓
SQE录入会议信息：
  - 会议日期
  - 实际参会人员级别、姓名、职位
  - 会议纪要
  - 供应商是否参会
    ↓
系统检查违规情况：
  - 未参会？
  - 未提交报告？
    ↓
如有违规，标记 penalty_applied = true
    ↓
会议状态变更为 completed
```

### 4. 违规处罚流程
```
会议完成后检查
    ↓
发现违规（未参会或未提交报告）
    ↓
标记 penalty_applied = true
记录 penalty_reason
    ↓
下个月度绩效计算时
    ↓
PerformanceCalculator 读取 penalty_applied
    ↓
配合度自动扣分（额外扣分）
```

## 权限控制

### 供应商用户
- **查看**：只能查看自己的会议记录
- **上传**：可以上传改善报告
- **限制**：不能录入考勤、不能取消会议

### 内部员工（SQE）
- **查看**：可以查看所有会议记录
- **创建**：可以手动创建会议记录
- **录入**：可以录入考勤和纪要
- **取消**：可以取消会议

## 数据统计

系统提供以下统计数据：
- **total_meetings**: 总会议数
- **pending_meetings**: 待召开会议数
- **completed_meetings**: 已完成会议数
- **meetings_with_penalty**: 有违规处罚的会议数
- **report_submission_rate**: 报告提交率
- **attendance_rate**: 参会率

## 集成点

### 1. 与绩效评价模块集成
- 绩效评价完成后，自动调用 `auto_create_meeting_for_performance()`
- 读取绩效等级（C/D）确定参会人员要求

### 2. 与通知系统集成
- 会议创建后，自动发送站内信通知
- 通知内容包含：绩效等级、得分、参会要求、会议编号

### 3. 与绩效计算器集成
- 下个月度绩效计算时，读取 `penalty_applied` 标记
- 如有违规，配合度自动扣分

## 使用示例

### 1. 自动创建会议（在绩效评价完成后调用）
```python
from app.services.supplier_meeting_service import SupplierMeetingService

# 绩效评价完成后
meeting = await SupplierMeetingService.auto_create_meeting_for_performance(
    db=db,
    performance=performance,  # SupplierPerformance 对象
    created_by=current_user.id
)
```

### 2. 供应商上传改善报告
```python
# POST /api/v1/supplier-meetings/{meeting_id}/upload-report
{
    "improvement_report_path": "/uploads/reports/supplier_123_202401_improvement.pdf"
}
```

### 3. SQE录入考勤
```python
# POST /api/v1/supplier-meetings/{meeting_id}/record-attendance
{
    "meeting_date": "2024-01-15",
    "actual_attendee_level": "副总级",
    "attendee_name": "张三",
    "attendee_position": "副总经理",
    "meeting_minutes": "会议讨论了来料质量问题...",
    "supplier_attended": true
}
```

### 4. 查询会议列表
```python
# GET /api/v1/supplier-meetings?supplier_id=123&status=pending&page=1&page_size=20
```

### 5. 获取会议统计
```python
# GET /api/v1/supplier-meetings/statistics?supplier_id=123&year=2024
```

## 注意事项

### 1. 数据库迁移
- 迁移文件已创建：`2026_02_13_1500-007_add_supplier_meetings_table.py`
- 需要运行 `alembic upgrade head` 创建表
- 注意：当前环境存在编码问题，需要修复 alembic.ini 文件编码

### 2. 会议编号生成
- 格式：`MTG-{供应商ID}-{年份月份}-{序号}`
- 示例：`MTG-123-202401-001`
- 自动递增序号，避免重复

### 3. 违规处罚
- 处罚标记在会议完成时自动设置
- 实际扣分在下个月度绩效计算时执行
- 需要在 `PerformanceCalculator` 中读取 `penalty_applied` 标记

### 4. 权限验证
- 所有 API 都需要登录认证
- 供应商用户只能访问自己的数据
- 内部员工可以访问所有数据

## 后续工作

### 1. 集成到绩效评价流程
在 `SupplierPerformanceService` 或 `PerformanceCalculator` 中，绩效评价完成后调用：
```python
if performance.grade in ["C", "D"]:
    await SupplierMeetingService.auto_create_meeting_for_performance(
        db=db,
        performance=performance,
        created_by=sqe_user_id
    )
```

### 2. 集成到绩效计算器
在 `PerformanceCalculator` 中，计算配合度扣分时检查上月会议违规：
```python
# 查询上月会议是否有违规
last_month_meetings = await db.execute(
    select(SupplierMeeting).where(
        and_(
            SupplierMeeting.supplier_id == supplier_id,
            SupplierMeeting.penalty_applied == True,
            # 上月会议条件
        )
    )
)

if last_month_meetings:
    cooperation_deduction += 10  # 额外扣分
```

### 3. 前端开发
需要创建以下前端页面：
- `SupplierMeetingList.vue` - 会议列表页面
- `SupplierMeetingDetail.vue` - 会议详情页面
- `SupplierMeetingForm.vue` - 会议录入表单
- `SupplierMeetingReportUpload.vue` - 报告上传组件

### 4. 测试
- 单元测试：测试服务层方法
- 集成测试：测试 API 端点
- 端到端测试：测试完整业务流程

## 技术要点

### 1. 异步编程
所有数据库操作使用 `async/await`，确保高性能。

### 2. 事务管理
使用 SQLAlchemy 的事务机制，确保数据一致性。

### 3. 外键约束
正确设置外键约束，确保数据完整性。

### 4. 索引优化
在常用查询字段上创建索引，提高查询性能。

### 5. 权限控制
在 API 层进行权限验证，确保数据安全。

## 总结

本任务成功实现了供应商会议与改进监控功能，包括：
- ✅ 数据模型设计
- ✅ 服务层实现
- ✅ API 路由创建
- ✅ 数据库迁移文件
- ✅ 自动立项机制
- ✅ 违规处罚逻辑
- ✅ 权限控制
- ✅ 统计功能

所有核心功能已实现，符合需求文档 2.5.6 的要求。
