# ExecPlan（QMS）

> 这是一份活文档。创建任务计划后，必须随着执行持续更新：
> `进度`、`意外发现`、`决策日志`、`验证证据`、`回顾`
> 使用前先阅读：
>
> - [`AGENTS.md`](/E:/WorkSpace/QMS/AGENTS.md)
> - [`doc/PROJECT_DEVELOPMENT_HANDOFF.md`](/E:/WorkSpace/QMS/doc/PROJECT_DEVELOPMENT_HANDOFF.md)

***

## 任务名称

系统管理底座升级：角色标签权限管理 + 用户审批/用户清单拆分

## 任务元信息

- 模块：系统管理 / 用户管理 / 权限管理
- 需求来源：
  - 用户最新策划：按角色标签统一授权，由管理员配置角色标签权限并为账户分配角色标签
  - 当前系统管理板块开发收口
- 关联文档：
  - [`doc/PROJECT_DEVELOPMENT_HANDOFF.md`](/E:/WorkSpace/QMS/doc/PROJECT_DEVELOPMENT_HANDOFF.md)
  - [`doc/QMS_ROLE_FUNCTION_MAPPING.md`](/E:/WorkSpace/QMS/doc/QMS_ROLE_FUNCTION_MAPPING.md)
  - [`.kiro/steering/product.md`](/E:/WorkSpace/QMS/.kiro/steering/product.md)
  - [`.kiro/specs/qms-foundation-and-auth/requirements.md`](/E:/WorkSpace/QMS/.kiro/specs/qms-foundation-and-auth/requirements.md)
  - [`.kiro/specs/qms-foundation-and-auth/design.md`](/E:/WorkSpace/QMS/.kiro/specs/qms-foundation-and-auth/design.md)
- 风险等级：高
- 是否涉及双环境 / feature flag：否
- 是否需要更新需求面板：是
- 是否需要回写 `.kiro` 源文档：是

***

## 目的 / 用户可观察结果

- 管理员在“权限管理”中不再按单个用户逐项勾权限，而是按“角色标签”统一维护模块权限。
- 管理员在“用户管理”中可以区分“用户审批”和“用户清单管理”两个子版块。
- 用户清单管理支持按姓名、部门、岗位等字段搜索筛选，并支持基本信息维护、角色分配、冻结/解冻、删除、密码重置等操作。
- 角色标签的权限变更会直接影响对应账户的实际访问权限，保持角色级统一治理。

***

## 非目标

- 不在本次范围内实现完整的组织架构树、部门层级主数据中心。
- 不在本次范围内实现业务管理员与超级管理员的彻底拆权，只保留当前 super admin bootstrap 入口。
- 不在本次范围内重构操作日志、任务监控、通知规则、系统配置页面。

***

## 前置阅读

- [`doc/PROJECT_DEVELOPMENT_HANDOFF.md`](/E:/WorkSpace/QMS/doc/PROJECT_DEVELOPMENT_HANDOFF.md)
- [`doc/QMS_ROLE_FUNCTION_MAPPING.md`](/E:/WorkSpace/QMS/doc/QMS_ROLE_FUNCTION_MAPPING.md)
- [`.kiro/steering/product.md`](/E:/WorkSpace/QMS/.kiro/steering/product.md)
- [`.kiro/specs/qms-foundation-and-auth/requirements.md`](/E:/WorkSpace/QMS/.kiro/specs/qms-foundation-and-auth/requirements.md)
- [`.kiro/specs/qms-foundation-and-auth/design.md`](/E:/WorkSpace/QMS/.kiro/specs/qms-foundation-and-auth/design.md)

***

## 里程碑与验证

- [x] 步骤 1：确认范围、依赖和现状
  - 验证：已确认当前权限模型仍为“按用户授予”，用户管理仅有待审核列表，需新增角色标签与用户清单治理能力
- [x] 步骤 2：完成后端实现或契约调整
  - 验证：`& '.\.venv\Scripts\python.exe' -m pytest backend/test/test_admin_users_api.py backend/test/test_admin_permissions_api.py backend/test/test_permissions.py`
- [x] 步骤 3：完成前端实现或交互收口
  - 验证：`Set-Location frontend; npm run test:foundation`
- [x] 步骤 4：补齐最小自动化验证
  - 验证：`Set-Location frontend; npm run build`
- [x] 步骤 5：联调底座 smoke
  - 验证：`& '.\.venv\Scripts\python.exe' backend/scripts/run_foundation_smoke.py`
- [x] 步骤 6：更新需求面板 / 专题文档 / 交付记录
  - 验证：已同步 `frontend/src/features/requirements-panel/catalog.ts`、`doc/QMS_ROLE_FUNCTION_MAPPING.md`、`doc/PROJECT_DEVELOPMENT_HANDOFF.md`
- [x] 步骤 7：同步回写 `.kiro` 源文档
  - 验证：已同步 `.kiro/steering/product.md`、`.kiro/specs/qms-foundation-and-auth/requirements.md`、`.kiro/specs/qms-foundation-and-auth/design.md`

***

## 进度

- [ ] 待开始
- [ ] 进行中
- [x] 已完成

> 角色标签化权限治理、用户审批/用户清单拆分、验证回归与文档同步已经全部完成。

***

## 意外发现 & 新发现

- 当前权限矩阵接口和页面仍按“用户”为行维度，不符合角色模板化治理目标。
- 当前用户管理接口只有待审核、冻结、解冻、重置密码，缺少用户列表、编辑、角色分配、删除。
- 当前 `is_platform_admin` 仍是用户名白名单 bootstrap 机制，不是结构化系统角色字段。

***

## 决策日志

| 日期         | 决策                          | 理由                      |
| ---------- | --------------------------- | ----------------------- |
| 2026-04-12 | 引入角色标签、角色权限、用户角色关联三张新表      | 最小代价实现“按角色授权 + 按账户分配角色” |
| 2026-04-12 | 保留现有用户直授权限模型并在权限检查时与角色权限做并集 | 保持兼容，避免一次性破坏现有权限能力      |
| 2026-04-12 | 用户管理页面拆成“用户审批 / 用户清单管理”两块   | 与管理动作类型一致，降低页面认知负担      |

***

## 验证证据

