# Customer Quality Models Implementation

## 概述

本文档记录客户质量管理模块（2.7）的数据模型实现，包含客诉管理、8D闭环、索赔管理和经验教训沉淀。

## 实现的模型

### 1. CustomerComplaint（客诉单模型）

**文件位置**: `backend/app/models/customer_complaint.py`

**核心字段**:
- `complaint_number`: 客诉单号（唯一）
- `complaint_type`: 客诉类型（0km/售后）
- `customer_code`: 客户代码
- `product_type`: 产品类型
- `defect_description`: 缺陷描述
- `severity_level`: 严重度等级（TBD待产品定义）
- `vin_code`: VIN码（售后客诉专用）
- `mileage`: 失效里程（售后客诉专用）
- `purchase_date`: 购车日期（售后客诉专用）
- `status`: 客诉状态
- `cqe_id`: 负责CQE的用户ID
- `responsible_dept`: 责任部门

**枚举类型**:
- `ComplaintType`: 0km, after_sales
- `ComplaintStatus`: pending, in_analysis, in_response, in_review, closed, rejected
- `SeverityLevel`: critical, major, minor, tbd（待产品定义）

**关系**:
- 一对一关联 `EightDCustomer`（8D报告）
- 一对多关联 `CustomerClaim`（客户索赔）
- 一对多关联 `SupplierClaim`（供应商索赔）

### 2. EightDCustomer（客诉8D报告模型）

**文件位置**: `backend/app/models/eight_d_customer.py`

**核心字段**:
- `complaint_id`: 关联的客诉单ID（唯一）
- `d0_d3_cqe`: D0-D3阶段数据（JSON格式，CQE负责）
  - d0_team: 团队成员
  - d1_problem: 问题描述（5W2H）
  - d2_containment: 围堵措施（在途品、库存品、客户端）
  - d3_root_cause_initial: 初步原因分析
- `d4_d7_responsible`: D4-D7阶段数据（JSON格式，责任板块负责）
  - d4_root_cause: 根本原因分析（5Why/鱼骨图/FTA）
  - d5_corrective_actions: 纠正措施
  - d6_verification: 验证有效性（必须上传验证报告）
  - d7_standardization: 标准化（文件修改记录）
- `d8_horizontal`: D8阶段数据（JSON格式）
  - horizontal_deployment: 水平展开
  - lesson_learned: 经验教训沉淀
- `status`: 8D报告状态
- `approval_level`: 审批级别（C级科室经理/A/B级部长联合）

**枚举类型**:
- `EightDStatus`: draft, d0_d3_completed, d4_d7_in_progress, d4_d7_completed, d8_in_progress, in_review, approved, rejected, closed
- `ApprovalLevel`: section_manager, department_head, none

**业务逻辑**:
- D0-D3由CQE完成（一次因解析）
- D4-D7由责任板块完成（根本原因、对策、验证）
- D8水平展开和经验教训沉淀
- 分级审批流程（C级/A/B级）

### 3. CustomerClaim（客户索赔模型）

**文件位置**: `backend/app/models/customer_claim.py`

**核心字段**:
- `complaint_id`: 关联的客诉单ID
- `claim_amount`: 索赔金额
- `claim_currency`: 币种（CNY/USD/EUR等）
- `claim_date`: 索赔日期
- `customer_name`: 客户名称
- `claim_description`: 索赔说明
- `claim_reference`: 客户索赔单号

**业务逻辑**:
- 记录客户因质量问题向公司提出的索赔
- 支持手动关联多个客诉单
- 用于质量成本统计

### 4. SupplierClaim（供应商索赔模型）

**文件位置**: `backend/app/models/supplier_claim.py`

**核心字段**:
- `complaint_id`: 关联的客诉单ID（可选）
- `supplier_id`: 供应商ID
- `claim_amount`: 索赔金额
- `claim_currency`: 币种
- `claim_date`: 索赔日期
- `material_code`: 涉及物料编码
- `defect_qty`: 不良数量
- `status`: 索赔状态
- `negotiation_notes`: 协商记录
- `final_amount`: 最终索赔金额（协商后）
- `payment_date`: 实际支付日期

**枚举类型**:
- `SupplierClaimStatus`: draft, submitted, under_negotiation, accepted, rejected, partially_accepted, paid, closed

**业务逻辑**:
- 支持从客诉单一键转嫁生成
- 记录协商过程和最终金额
- 关联供应商绩效评价（2.5.5扣分）

