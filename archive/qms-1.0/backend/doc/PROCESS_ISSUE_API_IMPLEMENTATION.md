# 制程质量问题发单管理 API 实现文档

## 概述

本文档描述制程质量问题发单管理模块的 API 实现，对应任务 11.4。

## 功能特性

### 1. 创建制程问题单
- **接口**: `POST /api/v1/process-issues`
- **功能**: 创建制程质量问题单
- **触发场景**:
  - 手动发起：PQE 从 2.4.3 报表或不良品清单发现异常，手动创建问题单
  - 自动触发：预留接口，未来可配置自动触发规则
- **业务逻辑**:
  1. 生成问题单编号（格式：PQI-YYYYMMDD-XXXX）
  2. 根据责任类别指派给对应的责任板块担当
  3. 可关联多个不良品记录ID
  4. 初始状态为 OPEN（已开立）

### 2. 查询问题单列表
- **接口**: `GET /api/v1/process-issues`
- **功能**: 查询制程问题单列表（支持多条件筛选和分页）
- **筛选条件**:
  - status: 问题单状态
  - responsibility_category: 责任类别
  - assigned_to: 当前处理人ID
  - created_by: 发起人ID
  - is_overdue: 是否逾期
  - start_date/end_date: 创建日期范围

### 3. 获取问题单详情
- **接口**: `GET /api/v1/process-issues/{issue_id}`
- **功能**: 根据ID获取制程问题单详情

### 4. 责任板块填写分析和对策
- **接口**: `POST /api/v1/process-issues/{issue_id}/response`
- **功能**: 责任板块填写根本原因分析和纠正措施
- **执行流程**:
  1. 责任板块担当填写：
     - 根本原因分析（必填，最少20字）
     - 围堵措施（必填，最少10字）
     - 纠正措施（必填，最少20字）
     - 验证期（必填，1-90天）
     - 改善证据附件（可选）
  2. 系统自动计算验证开始日期和结束日期
  3. 状态更新为 IN_VERIFICATION（验证中）
- **权限要求**:
  - 只有被指派的责任人才能填写
  - 只有 OPEN 或 IN_ANALYSIS 状态才能填写

### 5. PQE 验证对策有效性
- **接口**: `POST /api/v1/process-issues/{issue_id}/verify`
- **功能**: PQE 验证对策有效性
- **验证逻辑**:
  1. 检查是否在验证期内（必须等待验证期结束）
  2. 验证通过：问题单保持 IN_VERIFICATION 状态，等待关闭
  3. 验证不通过：退回到 IN_ANALYSIS 状态，需要重新填写对策
- **权限要求**:
  - 需要有 process_quality.issue.verify 权限
  - 只有 IN_VERIFICATION 状态才能验证

### 6. 关闭问题单
- **接口**: `POST /api/v1/process-issues/{issue_id}/close`
- **功能**: 关闭制程问题单
- **关闭条件**:
  1. 问题单状态必须为 IN_VERIFICATION（验证中）
  2. 必须已经过 PQE 验证（verified_by 不为空）
  3. 验证结果为通过
- **权限要求**:
  - 需要有 process_quality.issue.close 权限

### 7. 获取我的待处理问题单
- **接口**: `GET /api/v1/process-issues/my/pending`
- **功能**: 获取当前用户待处理的制程问题单
- **返回条件**:
  - assigned_to = 当前用户ID
  - status in [OPEN, IN_ANALYSIS, IN_VERIFICATION]
- **排序规则**:
  - 按验证结束日期升序排列（逾期的排在前面）

## 数据模型

### ProcessIssue（制程问题单）
```python
{
    "id": int,                              # 主键
    "issue_number": str,                    # 问题单编号（PQI-YYYYMMDD-XXXX）
    "issue_description": str,               # 问题描述
    "responsibility_category": str,         # 责任类别
    "assigned_to": int,                     # 当前处理人ID
    "root_cause": str,                      # 根本原因分析
    "containment_action": str,              # 围堵措施
    "corrective_action": str,               # 纠正措施
    "verification_period": int,             # 验证期（天数）
    "verification_start_date": date,        # 验证开始日期
    "verification_end_date": date,          # 验证结束日期
    "status": str,                          # 状态
    "related_defect_ids": str,              # 关联的不良品记录ID
    "evidence_files": str,                  # 改善证据附件路径（JSON格式）
    "created_by": int,                      # 发起人ID
    "verified_by": int,                     # 验证人ID
    "closed_by": int,                       # 关闭人ID
    "closed_at": datetime,                  # 关闭时间
    "created_at": datetime,                 # 创建时间
    "updated_at": datetime                  # 更新时间
}
```

### 状态枚举（ProcessIssueStatus）
- `OPEN`: 已开立
- `IN_ANALYSIS`: 分析中
- `IN_VERIFICATION`: 验证中
- `CLOSED`: 已关闭
- `CANCELLED`: 已取消