- 后端测试：
  - `& '.\.venv\Scripts\python.exe' -m pytest backend/test/test_admin_users_api.py backend/test/test_admin_permissions_api.py backend/test/test_permissions.py`
  - 结果：29 passed
  - `& '.\.venv\Scripts\python.exe' -m pytest backend/test/test_admin_users_api.py -q`
  - 结果：15 passed
- 前端测试：
  - `Set-Location frontend; npm run test:foundation`
  - 结果：通过
- 前端构建：
  - `Set-Location frontend; npm run build`
  - 结果：通过
- 底座 smoke：
  - `& '.\.venv\Scripts\python.exe' backend/scripts/run_foundation_smoke.py`
  - `& '.\.venv\Scripts\python.exe' -m pytest backend/test/test_customer_audit_issue_task_api.py backend/test/test_audit_nc_problem_category_api.py backend/test/test_problem_management_api.py`
  - 结果：67 passed
- 契约补充：
  - `backend/test/test_foundation_milestone_api.py::test_permission_matrix_contract_and_mutations`
  - 已同步改为角色标签矩阵口径

***

## 回退思路

- 如角色标签模型上线后出现问题，可先保留用户直授权限通路，前端回退到旧权限矩阵页面；数据库新增表不会破坏现有用户和权限数据。

***

## 完成回顾

- 做对了什么：把“角色标签统一授权 + 账户分配角色”完整落到了模型、接口、页面、测试和文档，且保留了用户直连授权的兼容路径。
- 还缺什么：`sys.business_admin` 仍未独立建模；操作日志、任务监控、通知规则、系统配置仍待后续继续闭环。
- 下次应提前规避什么：系统级契约改造后，要同步检查 foundation smoke 和需求面板口径，避免最后阶段再补测试漂移。

***

## 完成检查清单

- [x] 页面或接口具备真实闭环，不只是骨架存在
- [x] 权限、状态流转、环境差异已确认
- [x] 自动化验证已补齐或明确说明缺口
- [x] 需求面板 / 文档已同步
- [x] 如果任务升级了需求或设计，相关 `.kiro` 源文档已同步
- [x] 最终说明包含结果、验证、剩余风险

***

## Task: Subpage Layout Compaction And Surface Cleanup (2026-04-12)

- Goal:
  - remove the extra blank band left after moving subpage titles into the top bar
  - collapse redundant outer padding and shell borders on titled subpages
  - keep actions inside the single business surface when a page only has one main card
- Non-goals:
  - no API or data-contract changes
  - no redesign of business tables or workflows
- Planned verification:
  - `Set-Location frontend; npm run test:foundation`
  - `Set-Location frontend; npm run build`
- Risks / rollback:
  - the global stage compaction may affect legacy pages with custom spacing
  - rollback point is `frontend/src/layouts/MainLayout.vue`, `frontend/src/style.css`, and the affected admin views

## Task: Admin User Creation Entry And Bulk Provisioning (2026-04-13)

- Goal:
  - add a clear `创建用户` action in the user directory header
  - support single-user creation for internal and supplier accounts
  - support bulk user creation from pasted multi-line text with shared batch rules
  - return temporary passwords / creation results so admins can complete handoff immediately
- Non-goals:
  - no redesign of registration workflow
  - no organization tree / department master-data refactor
  - no supplier lifecycle changes beyond resolving an existing supplier when creating supplier users
- Planned verification:
  - `Set-Location backend; & '..\.venv\Scripts\python.exe' -m pytest test\test_admin_users_api.py`
  - `Set-Location frontend; npm run test:foundation`
  - `Set-Location frontend; npm run build`
- Risks / rollback:
  - batch parsing may reject malformed rows unexpectedly if validation messaging is unclear
  - supplier account creation depends on existing supplier master data
  - rollback point is `backend/app/api/v1/admin/users.py`, `backend/app/schemas/admin.py`, `frontend/src/views/admin/UserApproval.vue`, and related API/type files

## Task: Registration Policy Tightening And Supplier Master Planning (2026-04-15)

- Goal:
  - contract public registration to internal employees only
  - remove supplier self-registration and shift supplier account provisioning fully into admin user management
  - introduce supplier master-data maintenance planning so supplier accounts are created against a governed supplier directory
  - align registration policy, supplier master data, and supplier-account linkage into one closed design
- Non-goals:
  - no immediate implementation of full supplier-quality business workflows
  - no one-shot refactor of all existing supplier-related modules
  - no physical deletion strategy for supplier master records in this phase
- Planned sequence:
  - Phase 1: remove supplier self-registration from public register flow and contract `/auth/register` to internal-only
  - Phase 2: add internal registration gate for corporate email suffix with non-revealing validation messaging
  - Phase 3: design and land a minimal admin-only supplier master module with `supplier_code` and `supplier_name` as the primary reference pair
  - Phase 4: adapt admin supplier-account creation to depend on supplier master records and inherited supplier attributes
- Planned verification:
  - `Set-Location backend; & '..\.venv\Scripts\python.exe' -m pytest test\test_auth_api.py test\test_admin_users_api.py`
  - `Set-Location frontend; npm run test -- src/views/test/login.spec.ts src/views/test/register.spec.ts`
  - `Set-Location frontend; npm run test:foundation`
  - `Set-Location frontend; npm run build`
- Risks / rollback:
  - public registration policy changes require synchronized updates across frontend, backend schema, and source requirements docs
  - supplier master maintenance is shared reference data and may affect downstream modules that already rely on `supplier_id`
  - rollback point is `frontend/src/views/Register.vue`, `backend/app/api/v1/auth.py`, `backend/app/schemas/user.py`, plus the future supplier-master admin surfaces

- Status:
  - completed on 2026-04-18
- Delivered:

## Task: Cross-Module Problem Management Unification (2026-04-20)

- Goal:
  - 梳理供应商质量、制程质量、客户质量、新品质量、审核管理五个板块的问题管理共性与差异
  - 在现有权限、待办、通知和供应商数据隔离底座上，设计一套可渐进落地的统一问题管理抽象
  - 优先收敛第一批最小闭环，为后续编码阶段确定主表/子表、状态机、角色权限和页面/API 顺序
- Non-goals:
  - 本轮不一次性重构所有现有业务表到统一模型
  - 本轮不追求把通知中心、全局任务监控、操作日志全部做成完全体
  - 本轮不直接覆盖供应商绩效、PPAP、索赔、变更等非问题主链路能力
