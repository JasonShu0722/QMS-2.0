# Implementation Plan - QMS Complete System

本实施计划将 QMS 质量管理系统的完整设计转化为可执行的开发任务。任务涵盖从基础设施到所有业务模块（2.1-2.12）的完整实现。

## 任务执行说明

- 每个任务都引用了对应的需求编号（Requirements: X.X）
- 标记为 `*` 的子任务为可选任务（如单元测试），可根据项目进度决定是否实施
- Phase 1 包含基础设施和所有核心业务模块（2.1-2.9, 2.12）
- Phase 2 为预留功能（2.10 仪器量具管理、2.11 质量成本管理）
- 建议按顺序执行任务，避免依赖问题

---

## Phase 1: 基础设施与核心业务模块

### 1. 项目基础设施搭建

- [x] 1.1 初始化 Monorepo 项目结构
  - 创建根目录结构：backend/, frontend/, deployment/
  - 创建 .env.example 环境变量模板（包含 DB_PASSWORD, REDIS_PASSWORD, SECRET_KEY, IMS_BASE_URL, OPENAI_API_KEY, SMTP_SERVER）
  - 编写 README.md 项目说明文档（包含双轨发布架构说明）
  - 创建 .gitignore 文件
  - _Requirements: 2.1.1, 2.12.1_

- [x] 1.2 配置双轨 Docker Compose 环境
  - 创建 docker-compose.yml，定义以下服务：
    - postgres: PostgreSQL 15+ 数据库（共享数据底座）
    - redis: Redis 7+ 缓存/队列
    - backend-stable: 正式环境后端容器
    - backend-preview: 预览环境后端容器
    - frontend-stable: 正式环境前端容器
    - frontend-preview: 预览环境前端容器
    - nginx: 反向代理网关
    - celery-worker: 异步任务处理
    - celery-beat: 定时任务调度
  - 配置容器间网络连接（qms_network）
  - 配置数据卷持久化（postgres_data, redis_data）
  - _Requirements: 2.12.1, 2.12.2_

- [x] 1.3 配置 Nginx 双轨路由分发
  - 创建 deployment/nginx/nginx.conf 配置文件
  - 配置正式环境路由：qms.company.com -> frontend-stable, /api -> backend-stable
  - 配置预览环境路由：preview.company.com -> frontend-preview, /api -> backend-preview
  - 配置 SSL 证书路径（生产环境）
  - 设置文件上传大小限制（client_max_body_size 50M）
  - 配置静态文件缓存策略
  - _Requirements: 2.12.1, 2.12.2_

- [x] 1.4 配置后端开发环境
  - 初始化 FastAPI 项目结构（app/api/, app/core/, app/models/, app/schemas/, app/services/）
  - 创建 requirements.txt 依赖包：FastAPI, Uvicorn, SQLAlchemy 2.0+, Alembic, Pydantic V2, Python-Jose, Passlib, LDAP3, Redis, Celery, HTTPX, aiosmtplib
  - 创建 backend/Dockerfile 容器构建文件
  - 配置 Alembic 数据库迁移工具（alembic.ini, alembic/env.py）
  - 创建 app/core/config.py 配置管理模块（读取环境变量）
  - _Requirements: 2.1.5, 2.12.2_

- [x] 1.5 配置前端开发环境
  - 使用 Vite 初始化 Vue 3 项目（Composition API）
  - 安装依赖包：Element Plus, Tailwind CSS, ECharts, Axios, Pinia, Vue Router
  - 创建 frontend/Dockerfile 容器构建文件
  - 配置 Vue Router 路由结构（router/index.ts）
  - 创建基础布局组件（layouts/MainLayout.vue, layouts/MobileLayout.vue）
  - 配置 Tailwind CSS（tailwind.config.js）
  - _Requirements: 2.1.7, 2.12.1_

### 2. 数据库设计与核心模型（基础层）

- [x] 2.1 设计用户与权限数据模型
  - 创建 User 模型：id, username, password_hash, email, phone, full_name, user_type, department, position, supplier_id, status, digital_signature, failed_login_attempts, locked_until, password_changed_at
  - 创建 Permission 模型：id, user_id, module_path, operation_type, is_granted
  - 创建 Supplier 模型：id, name, code, contact_person, contact_email, contact_phone, iso9001_cert, iso9001_expiry, iatf16949_cert, iatf16949_expiry, status
  - _Requirements: 2.1.1, 2.1.3, 2.1.4_

- [x] 2.2 设计通知与日志数据模型
  - 创建 Notification 模型：id, user_id, message_type, title, content, link, is_read, read_at
  - 创建 OperationLog 模型：id, user_id, operation_type, target_module, target_id, before_data, after_data, ip_address, user_agent, created_at
  - 创建 Announcement 模型：id, title, content, announcement_type, importance, is_active, published_at, expires_at
  - _Requirements: 2.1.4, 2.2.4, 2.2.5_

- [x] 2.3 设计功能特性开关数据模型
  - 创建 FeatureFlag 模型：id, feature_key, feature_name, description, is_enabled, scope, whitelist_user_ids, whitelist_supplier_ids, environment
  - _Requirements: 2.12.3_

- [x] 2.4 设计系统配置数据模型
  - 创建 SystemConfig 模型：id, config_key, config_value, config_type, description, category, validation_rule
  - _Requirements: 2.3.2_

- [x] 2.5 执行数据库迁移（兼容双轨环境）
  - 使用 Alembic 生成初始迁移脚本
  - 验证迁移脚本符合非破坏性原则
  - 执行迁移：alembic upgrade head
  - 创建数据库索引优化查询性能
  - _Requirements: 2.12.2_

### 3. 认证授权与权限引擎

- [x] 3.1 实现可插拔认证策略（Strategy Pattern）
  - 创建 AuthStrategy 抽象基类
  - 实现 LocalAuthStrategy（密码哈希、JWT Token、密码策略、登录锁定）
  - 预留 LDAPAuthStrategy（Phase 2）
  - 创建 AuthService 统一认证服务
  - _Requirements: 2.1.5_

