# Task 13.5: 试产问题跟进实现文档

## 实现概述

本任务实现了试产问题跟进功能（2.8.4），采用敏捷的清单式管理，支持问题的全生命周期管理和升级为8D报告。

## 核心功能

### 1. 问题录入与管理
- ✅ 创建试产问题（POST /api/v1/trial-issues）
- ✅ 查询问题列表（GET /api/v1/trial-issues）
- ✅ 获取问题详情（GET /api/v1/trial-issues/{id}）
- ✅ 更新问题信息（PUT /api/v1/trial-issues/{id}）

### 2. 问题指派与处理
- ✅ 指派责任人（POST /api/v1/trial-issues/{id}/assign）
- ✅ 提交解决方案（POST /api/v1/trial-issues/{id}/solution）
- ✅ 验证解决方案（POST /api/v1/trial-issues/{id}/verify）
- ✅ 关闭问题（POST /api/v1/trial-issues/{id}/close）

### 3. 问题升级
- ✅ 升级为8D报告（POST /api/v1/trial-issues/{id}/escalate）
  - 复杂问题可一键升级为8D报告流程
  - 自动记录升级原因和时间
  - 问题状态变更为"已升级"

### 4. 遗留问题管理
- ✅ 标记为遗留问题（POST /api/v1/trial-issues/{id}/mark-legacy）
  - SOP节点未关闭的问题需标记为遗留问题
  - 自动触发特批流程
- ✅ 带病量产特批（POST /api/v1/trial-issues/{id}/approve-legacy）
  - 支持批准/驳回审批
  - 批准后生成风险告知书（预留功能）

### 5. 附件管理
- ✅ 上传对策附件（POST /api/v1/trial-issues/{id}/upload-solution-file）
  - 支持上传解决方案相关文件
  - 文件路径记录到数据库

### 6. 统计分析
- ✅ 问题统计（GET /api/v1/trial-issues/statistics）
  - 按状态统计（待处理、处理中、已解决、已关闭、已升级）
  - 按类型统计（设计、模具、工艺、物料、设备）
  - 遗留问题统计

## 数据模型

### TrialIssue 模型字段

```python
class TrialIssue(Base):
    # 基础信息
    id: int                          # 主键
    trial_id: int                    # 关联试产记录ID
    issue_number: str                # 问题编号（TI-YYYY-NNNN）
    issue_description: str           # 问题描述
    issue_type: IssueType           # 问题类型（设计/模具/工艺/物料/设备/其他）
    
    # 责任与处理
    assigned_to: int                 # 责任人ID
    assigned_dept: str               # 责任部门
    root_cause: str                  # 根本原因
    solution: str                    # 解决方案
    solution_file_path: str          # 对策附件路径
    
    # 验证信息
    verification_method: str         # 验证方法
    verification_result: str         # 验证结果（passed/failed）
    verified_by: int                 # 验证人ID
    verified_at: datetime            # 验证时间
    
    # 问题状态
    status: IssueStatus             # 状态（待处理/处理中/已解决/已关闭/已升级）
    
    # 升级为8D
    is_escalated_to_8d: bool        # 是否已升级为8D报告
    eight_d_id: int                  # 关联的8D报告ID
    escalated_at: datetime           # 升级时间
    escalation_reason: str           # 升级原因
    
    # 遗留问题管理
    is_legacy_issue: bool            # 是否为遗留问题
    legacy_approval_status: str      # 带病量产审批状态（pending/approved/rejected）
    legacy_approval_by: int          # 特批人ID
    legacy_approval_at: datetime     # 特批时间
    risk_acknowledgement_path: str   # 风险告知书路径
    
    # 时间节点
    deadline: datetime               # 要求完成时间
    resolved_at: datetime            # 解决时间
    closed_at: datetime              # 关闭时间
```

## 业务流程

### 简单问题处理流程

