# Task 15.2: 仪器量具管理 API 接口预留实现

## 实施日期
2026-02-18

## 任务概述
为 2.10 仪器与量具管理功能预留 API 接口，所有接口返回 501 Not Implemented。

## 实施内容

### 1. 创建的文件
- `backend/app/api/v1/instruments.py` - 仪器量具管理 API 路由文件

### 2. 修改的文件
- `backend/app/api/v1/__init__.py` - 注册 instruments 路由

### 3. 实现的 API 接口

#### 3.1 基础管理接口
- **GET /api/v1/instruments** - 获取仪器量具列表
  - 支持按类型、状态筛选
  - 支持分页查询
  - Requirements: 2.10.1

- **POST /api/v1/instruments** - 创建仪器量具
  - 录入仪器基本信息
  - 自动生成唯一二维码
  - Requirements: 2.10.1

- **PUT /api/v1/instruments/{id}** - 更新仪器量具
  - 修改仪器信息
  - 更新责任人
  - 变更状态
  - Requirements: 2.10.1

#### 3.2 校准管理接口
- **POST /api/v1/instruments/{id}/calibration** - 记录校准
  - 上传校准证书
  - OCR 识别校准日期
  - 更新校准状态
  - 自动计算预警日期
  - Requirements: 2.10.2

#### 3.3 MSA 分析接口
- **POST /api/v1/instruments/{id}/msa** - 记录 MSA 分析
  - 支持 GR&R 分析
  - 上传 MSA 报告
  - 记录分析结果
  - Requirements: 2.10.2

## 技术实现细节

### 接口特性
1. **所有接口返回 501 Not Implemented**
   - 符合预留功能要求
   - 明确标注为 Phase 2 实施

2. **完整的文档注释**
   - 中英文双语注释
   - 详细的功能说明
   - 应用场景描述
   - Requirements 追溯

3. **实施指南**
   - 文件末尾包含完整的 Phase 2 实施指南
   - 列出需要创建的 Schemas
   - 列出需要实现的 Service Layer
   - 列出需要集成的 Celery 任务
   - 列出状态互锁逻辑
   - 列出前端开发要求

## 验证结果

### 测试执行
```bash
python test_instruments_api.py
```

### 测试结果
```
✓ PASS | GET  /api/v1/instruments                      | 获取仪器量具列表
✓ PASS | POST /api/v1/instruments                      | 创建仪器量具
✓ PASS | PUT  /api/v1/instruments/1                    | 更新仪器量具
✓ PASS | POST /api/v1/instruments/1/calibration        | 记录校准
✓ PASS | POST /api/v1/instruments/1/msa                | 记录 MSA 分析

Results: 5/5 tests passed
✓ All reserved endpoints are properly registered!
```

## Phase 2 实施清单

当需要启用仪器量具管理功能时，需要完成以下工作：

### 1. 数据层
- ✅ 数据库模型已创建（Task 15.1）
- ⏸️ 需要移除字段的 Nullable 约束（根据实际需求）

### 2. Schema 层
需要创建 `app/schemas/instrument.py`：
- InstrumentCreate
- InstrumentUpdate
- InstrumentResponse
- CalibrationCreate
- MSARecordCreate
- InstrumentListResponse

### 3. Service 层
需要创建 `app/services/instrument_service.py`：
- InstrumentService 类
- 实现所有业务逻辑方法

### 4. 定时任务
需要创建 `app/tasks/instrument_tasks.py`：
- 校准到期预警任务
- 自动冻结过期仪器任务
- 生成年度 MSA 分析任务

### 5. 状态互锁
需要在以下模块中集成量具状态检查：
- 2.5.1 IQC 检验模块
- 2.5.10 扫码防错模块

### 6. 前端开发
需要创建以下页面：
- Instruments.vue - 仪器台账列表
- InstrumentDetail.vue - 仪器详情
- CalibrationUpload.vue - 校准记录上传
- MSARecord.vue - MSA 分析记录

### 7. 权限配置
- 在 2.1.1 权限矩阵中添加"仪器量具管理"模块
- 配置录入/查阅/修改/删除/导出权限

### 8. 功能开关
- 通过 Feature Flag 控制菜单可见性
- 支持灰度发布

### 9. 移除预留状态
- 移除所有 501 状态码
- 替换为实际业务逻辑实现

## 依赖关系
- 依赖 Task 15.1（数据库模型已创建）
- 被 2.5.1 IQC 检验模块依赖（状态互锁）
- 被 2.5.10 扫码防错模块依赖（状态互锁）

## 符合规范
- ✅ 遵循 FastAPI 路由规范
- ✅ 使用 snake_case 命名
- ✅ 中英文双语注释
- ✅ 完整的 OpenAPI 文档
- ✅ 所有接口返回 501 Not Implemented
- ✅ 添加详细的实施指南

## 下一步
Task 15.2 已完成。可以继续执行 Task 15.3（预留仪器量具管理前端页面）或根据项目优先级调整。
