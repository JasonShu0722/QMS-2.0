# Task 10.10: 关键件防错与追溯扫描实现文档

## 实施概述

本任务实现了关键件防错与追溯扫描功能（Requirements 2.5.9），为未纳入 MES 管控的关键件提供轻量级防错工具，在 IQC 或投产前扫码验证，防止错料混入。

## 核心功能

### 1. 校验规则配置
- **正则匹配**：支持 SQE 为特定料号配置正则表达式（如 `^A\d{4}[XYZ]$`）
- **特征校验**：支持配置固定前缀、后缀、长度限制（Min/Max Length）
- **防重逻辑**：开启"唯一性校验"后，系统自动比对历史记录，拦截重复扫描的序列号 (SN)

### 2. 扫码验证
- **即时反馈**：扫描 OK 显示绿色 "PASS" 字样；扫描 NG 显示红色报警并提示错误原因
- **计数管理**：设定"目标数量"，实时显示当前已扫数量/剩余数量，满额自动停止
- **多维度校验**：
  - 正则表达式格式校验
  - 前缀/后缀匹配
  - 长度范围验证
  - 唯一性防重检查

### 3. 批次提交归档
- 供应商完成发货批次扫码录入后可进行提交归档
- 提交时填写物料号及批次
- 归档后推送对应的 SQE 及 IQC，以用于 IQC 检验校核

### 4. 数据追溯与导出
- 系统自动记录：物料号、供应商代码、条码内容、判定结果、扫描时间、操作员、设备IP
- 支持多条件查询：物料编码、供应商、批次号、归档状态、通过状态
- 一键导出 Excel 文档（预留接口）

## 技术实现

### 数据模型

#### BarcodeValidation（条码校验规则表）
```python
- id: 主键
- material_code: 物料编码（索引）
- validation_rules: 校验规则（JSON格式）
  - prefix: 固定前缀
  - suffix: 固定后缀
  - min_length: 最小长度
  - max_length: 最大长度
- regex_pattern: 正则表达式
- is_unique_check: 是否启用唯一性校验
- created_by: 创建人ID（SQE）
- updated_by: 更新人ID
- created_at: 创建时间
- updated_at: 更新时间
```

#### BarcodeScanRecord（条码扫描记录表）
```python
- id: 主键
- material_code: 物料编码（索引）
- supplier_id: 供应商ID（外键，索引）
- batch_number: 批次号（索引）
- barcode_content: 条码内容（索引）
- is_pass: 是否通过（索引）
- error_reason: 错误原因（NG时记录）
- scanned_by: 扫描人ID（外键）
- scanned_at: 扫描时间（索引）
- device_ip: 设备IP
- is_archived: 是否已归档（索引）
- archived_at: 归档时间
```

### API 端点

#### 校验规则管理
- `POST /api/v1/barcode-validation/rules` - 创建校验规则
- `PUT /api/v1/barcode-validation/rules/{material_code}` - 更新校验规则
- `GET /api/v1/barcode-validation/rules/{material_code}` - 获取校验规则
- `GET /api/v1/barcode-validation/rules` - 获取规则列表

#### 扫码验证
- `POST /api/v1/barcode-validation/scan` - 扫码验证（核心接口）
  - 请求参数：
    - material_code: 物料编码
    - barcode_content: 条码内容
    - supplier_id: 供应商ID
    - batch_number: 批次号（可选）
    - device_ip: 设备IP（可选）
  - 响应：
    - is_pass: 是否通过（true=PASS, false=NG）
    - message: 验证消息
    - error_reason: 错误原因（NG时）
    - record_id: 扫描记录ID
    - scanned_at: 扫描时间

#### 批次管理
- `POST /api/v1/barcode-validation/submit` - 批次提交归档
  - 请求参数：
    - material_code: 物料编码
    - batch_number: 批次号
    - supplier_id: 供应商ID
  - 响应：
    - success: 是否成功
    - message: 提交消息
    - archived_count: 归档记录数
    - batch_number: 批次号
    - archived_at: 归档时间

#### 数据查询
- `GET /api/v1/barcode-validation/records` - 查询扫描记录
  - 支持筛选：material_code, supplier_id, batch_number, is_archived, is_pass
  - 支持分页：skip, limit
- `GET /api/v1/barcode-validation/statistics` - 获取扫码统计
  - 返回：total_scanned, pass_count, fail_count, pass_rate, remaining_quantity
- `GET /api/v1/barcode-validation/export` - 导出扫描记录（预留）

### 核心服务逻辑

#### BarcodeValidationService

**validate_barcode() - 条码验证核心逻辑**
```python
1. 正则表达式校验
   - 使用 re.match() 验证条码格式
   - 不匹配返回：False, "条码格式不符合正则表达式"

2. 特征校验
   - 前缀校验：startswith()
   - 后缀校验：endswith()
   - 最小长度：len(barcode) >= min_length
   - 最大长度：len(barcode) <= max_length

3. 唯一性校验（防重）
   - 查询数据库中是否存在相同条码的通过记录
   - 存在返回：False, "条码重复，已于 {时间} 扫描"

4. 全部通过
   - 返回：True, None
```