- Planned sequence:
  - Phase 1: 盘点现有问题类模型、页面、接口、权限与待办基础，识别真实可复用部分和契约漂移
  - Phase 2: 定义统一问题主模型边界，明确共性字段、状态、动作、附件、应答、SLA、待办、通知抽象
  - Phase 3: 定义模块差异扩展层，区分供应商SCAR/8D、制程问题、客诉8D、试产问题、审核NC/客户审核问题
  - Phase 4: 锁定第一批最小闭环并按后端模型/API、权限范围、前端列表/详情/应答页顺序实施
- Planned verification:
  - `& '.\\.venv\\Scripts\\python.exe' -m pytest backend/test/test_scar_api.py backend/test/test_process_quality_module.py backend/test/test_customer_quality_comprehensive.py backend/test/test_new_product_comprehensive.py backend/test/test_audit_management_module.py`
  - `& '.\\.venv\\Scripts\\python.exe' -m pytest backend/test/test_permissions.py backend/test/test_notifications.py backend/test/test_task_aggregator.py`
  - `Set-Location frontend; npm run test:foundation`
  - `Set-Location frontend; npm run build`
- Risks / rollback:
  - 现有多个模块已存在各自问题单模型、状态值和前端文案，统一抽象时容易引入契约不兼容
  - 当前任务聚合、通知发送、权限校验在业务模块内落地深度不一致，不能假设已有底座已天然可复用
  - 若统一主模型改造跨度过大，应回退为“统一问题中心 + 模块扩展子表”的渐进方案，避免一次性替换全部现有表
- Status:
  - completed
  - implemented formal `problem_reports` / `problem_report_sources`, `ZXQ-*` / `ZX8D-*` numbering, risk/response filters, and duplicate suppression in the unified problem center
  - connected customer complaint brief/8D mapping, process defect `PD-*` + process issue `ZXQ-PQ*`, new-product defect `NPD-*` + `ZXQ/ZX8D-DQ*`, trial issue 8D escalation, and customer-audit issue task `AQ3`
  - frontend problem center now displays formal follow-up numbers, 8D numbers, risk tags, and filters by risk / response mode
  - verification passed:
    - `& '.\.venv\Scripts\python.exe' -m pytest backend/test/test_problem_management.py backend/test/test_problem_management_api.py`
    - `Set-Location backend; & '..\.venv\Scripts\python.exe' -m alembic upgrade head`
    - `Set-Location frontend; npm run test -- src/utils/test/problemIssueSummary.spec.ts`
    - `Set-Location frontend; npm run test:foundation`
    - `Set-Location frontend; npm run build`
- Notes:
  - 分析阶段先输出现状梳理、统一设计建议、角色权限矩阵和最小闭环范围；讨论确认后再进入代码落地。
  - 问题回复形式增加分级：简单/单点问题可走“问题简报”，复杂/重大问题走“8D报告”；发起时可选择，跟进责任人和管理角色可在流程中即时调整，并保留切换审计轨迹。
  - 问题主单号需要按问题分类编码，编码结构参考既定 8D 报告规则；统一编号生成器需支持主问题单号与 8D 报告号分离，并共享分类码、子类码、年月和流水规则。
  - 编号格式定稿：分类码与子类码拼成一个分段，不额外增加连接符；示例：`ZXQ-CQ1-2604-003`、`ZX8D-AQ3-2604-001`。
  - 分类码定稿：
    - `CQ`: `0`=0km，`1`=售后
    - `PQ`: `0`=PCBA段，`1`=组装测试段
    - `IQ`: `0`=结构料，`1`=电子料
    - `DQ`: `0`=厂内试产/调试问题，`1`=客诉问题
  - `AQ`: `0`=体系审核NC，`1`=过程审核NC，`2`=产品审核NC，`3`=客户审核问题
  - 实现假设：`CQ` 默认承载量产后客户质量问题；`DQ-1` 作为量产前/新品阶段来自客户侧的问题编码，后续在主表通过来源类型与业务模块进一步区分。
  - 已补后端共享能力：`backend/app/core/problem_management.py`、`backend/app/api/v1/problem_management.py`、`backend/app/schemas/problem_management.py`，对外提供统一分类字典、回复形式、处理分级和编号规则元数据接口。
  - 已补前端共享接入层：`frontend/src/types/problem-management.ts`、`frontend/src/api/problem-management.ts`、`frontend/src/stores/problemManagement.ts`，并在登录/刷新用户信息后预加载共享字典，避免后续问题页继续散落硬编码。
  - 已完成第一批页面接入：客户客诉列表页与新建表单改为复用统一分类字典，通过 `CQ0/CQ1` 映射驱动筛选项、标签文案和表单选项，不再在页面内重复硬编码 `0km/售后` 文案。
  - 已完成审核 NC 首轮收口：前端 `audit` API 改为对齐后端 `/api/v1/audit-nc` 路径，`AuditNCList` 改为兼容后端 `open/assigned/submitted/verified/rejected/closed` 状态口径，并保留对旧 `pending/responded` 值的兼容映射，避免页面动作按钮和状态标签失真。
  - public registration was contracted to internal employees only
  - supplier self-registration and public supplier search were removed
  - internal registration now enforces the corporate email policy with outward-generic validation messaging
  - supplier login now depends on an existing active supplier master record
  - system management now includes supplier master maintenance with list/search/create/bulk-edit/status controls
  - admin supplier-account creation and batch creation now resolve against supplier master data only
  - 已补审核 NC 后端分类增强：`AuditNCDetail` / 列表接口现在会基于 `AuditPlan.audit_type` 返回 `audit_type`、`problem_category_key`、`problem_category_label`，把审核类问题直接挂到统一 `AQ0-AQ3` 分类字典上，先为后续前端展示和统一问题中心聚合打底。
  - 已完成审核 NC 分类前端接入：`AuditNCList` 新增“问题分类”列与筛选项，直接复用统一问题字典；后端 `/api/v1/audit-nc` 同步支持 `problem_category_key` 查询参数，形成“字典 -> 接口 -> 页面”的最小闭环。