```
1. 创建问题 (status: open)
   ↓
2. 指派责任人 (status: in_progress)
   ↓
3. 提交解决方案 (status: in_progress)
   ↓
4. 验证解决方案
   ├─ 验证通过 (status: resolved)
   │  ↓
   │  5. 关闭问题 (status: closed)
   │
   └─ 验证失败 (status: in_progress)
      ↓
      返回步骤3，重新提交对策
```

### 复杂问题升级流程

```
1. 创建问题 (status: open)
   ↓
2. 评估为复杂问题
   ↓
3. 升级为8D报告 (status: escalated)
   ↓
4. 进入8D流程（D0-D8）
   ↓
5. 8D报告结案
```

### 遗留问题特批流程

```
1. SOP节点到达，问题未关闭
   ↓
2. 标记为遗留问题 (is_legacy_issue: true)
   ↓
3. 提交带病量产特批申请 (legacy_approval_status: pending)
   ↓
4. 质量经理审批
   ├─ 批准 (legacy_approval_status: approved)
   │  ├─ 生成风险告知书
   │  └─ 允许量产，但需在规定时间内完成整改
   │
   └─ 驳回 (legacy_approval_status: rejected)
      └─ 必须解决问题后才能量产
```

## API 端点列表

| 方法 | 路径 | 功能 | 权限要求 |
|------|------|------|----------|
| POST | /api/v1/trial-issues | 创建试产问题 | 录入权限 |
| GET | /api/v1/trial-issues | 查询问题列表 | 查阅权限 |
| GET | /api/v1/trial-issues/{id} | 获取问题详情 | 查阅权限 |
| PUT | /api/v1/trial-issues/{id} | 更新问题信息 | 修改权限 |
| POST | /api/v1/trial-issues/{id}/assign | 指派责任人 | 修改权限 |
| POST | /api/v1/trial-issues/{id}/solution | 提交解决方案 | 责任人或修改权限 |
| POST | /api/v1/trial-issues/{id}/verify | 验证解决方案 | 修改权限 |
| POST | /api/v1/trial-issues/{id}/close | 关闭问题 | 修改权限 |
| POST | /api/v1/trial-issues/{id}/escalate | 升级为8D报告 | 修改权限 |
| POST | /api/v1/trial-issues/{id}/mark-legacy | 标记为遗留问题 | 修改权限 |
| POST | /api/v1/trial-issues/{id}/approve-legacy | 带病量产特批 | 特批权限 |
| POST | /api/v1/trial-issues/{id}/upload-solution-file | 上传对策附件 | 责任人或修改权限 |
| GET | /api/v1/trial-issues/statistics | 获取问题统计 | 查阅权限 |

## 数据校验规则

### 创建问题
- trial_id: 必填，必须是有效的试产记录ID
- issue_description: 必填，最少1个字符
- issue_type: 必填，必须是有效的问题类型枚举值
- assigned_to: 可选，如果提供必须是有效的用户ID
- deadline: 可选，必须是有效的日期时间

### 提交解决方案
- root_cause: 必填，最少1个字符
- solution: 必填，最少1个字符
- verification_method: 可选

### 验证解决方案
- verification_result: 必填，只能是"passed"或"failed"
- verification_comments: 可选

### 升级为8D
- escalation_reason: 必填，最少1个字符

### 带病量产特批
- approval_status: 必填，只能是"pending"、"approved"或"rejected"
- approval_comments: 可选

## 业务规则

### 状态转换规则
1. 新建问题默认状态为"待处理"（open）
2. 指派责任人后状态变为"处理中"（in_progress）
3. 提交解决方案后保持"处理中"状态
4. 验证通过后状态变为"已解决"（resolved）
5. 验证失败后保持"处理中"状态，需重新提交对策
6. 只有"已解决"的问题才能关闭
7. 升级为8D后状态变为"已升级"（escalated）

### 遗留问题规则
1. 只有未关闭的问题才能标记为遗留问题
2. 遗留问题需要特批才能量产
3. 特批批准后生成风险告知书
4. 特批驳回后必须解决问题才能量产