- [x] 3.2 实现用户注册与审核 API
  - 创建 Pydantic 数据校验模型（UserRegisterSchema, UserApprovalSchema）
  - 实现 POST /api/v1/auth/register 注册接口
  - 实现 GET /api/v1/auth/suppliers/search 供应商模糊搜索接口
  - _Requirements: 2.1.3_

- [x] 3.3 实现统一登录 API（多入口支持）
  - 实现 POST /api/v1/auth/login 登录接口（支持内部员工/供应商）
  - 实现 GET /api/v1/auth/captcha 图形验证码生成接口
  - 实现 GET /api/v1/auth/me 获取当前用户信息接口
  - 创建 get_current_user 依赖注入函数
  - _Requirements: 2.1.5_

- [x] 3.4 实现权限引擎核心逻辑
  - 创建 PermissionChecker 类（check_permission, get_user_permissions, filter_by_supplier）
  - 实现 require_permission 装饰器
  - 实现权限缓存机制（Redis）
  - _Requirements: 2.1.1_

- [x] 3.5 实现权限配置管理 API
  - 实现 GET /api/v1/admin/permissions/matrix 获取权限矩阵
  - 实现 PUT /api/v1/admin/permissions/grant 授予权限
  - 实现 PUT /api/v1/admin/permissions/revoke 撤销权限
  - 实现 GET /api/v1/admin/permissions/users/{user_id} 获取用户权限详情
  - _Requirements: 2.1.1_

- [x] 3.6 实现用户审核管理 API
  - 实现 GET /api/v1/admin/users/pending 获取待审核用户列表
  - 实现 POST /api/v1/admin/users/{id}/approve 批准用户
  - 实现 POST /api/v1/admin/users/{id}/reject 拒绝用户
  - 实现 POST /api/v1/admin/users/{id}/freeze 冻结账号
  - 实现 POST /api/v1/admin/users/{id}/reset-password 重置密码
  - _Requirements: 2.1.3, 2.3.3_

- [x] 3.7 实现操作日志审计
  - 创建审计中间件（拦截 POST/PUT/DELETE 请求）
  - 实现 GET /api/v1/admin/operation-logs 获取日志列表
  - 实现 GET /api/v1/admin/operation-logs/{id} 获取日志详情
  - _Requirements: 2.1.4_

### 4. 个人中心与通知系统

- [x] 4.1 实现任务聚合服务
  - 创建 TaskAggregator 类（get_user_tasks, calculate_urgency, calculate_remaining）
  - 配置业务表映射（BUSINESS_TABLES）
  - 实现 GET /api/v1/tasks/my-tasks 获取当前用户待办任务
  - _Requirements: 2.2.3_

- [x] 4.2 实现任务转派功能
  - 实现 POST /api/v1/admin/tasks/reassign 批量转派任务
  - 实现 GET /api/v1/admin/tasks/statistics 任务统计
  - _Requirements: 2.3.1_

- [x] 4.3 实现通知中心服务
  - 创建 NotificationHub 类（send_notification, send_email, send_wechat_work, mark_as_read）
  - 实现 GET /api/v1/notifications 获取站内信列表
  - 实现 GET /api/v1/notifications/unread-count 获取未读消息数量
  - 实现 PUT /api/v1/notifications/{id}/read 标记单条消息为已读
  - 实现 PUT /api/v1/notifications/read-all 一键标记全部已读
  - _Requirements: 2.2.4_

- [x] 4.4 实现个人信息管理 API
  - 实现 GET /api/v1/profile 获取个人信息
  - 实现 PUT /api/v1/profile/password 修改密码
  - 实现 POST /api/v1/profile/signature 上传电子签名（自动背景透明化）
  - _Requirements: 2.2.2_

- [x] 4.5 实现公告栏管理
  - 实现 GET /api/v1/announcements 获取公告列表
  - 实现 POST /api/v1/admin/announcements 创建公告
  - 实现 POST /api/v1/announcements/{id}/read 记录阅读
  - 实现 GET /api/v1/admin/announcements/{id}/statistics 查看阅读统计
  - _Requirements: 2.2.5_

- [x] 4.6 实现消息通知配置管理
  - 创建 NotificationRule 模型
  - 实现 POST /api/v1/admin/notification-rules 创建通知规则
  - 实现 PUT /api/v1/admin/notification-rules/{id} 更新通知规则
  - 实现 POST /api/v1/admin/smtp-config 配置 SMTP 服务器
  - 实现 POST /api/v1/admin/webhook-config 配置企业微信/钉钉 Webhook
  - _Requirements: 2.3.2_

### 5. 功能特性开关与系统配置

- [x] 5.1 实现功能特性开关服务
  - 创建 FeatureFlagService 类（is_feature_enabled, update_feature_flag, get_all_feature_flags）
  - 实现 GET /api/v1/admin/feature-flags 获取功能开关列表
  - 实现 PUT /api/v1/admin/feature-flags/{id} 更新功能开关
  - 实现 GET /api/v1/feature-flags/my-features 获取当前用户可用功能列表
  - _Requirements: 2.12.3_

- [x] 5.2 实现系统全局配置管理
  - 实现 GET /api/v1/admin/system-config 获取所有配置项
  - 实现 PUT /api/v1/admin/system-config/{key} 更新配置项
  - 实现配置分类管理（business_rule, timeout, file_limit, notification）
  - 实现配置默认值机制
  - _Requirements: 2.3.2_

### 6. 前端基础组件开发

- [x] 6.1 实现前端认证与路由
  - 创建 useAuthStore Pinia 状态管理
  - 创建 Axios 封装（request.ts）
  - 配置路由守卫（验证 Token 有效性）
  - _Requirements: 2.1.5_

- [x] 6.2 实现登录注册页面（多入口支持）
  - 创建 Login.vue 登录页面（员工登录/供应商登录）
  - 创建 Register.vue 注册页面（公司用户/供应商用户）
  - 实现供应商名称模糊搜索组件
  - _Requirements: 2.1.3, 2.1.5_