- Notes:
  - customer-audit issue-task create/list APIs now adapt the shared `AuditNC` model into the customer-audit response shape and return unified `AQ3` category metadata
  - customer-audit issue-task creation on the frontend now uses the real `customer-audits/{audit_id}/issue-tasks` contract and the dialog shows the shared `AQ3` category label from problem-management catalog data
  - fixed the historical runtime failure where `AuditLogService` tried to write a non-existent `OperationLog.description` field; the current minimal fix restores the flow but still does not persist operation descriptions separately
- Documentation synced:
  - `.kiro/steering/product.md`
  - `.kiro/specs/qms-foundation-and-auth/requirements.md`
  - `.kiro/specs/qms-foundation-and-auth/design.md`
  - `doc/QMS_ROLE_FUNCTION_MAPPING.md`
  - `frontend/src/features/requirements-panel/catalog.ts`
- Verification evidence:
  - `& '.\.venv\Scripts\python.exe' -m pytest backend/test/test_problem_management.py backend/test/test_problem_management_api.py`
  - `Set-Location frontend; npm run test -- src/stores/test/problemManagement.spec.ts src/stores/test/auth.spec.ts`
  - `Set-Location frontend; npm run test -- src/utils/test/problemManagement.spec.ts src/stores/test/problemManagement.spec.ts src/stores/test/auth.spec.ts`
  - `Set-Location frontend; npm run test -- src/utils/test/auditNc.spec.ts src/utils/test/problemManagement.spec.ts src/stores/test/problemManagement.spec.ts src/stores/test/auth.spec.ts`
  - `Set-Location frontend; npm run test -- src/utils/test/auditNc.spec.ts src/stores/test/problemManagement.spec.ts src/stores/test/auth.spec.ts`
  - `Set-Location frontend; npm run build`
  - `& '.\.venv\Scripts\python.exe' -m pytest backend/test/test_audit_nc_problem_category_api.py backend/test/test_problem_management_api.py`
  - `Set-Location frontend; npm run test:foundation`
  - `& '.\.venv\Scripts\python.exe' -m pytest backend/test/test_user_registration.py backend/test/test_login.py backend/test/test_admin_suppliers_api.py backend/test/test_admin_users_api.py backend/test/test_foundation_milestone_api.py backend/test/test_profile_api.py`
  - `& '.\.venv\Scripts\python.exe' backend/scripts/run_foundation_smoke.py`