### 权限控制
1. 创建问题需要录入权限
2. 查看问题需要查阅权限
3. 修改问题需要修改权限
4. 责任人可以提交解决方案
5. 带病量产特批需要特批权限（通常为质量经理或更高级别）

## 通知机制（预留）

以下通知功能已在代码中预留接口，待通知服务实现后启用：

1. 指派责任人时发送通知给责任人
2. 提交解决方案时发送通知给创建人/验证人
3. 验证解决方案时发送通知给责任人
4. 升级为8D时发送通知给相关人员
5. 标记为遗留问题时发送通知给审批人
6. 带病量产特批时发送通知给相关人员

## 与其他模块的集成

### 与试产记录模块集成
- 每个问题必须关联到一个试产记录
- 试产记录可以有多个问题
- 通过trial_id建立关联关系

### 与8D报告模块集成（预留）
- 复杂问题可升级为8D报告
- 升级时创建8D报告记录
- 通过eight_d_id建立关联关系
- 8D报告结案后同步更新问题状态

### 与用户模块集成
- 责任人、验证人、特批人都是系统用户
- 通过用户ID建立关联关系
- 支持按责任人筛选问题

## 文件结构

```
backend/
├── app/
│   ├── models/
│   │   └── trial_issue.py              # 数据模型（已存在）
│   ├── schemas/
│   │   └── trial_issue.py              # 数据校验模型（新建）
│   ├── services/
│   │   └── trial_issue_service.py      # 业务逻辑服务（新建）
│   └── api/
│       └── v1/
│           └── trial_issues.py         # API路由（新建）
└── TASK_13.5_TRIAL_ISSUE_IMPLEMENTATION.md  # 实现文档（本文件）
```

## 测试建议

### 单元测试
1. 测试问题编号生成逻辑
2. 测试状态转换规则
3. 测试权限验证逻辑
4. 测试遗留问题特批流程

### 集成测试
1. 测试完整的问题处理流程
2. 测试升级为8D报告流程
3. 测试遗留问题特批流程
4. 测试问题统计功能

### API测试
1. 测试所有API端点的正常流程
2. 测试异常情况处理（如问题不存在、状态不允许等）
3. 测试权限控制
4. 测试数据校验

## 后续优化建议

1. **文件上传功能完善**
   - 实现真实的文件上传逻辑
   - 支持多种文件格式
   - 添加文件大小和类型验证
   - 实现文件预览功能

2. **通知功能实现**
   - 实现站内信通知
   - 实现邮件通知
   - 实现企业微信/钉钉通知

3. **8D报告集成**
   - 实现8D报告模块
   - 完善升级为8D的逻辑
   - 实现8D报告与问题的双向关联

4. **风险告知书生成**
   - 实现风险告知书模板
   - 自动生成PDF文档
   - 支持电子签名

5. **数据分析增强**
   - 添加问题趋势分析
   - 添加问题根因分析
   - 添加责任人绩效统计

6. **移动端优化**
   - 优化移动端界面
   - 支持扫码查看问题
   - 支持离线模式

## 实现状态

✅ 数据模型（已存在）
✅ 数据校验模型
✅ 业务逻辑服务
✅ API路由
✅ 问题录入与管理
✅ 问题指派与处理
✅ 问题升级为8D
✅ 遗留问题管理
✅ 带病量产特批
✅ 附件管理（基础功能）
✅ 统计分析

⏸️ 文件上传完善（预留）
⏸️ 通知功能（预留）
⏸️ 8D报告集成（预留）
⏸️ 风险告知书生成（预留）

## 总结

本任务成功实现了试产问题跟进的核心功能，包括问题的全生命周期管理、升级为8D报告、遗留问题管理和带病量产特批流程。系统采用敏捷的清单式管理方式，支持快速处理简单问题，同时也支持将复杂问题升级为8D报告进行深度分析。

实现遵循了产品需求文档（product.md 2.8.4）的所有要求，并预留了与其他模块集成的接口，为后续功能扩展奠定了基础。