- [x] 6.3 实现个人中心页面（动态工作台）
  - 创建 PersonalCenter.vue 个人中心页面
  - 实现个人信息模块（修改密码、电子签名上传）
  - 实现待办任务列表（TaskCard.vue 组件）
  - 实现内部员工视图和供应商视图
  - _Requirements: 2.1.6, 2.2.1, 2.2.2, 2.2.3_

- [x] 6.4 实现站内信通知组件
  - 创建 NotificationBell.vue 铃铛图标组件
  - 创建 NotificationList.vue 站内信列表组件
  - _Requirements: 2.2.4_

- [x] 6.5 实现公告栏组件
  - 创建 AnnouncementList.vue 公告列表组件
  - 创建 AnnouncementDialog.vue 重要公告弹窗
  - _Requirements: 2.2.5_

- [x] 6.6 实现系统管理后台页面
  - 创建 UserApproval.vue 用户审核页面
  - 创建 PermissionMatrix.vue 权限矩阵配置页面
  - 创建 TaskMonitor.vue 任务统计页面
  - 创建 OperationLogs.vue 操作日志页面
  - 创建 FeatureFlags.vue 功能开关管理页面
  - _Requirements: 2.1.1, 2.1.3, 2.1.4, 2.3.1, 2.3.3, 2.12.3_

- [x] 6.7 实现移动端响应式适配
  - 配置 Tailwind CSS 断点（sm, md, lg）
  - 实现响应式布局组件
  - 实现扫码页面全屏模式（预留接口）
  - 实现离线暂存模式（预留接口）
  - _Requirements: 2.1.7_

### 7. 环境切换与版本管理

- [x] 7.1 实现环境切换功能
  - 在前端顶部导航栏添加环境切换按钮
  - 实现环境切换逻辑（域名切换、Token 共享）
  - 添加环境标识（预览版标识）
  - _Requirements: 2.12.1_

- [x] 7.2 实现数据库兼容性验证
  - 创建 Alembic 迁移脚本验证工具
  - 在 CI/CD 流程中集成验证
  - _Requirements: 2.12.2_

### 8. 测试与部署

- [x] 8.1 编写后端单元测试（可选）
  - 创建 test_auth.py 认证模块测试
  - 创建 test_permissions.py 权限模块测试
  - 创建 test_task_aggregator.py 任务聚合测试
  - _Requirements: 2.1.1, 2.1.5, 2.2.3_

- [x] 8.2 编写前端单元测试（可选）
  - 创建 TaskCard.spec.ts 任务卡片组件测试
  - 创建 NotificationBell.spec.ts 通知组件测试
  - 创建 login.spec.ts E2E 登录流程测试
  - _Requirements: 2.1.5, 2.2.3, 2.2.4_

- [x] 8.3 部署准备与优化
  - 配置生产环境变量（.env.production）
  - 配置 SSL 证书
  - 配置数据库备份策略
  - 性能优化（Redis 缓存、数据库索引、Nginx 缓存）
  - _Requirements: 2.12.1_

- [x] 8.4 执行生产环境部署
  - 使用 Docker Compose 启动所有服务
  - 执行数据库迁移
  - 验证双轨环境访问
  - 功能验证测试
  - _Requirements: 2.12.1, 2.12.2_

### 9. 质量数据面板（2.4 Quality Data Dashboard）

- [x] 9.1 设计质量数据模型
  - 创建 QualityMetric 模型：id, metric_type, metric_date, value, target_value, product_type, supplier_id, line_id, process_id
  - 创建 IMSSyncLog 模型：id, sync_type, sync_date, status, records_count, error_message
  - 指标类型枚举：incoming_batch_pass_rate, material_online_ppm, process_defect_rate, process_fpy, okm_ppm, mis_3_ppm, mis_12_ppm
  - _Requirements: 2.4.1_

- [x] 9.2 实现 IMS 数据集成服务
  - 创建 IMSIntegrationService 类（使用 HTTPX 异步客户端）
  - 实现 fetch_incoming_inspection_data() 拉取入库检验数据
  - 实现 fetch_production_output_data() 拉取成品产出数据
  - 实现 fetch_process_test_data() 拉取制程测试数据
  - 创建 Celery 定时任务（每日凌晨 02:00 同步）
  - 实现错误处理和重试机制
  - _Requirements: 2.4.1_

- [x] 9.3 实现质量指标计算引擎
  - 创建 MetricsCalculator 类
  - 实现 calculate_incoming_batch_pass_rate() 来料批次合格率计算
  - 实现 calculate_material_online_ppm() 物料上线不良 PPM 计算
  - 实现 calculate_process_defect_rate() 制程不合格率计算
  - 实现 calculate_process_fpy() 制程直通率计算
  - 实现 calculate_0km_ppm() 0KM 不良 PPM 计算
  - 实现 calculate_3mis_ppm() 3MIS 售后不良 PPM 计算（滚动 3 个月）
  - 实现 calculate_12mis_ppm() 12MIS 售后不良 PPM 计算（滚动 12 个月）
  - 按供应商、产品类型、工序、线体进行分类统计
  - _Requirements: 2.4.1_

- [x] 9.4 实现质量数据 API
  - 实现 GET /api/v1/quality-metrics/dashboard 获取仪表盘数据
  - 实现 GET /api/v1/quality-metrics/trend 获取指标趋势（支持时间范围筛选）
  - 实现 GET /api/v1/quality-metrics/drill-down 下钻查询（点击指标查看明细）
  - 实现 GET /api/v1/quality-metrics/top-suppliers 获取 Top5 供应商清单
  - 实现 GET /api/v1/quality-metrics/process-analysis 制程质量分析
  - 实现 GET /api/v1/quality-metrics/customer-analysis 客户质量分析
  - 实现权限控制（用户只能查看被授权的指标）
  - _Requirements: 2.4.2, 2.4.3_