- Residual notes:
  - backend still emits existing `datetime.utcnow()` / Pydantic deprecation warnings during test runs
  - frontend build still emits the existing Sass legacy API and large chunk warnings
  - customer-quality planning has now been expanded to treat complaint intake as a source ledger, split physical disposition from physical analysis, and defer formal issue / 8D launch until customer-quality roles decide to escalate one or more complaint records
  - customer master maintenance is now available in system management and customer complaint intake can consume that master list directly
  - customer complaint ledger now records customer master reference, customer snapshot, end customer, return flag, and physical-analysis flag
  - customer complaints that do not require physical analysis now support in-list physical disposition filing, with `pending / in_progress / completed` status, plan/notes recording, and close-on-completion behavior
  - customer complaints that require physical analysis now support in-list task dispatch and update, with responsible department/user assignment, failed-part tracking, one-time cause summary capture, and `pending / assigned / completed` status progression
  - customer complaint list now supports single-record 8D launch, shows 8D status, and routes directly into the customer 8D page by complaint id
  - the legacy customer 8D page is now contract-aligned with the current backend status values and uses a frontend adapter layer to translate the old flat form shape into the backend D4-D7 / D8 payload structure
  - the customer 8D page now exposes an empty-state “发起 8D” entry when the complaint already满足前置条件, auto-prefills D4-D7 / D8 forms from normalized data, and jumps to the most relevant tab based on the current 8D status
  - the customer 8D page now shows a lightweight report summary with current status, approval level, submit/review timestamps, review comments, and next-step hints so users can read the current closing posture without re-parsing each tab
  - the customer 8D page now consumes the existing backend archive and SLA endpoints: approved reports can be archived/closed directly from the page, and the summary card now shows remaining SLA days / overdue state
  - customer complaints now have a read-only detail page that consolidates ledger data, physical disposition / analysis status, 8D progress, and next-step hints; the list “查看” entry routes into that page and can continue to launch/view 8D from there
  - the customer complaint detail page now reuses the existing physical disposition / analysis dialogs, so complaint handlers can continue updating实物处理和实物解析而不必回到列表页
  - process-quality issue list/detail now align to the backend workflow states (`open / in_analysis / in_verification / closed / cancelled`) through a shared frontend helper, so filtering, tags, action buttons, and status counts no longer rely on the old `in_progress / verifying` aliases
  - process-quality issue detail now opens the response dialog correctly when routed with `?action=respond`, and same-component issue switches reset temporary form state before reloading the next record
  - latest verification for this increment:
    - `& '.\.venv\Scripts\python.exe' -m pytest backend/test/test_customer_complaint_simple.py backend/test/test_customer_complaint_module.py backend/test/test_customer_complaint_api.py backend/test/test_admin_customers_api.py`
    - `Set-Location frontend; npm run test -- src/utils/test/customerEightD.spec.ts src/utils/test/customerComplaint.spec.ts src/utils/test/problemManagement.spec.ts`
    - `Set-Location frontend; npm run build`

  - customer 8D backend now supports aggregate initialization from multiple complaint ledger records through `/api/v1/customer-complaints/8d/init`, with a dedicated complaint-link table that keeps the old single-record route compatible
  - aggregate 8D initialization currently enforces same customer + same complaint-type scope, supports an explicit primary complaint anchor, and makes secondary complaints resolve the same 8D status/report id in complaint detail APIs
  - customer 8D service updates now fan out status changes across all linked complaints for D4-D7 submission, rejection, and archive-closing, which keeps the multi-complaint ledger view internally consistent before the batch frontend entry is added
  - customer complaint list now supports table-selection based batch 8D launch, reuses the shared batch eligibility rules on the frontend, and routes into the existing customer 8D page using the backend-returned primary complaint anchor
  - customer 8D page now shows the full related complaint scope after batch launch, including a summary sentence plus linked complaint rows with primary/current markers and complaint-type labels, so handlers can confirm the aggregation range without returning to the ledger
  - customer 8D now supports minimal in-page scope maintenance: while the report is still in `D4-D7` progress, handlers can append additional same-customer/same-type complaint records and remove non-primary non-current complaints from the aggregation scope without leaving the report page
  - customer complaint detail now pulls the linked 8D scope when a complaint has already entered 8D tracking, so handlers can review all related complaints and jump across the aggregated scope directly from any single complaint detail page
  - customer 8D now exposes a direct “view complaint” jump for every related complaint in the aggregation scope, and the report overview surfaces the D0-D3 source-complaint range metadata so handlers can confirm provenance without leaving the 8D page
  - customer 8D now supports switching the primary complaint anchor while the report is still in `D4-D7` progress; the backend updates both the primary link and the D0-D3 source metadata, and the frontend exposes a minimal in-page action so later cross-module aggregate issue forms can reuse the same “main record switch” pattern
  - latest verification for this increment:
    - `& '.\.venv\Scripts\python.exe' -m pytest backend/test/test_customer_complaint_api.py backend/test/test_customer_complaint_simple.py backend/test/test_customer_complaint_module.py`
    - `Set-Location frontend; npm run test -- src/utils/test/processIssue.spec.ts src/utils/test/customerComplaint.spec.ts src/utils/test/customerEightD.spec.ts src/utils/test/problemManagement.spec.ts`
    - `Set-Location frontend; npm run build`
  - unified problem center now has a first internal read-only frontend entry at `/quality/problem-center`, consuming the shared `/v1/problem-management/issues` API for the first confirmed modules (`customer_quality` + `audit_management`)
  - the first page slice supports shared filters (module / problem category / unified status / keyword), shows response mode and overdue hints, and routes back to source records so later incoming/process/new-product modules can extend the same shell instead of building separate list scaffolds
  - requirement panel sync:
    - `frontend/src/features/requirements-panel/catalog.ts`: added `dashboard-problem-center` and marked it `doing`
    - `doc/requirements-panel/qms-requirements-data.js`: mirrored the same requirement item for the document-side panel data
  - latest verification for this increment:
    - `& '.\.venv\Scripts\python.exe' -m pytest backend/test/test_problem_management_api.py`
    - `Set-Location frontend; npm run test -- src/utils/test/problemIssueSummary.spec.ts src/utils/test/processIssue.spec.ts src/utils/test/customerComplaint.spec.ts src/utils/test/customerEightD.spec.ts src/utils/test/problemManagement.spec.ts`
    - `Set-Location frontend; npm run build`
  - process-quality issues are now included in the unified problem-center aggregation, so the first shared list slice covers `customer_quality + process_quality + audit_management` instead of stopping at customer/audit only
  - current process-category resolution is a compatibility inference, not a new source-of-truth field: the problem center first inspects related defect `process_id/line_id`, then falls back to issue-number / description keywords to distinguish `PQ0` vs `PQ1` until process issues get a structured stage field
  - the problem-center frontend now supports jumping from `process_issue` summary rows back into `ProcessIssueDetail`, keeping the new process entries actionable instead of read-only dead ends
  - new-product trial issues are now included in the unified problem-center aggregation as the first `DQ0` slice, so the current shared list covers `customer_quality + process_quality + new_product_quality + audit_management`
  - current new-product category resolution is intentionally conservative: existing `TrialIssue` records all map to `DQ0` because the current source model only represents internal trial/debug issues; `DQ1` remains reserved for future customer-sourced new-product problem records
  - the problem-center frontend now supports jumping from `trial_issue` summary rows back into `TrialIssueList`, and the trial-issue page accepts a lightweight `focusId` query so the target issue opens directly in the detail dialog
  - requirement panel sync:
    - `frontend/src/features/requirements-panel/catalog.ts`: updated `dashboard-problem-center` acceptance to include process-quality and new-product coverage
    - `doc/requirements-panel/qms-requirements-data.js`: mirrored the same acceptance update for the document-side panel data
  - latest verification for this increment:
    - `& '.\.venv\Scripts\python.exe' -m pytest backend/test/test_problem_management_api.py backend/test/test_audit_nc_problem_category_api.py backend/test/test_customer_complaint_api.py`
    - `Set-Location frontend; npm run test -- src/utils/test/problemIssueSummary.spec.ts src/utils/test/processIssue.spec.ts src/utils/test/customerComplaint.spec.ts src/utils/test/customerEightD.spec.ts src/utils/test/problemManagement.spec.ts`
    - `Set-Location frontend; npm run build`
  - supplier-quality SCAR summaries are now included in the first unified problem-center slice as `incoming_quality`, so the current shared list covers `supplier_quality + customer_quality + process_quality + new_product_quality + audit_management`
  - current supplier category resolution is intentionally a compatibility inference: the problem center inspects SCAR `material_code` and `defect_description` keywords to distinguish `IQ0` vs `IQ1`, and falls back to `IQ1` until SCAR gains an explicit material-class field
  - the problem-center frontend now supports jumping from `scar` summary rows back to `SCAR` management, and the SCAR list accepts a lightweight `focusId` query so the target record is highlighted and visible without adding a new detail page in this round
  - the unified problem center now supports `only_assigned_to_me`, so internal users can narrow the first-batch cross-module list down to items currently assigned to themselves before a true shared todo engine is wired in
  - the unified problem center now supports `only_created_by_me`, backed by a normalized `created_by_id` in the shared summary model, so internal users can quickly slice back to the problem records they originally raised across all currently connected modules
  - the unified problem center now also supports `only_overdue`, reusing the existing per-module overdue flags to quickly surface overdue audit NC, process issues, SCAR, and trial issues without changing source workflows
  - the unified problem center now supports `only_actionable_to_me`, using the same cross-module quick-action rules as the row-level entry buttons so internal users can narrow the list to items they can handle directly from the shared problem-center surface
  - the problem-center page itself was cleaned up while adding the new filter toggles, so the current list view no longer carries mojibake copy in its title, filters, or action labels
  - the problem-center header now shows lightweight current-page actionable and overdue counts, which makes the page behave more like a shared todo intake surface without introducing a brand-new backend task engine in this round
  - the shared problem-center helper now also provides quick-entry routes and route-query parsing, so other pages can open the problem center directly into `only_actionable_to_me` / `only_overdue` slices without duplicating query-shaping logic
  - workbench now includes a lightweight internal-only problem-center card that reads total/actionable/overdue counts from the existing unified issue-summary API and jumps straight into the corresponding problem-center filtered view
  - the workbench problem-center card now falls back to overdue previews when there are no directly actionable items, so the lightweight entry no longer collapses to an empty state on active but unassigned cross-module follow-up days
  - the workbench problem-center card now also exposes a direct “只看我发起的” entry and falls back to created-by-me previews after actionable/overdue are exhausted, so cross-module follow-up can stay inside the shared problem surface without reopening each source module first
  - the workbench problem-center card now shows a lightweight per-module summary for the current preview slice and can jump straight into the problem center with both the current quick filter and module preset, so the first shared issue入口 starts behaving like a real cross-board traffic router instead of a flat list teaser
  - the unified problem summary API now returns pre-pagination `module_counts`, and the workbench problem-center card prefers those backend counts for its module summary while keeping preview-item counting as a compatibility fallback
  - the problem center page now consumes the same normalized module-count helper as the workbench and shows clickable module distribution chips above the shared list, making backend `module_counts` visible in the main issue surface as well as the entry card
  - SCAR pending-review items now participate in the unified actionable rules: submitted SCAR 8D reports reassign the current handler back to the internal creator for review, and the incoming-quality review route exposes a minimal approve/reject panel from the shared problem center while supplier-side 8D submission remains anchored in the SCAR list
  - while wiring SCAR review, the legacy SCAR service notification calls were aligned with the existing `NotificationHub.send_notification` contract and their links were corrected to the current supplier/internal 8D routes
  - latest verification for this increment:
    - `& '.\.venv\Scripts\python.exe' -m pytest backend/test/test_problem_management_api.py backend/test/test_scar_api.py`
    - `Set-Location frontend; npm run test -- src/utils/test/problemIssueSummary.spec.ts src/utils/test/processIssue.spec.ts src/utils/test/customerComplaint.spec.ts src/utils/test/customerEightD.spec.ts src/utils/test/problemManagement.spec.ts`
    - `Set-Location frontend; npm run build`
  - customer-complaint items in the unified problem summary now carry the `requires_physical_analysis` branch flag, and non-analysis complaints resolve their actionable owner back to the CQE/creator so direct physical-disposition follow-up can appear in shared actionable views instead of disappearing from the cross-module surface
  - the problem-center quick action for customer quality now distinguishes `实物解析` and `实物处理`, routing complaint rows into the matching detail-dialog action (`analysis` vs `disposition`) instead of assuming every customer complaint must go through analysis first
  - latest verification for this increment:
    - `& '.\.venv\Scripts\python.exe' -m pytest backend/test/test_problem_management_api.py backend/test/test_customer_complaint_api.py`
    - `Set-Location frontend; npm run test -- src/utils/test/problemIssueSummary.spec.ts src/utils/test/processIssue.spec.ts src/utils/test/customerComplaint.spec.ts src/utils/test/customerEightD.spec.ts src/utils/test/problemManagement.spec.ts`
    - `Set-Location frontend; npm run build`

  - the unified problem summary now exposes a stage-aware `action_owner_id`, so the problem center can distinguish "record assignee" from "current stage operator" without inventing a new workflow engine
  - second-stage quick actions are now wired into existing source pages instead of a new shell: process issues support `respond / verify / close`, audit NC supports `respond / verify / close`, and trial issues support `solution / close` when opened from the problem center
  - the actionable filter now includes internal second-stage items owned by the current user in their active stage, including audit NC pending review/closure, process issue verification/closure, and trial issue closure
  - latest verification for this increment:
    - `& '.\.venv\Scripts\python.exe' -m pytest backend/test/test_problem_management_api.py`
    - `Set-Location frontend; npm run test -- src/utils/test/problemIssueSummary.spec.ts src/utils/test/processIssue.spec.ts src/utils/test/customerComplaint.spec.ts src/utils/test/customerEightD.spec.ts src/utils/test/problemManagement.spec.ts`
    - `Set-Location frontend; npm run build`
  - self-check follow-up for current problem-management pages:
    - added a shared `/api/v1/problem-management/internal-users` option API so cross-module assignment dialogs no longer have to reuse customer-only endpoints or raw user-id inputs
    - `ProcessIssueList` and `ProcessDefectList` now use a real `ProcessIssueCreateDialog` instead of the stale `ProcessIssueCreate` route reference, closing an actual broken entry in the current base chain
    - `AuditNCList` assignment now uses an internal-user dropdown instead of manual `用户 ID` input, which is a direct UX cleanup for the current audit problem workflow
    - `ProcessIssueDetail`, `TrialIssueList`, and `AuditNCList` dialogs were switched to percentage widths plus max-width caps to reduce mobile/medium-screen overflow and obvious form squeezing
  - duplicate / overlap review conclusion for this pass:
    - `quality/scar` and `supplier/scar` intentionally reuse the same `SCARList.vue` surface for internal vs supplier audiences and should be retained
    - `quality/scar/eight-d/:id?` and `supplier/eight-d/:id?` intentionally reuse the same 8D page with different entry context and should be retained
    - `CustomerClaimList` vs `CustomerComplaintList`, and `SupplierClaimList` vs `SCARList`, are adjacent business pages rather than true duplicates in the current codebase
    - the only confirmed stale page-level gap in this pass was the missing `ProcessIssueCreate` entry path, which has now been replaced by an actual create dialog
  - latest verification for this increment:
    - `& '.\.venv\Scripts\python.exe' -m pytest backend/test/test_problem_management_api.py`
    - `Set-Location frontend; npm run test -- src/utils/test/processIssue.spec.ts src/utils/test/problemIssueSummary.spec.ts`
    - `Set-Location frontend; npm run build`
  - cross-module follow-up for current problem-management usability:
    - extracted a lightweight frontend `internalUsers` utility so shared issue surfaces render internal handler names consistently instead of exposing raw numeric ids
    - the unified problem center now resolves `assigned_to` into `姓名 (username) / 部门` labels when possible, which makes mixed-module queues easier to scan once customer / process / audit items sit together
    - `ProcessIssueDetail` now shows the same internal handler label format as the issue center, aligning process-quality detail pages with the cross-module summary experience
    - `CustomerAuditList` issue-task creation now uses the shared internal-user dropdown instead of manual user-id entry, and both customer-audit dialogs now use responsive widths to reduce obvious medium-screen layout squeezing
    - `AuditNCList` now reuses the same internal-user label formatter as the other problem-management pages, keeping audit-management assignment wording aligned with the unified center
  - latest verification for this increment:
    - `Set-Location frontend; npm run test -- src/utils/test/internalUsers.spec.ts src/utils/test/processIssue.spec.ts src/utils/test/problemIssueSummary.spec.ts`
    - `Set-Location frontend; npm run build`
  - audit-management / customer-audit follow-up:
    - customer-audit issue tasks (`AQ3`) now enter the shared NC workflow as `assigned` when a responsible owner is chosen during creation, instead of falling back to `open` and forcing a redundant second assignment step
    - the unified problem-center audit aggregation now includes customer-audit-derived NC tasks (negative `audit_id` bridge records), resolves them to `AQ3`, carries the customer name back into the shared summary, and exposes them as actionable items for the assigned internal owner
    - this closes a real gap in the current first-batch scope: customer-audit发单 no longer disappears outside the standalone list and can now be filtered through `问题分类=AQ3` plus `只看我可处理`
  - latest verification for this increment:
    - `& '.\.venv\Scripts\python.exe' -m pytest backend/test/test_problem_management_api.py backend/test/test_customer_audit_issue_task_api.py`
  - customer-audit source-page closure:
    - the unified problem summary now carries the parent customer-audit record id for `AQ3` items, so source routing can distinguish “客户审核问题” from normal audit NC
    - `AQ3` items opened from the problem center now land on the customer-audit ledger with the target audit row focused, automatically open the related issue-task dialog, and highlight the originating task
    - the customer-audit ledger was upgraded from a placeholder list into an actionable source surface: it now supports task viewing, route-driven focus, related-task listing, and one-click handoff back into the shared NC handling page
  - latest verification for this increment:
    - `& '.\.venv\Scripts\python.exe' -m pytest backend/test/test_problem_management_api.py backend/test/test_customer_audit_issue_task_api.py`
    - `Set-Location frontend; npm run test -- src/utils/test/problemIssueSummary.spec.ts src/utils/test/internalUsers.spec.ts`
    - `Set-Location frontend; npm run build`
  - AQ3 source-loop polish:
    - `AQ3` source links in the unified problem center now use a distinct customer-audit action label instead of the generic `查看 NC`, reducing ambiguity once customer-audit tasks and normal audit NC items are mixed in the same queue
    - `AQ3` quick actions now carry the parent customer-audit id into `AuditNCList`, so users who enter NC handling directly from the problem center still retain a clean return path back to the originating customer-audit task
    - `AuditNCList` now exposes a lightweight `返回客审任务` entry when the current NC came from customer-audit dispatch, completing the round-trip between source ledger, unified problem center, and NC handling without inventing a new page
  - latest verification for this increment:
    - `Set-Location frontend; npm run test -- src/utils/test/problemIssueSummary.spec.ts src/utils/test/internalUsers.spec.ts`
    - `Set-Location frontend; npm run build`
  - new-product / trial-issue source-loop polish:
    - `TrialIssueList` now treats `focusId` as a first-class route state instead of only an incidental detail lookup, so trial issues opened from the unified problem center are also anchored in the source list itself
    - when the focused issue is outside the current page slice, the source page now fetches and prepends that issue before opening the detail dialog, avoiding the previous “dialog opens but list has no matching row” break in context
    - trial-issue detail viewing now round-trips through route query state, with source-row highlighting and automatic `focusId` cleanup after the dialog closes, keeping the new-product-quality queue aligned with the customer-audit and SCAR source patterns
  - latest verification for this increment:
    - `Set-Location frontend; npm run test -- src/utils/test/problemIssueSummary.spec.ts src/utils/test/internalUsers.spec.ts`
    - `Set-Location frontend; npm run build`
  - SCAR / 8D source-loop and copy cleanup:
    - `SCARList` now passes explicit `sourceRouteName` and `sourceFocusId` into the 8D form, so supplier-side 8D submission no longer depends on browser history to get back to the originating SCAR list row
    - unified problem-center `scar-review-8d` quick actions now carry the same source-return metadata into `ScarEightDReview`, keeping internal review entry and supplier entry on one consistent round-trip contract
    - `EightDForm` now derives a stable return target (`SCARList` or `ScarManagement`) from route context, uses it for the header back button and post-submit redirect, and shows a context-aware page title for supplier fill-in vs internal review
    - `ProblemIssueCenter` copy was normalized for clearer wording around unified issue aggregation and cross-object display, closing the remaining visible text inconsistency in the core issue-center surface
  - latest verification for this increment:
    - `Set-Location frontend; npm run test -- src/utils/test/problemIssueSummary.spec.ts src/utils/test/internalUsers.spec.ts`
    - `Set-Location frontend; npm run build`
  - customer-quality source-loop closure:
    - `CustomerComplaintList` now supports `focusId` anchoring, row highlighting, and focused-record补载, so complaint rows opened from downstream pages can return to a visible source row instead of landing on an unanchored ledger slice
    - unified problem-center customer-complaint source links and quick actions now carry `sourceRouteName=ProblemIssueCenter`, allowing complaint detail actions to return to the problem center explicitly instead of depending on browser history
    - `CustomerComplaintDetail` and `EightDCustomerForm` now exchange explicit source metadata for `台账 -> 详情 -> 8D`, `问题中心 -> 详情`, and `8D -> 关联客诉详情` round-trips, closing the remaining customer-quality navigation gap in the current problem-management scope
    - cleaned visible乱码 in the customer 8D scope-management area (`设为主客诉` / 切换提示语), removing a lingering polish defect in one of the core issue-response pages
  - latest verification for this increment:
    - `Set-Location frontend; npm run test -- src/utils/test/problemIssueSummary.spec.ts src/utils/test/internalUsers.spec.ts`
    - `Set-Location frontend; npm run build`

  - unified 8D workspace follow-up:
    - introduced a shared `EightDWorkspace` shell with in-page tabs, so supplier 8D and customer 8D no longer need to exist as two standalone top-level work surfaces
    - kept existing supplier/customer business pages and APIs as inner panels, while adding old-route compatibility redirects from `EightDForm`, `ScarEightDReview`, and `EightDCustomerForm` into the shared workspace
    - collapsed redundant navigation and workbench quick entries into a single `8D 报告中心` entry, while preserving source-driven opening from SCAR, customer complaints, and the unified problem center
    - added a dedicated `客诉8D` ledger under customer-quality management, backed by a new customer-8D list API and stable `ZX8D-<分类>-<YYMM>-<SEQ>` numbering for newly created customer 8D reports
    - the new ledger now supports report-number / complaint-type / customer / product-type / status / date filters, opens into the shared `EightDWorkspace`, and round-trips back from `EightDCustomerForm` and `CustomerComplaintDetail` with focused-row context
  - latest verification for this increment:
    - `& '.\.venv\Scripts\python.exe' -m pytest backend/test/test_customer_complaint_api.py`
    - `Set-Location backend; $env:PYTHONIOENCODING='utf-8'; & '..\.venv\Scripts\python.exe' scripts/validate_migration.py alembic/versions/2026_04_29_1810-a6b5c4d3e2f1_add_customer_8d_report_number.py`
    - `Set-Location frontend; npm run test -- src/utils/test/problemIssueSummary.spec.ts src/utils/test/internalUsers.spec.ts`
    - `Set-Location frontend; npm run build`

