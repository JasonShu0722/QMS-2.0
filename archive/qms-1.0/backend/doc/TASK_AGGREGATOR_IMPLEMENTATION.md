# Task Aggregator Implementation

## Overview

This document describes the implementation of Task 4.1: Task Aggregation Service for the QMS Foundation & Authentication Module.

## Implementation Summary

### 1. Core Service: `task_aggregator.py`

**Location**: `backend/app/services/task_aggregator.py`

**Key Components**:

- `TaskItem` class: Data model for individual task items
- `TaskAggregator` class: Main service for aggregating tasks from business tables

**Features**:
- Aggregates tasks from multiple business tables (SCAR, PPAP, Audit NC, Customer Complaints, etc.)
- Calculates task urgency based on remaining time:
  - 🔴 Overdue (red): remaining time < 0
  - 🟡 Urgent (yellow): remaining time ≤ 72 hours
  - 🟢 Normal (green): remaining time > 72 hours
- Calculates remaining processing time in hours
- Sorts tasks by urgency (most urgent first)
- Provides task statistics (total, overdue, urgent, normal)

**Business Table Configuration**:
```python
BUSINESS_TABLES = [
    {
        "table": "scar_reports",
        "handler_field": "current_handler_id",
        "task_type": "SCAR报告处理",
        "deadline_field": "deadline",
        "number_field": "report_number",
        "link_pattern": "/supplier/scar/{id}",
        "description_field": "problem_description",
        "enabled": False  # Phase 1: Not enabled yet
    },
    # ... more tables
]
```

**Note**: All business tables are currently disabled (`enabled: False`) as they will be created in later phases. The service is designed to be extensible and will automatically start aggregating tasks once the tables are created and enabled.

### 2. API Schemas: `task.py`

**Location**: `backend/app/schemas/task.py`

**Models**:
- `TaskItemResponse`: Response model for individual task items
- `TaskListResponse`: Response model for task list with total count
- `TaskStatisticsResponse`: Response model for task statistics

### 3. API Routes: `tasks.py`

**Location**: `backend/app/api/v1/tasks.py`

**Endpoints**:

#### GET `/api/v1/tasks/my-tasks`
- Returns all pending tasks for the current user
- Requires authentication (JWT token)
- Response includes task details, urgency, remaining time, and jump links

#### GET `/api/v1/tasks/statistics`
- Returns task statistics for the current user
- Requires authentication (JWT token)
- Response includes total, overdue, urgent, and normal task counts

### 4. Tests

**Unit Tests**: `backend/tests/test_task_aggregator.py`
- Tests for urgency calculation logic
- Tests for remaining time calculation
- Tests for TaskItem creation and serialization
- Tests for empty task lists (Phase 1 scenario)

**API Tests**: `backend/tests/test_tasks_api.py`
- Tests for unauthorized access
- Tests for authorized access with valid JWT token
- Tests for response schema validation

## Phase 1 Behavior

In Phase 1, since the business tables (SCAR, PPAP, etc.) have not been created yet:
- All API calls will return empty task lists
- Statistics will show all zeros
- The service is fully functional and ready to aggregate tasks once tables are enabled

## Integration Points

### Frontend Integration

The frontend can call these endpoints to display tasks in the personal center:

```typescript
// Get user tasks
const response = await axios.get('/api/v1/tasks/my-tasks', {
  headers: { Authorization: `Bearer ${token}` }
});

// Get task statistics
const stats = await axios.get('/api/v1/tasks/statistics', {
  headers: { Authorization: `Bearer ${token}` }
});
```

### Future Enhancements

When business tables are created in later phases:
1. Set `enabled: True` for the corresponding table configuration
2. Ensure the table has the required fields:
   - Handler field (e.g., `current_handler_id`)
   - Deadline field (e.g., `deadline`)
   - Number field (e.g., `report_number`)
   - Status field (to filter out closed tasks)
3. The service will automatically start aggregating tasks from that table

## API Documentation

The API endpoints are automatically documented in FastAPI's interactive docs:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Requirements Mapping

This implementation satisfies **Requirement 2.2.3** from the requirements document:

> **Requirement 2.2.3: 待办任务聚合**
> 
> WHEN 系统加载待办任务 THEN THE QMS_System SHALL 遍历所有业务表筛选当前处理人等于当前用户的记录
> 
> WHEN 系统展示待办任务 THEN THE QMS_System SHALL 显示任务类型、单据编号、紧急程度、剩余处理时间
> 
> WHEN 任务剩余时间小于 0 THEN THE QMS_System SHALL 标记为红色已超期状态
> 
> WHEN 任务剩余时间小于等于 72 小时 THEN THE QMS_System SHALL 标记为黄色即将超期状态
> 
> WHEN 任务剩余时间大于 72 小时 THEN THE QMS_System SHALL 标记为绿色正常状态
> 
> WHEN 用户点击待办任务 THEN THE QMS_System SHALL 直接跳转到对应单据详情页进行处理

## Conclusion

The task aggregation service has been successfully implemented with:
- ✅ Core service logic for aggregating tasks
- ✅ Urgency calculation (overdue/urgent/normal)
- ✅ Remaining time calculation
- ✅ RESTful API endpoints
- ✅ Pydantic schemas for data validation
- ✅ Unit tests and API tests
- ✅ Extensible design for future business tables

The service is ready for Phase 1 deployment and will seamlessly integrate with business tables as they are created in future phases.