- [x] 9.5 实现 AI 智能诊断服务
  - 创建 AIAnalysisService 类（集成 OpenAI API / DeepSeek）
  - 实现 analyze_anomaly() 异常自动寻源（指标飙升时触发）
  - 实现 natural_language_query() 自然语言查询（用户提问转 SQL）
  - 实现 generate_trend_chart() 根据用户描述生成图表
  - 实现 POST /api/v1/ai/diagnose 异常诊断接口
  - 实现 POST /api/v1/ai/query 自然语言查询接口
  - _Requirements: 2.4.4_

- [x] 9.6 实现质量数据可视化前端
  - 创建 QualityDashboard.vue 质量数据仪表盘页面
  - 使用 ECharts 实现指标图表（折线图、柱状图、雷达图）
  - 实现质量红绿灯（达标绿色、未达标红色）
  - 实现动态图表展示（类型按钮、时间调整按钮）
  - 实现下钻功能（点击指标跳转到问题明细）
  - 创建 AIAssistant.vue AI 对话框组件
  - _Requirements: 2.4.2, 2.4.4_

- [x] 9.7 编写质量数据模块测试（可选）
  - 测试 IMS 数据同步逻辑
  - 测试指标计算公式准确性
  - 测试 AI 诊断服务
  - _Requirements: 2.4.1, 2.4.4_

### 10. 供应商质量管理（2.5 Supplier Quality Management）

- [x] 10.1 设计供应商质量数据模型
  - 创建 SCAR 模型（Supplier Corrective Action Request）：id, scar_number, supplier_id, material_code, defect_description, defect_qty, severity, status, current_handler_id, deadline
  - 创建 EightD 模型（8D Report）：id, scar_id, d0_d3_data (JSON), d4_d7_data (JSON), d8_data (JSON), status, submitted_by, reviewed_by, review_comments
  - 创建 SupplierAudit 模型：id, supplier_id, audit_type, audit_date, auditor_id, audit_result, score, nc_items (JSON)
  - 创建 SupplierPerformance 模型：id, supplier_id, month, incoming_quality_score, process_quality_score, cooperation_score, final_score, grade
  - 创建 SupplierTarget 模型：id, supplier_id, year, target_type, target_value, is_signed, signed_at
  - 创建 PPAP 模型：id, supplier_id, material_code, ppap_level, submission_date, status, documents (JSON)
  - 创建 InspectionSpec 模型：id, material_code, supplier_id, version, sip_file_path, key_characteristics (JSON), status
  - 创建 BarcodeValidation 模型：id, material_code, validation_rules (JSON), regex_pattern, is_unique_check
  - _Requirements: 2.5.2, 2.5.3, 2.5.4, 2.5.5, 2.5.7, 2.5.8, 2.5.9_

- [x] 10.2 实现 IQC 数据集成
  - 扩展 IMSIntegrationService 类
  - 实现 sync_iqc_inspection_results() 同步 IQC 检验结果
  - 实现 auto_create_scar_on_ng() NG 自动立案逻辑
  - 实现 sync_special_approval_records() 同步特采记录
  - _Requirements: 2.5.1_

- [x] 10.3 实现 SCAR 与 8D 闭环管理
  - 实现 POST /api/v1/scar 创建 SCAR 单
  - 实现 GET /api/v1/scar 获取 SCAR 列表（供应商仅见自己的数据）
  - 实现 POST /api/v1/scar/{id}/8d 供应商提交 8D 报告
  - 实现 POST /api/v1/scar/{id}/8d/review SQE 审核 8D 报告
  - 实现 POST /api/v1/scar/{id}/8d/reject SQE 驳回 8D 报告
  - 实现 AI 预审功能（关键词检测、历史查重）
  - 实现邮件通知（SCAR 创建、8D 提交、审核结果）
  - _Requirements: 2.5.2_

- [x] 10.4 实现供应商生命周期管理
  - 实现 POST /api/v1/suppliers/qualification 供应商准入审核
  - 实现 POST /api/v1/suppliers/{id}/documents 上传资质文件
  - 实现证书有效期自动预警（Celery 定时任务）
  - 实现 POST /api/v1/suppliers/pcn 供应商变更管理（PCN 申请）
  - 实现 GET /api/v1/suppliers/audits/plan 年度审核计划管理
  - 实现 POST /api/v1/suppliers/audits 创建审核记录
  - 实现 POST /api/v1/suppliers/audits/{id}/nc 录入不符合项（NC）
  - 实现 NC 整改任务指派和闭环跟踪
  - _Requirements: 2.5.3_

- [x] 10.5 实现供应商质量目标管理
  - 实现 POST /api/v1/supplier-targets/batch 批量设定目标
  - 实现 POST /api/v1/supplier-targets/individual 单独设定目标
  - 实现目标优先级逻辑（单独设定 > 批量设定 > 全局默认值）
  - 实现辅助决策数据展示（历史实际值对比）
  - 实现审批流（SQE 提交 -> 质量经理审核）
  - 实现 POST /api/v1/supplier-targets/{id}/sign 供应商签署目标
  - 实现签署互锁机制（未签署限制申诉权限）
  - _Requirements: 2.5.4_

- [x] 10.6 实现供应商绩效评价
  - 创建 PerformanceCalculator 类
  - 实现 60 分制扣分模型计算逻辑
  - 实现来料质量扣分计算（对比 2.5.4 目标值）
  - 实现制程质量扣分计算（对比 2.5.4 目标 PPM）
  - 实现配合度扣分（SQE 人工评价）
  - 实现 0 公里/售后质量扣分（关联 2.7 客诉记录）
  - 实现等级评定（A/B/C/D）
  - 实现 SQE 人工校核功能
  - 实现 Celery 定时任务（每月 1 日自动计算）
  - 实现 GET /api/v1/supplier-performance 获取绩效卡
  - _Requirements: 2.5.5_

