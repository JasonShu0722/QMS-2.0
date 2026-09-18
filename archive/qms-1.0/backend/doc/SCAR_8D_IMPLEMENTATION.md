# SCAR 与 8D 闭环管理实现文档

## 概述

本文档描述 SCAR（Supplier Corrective Action Request，供应商纠正措施请求）和 8D 报告闭环管理功能的实现细节。

## 功能特性

### 1. SCAR 管理

#### 1.1 创建 SCAR 单
- **接口**: `POST /api/v1/scar`
- **权限**: 内部用户（IQC/SQE）
- **功能**:
  - 自动生成 SCAR 编号（格式：SCAR-YYYYMMDD-XXXX）
  - 关联供应商和物料信息
  - 设置严重度和截止日期
  - 自动通知供应商联系人

#### 1.2 查询 SCAR 列表
- **接口**: `GET /api/v1/scar`
- **权限**: 
  - 内部用户：查看所有 SCAR
  - 供应商用户：仅查看自己的 SCAR
- **功能**:
  - 支持按供应商、物料编码、状态、严重度筛选
  - 分页查询
  - 显示是否已提交 8D 报告

#### 1.3 查询 SCAR 详情
- **接口**: `GET /api/v1/scar/{scar_id}`
- **权限**: 数据归属权限控制
- **功能**:
  - 显示完整的 SCAR 信息
  - 包含供应商名称、当前处理人等关联数据

### 2. 8D 报告管理

#### 2.1 提交 8D 报告
- **接口**: `POST /api/v1/scar/{scar_id}/8d`
- **权限**: 供应商用户
- **功能**:
  - 提交 D0-D3、D4-D7、D8 阶段数据
  - 自动更新 SCAR 状态为"审核中"
  - 通知 SQE 审核
  - 支持更新已有报告

#### 2.2 查询 8D 报告
- **接口**: `GET /api/v1/scar/{scar_id}/8d`
- **权限**: 数据归属权限控制
- **功能**:
  - 显示完整的 8D 报告内容
  - 包含提交人、审核人、审核意见等信息

#### 2.3 审核 8D 报告
- **接口**: `POST /api/v1/scar/{scar_id}/8d/review`
- **权限**: 内部用户（SQE）
- **功能**:
  - 批准或驳回 8D 报告
  - 填写审核意见
  - 自动更新 SCAR 状态
  - 通知供应商审核结果

#### 2.4 驳回 8D 报告（便捷接口）
- **接口**: `POST /api/v1/scar/{scar_id}/8d/reject`
- **权限**: 内部用户（SQE）
- **功能**: 等同于 review 接口但 approved=False

### 3. AI 预审功能

#### 3.1 AI 预审 8D 报告
- **接口**: `POST /api/v1/scar/8d/ai-prereview`
- **权限**: 所有用户
- **功能**:
  - **关键词检测**: 识别空洞词汇（如"加强培训"、"加强管理"）
  - **历史查重**: 检查根本原因是否与过去 3 个月的 8D 报告重复
  - 提供改进建议
  - 注意：这是辅助功能，不替代人工审核

## 数据模型

### SCAR 模型
```python
class SCAR:
    id: int                      # 主键
    scar_number: str             # SCAR 编号
    supplier_id: int             # 供应商ID
    material_code: str           # 物料编码
    defect_description: str      # 缺陷描述
    defect_qty: int              # 不良数量
    severity: str                # 严重度 (low/medium/high/critical)
    status: str                  # 状态 (open/supplier_responding/under_review/rejected/approved/closed)
    current_handler_id: int      # 当前处理人ID
    deadline: datetime           # 截止日期
    created_at: datetime         # 创建时间
    updated_at: datetime         # 更新时间
```

### 8D 报告模型
```python
class EightD:
    id: int                      # 主键
    scar_id: int                 # 关联的 SCAR ID
    d0_d3_data: dict             # D0-D3 阶段数据（JSON）
    d4_d7_data: dict             # D4-D7 阶段数据（JSON）
    d8_data: dict                # D8 阶段数据（JSON）
    status: str                  # 状态 (draft/submitted/under_review/rejected/approved/closed)
    submitted_by: int            # 提交人ID
    reviewed_by: int             # 审核人ID
    review_comments: str         # 审核意见
    submitted_at: datetime       # 提交时间
    reviewed_at: datetime        # 审核时间
```

## 业务流程

### SCAR 创建流程
1. IQC/SQE 发现供应商质量问题
2. 创建 SCAR 单，填写缺陷信息
3. 系统自动生成 SCAR 编号
4. 系统查找供应商联系人并设置为当前处理人
5. 发送站内信和邮件通知供应商