**scan_barcode() - 扫码验证流程**
```python
1. 获取校验规则
   - 如果没有配置规则，默认通过

2. 执行校验
   - 调用 validate_barcode() 进行验证

3. 记录扫描结果
   - 创建 BarcodeScanRecord 记录
   - 记录判定结果、错误原因、扫描时间等

4. 返回响应
   - is_pass: 是否通过
   - message: "PASS" 或 "NG - {错误原因}"
   - record_id: 扫描记录ID
```

**submit_batch() - 批次提交归档**
```python
1. 查询未归档记录
   - 筛选条件：material_code, batch_number, supplier_id, is_archived=False

2. 批量更新为已归档
   - 设置 is_archived=True
   - 记录 archived_at 时间

3. 返回归档结果
   - archived_count: 归档记录数
   - archived_at: 归档时间
```

## 使用场景

### 场景 1：SQE 配置校验规则

```bash
# 创建校验规则
POST /api/v1/barcode-validation/rules
{
  "material_code": "A1234",
  "validation_rules": {
    "prefix": "A",
    "suffix": "XYZ",
    "min_length": 10,
    "max_length": 20
  },
  "regex_pattern": "^A\\d{4}[XYZ]$",
  "is_unique_check": true
}
```

### 场景 2：IQC 扫码验证

```bash
# 扫码验证
POST /api/v1/barcode-validation/scan
{
  "material_code": "A1234",
  "barcode_content": "A1234567XYZ",
  "supplier_id": 1,
  "batch_number": "BATCH001",
  "device_ip": "192.168.1.100"
}

# 响应（通过）
{
  "is_pass": true,
  "message": "PASS",
  "error_reason": null,
  "record_id": 123,
  "scanned_at": "2026-02-13T10:30:00"
}

# 响应（失败）
{
  "is_pass": false,
  "message": "NG - 条码前缀不匹配，期望: A",
  "error_reason": "条码前缀不匹配，期望: A",
  "record_id": 124,
  "scanned_at": "2026-02-13T10:31:00"
}
```

### 场景 3：供应商批次提交

```bash
# 批次提交归档
POST /api/v1/barcode-validation/submit
{
  "material_code": "A1234",
  "batch_number": "BATCH001",
  "supplier_id": 1
}

# 响应
{
  "success": true,
  "message": "批次 BATCH001 归档成功",
  "archived_count": 50,
  "batch_number": "BATCH001",
  "archived_at": "2026-02-13T15:00:00"
}
```

### 场景 4：查询扫码统计

```bash
# 获取扫码统计
GET /api/v1/barcode-validation/statistics?material_code=A1234&batch_number=BATCH001&target_quantity=100

# 响应
{
  "material_code": "A1234",
  "batch_number": "BATCH001",
  "total_scanned": 52,
  "pass_count": 50,
  "fail_count": 2,
  "pass_rate": 96.15,
  "target_quantity": 100,
  "remaining_quantity": 50
}
```

## 移动端适配

### 扫码页面全屏模式
- 在 PDA 或手机浏览器打开"扫码防错"页面时
- 自动隐藏顶部导航和底部版权信息
- 全屏显示扫描框和红绿灯结果
- 防止误触

### 离线暂存模式（预留）
- 针对车间无信号场景
- 支持将扫码数据"暂存本地"
- 网络恢复后自动同步提交

## 安全与权限

### 权限控制
- 创建/更新校验规则：需要 SQE 权限
- 扫码验证：IQC、供应商、产线操作员
- 批次提交：供应商
- 查询记录：SQE、IQC、质量工程师
- 导出数据：需要导出权限

### 数据隔离
- 供应商用户仅能查看自己的扫描记录
- 内部用户可查看所有记录

## 后续优化方向

1. **Excel 导出功能**
   - 使用 openpyxl 或 xlsxwriter 生成 Excel 文件
   - 支持自定义导出字段和格式

2. **通知推送**
   - 批次归档后自动通知 SQE 和 IQC
   - 集成邮件和企业微信通知

3. **统计报表**
   - 供应商扫码质量排行榜
   - 物料扫码通过率趋势图
   - 异常条码分析报告

4. **移动端优化**
   - 开发专用扫码 APP
   - 支持离线模式和自动同步
   - 集成硬件扫码枪

5. **AI 辅助**
   - 条码格式智能识别
   - 异常条码模式分析
   - 自动生成校验规则建议

## 测试建议

### 单元测试
- 测试正则表达式校验逻辑
- 测试特征校验（前缀、后缀、长度）
- 测试唯一性防重逻辑
- 测试批次归档流程

### 集成测试
- 测试完整扫码流程
- 测试批次提交和查询
- 测试统计计算准确性

### 性能测试
- 测试高并发扫码场景
- 测试大批量数据查询性能
- 测试数据库索引效果

## 实施状态

✅ 数据模型已创建（BarcodeValidation, BarcodeScanRecord）
✅ 数据库迁移已完成
✅ Pydantic 模型已定义
✅ 服务层逻辑已实现
✅ API 端点已创建
✅ 路由已注册

## 相关文档

- Requirements: 2.5.9 关键件防错与追溯扫描
- Design: `.kiro/specs/qms-foundation-and-auth/design.md`
- Product: `.kiro/steering/product.md` 第 2.5.9 节