- [x] 10.7 实现供应商会议与改进监控
  - 实现 C/D 级供应商自动立项会议任务
  - 实现参会人员要求通知（C 级副总、D 级总经理）
  - 实现 POST /api/v1/supplier-meetings 创建会议记录
  - 实现资料上传和考勤录入
  - 实现违规处罚逻辑（未参会自动扣分）
  - _Requirements: 2.5.6_

- [x] 10.8 实现 PPAP 管理
  - 实现 POST /api/v1/ppap 创建 PPAP 提交任务
  - 实现 18 项文件检查表配置
  - 实现 POST /api/v1/ppap/{id}/documents 供应商上传文件
  - 实现 POST /api/v1/ppap/{id}/review SQE 审核（单项驳回/整体批准）
  - 实现年度再鉴定自动提醒（Celery 定时任务）
  - _Requirements: 2.5.7_

- [x] 10.9 实现物料检验规范管理
  - 实现 POST /api/v1/inspection-specs SQE 发起规范提交任务
  - 实现 POST /api/v1/inspection-specs/{id}/submit 供应商提交 SIP
  - 实现版本管理（V1.0, V1.1...）
  - 实现 POST /api/v1/inspection-specs/{id}/approve SQE 审批
  - 实现报告频率策略配置（按批次/按时间）
  - 实现 ASN 强关联（预留功能，待发货数据流打通）
  - 实现定期报告提交任务推送
  - _Requirements: 2.5.8_

- [x] 10.10 实现关键件防错与追溯扫描
  - 实现校验规则配置（正则匹配、特征校验、防重逻辑）
  - 实现 POST /api/v1/barcode-validation/scan 扫码验证接口
  - 实现即时反馈（PASS/NG）
  - 实现计数管理（目标数量、已扫数量）
  - 实现 POST /api/v1/barcode-validation/submit 批次提交归档
  - 实现数据追溯和导出功能
  - _Requirements: 2.5.9_

- [x] 10.11 实现供应商质量管理前端
  - 创建 SupplierDashboard.vue 供应商仪表盘（供应商视图）
  - 创建 SCARList.vue SCAR 列表页面
  - 创建 EightDForm.vue 8D 报告填写页面
  - 创建 SupplierAuditPlan.vue 审核计划页面
  - 创建 SupplierPerformance.vue 绩效评价页面
  - 创建 SupplierTargets.vue 质量目标管理页面
  - 创建 PPAPManagement.vue PPAP 管理页面
  - 创建 InspectionSpecs.vue 检验规范管理页面
  - 创建 BarcodeScanner.vue 扫码防错页面（移动端全屏模式）
  - _Requirements: 2.5.1-2.5.9_

- [x] 10.12 编写供应商质量管理模块测试（可选）
  - 测试 SCAR 自动立案逻辑
  - 测试 8D 报告 AI 预审
  - 测试绩效评价计算公式
  - 测试条码校验规则
  - _Requirements: 2.5.1-2.5.9_

### 11. 过程质量管理（2.6 Process Quality Management）

- [x] 11.1 设计过程质量数据模型
  - 创建 ProcessDefect 模型：id, defect_date, work_order, process_id, line_id, defect_type, defect_qty, responsibility_category, operator_id, recorded_by
  - 创建 ProcessIssue 模型：id, issue_number, issue_description, responsibility_category, assigned_to, root_cause, containment_action, corrective_action, verification_period, status
  - 责任类别枚举：material_defect, operation_defect, equipment_defect, process_defect, design_defect
  - _Requirements: 2.6.2, 2.6.3_

- [x] 11.2 实现生产数据集成
  - 扩展 IMSIntegrationService 类
  - 实现 sync_production_output() 同步成品入库数据
  - 实现 sync_first_pass_test() 同步一次测试数据
  - 实现 sync_process_defects() 同步制程不良记录
  - 维度要求：日期、工单号、工序、产线
  - _Requirements: 2.6.1_

- [x] 11.3 实现不合格品数据录入与分类
  - 实现 POST /api/v1/process-defects 人工补录不良品数据
  - 实现失效类型预设选项
  - 实现责任类别选择（自动关联 2.4.1 指标）
  - 实现 GET /api/v1/process-defects 获取不良品数据清单（支持筛选）
  - _Requirements: 2.6.2_

- [x] 11.4 实现制程质量问题发单管理
  - 实现 POST /api/v1/process-issues 创建制程问题单
  - 实现自动触发配置接口（预留）
  - 实现手动发起（从 2.4.3 报表或不良品清单）
  - 实现问题指派（根据责任归属）
  - 实现 POST /api/v1/process-issues/{id}/response 责任板块填写分析和对策
  - 实现 POST /api/v1/process-issues/{id}/verify PQE 验证对策有效性
  - 实现 POST /api/v1/process-issues/{id}/close 关闭问题单
  - _Requirements: 2.6.3_

- [x] 11.5 实现过程质量管理前端
  - 创建 ProcessDefectList.vue 不合格品数据清单页面
  - 创建 ProcessDefectForm.vue 不良品录入表单
  - 创建 ProcessIssueList.vue 制程问题清单页面
  - 创建 ProcessIssueDetail.vue 问题详情和闭环页面
  - 集成 2.4.3 制程质量分析图表
  - _Requirements: 2.6.1-2.6.3_

- [x] 11.6 编写过程质量管理模块测试（可选）
  - 测试生产数据同步逻辑
  - 测试责任类别关联指标计算
  - 测试问题闭环流程
  - _Requirements: 2.6.1-2.6.3_

### 12. 客户质量管理（2.7 Customer Quality Management）

- [x] 12.1 设计客户质量数据模型
  - 创建 CustomerComplaint 模型：id, complaint_number, complaint_type, customer_code, product_type, defect_description, severity_level, vin_code, mileage, purchase_date, status, cqe_id, responsible_dept
  - 创建 EightDCustomer 模型：id, complaint_id, d0_d3_cqe (JSON), d4_d7_responsible (JSON), d8_horizontal (JSON), status, approval_level
  - 创建 CustomerClaim 模型：id, complaint_id, claim_amount, claim_currency, claim_date, customer_name
  - 创建 SupplierClaim 模型：id, complaint_id, supplier_id, claim_amount, claim_currency, claim_date, status
  - 创建 LessonLearned 模型：id, source_type, source_id, lesson_title, lesson_content, root_cause, preventive_action, approved_by, is_active
  - 客诉类型枚举：0km, after_sales
  - 严重度等级枚举：TBD（待产品定义）
  - _Requirements: 2.7.2, 2.7.3, 2.7.4_