## Task: Permission-Driven Surface Visibility And Supplier Quality Panel Access (2026-04-18)

- Goal:
  - make major sections and subpages disappear from navigation when the current account lacks the corresponding permissions
  - keep route-level blocking as the second line of defense, but move menu / quick-entry visibility to permission-aware rendering
  - allow supplier accounts with the correct role tag to access the quality data panel and only view trend data scoped to their own supplier
- Non-goals:
  - no redesign of the permission matrix UI
  - no expansion into full cross-module supplier self-service analytics beyond the quality data panel
  - no rewrite of the entire workbench information architecture
- Planned implementation:
  - add a current-user permission-tree endpoint under auth APIs
  - let the frontend auth store cache the current user permission tree for local visibility checks
  - refactor sidebar and workbench quick actions to render only accessible major/minor entries
  - unify quality data panel API permission checks to the `quality.data_panel` module and restrict supplier views to self-scoped trend access
- Planned verification:
  - `& '.\.venv\Scripts\python.exe' -m pytest backend/test/test_login.py backend/test/test_admin_permissions_api.py backend/test/test_foundation_milestone_api.py`
  - `Set-Location frontend; npm run test:foundation`
  - `Set-Location frontend; npm run build`
- Risks / rollback:
  - menu visibility may drift from route guarding if permission metadata is duplicated instead of centralized
  - supplier analytics access must not leak peer-supplier rankings or unrelated internal analysis tabs
  - rollback points are `frontend/src/layouts/MainLayout.vue`, `frontend/src/views/Workbench.vue`, `frontend/src/stores/auth.ts`, `frontend/src/router/index.ts`, `frontend/src/views/QualityDashboard.vue`, `backend/app/api/v1/auth.py`, and `backend/app/api/v1/quality_metrics.py`