### 8D 提交流程
1. 供应商登录系统查看待处理 SCAR
2. 填写 8D 报告（D0-D3、D4-D7、D8）
3. 提交报告
4. 系统更新 SCAR 状态为"审核中"
5. 通知 SQE 审核

### 8D 审核流程
1. SQE 收到审核通知
2. 查看 8D 报告内容
3. 可选：使用 AI 预审功能辅助判断
4. 填写审核意见并选择批准/驳回
5. 系统更新状态并通知供应商
6. 如果驳回，供应商需重新提交

## 权限控制

### 数据访问权限
- **内部用户**: 可以查看所有 SCAR 和 8D 报告
- **供应商用户**: 只能查看关联到自己供应商的数据

### 操作权限
- **创建 SCAR**: 仅内部用户
- **提交 8D**: 仅供应商用户
- **审核 8D**: 仅内部用户

## 通知机制

### 站内信通知
- SCAR 创建时通知供应商
- 8D 提交时通知 SQE
- 8D 审核完成时通知供应商

### 邮件通知（预留）
- 系统支持邮件通知功能
- 需要配置 SMTP 服务器参数
- 当前阶段邮件功能为可选项

## AI 预审规则

### 关键词检测
检测以下空洞词汇：
- "加强培训"
- "加强管理"
- "加强监督"
- "提高意识"

如果检测到这些词汇，系统会：
- 标记为不通过预审
- 提示供应商提供具体措施
- 建议上传相关证据

### 历史查重
- 查询该供应商过去 3 个月的已批准 8D 报告
- 比对根本原因是否重复
- 如果发现重复，提示供应商检查之前的纠正措施是否有效执行

## API 使用示例

### 创建 SCAR
```bash
curl -X POST http://localhost:8000/api/v1/scar \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "supplier_id": 1,
    "material_code": "MAT-001",
    "defect_description": "物料尺寸超差",
    "defect_qty": 100,
    "severity": "high",
    "deadline": "2024-02-20T00:00:00Z"
  }'
```

### 提交 8D 报告
```bash
curl -X POST http://localhost:8000/api/v1/scar/1/8d \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "d0_d3_data": {
      "problem_description": "物料尺寸超差",
      "containment_action": "隔离不良品"
    },
    "d4_d7_data": {
      "root_cause": "模具磨损导致尺寸偏移",
      "corrective_action": "更换模具并重新校准",
      "preventive_action": "建立模具定期保养计划",
      "verification": "已验证100件产品，尺寸合格"
    },
    "d8_data": {
      "horizontal_deployment": "已推广到所有类似产品",
      "lessons_learned": "加强模具管理"
    }
  }'
```

### 审核 8D 报告
```bash
curl -X POST http://localhost:8000/api/v1/scar/1/8d/review \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "review_comments": "根本原因分析充分，纠正措施有效",
    "approved": true
  }'
```

### AI 预审
```bash
curl -X POST http://localhost:8000/api/v1/scar/8d/ai-prereview \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "supplier_id": 1,
    "eight_d_data": {
      "d4_d7_data": {
        "root_cause": "员工操作不当",
        "corrective_action": "更新作业指导书并培训",
        "preventive_action": "建立技能矩阵和定期考核机制"
      }
    }
  }'
```

## 注意事项

1. **SCAR 编号唯一性**: 系统自动生成，确保每天的序号连续
2. **权限验证**: 所有接口都需要进行权限验证
3. **数据归属**: 供应商用户只能访问自己的数据
4. **状态流转**: SCAR 和 8D 的状态变更需要遵循业务规则
5. **通知及时性**: 关键操作需要及时通知相关人员
6. **AI 预审限制**: AI 预审仅作为辅助工具，不能替代人工审核

## 后续扩展

1. **邮件模板**: 完善邮件通知模板
2. **附件管理**: 支持上传改善前后对比图
3. **工作流引擎**: 实现更复杂的审批流程
4. **统计报表**: 生成 SCAR 统计分析报表
5. **移动端优化**: 优化移动端 8D 填写体验
6. **AI 增强**: 使用更先进的 NLP 技术进行预审

## 相关文档

- [Requirements Document](../../.kiro/specs/qms-foundation-and-auth/requirements.md) - 需求文档 2.5.2
- [Design Document](../../.kiro/specs/qms-foundation-and-auth/design.md) - 设计文档
- [Product Specification](../../.kiro/steering/product.md) - 产品规格 2.5.2