- [x] 12.2 实现出货数据集成
  - 扩展 IMSIntegrationService 类
  - 实现 sync_shipment_data() 同步发货记录
  - 维护过去 24 个月的分月出货数据表
  - 核心字段：客户代码、产品类型、出货日期、出货数量
  - _Requirements: 2.7.1_

- [x] 12.3 实现客诉录入与分级受理
  - 实现 POST /api/v1/customer-complaints 创建客诉单
  - 实现 0KM 客诉和售后客诉分类录入
  - 实现缺陷等级界定（内置分级逻辑）
  - 实现 POST /api/v1/customer-complaints/{id}/preliminary-analysis CQE 一次因解析（D0-D3）
  - 实现自动追溯（联动 IMS 查询过程记录）
  - 实现任务流转（CQE -> 责任板块）
  - _Requirements: 2.7.2_

- [x] 12.4 实现客诉 8D 闭环与时效管理
  - 实现 SLA 动态时效监控（7 天提交、10 天归档）
  - 实现 POST /api/v1/customer-complaints/{id}/8d 责任板块填写 D4-D7
  - 实现 5Why、鱼骨图、FTA 分析工具模板
  - 实现 D6 验证报告上传（强制附件）
  - 实现 D7 标准化（文件修改勾选和上传）
  - 实现 POST /api/v1/customer-complaints/{id}/8d/d8 D8 水平展开和经验教训
  - 实现分级审批流（C 级科室经理、A/B 级部长联合审批）
  - 实现归档检查表核对流程
  - _Requirements: 2.7.3_

- [x] 12.5 实现索赔管理
  - 实现 POST /api/v1/customer-claims 登记客户索赔
  - 实现客户索赔与客诉单关联（多选关联）
  - 实现 POST /api/v1/supplier-claims 创建供应商索赔
  - 实现一键转嫁功能（从客诉单生成供应商索赔）
  - 实现索赔金额统计和报表
  - _Requirements: 2.7.4_

- [x] 12.6 实现客户质量管理前端
  - 创建 CustomerComplaintList.vue 客诉列表页面
  - 创建 CustomerComplaintForm.vue 客诉录入表单
  - 创建 EightDCustomerForm.vue 客诉 8D 报告页面
  - 创建 CustomerClaimList.vue 客户索赔管理页面
  - 创建 SupplierClaimList.vue 供应商索赔管理页面
  - 集成 2.4.3 客户质量分析图表
  - _Requirements: 2.7.1-2.7.4_

- [x] 12.7 编写客户质量管理模块测试（可选）
  - 测试出货数据同步和滚动计算
  - 测试 8D 闭环流程和时效监控
  - 测试索赔转嫁逻辑
  - _Requirements: 2.7.1-2.7.4_

### 13. 新品质量管理（2.8 New Product Quality Management）

- [x] 13.1 设计新品质量数据模型
  - 创建 LessonLearnedLibrary 模型：id, lesson_title, lesson_content, source_module, root_cause, preventive_action, applicable_scenarios, is_active
  - 创建 NewProductProject 模型：id, project_code, project_name, product_type, project_manager, current_stage, status
  - 创建 ProjectLessonCheck 模型：id, project_id, lesson_id, is_applicable, reason_if_not, evidence_file_path, checked_by, checked_at
  - 创建 StageReview 模型：id, project_id, stage_name, review_date, deliverables (JSON), review_result, reviewer_ids
  - 创建 TrialProduction 模型：id, project_id, work_order, target_metrics (JSON), actual_metrics (JSON), status
  - 创建 TrialIssue 模型：id, trial_id, issue_description, issue_type, assigned_to, solution, status, is_escalated_to_8d
  - _Requirements: 2.8.1, 2.8.2, 2.8.3, 2.8.4_

- [x] 13.2 实现经验教训反向注入
  - 实现经验教训库管理（调用 2.5/2.6/2.7 模块的 8D 结案记录）
  - 实现 POST /api/v1/lesson-learned 手工新增/完善/删减经验教训
  - 实现 GET /api/v1/lesson-learned 获取经验教训库
  - 实现项目立项时自动推送相关历史问题
  - 实现 POST /api/v1/projects/{id}/lesson-check 逐条勾选规避措施
  - 实现阶段评审时上传规避证据
  - _Requirements: 2.8.1_

- [x] 13.3 实现阶段评审与交付物管理
  - 实现 POST /api/v1/projects 创建新品项目
  - 实现 POST /api/v1/projects/{id}/stage-reviews 配置阶段评审节点
  - 实现项目质量交付物清单配置
  - 实现 POST /api/v1/projects/{id}/deliverables 上传交付物
  - 实现交付物缺失时锁定项目进度
  - 实现 POST /api/v1/projects/{id}/stage-reviews/{stage_id}/approve 阶段评审批准
  - _Requirements: 2.8.2_

- [x] 13.4 实现试产目标与实绩管理
  - 实现 POST /api/v1/trial-production 创建试产记录
  - 实现关联 IMS 工单号
  - 实现设定质量目标（直通率、CPK、尺寸合格率）
  - 实现自动抓取 IMS 数据（投入数、产出数、一次合格数、不良数）
  - 实现手动补录（CPK、破坏性实验、外观评审）
  - 实现 GET /api/v1/trial-production/{id}/summary 生成试产总结报告
  - 实现红绿灯对比（目标值 vs 实绩值）
  - 实现一键导出 Excel/PDF
  - _Requirements: 2.8.3_