## Task: Problem Management Formal Report Expansion (2026-05-27)

- Goal:
  - land the confirmed `source ledger -> ZXQ formal problem report -> brief/8D follow-up -> problem center` pattern across customer complaints, process quality, new product quality, and audit management
  - preserve existing source-ledger numbers while adding `ZXQ-<category>-<YYMM>-<SEQ3>` as the formal follow-up number
  - keep customer and supplier 8D chains intact while mapping 8D follow-ups to the formal problem-report layer
- Non-goals:
  - no new approval-engine framework
  - no rewrite of SCAR or customer 8D workspaces
  - no destructive migration or historical migration edits
- Planned implementation:
  - add `problem_reports` and `problem_report_sources`
  - add source numbers for process defects and new-product defect intake where needed
  - create formal reports from problem-management API, customer 8D init, process issue creation, trial issue 8D escalation, and customer-audit issue tasks
  - keep customer complaints as a source ledger: users manually select one or more complaints before launching a formal report, and can later adjust the linked complaint range from the list entry
  - make the unified problem center prefer formal reports and hide duplicated legacy source rows
  - expose risk level, response mode, `ZXQ`, and `ZX8D` fields to frontend summary rows
- Planned verification:
  - `& '.\.venv\Scripts\python.exe' -m pytest backend/test/test_problem_management.py backend/test/test_problem_management_api.py`
  - `Set-Location backend; & '..\.venv\Scripts\python.exe' -m alembic upgrade head`
  - `Set-Location frontend; npm run test:foundation`
  - `Set-Location frontend; npm run build`