### 5. LessonLearned（经验教训模型）

**文件位置**: `backend/app/models/lesson_learned.py`

**核心字段**:
- `source_type`: 来源类型（客诉/供应商8D/制程问题/手工录入）
- `source_id`: 来源记录ID
- `lesson_title`: 经验教训标题
- `lesson_content`: 经验教训详细内容
- `root_cause`: 根本原因
- `preventive_action`: 预防措施
- `applicable_scenarios`: 适用场景标签
- `product_types`: 适用产品类型
- `process_types`: 适用工序类型
- `is_active`: 是否启用
- `approved_by`: 批准人ID

**枚举类型**:
- `SourceType`: customer_complaint, supplier_8d, process_issue, manual

**业务逻辑**:
- 从各模块8D报告中提取经验教训
- 支持手工新增/完善/删减
- 用于新品项目反向注入（2.8.1）
- 支持智能推送和历史查重

## 数据库迁移

**迁移文件**: `backend/alembic/versions/2026_02_14_1400-012_add_customer_quality_models.py`

**创建的表**:
1. `customer_complaints` - 客诉单表
2. `eight_d_customer` - 客诉8D报告表
3. `customer_claims` - 客户索赔表
4. `supplier_claims` - 供应商索赔表
5. `lesson_learned` - 经验教训表

**索引**:
- `customer_complaints`: complaint_number（唯一）, customer_code, id
- `eight_d_customer`: id, complaint_id（唯一）
- `customer_claims`: id, complaint_id
- `supplier_claims`: id, complaint_id, supplier_id
- `lesson_learned`: id

**外键关系**:
- `customer_complaints` -> `users` (cqe_id, created_by)
- `eight_d_customer` -> `customer_complaints` (complaint_id)
- `eight_d_customer` -> `users` (reviewed_by)
- `customer_claims` -> `customer_complaints` (complaint_id)
- `customer_claims` -> `users` (created_by)
- `supplier_claims` -> `customer_complaints` (complaint_id)
- `supplier_claims` -> `suppliers` (supplier_id)
- `supplier_claims` -> `users` (created_by)
- `lesson_learned` -> `users` (approved_by, created_by)

## 兼容性设计

遵循双轨发布架构的非破坏性原则：

1. **所有新增字段均为nullable或带默认值**
   - 确保正式环境旧代码不会因缺少字段而报错

2. **使用server_default**
   - `severity_level`: 默认'tbd'
   - `status`字段: 默认初始状态
   - `claim_currency`: 默认'CNY'
   - `is_active`: 默认true
   - 时间戳字段: 默认CURRENT_TIMESTAMP

3. **JSON字段设计**
   - 8D报告各阶段数据使用JSON存储
   - 灵活支持未来扩展
   - 避免频繁修改表结构

## 业务流程支持

### 客诉录入与分级受理（2.7.2）
- `CustomerComplaint`模型支持0KM和售后客诉分类
- 严重度等级界定（TBD待产品定义）
- CQE一次因解析（D0-D3）
- 自动追溯功能（预留接口）

### 8D闭环与时效管理（2.7.3）
- `EightDCustomer`模型支持完整8D流程
- SLA动态时效监控（7天提交、10天归档）
- 分级审批流程
- 归档检查表核对

### 索赔管理（2.7.4）
- `CustomerClaim`记录客户索赔
- `SupplierClaim`支持一键转嫁
- 索赔金额统计和报表

### 经验教训沉淀
- `LessonLearned`支持多来源汇总
- 智能推送到新品项目
- 历史问题查重

## 下一步工作

1. **创建Pydantic Schemas**（任务12.2-12.7）
   - 客诉录入/查询Schema
   - 8D报告各阶段Schema
   - 索赔管理Schema

2. **实现Service层**
   - 客诉服务（录入、分级、追溯）
   - 8D服务（流程控制、时效监控）
   - 索赔服务（转嫁、统计）
   - 经验教训服务（提取、推送）

3. **实现API接口**
   - 客诉CRUD接口
   - 8D流程接口
   - 索赔管理接口
   - 经验教训接口

4. **前端组件开发**
   - 客诉列表和表单
   - 8D报告填写页面
   - 索赔管理页面

## 参考需求

- Requirements 2.7.2: 客诉录入与分级受理
- Requirements 2.7.3: 8D闭环与时效管理
- Requirements 2.7.4: 索赔管理
- Product.md 2.7: 客户质量管理完整需求