- [x] 13.5 实现试产问题跟进
  - 实现 POST /api/v1/trial-issues 录入试产问题
  - 实现问题清单管理（指派责任人、上传对策、关闭）
  - 实现 POST /api/v1/trial-issues/{id}/escalate 升级为 8D 报告
  - 实现遗留问题管理（SOP 节点未关闭问题需特批）
  - 实现"带病量产"特批流程（签署风险告知书）
  - _Requirements: 2.8.4_

- [x] 13.6 预留初期流动管理接口
  - 创建 InitialFlowControl 模型（预留表结构）
  - 预留加严控制配置入口
  - 预留退出机制自动判断逻辑
  - 当前阶段仅作为静态记录
  - _Requirements: 2.8.5_

- [x] 13.7 实现新品质量管理前端
  - 创建 LessonLearnedLibrary.vue 经验教训库页面
  - 创建 NewProductProjects.vue 新品项目列表页面
  - 创建 ProjectLessonCheck.vue 经验教训点检页面
  - 创建 StageReview.vue 阶段评审页面
  - 创建 TrialProduction.vue 试产管理页面
  - 创建 TrialProductionSummary.vue 试产总结报告页面
  - 创建 TrialIssueList.vue 试产问题清单页面
  - _Requirements: 2.8.1-2.8.5_

- [x] 13.8 编写新品质量管理模块测试（可选）
  - 测试经验教训自动推送逻辑
  - 测试阶段评审交付物互锁
  - 测试试产数据自动抓取和计算
  - _Requirements: 2.8.1-2.8.4_

### 14. 审核管理（2.9 Audit Management）

- [x] 14.1 设计审核管理数据模型
  - 创建 AuditPlan 模型：id, audit_type, audit_name, planned_date, auditor_id, auditee_dept, status
  - 创建 AuditTemplate 模型：id, template_name, audit_type, checklist_items (JSON), scoring_rules (JSON)
  - 创建 AuditExecution 模型：id, audit_plan_id, template_id, audit_date, auditor_id, checklist_results (JSON), final_score, grade, audit_report_path
  - 创建 AuditNC 模型：id, audit_id, nc_item, nc_description, evidence_photo_path, responsible_dept, assigned_to, root_cause, corrective_action, verification_status, deadline
  - 创建 CustomerAudit 模型：id, customer_name, audit_type, audit_date, final_result, score, external_issue_list_path
  - 审核类型枚举：system_audit (IATF16949), process_audit (VDA6.3), product_audit (VDA6.5), customer_audit
  - _Requirements: 2.9.1, 2.9.2, 2.9.3, 2.9.4_

- [x] 14.2 实现审核计划与排程
  - 实现 POST /api/v1/audit-plans 创建年度审核计划
  - 实现 GET /api/v1/audit-plans 获取审核计划（年度视图）
  - 实现智能提醒（提前 N 天邮件通知）
  - 实现 POST /api/v1/audit-plans/{id}/postpone 延期申请（需质量部长批准）
  - _Requirements: 2.9.1_

- [x] 14.3 实现审核模板库管理
  - 实现 POST /api/v1/audit-templates 创建审核模板
  - 实现内置标准模板（VDA 6.3 P2-P7, VDA 6.5, IATF16949）
  - 实现自定义模板（专项审核）
  - 实现 GET /api/v1/audit-templates 获取模板库
  - _Requirements: 2.9.2_

- [x] 14.4 实现审核实施与数字化检查表
  - 实现 POST /api/v1/audit-executions 创建审核执行记录
  - 实现 POST /api/v1/audit-executions/{id}/checklist 在线打分（支持移动端）
  - 实现现场拍照上传（挂载到对应条款）
  - 实现自动评分（VDA 6.3 单项 0 分降级规则）
  - 实现 GET /api/v1/audit-executions/{id}/report 生成审核报告（PDF，含雷达图）
  - _Requirements: 2.9.2_

- [x] 14.5 实现问题整改与闭环
  - 实现审核结束后自动生成 NC 待办任务
  - 实现 POST /api/v1/audit-nc/{id}/assign 指派 NC 给责任板块
  - 实现 POST /api/v1/audit-nc/{id}/response 责任人填写原因和措施
  - 实现 POST /api/v1/audit-nc/{id}/verify 审核员验证有效性
  - 实现 POST /api/v1/audit-nc/{id}/close 关闭 NC
  - 实现逾期升级（Celery 定时任务）
  - _Requirements: 2.9.3_

- [x] 14.6 实现二方审核特别管理
  - 实现 POST /api/v1/customer-audits 创建客户审核台账
  - 实现上传客户指定的问题整改清单（Excel）
  - 实现内部闭环任务创建（依据客户问题清单）
  - 实现 GET /api/v1/customer-audits 获取客户审核台账
  - _Requirements: 2.9.4_

- [x] 14.7 实现审核管理前端
  - 创建 AuditPlanCalendar.vue 审核计划日历视图
  - 创建 AuditTemplates.vue 审核模板库页面
  - 创建 AuditExecution.vue 审核执行页面（支持移动端）
  - 创建 AuditChecklistMobile.vue 移动端检查表（全屏模式）
  - 创建 AuditReport.vue 审核报告页面（含雷达图）
  - 创建 AuditNCList.vue NC 整改清单页面
  - 创建 CustomerAuditList.vue 客户审核台账页面
  - _Requirements: 2.9.1-2.9.4_

- [x] 14.8 编写审核管理模块测试（可选）
  - 测试审核计划提醒逻辑
  - 测试自动评分规则
  - 测试 NC 闭环流程
  - _Requirements: 2.9.1-2.9.3_

---

## Phase 2: 预留功能接口 (Reserved Features)

### 15. 仪器与量具管理（2.10 Instrument Management - 预留）

- [x] 15.1 创建仪器量具数据模型（预留表结构）
  - 创建 Instrument 模型：id, instrument_code, instrument_name, instrument_type, calibration_date, next_calibration_date, calibration_cert_path, status
  - 创建 MSARecord 模型：id, instrument_id, msa_type, msa_date, msa_result, msa_report_path
  - 所有字段设置为 Nullable（兼容双轨环境）
  - 执行数据库迁移（仅创建表结构，不实现业务逻辑）
  - _Requirements: 2.10（预留功能）_