- Risks / rollback:
  - duplicated rows can appear if source mappings are incomplete
  - legacy `PQI-*` and `TI-*` source numbers must stay readable while `ZXQ-*` becomes the formal report number
  - rollback points are `backend/app/models/problem_report.py`, `backend/app/services/problem_management_service.py`, the new migration, and the touched source-service integrations
- Status:
  - completed
  - implemented a unified formal problem-report layer with `problem_reports`, `problem_report_sources`, and `new_product_defects`
  - connected customer complaints, customer 8D init, process defects/issues, trial-issue 8D escalation, new-product defect intake, and customer-audit issue tasks to the `ZXQ` / `ZX8D` numbering layer
  - updated the customer complaint list so formal follow-up launch is manually range-selected, linked problem documents are visible from the list, and brief-report source ranges can be adjusted after launch
  - added a new-product defect intake page and surfaced it through route, navigation, and workbench quick actions
  - updated the unified problem center to display formal follow-up numbers, risk level, response mode, and source-ledger references
  - synchronized the requirements catalog and product/requirements documentation for the new first-batch scope
  - verification evidence:
    - `& '.\.venv\Scripts\python.exe' -m pytest backend/test/test_problem_management.py backend/test/test_problem_management_api.py -q --disable-warnings` -> 26 passed
    - customer complaint regression now covers list-level `ZXQ` links and replacement of the linked source range
    - `npm.cmd run test -- src/utils/test/problemIssueSummary.spec.ts` -> 8 passed
    - `npm.cmd run test:foundation` -> 25 passed
    - `npm.cmd run build` -> passed, with existing Sass legacy JS API and chunk-size warnings
    - `alembic upgrade head` -> passed against local PostgreSQL after Docker was started and `localhost` was normalized to `127.0.0.1`; `alembic current` reported `f6a7b8c9d0e1 (head)`
    - PostgreSQL table check confirmed `problem_reports`, `problem_report_sources`, and `new_product_defects`