### 责任类别枚举（ResponsibilityCategory）
- `material_defect`: 物料不良
- `operation_defect`: 作业不良
- `equipment_defect`: 设备不良
- `process_defect`: 工艺不良
- `design_defect`: 设计不良

## 业务流程

### 完整闭环流程
```
1. PQE 创建问题单 (OPEN)
   ↓
2. 指派给责任板块担当
   ↓
3. 责任板块填写分析和对策 (IN_VERIFICATION)
   - 根本原因分析
   - 围堵措施
   - 纠正措施
   - 验证期设定
   ↓
4. 等待验证期结束
   ↓
5. PQE 验证对策有效性
   - 验证通过 → 继续
   - 验证不通过 → 退回到步骤3 (IN_ANALYSIS)
   ↓
6. PQE 关闭问题单 (CLOSED)
```

## API 使用示例

### 1. 创建问题单
```bash
POST /api/v1/process-issues
Content-Type: application/json
Authorization: Bearer <token>

{
  "issue_description": "产线A连续3天出现焊接不良，不良率超过2%，需要立即分析原因并制定对策",
  "responsibility_category": "equipment_defect",
  "assigned_to": 15,
  "related_defect_ids": [101, 102, 103]
}
```

### 2. 查询问题单列表
```bash
GET /api/v1/process-issues?status=open&page=1&page_size=20
Authorization: Bearer <token>
```

### 3. 填写分析和对策
```bash
POST /api/v1/process-issues/1/response
Content-Type: application/json
Authorization: Bearer <token>

{
  "root_cause": "焊接设备温度控制模块老化，导致温度波动超过±5℃，影响焊接质量",
  "containment_action": "1. 立即更换温度控制模块\n2. 加强首件检验\n3. 增加巡检频次至每小时一次",
  "corrective_action": "1. 建立设备温度监控系统，实时预警\n2. 制定设备预防性维护计划\n3. 更新作业指导书，增加温度确认步骤",
  "verification_period": 7,
  "evidence_files": [
    "/uploads/evidence/temp_control_replacement.jpg",
    "/uploads/evidence/updated_sop.pdf"
  ]
}
```

### 4. 验证对策有效性
```bash
POST /api/v1/process-issues/1/verify
Content-Type: application/json
Authorization: Bearer <token>

{
  "verification_result": true,
  "verification_comments": "验证期内（7天）未再发生焊接不良，温度监控系统运行正常，对策有效"
}
```

### 5. 关闭问题单
```bash
POST /api/v1/process-issues/1/close
Content-Type: application/json
Authorization: Bearer <token>

{
  "close_comments": "对策验证通过，问题已彻底解决，可以关闭"
}
```

## 文件结构

```
backend/
├── app/
│   ├── api/
│   │   └── v1/
│   │       └── process_issues.py          # API 路由
│   ├── models/
│   │   └── process_issue.py               # 数据模型（已存在）
│   ├── schemas/
│   │   └── process_issue.py               # Pydantic 模型
│   └── services/
│       └── process_issue_service.py       # 业务逻辑
└── PROCESS_ISSUE_API_IMPLEMENTATION.md    # 本文档
```

## 待实现功能（TODO）

1. **权限检查**：
   - 在各个接口中添加权限检查逻辑
   - 使用 `check_permission` 函数验证用户权限

2. **通知机制**：
   - 创建问题单时通知被指派人
   - 提交对策时通知PQE
   - 验证结果通知责任人
   - 关闭问题单时通知相关人员

3. **自动触发配置**：
   - 预留自动触发接口
   - 配置触发规则（如：不良率超过阈值自动创建问题单）

4. **文件上传**：
   - 实现改善证据附件的上传功能
   - 文件存储和访问控制

5. **数据统计**：
   - 问题单统计分析
   - 责任类别分布
   - 平均闭环时长

## 测试建议

1. **单元测试**：
   - 测试问题单编号生成逻辑
   - 测试状态流转逻辑
   - 测试权限验证逻辑

2. **集成测试**：
   - 测试完整的闭环流程
   - 测试异常场景（如：状态不匹配、权限不足）

3. **性能测试**：
   - 测试大量问题单的查询性能
   - 测试并发创建问题单

## 注意事项

1. **验证期逻辑**：
   - 必须等待验证期结束后才能进行验证
   - 验证期由责任板块在提交对策时设定（1-90天）

2. **状态流转**：
   - 严格按照状态机流转
   - 不允许跳过状态

3. **权限控制**：
   - 只有被指派的责任人才能填写对策
   - 只有PQE才能验证和关闭问题单

4. **数据完整性**：
   - 关联的不良品记录ID需要验证存在性
   - 被指派的用户ID需要验证存在性

## 参考文档

- 需求文档：`.kiro/specs/qms-foundation-and-auth/requirements.md` - Requirement 2.6.3
- 产品文档：`.kiro/steering/product.md` - 2.6.3 制程质量问题发单管理
- 任务文档：`.kiro/specs/qms-foundation-and-auth/tasks.md` - 任务 11.4