- [x] 15.2 预留仪器量具管理 API 接口
  - 创建 backend/app/api/v1/instruments.py 仪器量具路由（空实现）
  - 定义 API 接口签名（不实现业务逻辑）：
    - GET /api/v1/instruments 获取仪器量具列表
    - POST /api/v1/instruments 创建仪器量具
    - PUT /api/v1/instruments/{id} 更新仪器量具
    - POST /api/v1/instruments/{id}/calibration 记录校准
    - POST /api/v1/instruments/{id}/msa 记录 MSA 分析
  - 所有接口返回 501 Not Implemented
  - 添加注释说明预留用途
  - _Requirements: 2.10（预留功能）_

- [x] 15.3 预留仪器量具管理前端页面
  - 创建 frontend/src/views/Instruments.vue 仪器量具管理页面（空页面）
  - 添加菜单入口（默认隐藏）
  - 通过功能开关控制可见性
  - _Requirements: 2.10（预留功能）_

### 16. 质量成本管理（2.11 Quality Cost Management - 预留）

- [x] 16.1 创建质量成本数据模型（预留表结构）
  - 创建 QualityCost 模型：id, cost_type, cost_category, amount, currency, related_object_type, related_object_id, cost_date, fiscal_year, fiscal_month
  - 创建 CostAnalysis 模型：id, analysis_type, analysis_period, total_cost, analysis_result (JSON)
  - 所有字段设置为 Nullable（兼容双轨环境）
  - 执行数据库迁移（仅创建表结构，不实现业务逻辑）
  - _Requirements: 2.11（预留功能）_

- [x] 16.2 预留质量成本管理 API 接口
  - 创建 backend/app/api/v1/quality_costs.py 质量成本路由（空实现）
  - 定义 API 接口签名（不实现业务逻辑）：
    - GET /api/v1/quality-costs 获取质量成本列表
    - POST /api/v1/quality-costs 创建质量成本记录
    - GET /api/v1/quality-costs/analysis 获取成本分析
    - GET /api/v1/quality-costs/trend 获取成本趋势
  - 所有接口返回 501 Not Implemented
  - 添加注释说明预留用途
  - _Requirements: 2.11（预留功能）_

- [x] 16.3 预留质量成本管理前端页面
  - 创建 frontend/src/views/QualityCosts.vue 质量成本管理页面（空页面）
  - 添加菜单入口（默认隐藏）
  - 通过功能开关控制可见性
  - _Requirements: 2.11（预留功能）_

---

## 总结

本实施计划共包含 **16 个主要任务组**，涵盖 QMS 系统的完整功能范围：

### Phase 1: 基础设施与核心业务模块（必须完成）

**基础设施层（任务组 1-8）：**
1. 项目基础设施搭建（双轨 Docker 环境、Nginx 路由分发）
2. 数据库设计与核心模型（用户、权限、通知、功能开关）
3. 认证授权与权限引擎（可插拔策略、多入口登录、细粒度权限）
4. 个人中心与通知系统（任务聚合、站内信、公告栏）
5. 功能特性开关与系统配置（灰度发布、白名单机制）
6. 前端基础组件开发（登录注册、个人中心、管理后台、移动端适配）
7. 环境切换与版本管理（双轨切换、数据库兼容性验证）
8. 测试与部署（单元测试、生产环境部署）

**核心业务模块（任务组 9-14）：**
9. 质量数据面板（2.4）- IMS 集成、指标计算、可视化、AI 诊断
10. 供应商质量管理（2.5）- IQC 集成、SCAR/8D 流程、供应商生命周期、绩效评价、PPAP、检验规范、条码扫描
11. 过程质量管理（2.6）- 生产数据集成、不良品跟踪、问题发单管理
12. 客户质量管理（2.7）- 出货数据、客诉管理、8D 闭环、索赔管理
13. 新品质量管理（2.8）- 经验教训、阶段评审、试产管理、问题跟进
14. 审核管理（2.9）- 审核计划、数字化检查表、NC 跟踪、二方审核

### Phase 2: 预留功能接口（仅预留表结构和 API）
15. 仪器与量具管理（2.10 - 预留）
16. 质量成本管理（2.11 - 预留）

**预估开发周期**：
- Phase 1 基础设施层（任务组 1-8）：4-6 周
- Phase 1 核心业务模块（任务组 9-14）：12-16 周
- Phase 2 预留功能（任务组 15-16）：1 周

**总计**：约 17-23 周（4-6 个月）

**关键技术要点**：
- 双轨发布架构：Preview & Stable 容器并行运行，共享 PostgreSQL 数据库
- 数据库兼容性：遵循 Alembic 非破坏性迁移原则（Add Column Only）
- IMS 系统集成：使用 HTTPX 异步客户端，Celery 定时任务（每日凌晨 02:00）
- AI 智能诊断：集成 OpenAI API / DeepSeek，实现异常寻源和自然语言查询
- 可插拔认证：Strategy Pattern 设计，Phase 1 实现 Local Auth，预留 LDAP Auth
- 移动端适配：Element Plus（桌面）+ Tailwind CSS（移动）响应式策略
- 功能开关：支持灰度发布和白名单机制

**模块依赖关系**：
- 任务组 1-8（基础设施）是所有业务模块的前置依赖
- 任务组 9（质量数据面板）依赖 IMS 集成，为其他业务模块提供指标计算
- 任务组 10-14（业务模块）可并行开发，但建议按顺序实施以便逐步验证
- 任务组 15-16（预留功能）可在 Phase 1 完成后根据业务需求决定是否实施

**下一步行动**：
开始执行 Phase 1 任务，建议按顺序执行，确保每个步骤都建立在前一步的基础上。优先完成基础设施层（任务组 1-8），然后根据业务优先级选择核心业务模块的实施顺序。
