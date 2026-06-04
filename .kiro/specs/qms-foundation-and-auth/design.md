# Design Document: QMS Foundation and Authentication

## 文档说明

本设计文档描述质量管理系统（QMS）的**基础架构与认证授权模块**的技术实现方案（对应 product.md 的 2.1-2.3 和 2.12 章节）。

### 文档覆盖范围

**本文档涵盖：**
- 系统基础与门户管理（2.1）
- 个人中心（2.2）
- 系统管理与全局配置（2.3）
- 版本与发布管理（2.12）
- 预留功能接口（2.10-2.11）

**业务模块设计（2.4-2.9）请参考：**
- **详细业务需求与设计**：`.kiro/steering/product.md`
  - 2.4 质量数据面板（IMS 集成、指标计算、AI 诊断）
  - 2.5 供应商质量管理（SCAR/8D、绩效评价、PPAP）
  - 2.6 过程质量管理（生产数据集成、不良品跟踪）
  - 2.7 客户质量管理（客诉管理、8D 闭环、索赔）
  - 2.8 新品质量管理（经验教训、试产管理）
  - 2.9 审核管理（审核计划、数字化检查表）
- **实施任务清单**：`tasks.md` 任务组 9-16

本文档与 product.md 共同构成 QMS 系统的完整技术设计方案。

## Overview

本设计文档描述质量管理系统（QMS）基础架构与认证授权模块的技术实现方案。该模块是整个 QMS 系统的核心底座，采用 **Monorepo + Docker Compose** 架构，实现 **Preview（预览环境）与 Stable（正式环境）双轨并行运行，共享同一 PostgreSQL 数据库底座**。

## 当前第一里程碑实现基线（2026-04）

当前仓库已经落地的底座能力如下：

1. **统一认证闭环**：内部员工与供应商共用统一登录页；前台公共注册入口临时关闭，账号新增优先走后台用户管理/后台创建路径；供应商登录保留验证码；`stable / preview` 由当前域名和后端运行实例决定，登录页不再提供环境选择；`allowed_environments` 成为唯一运行环境准入规则。
2. **稳定会话契约**：登录成功后除 Token 外，统一返回 `user_info`、`environment`、`allowed_environments`、平台管理员标识、头像/签名路径和供应商名称；其中当前 `is_platform_admin` 语义应解释为超级管理员（SuperAdmin）bootstrap 标识。
3. **平台管理员 bootstrap**：系统管理后台入口通过独立平台管理员标识引导，不依赖业务权限矩阵先完成自举。
4. **管理员分层与角色标签基础**：除 SuperAdmin 外，业务管理员（Admin）仍作为后续正式分层目标存在；当前权限治理基础已先通过 `role_tags / role_permissions / user_role_assignments` 三张表落地。
5. **权限矩阵闭环**：管理员后台已落地 `modules + rows` 契约的权限矩阵读取能力，且当前 `rows` 以角色标签为行维度；用户级直连授权保留为兼容通道。
6. **账号治理与个人中心基础**：注册审批、用户清单治理、角色标签分配、冻结/解冻、删除保护、重置密码、资料读取、头像上传、密码修改、电子签名上传已可联调；账户信息自助修改仅开放给平台管理员。
7. **供应商主数据基础**：系统管理下已补充供应商基础信息维护能力，供应商主数据至少包含供应商代码、供应商名称和状态，并作为供应商账号创建与登录校验的唯一绑定来源。
8. **基础工作台**：工作台已具备个人信息卡、环境标识、统一系统设置弹窗、可配置快捷入口、页头待办统计窗、个人待办事项弹窗、底座域待办任务聚合与公告/通知占位区，且待办只展示真实可处理事项。
9. **双环境与功能开关**：`stable / preview` 双环境已纳入正式设计，功能开关按“环境优先，再按 global / whitelist 判定”的规则生效。
10. **当前非阻塞项**：通知中心、公告管理大面板、操作日志总览、系统配置大面板仍属于后续阶段，不构成第一里程碑阻塞。

### 核心设计目标

1. **统一认证入口与环境准入**：支持内部员工（Phase 1: 账号密码，预留 LDAP/AD）和外部供应商（账号密码 + 图形验证码）的统一登录，并返回稳定会话对象；前台公共注册入口临时关闭，账号创建优先由管理员在用户管理/后台创建路径完成；登录目标环境由当前后端运行实例决定。
2. **细粒度权限控制**：基于“功能模块-操作类型”的二维权限矩阵，支持录入/查阅/修改/删除/导出五种操作的独立配置。
3. **平台管理自举与分层**：在权限矩阵完全配置前，通过超级管理员引导机制保障用户管理、权限矩阵、功能开关等后台能力可进入；后续再把日常运维能力下沉给业务管理员角色。
4. **基础工作台优先**：先交付可联调、可验证的工作台基础版，再逐步补齐指标增强块、公告中心和跨业务任务聚合。
5. **双轨发布机制**：通过 Nginx 域名路由分发，实现新功能在预览环境验证后平滑发布到正式环境。
6. **数据库兼容性**：遵循 Alembic 非破坏性迁移原则，确保双轨环境数据一致性。
7. **供应商主数据治理**：在系统管理下维护供应商基础信息，供应商账号必须绑定启用中的供应商主数据，且供应商主数据停用后已绑定账号失去登录资格。
8. **预留扩展接口**：为仪器量具管理、质量成本管理等后续功能保留扩展槽位，但不把预留骨架误判为已交付能力。

## 跨模块问题管理共享底座设计（2026-04 增补）

虽然问题管理的业务设计归属 product.md 的 2.5-2.9 章节，但当前基础设计已明确以下共享底座约束，供后续业务实现复用：

### 统一问题主模型

- 推荐新增统一 `IssueCase` 抽象，用于承接跨模块问题的共享属性：
  - `issue_no`
  - `business_module`
  - `category_code`
  - `subcategory_code`
  - `response_mode`
  - `current_status`
  - `current_assignee_id`
  - `responsible_dept`
  - `supplier_id`
  - `response_due_at`
  - `verify_due_at`
  - `close_due_at`
  - `source_type / source_id`
- 各业务模块仍保留自己的扩展表或扩展结构，不强制使用单一大表承载全部字段。

### 双回复模式

- `response_mode = brief`
  - 用于简单或单点问题，承载问题简报回复。
- `response_mode = eight_d`
  - 用于复杂或重大问题，承载结构化 8D 流程。
- 回复形式允许在流转中切换，但需要写入统一流转日志，保留切换人、切换时间和切换原因。

### 统一编号策略

- 问题主单号格式：`ZXQ-<分类子类>-<YYMM>-<SEQ3>`
  - 示例：`ZXQ-CQ1-2604-003`
- 8D 报告号格式：`ZX8D-<分类子类>-<YYMM>-<SEQ3>`
  - 示例：`ZX8D-AQ3-2604-001`
- 已确认分类字典：
  - `CQ0`：0km
  - `CQ1`：售后
  - `PQ0`：PCBA段
  - `PQ1`：组装测试段
  - `IQ0`：结构料
  - `IQ1`：电子料
  - `DQ0`：厂内试产/调试问题
  - `DQ1`：客诉问题
  - `AQ0`：体系审核 NC
  - `AQ1`：过程审核 NC
  - `AQ2`：产品审核 NC
  - `AQ3`：客户审核问题

### 权限与数据范围

- 内部用户默认可查看全量业务问题。
- 外部供应商仅可查看本供应商被分派的问题。
- 具体操作权限由三层共同决定：
  - 模块权限
  - 当前阶段权限
  - 是否为当前责任人 / 审核人 / 升级审批人
- “被分派后可应答”需要作为跨模块复用能力建模，不应简单等价于模块维护权限。

### 待办与通知复用

- 工作台、个人待办、通知中心需要复用统一问题流转事件，而不是由各模块分别生成不一致的卡片结构。
- 统一问题流转事件至少包括：
  - `assign`
  - `submit_response`
  - `reject`
  - `reopen`
  - `escalate`
  - `close`
  - `switch_response_mode`
- 待办卡片展示优先使用 `issue_no`；若当前节点属于 8D 正式处理环节，则同时支持展示 `report_no`。

### 客户质量链路特化设计

- 客户质量建议采用“客诉台账 -> 实物处理 / 实物解析 -> 正式问题单 / 8D”的三层结构，而不是让客诉台账天然等于 8D 主单。
- 客诉台账层建议承载：
  - `complaint_type`（`CQ0` / `CQ1`）
  - `customer_id`
  - `customer_name_snapshot`
  - `end_customer_name`
  - `is_return_involved`
  - `requires_physical_analysis`
  - `physical_disposition_plan`
  - `physical_disposition_status`
- 实物解析层建议独立为子记录或子任务，至少承载：
  - 一次原因分析
  - 责任部门 / 责任人
  - 失效零部件料号
  - 结论与证据附件
- 正式问题单层建议复用统一 `IssueCase`，并通过关联表维护客诉范围，而不是在 8D 表上继续保持“一条客诉只能对应一张 8D”的单向唯一关系。
- 数据关系建议优先按多对多设计：
  - 一个客诉台账可在后续被关联到正式问题单
  - 一个正式问题单可覆盖一条或多条客诉来源
  - 问题范围允许在处理过程中增删客诉明细，但需要保留范围调整日志
- 系统管理建议补充客户主数据治理能力，至少承载 `customer_code`、`customer_name`、状态和基础联络信息；客诉录入优先引用该主数据，终端客户在第一阶段允许文本输入。

### 技术栈选型

- **后端**：Python 3.10+ / FastAPI / SQLAlchemy (Async) / Alembic / Celery + Redis
- **前端**：Vue 3 (Composition API) / Vite / Element Plus / Pinia / Axios / Vitest
- **数据库**：PostgreSQL 15+ / Redis
- **认证**：Python-Jose (JWT) / Passlib (密码哈希) / LDAP3（预留）
- **网关**：Nginx（反向代理 + 双环境域名路由）
- **容器编排**：Docker Compose
- **部署环境**：面向 DMZ 部署设计，当前本地与云上均沿用双环境容器拓扑

## Architecture

### 系统拓扑架构

```mermaid
graph TD
    classDef preview fill:#eef,stroke:#333,stroke-width:2px,stroke-dasharray: 5 5;
    classDef stable fill:#dfd,stroke:#333,stroke-width:2px;
    classDef shared fill:#ffd,stroke:#333,stroke-width:3px;

    Supplier[供应商] --> Nginx
    Staff[内部员工] --> Nginx
    KeyUser[关键用户] --> Nginx

    Nginx[Nginx Gateway]:::shared -->|qms.bigshuaibee.cn| FrontStable[frontend-stable]:::stable
    Nginx -->|qms.bigshuaibee.cn /api| ApiStable[backend-stable]:::stable
    Nginx -->|preview.qms.bigshuaibee.cn| FrontPreview[frontend-preview]:::preview
    Nginx -->|preview.qms.bigshuaibee.cn /api| ApiPreview[backend-preview]:::preview

    ApiStable --> Postgres[(PostgreSQL)]:::shared
    ApiPreview --> Postgres
    ApiStable --> Redis[(Redis)]:::shared
    ApiPreview --> Redis
    Worker[celery-worker]:::shared --> Redis
    Worker --> Postgres
```

### 双轨发布机制

**核心原理**：通过 Nginx 基于域名的路由规则，将请求分发到不同容器实例；`stable` 与 `preview` 共享同一个 PostgreSQL 数据库，但通过环境变量、功能开关和非破坏性迁移维持兼容。

**当前路由规则**：

```nginx
# 正式环境
server {
    listen 80;
    server_name qms.bigshuaibee.cn;

    location / {
        proxy_pass http://frontend-stable:80;
    }

    location /api {
        proxy_pass http://backend-stable:8000;
    }
}

# 预览环境
server {
    listen 80;
    server_name preview.qms.bigshuaibee.cn;

    location / {
        proxy_pass http://frontend-preview:80;
    }

    location /api {
        proxy_pass http://backend-preview:8000;
    }
}
```

**当前 Compose 拓扑**：

- `postgres`
- `redis`
- `backend-stable`
- `frontend-stable`
- `backend-preview`
- `frontend-preview`
- `nginx`
- `celery-worker`

### 功能开关设计要点

- 功能开关实体包含 `feature_key`、`environment`、`scope`、`whitelist_user_ids`、`whitelist_supplier_ids` 等字段。
- 判定规则固定为：
  1. 先校验当前环境是否命中 `environment`
  2. 再根据 `scope=global/whitelist` 判断当前用户或供应商是否可见
- 前端登录态、路由守卫、菜单和工作台增强块都应复用这套判断逻辑。

### 当前已实现 API 面

第一里程碑已稳定的底座接口面如下：

- `POST /api/v1/auth/register`（兼容保留：内部员工注册申请；前台入口临时关闭）
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `GET /api/v1/auth/captcha`
- `GET/PATCH /api/v1/profile`
- `POST /api/v1/profile/avatar`
- `PUT /api/v1/profile/password`
- `POST /api/v1/profile/signature`
- `GET /api/v1/workbench/dashboard`
- `GET /api/v1/admin/users`
- `POST /api/v1/admin/users`
- `POST /api/v1/admin/users/bulk`
- `GET /api/v1/admin/permissions/matrix`
- `GET /api/v1/admin/permissions/roles`
- `POST /api/v1/admin/permissions/roles`
- `PUT /api/v1/admin/permissions/roles/{role_id}`
- `DELETE /api/v1/admin/permissions/roles/{role_id}`
- `PUT /api/v1/admin/permissions/roles/{role_id}/permissions`
- `PUT /api/v1/admin/permissions/grant`
- `PUT /api/v1/admin/permissions/revoke`
- `GET/POST/PUT/DELETE /api/v1/admin/feature-flags`
- `GET /api/v1/admin/users/pending`
- `PATCH /api/v1/admin/users/{user_id}`
- `PUT /api/v1/admin/users/{user_id}/roles`
- `DELETE /api/v1/admin/users/{user_id}`
- `POST /api/v1/admin/users/{user_id}/approve`
- `POST /api/v1/admin/users/{user_id}/reject`
- `POST /api/v1/admin/users/{user_id}/freeze`
- `POST /api/v1/admin/users/{user_id}/unfreeze`
- `POST /api/v1/admin/users/{user_id}/reset-password`
- `GET /api/v1/admin/suppliers`
- `POST /api/v1/admin/suppliers`
- `POST /api/v1/admin/suppliers/bulk`
- `PATCH /api/v1/admin/suppliers/{supplier_id}`
- `POST /api/v1/admin/suppliers/{supplier_id}/status`

其中：
- 用户管理已拆分为“用户审批”与“用户清单管理”两条主流程。
- 前台 `/register` 入口临时重定向至登录页，账号新增优先走后台用户管理 / `POST /api/v1/admin/users` 路径。
- 公共供应商搜索注册接口已收口，供应商账号统一由管理员在用户管理中创建。
- 供应商基础信息已独立为系统管理主数据入口，供应商账号创建、绑定和登录均依赖该主数据状态。
- 权限治理主路径已切换为“角色标签授权 -> 账户分配角色标签”，用户级授权仅保留兼容性补充能力。

### 认证架构设计

> 以下类图与伪代码用于表达组件职责。当前实现以 `auth.py`、`auth_strategy.py` 与 `user_session_service.py` 中的实际代码为准。

采用 **Strategy Pattern（策略模式）** 实现可插拔的认证方式：

```mermaid
classDiagram
    class AuthStrategy {
        <<interface>>
        +authenticate(credentials) User
        +validate_token(token) User
    }
    
    class LocalAuthStrategy {
        +authenticate(username, password) User
        +validate_token(jwt_token) User
        -verify_password(plain, hashed) bool
        -create_access_token(user_id) str
    }
    
    class LDAPAuthStrategy {
        +authenticate(username, password) User
        +validate_token(jwt_token) User
        -ldap_bind(username, password) bool
        -sync_user_from_ldap(ldap_user) User
    }
    
    class AuthService {
        -strategy: AuthStrategy
        +set_strategy(strategy)
        +login(credentials) Token
        +verify_token(token) User
    }
    
    AuthStrategy <|-- LocalAuthStrategy
    AuthStrategy <|-- LDAPAuthStrategy
    AuthService --> AuthStrategy
```

**Phase 1 实现范围**：
- ✅ LocalAuthStrategy（账号密码 + JWT）
- ✅ 供应商验证码校验、密码过期引导、运行环境准入控制
- ⏸️ LDAPAuthStrategy（预留接口，不实现）

**认证流程**：

1. **登录请求** → 前端提交 `{username, password, user_type}`；供应商附带验证码
2. **策略选择** → 后端根据 `user_type` 选择 LocalAuthStrategy
3. **密码验证** → 使用 Passlib 验证密码哈希
4. **环境校验** → 使用后端 `settings.ENVIRONMENT` 与 `allowed_environments` 判断当前运行环境是否可登录
5. **生成 Token** → 使用 Python-Jose 生成 JWT（有效期 24 小时）
6. **返回响应** → `{access_token, token_type, user_info, environment, allowed_environments, password_expired}`


## Components and Interfaces

### 后端核心组件

#### 1. Authentication Module (`app/core/auth.py`)

```python
from abc import ABC, abstractmethod
from typing import Optional
from datetime import datetime, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext

# 策略接口
class AuthStrategy(ABC):
    @abstractmethod
    async def authenticate(self, username: str, password: str) -> Optional[User]:
        pass
    
    @abstractmethod
    def create_access_token(self, user_id: int) -> str:
        pass

# 本地认证策略（Phase 1）
class LocalAuthStrategy(AuthStrategy):
    def __init__(self):
        self.pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
        self.SECRET_KEY = settings.SECRET_KEY
        self.ALGORITHM = "HS256"
        self.ACCESS_TOKEN_EXPIRE_HOURS = 24
    
    async def authenticate(self, username: str, password: str) -> Optional[User]:
        user = await UserRepository.get_by_username(username)
        if not user or not self.verify_password(password, user.hashed_password):
            return None
        return user
    
    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        return self.pwd_context.verify(plain_password, hashed_password)
    
    def create_access_token(self, user_id: int) -> str:
        expire = datetime.utcnow() + timedelta(hours=self.ACCESS_TOKEN_EXPIRE_HOURS)
        to_encode = {"sub": str(user_id), "exp": expire}
        return jwt.encode(to_encode, self.SECRET_KEY, algorithm=self.ALGORITHM)

# LDAP 认证策略（预留）
class LDAPAuthStrategy(AuthStrategy):
    async def authenticate(self, username: str, password: str) -> Optional[User]:
        raise NotImplementedError("LDAP authentication reserved for Phase 2")
    
    def create_access_token(self, user_id: int) -> str:
        # 复用 LocalAuthStrategy 的 JWT 生成逻辑
        pass

# 认证服务
class AuthService:
    def __init__(self, strategy: AuthStrategy):
        self.strategy = strategy
    
    async def login(self, username: str, password: str) -> dict:
        user = await self.strategy.authenticate(username, password)
        if not user:
            raise AuthenticationError("Invalid credentials")
        
        # 检查账号状态
        if user.status != UserStatus.ACTIVE:
            raise AuthenticationError(f"Account is {user.status}")
        
        # 生成 Token
        access_token = self.strategy.create_access_token(user.id)
        
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user_info": user.to_dict()
        }
```


#### 2. Permission Module (`app/core/permissions.py`)

```python
from enum import Enum
from typing import Set

class OperationType(str, Enum):
    CREATE = "create"      # 录入/新建
    READ = "read"          # 查阅
    UPDATE = "update"      # 修改/编辑
    DELETE = "delete"      # 删除
    EXPORT = "export"      # 导出

class PermissionChecker:
    """细粒度权限检查器"""

    @staticmethod
    async def get_user_permissions(user_id: int) -> Set[str]:
        """返回用户生效中的权限集合。

        当前实现会合并两类来源：
        1. 用户直连权限（兼容历史）
        2. 用户已分配且处于启用状态的角色标签权限
        """
        direct_permissions = await PermissionRepository.get_user_permissions(user_id)
        role_permissions = await RolePermissionRepository.get_permissions_by_user_roles(user_id)
        return set(direct_permissions) | set(role_permissions)

    @staticmethod
    async def check_permission(user_id: int, module_path: str, operation: OperationType) -> bool:
        permission_key = f"{module_path}.{operation.value}"
        permissions = await PermissionChecker.get_user_permissions(user_id)
        return permission_key in permissions

    @staticmethod
    async def filter_data_by_supplier(user_id: int, queryset):
        """供应商用户数据过滤"""
        user = await UserRepository.get_by_id(user_id)

        if user.user_type == UserType.SUPPLIER:
            # 仅返回关联到该供应商的数据
            return queryset.filter(supplier_id=user.supplier_id)

        return queryset
```


#### 3. Audit Log Module (`app/services/audit_service.py`)

```python
from typing import Any, Dict, Optional
import json

class AuditService:
    """操作日志审计服务"""
    
    @staticmethod
    async def log_operation(
        user_id: int,
        operation_type: str,  # "create", "update", "delete"
        target_type: str,     # "user", "permission", "config"
        target_id: Optional[int],
        before_data: Optional[Dict[str, Any]] = None,
        after_data: Optional[Dict[str, Any]] = None,
        description: Optional[str] = None
    ):
        """记录操作日志"""
        audit_log = AuditLog(
            user_id=user_id,
            operation_type=operation_type,
            target_type=target_type,
            target_id=target_id,
            before_snapshot=json.dumps(before_data) if before_data else None,
            after_snapshot=json.dumps(after_data) if after_data else None,
            description=description,
            ip_address=get_client_ip(),
            user_agent=get_user_agent(),
            created_at=datetime.utcnow()
        )
        
        await AuditLogRepository.create(audit_log)
    
    @staticmethod
    async def query_logs(
        user_id: Optional[int] = None,
        operation_type: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        page: int = 1,
        page_size: int = 50
    ) -> List[AuditLog]:
        """查询操作日志"""
        return await AuditLogRepository.query(
            user_id=user_id,
            operation_type=operation_type,
            start_date=start_date,
            end_date=end_date,
            page=page,
            page_size=page_size
        )
```


#### 4. Workbench Service (`app/services/workbench_service.py`)

```python
class WorkbenchService:
    """动态工作台服务"""
    
    @staticmethod
    async def get_dashboard_data(user_id: int) -> Dict[str, Any]:
        """获取用户个性化工作台数据"""
        user = await UserRepository.get_by_id(user_id)
        
        if user.user_type == UserType.INTERNAL:
            return await WorkbenchService._get_internal_dashboard(user)
        elif user.user_type == UserType.SUPPLIER:
            return await WorkbenchService._get_supplier_dashboard(user)
    
    @staticmethod
    async def _get_internal_dashboard(user: User) -> Dict[str, Any]:
        """内部员工工作台"""
        # 根据角色获取指标监控
        metrics = await MetricsService.get_metrics_by_role(user.role_id)
        
        # 聚合待办任务
        todos = await TodoService.get_user_todos(user.id)
        
        return {
            "user_info": user.to_dict(),
            "metrics": metrics,
            "todos": todos,
            "notifications": await NotificationService.get_unread_count(user.id)
        }
    
    @staticmethod
    async def _get_supplier_dashboard(user: User) -> Dict[str, Any]:
        """供应商工作台"""
        # 获取绩效等级
        performance = await SupplierPerformanceService.get_current_performance(
            user.supplier_id
        )
        
        # 仅获取需要供应商行动的任务
        todos = await TodoService.get_supplier_action_required(user.supplier_id)
        
        return {
            "user_info": user.to_dict(),
            "performance_status": {
                "grade": performance.grade,  # A/B/C/D
                "score": performance.score,
                "deduction_this_month": performance.deduction_this_month
            },
            "action_required_tasks": todos
        }
```


#### 5. Todo Aggregation Service (`app/services/todo_service.py`)

```python
class TodoService:
    """待办任务聚合服务"""
    
    # 业务表配置：定义哪些表需要聚合待办任务
    BUSINESS_TABLES = [
        {
            "table": "scar_reports",
            "handler_field": "current_handler_id",
            "task_type": "8D报告审核",
            "deadline_field": "deadline",
            "link_pattern": "/supplier/scar/{id}"
        },
        {
            "table": "ppap_submissions",
            "handler_field": "reviewer_id",
            "task_type": "PPAP审批",
            "deadline_field": "review_deadline",
            "link_pattern": "/supplier/ppap/{id}"
        },
        # ... 其他业务表配置
    ]
    
    @staticmethod
    async def get_user_todos(user_id: int) -> List[Dict[str, Any]]:
        """获取用户所有待办任务"""
        todos = []
        
        for config in TodoService.BUSINESS_TABLES:
            # 动态查询各业务表
            query = f"""
                SELECT id, {config['deadline_field']} as deadline
                FROM {config['table']}
                WHERE {config['handler_field']} = :user_id
                AND status != 'closed'
            """
            
            results = await db.execute(query, {"user_id": user_id})
            
            for row in results:
                remaining_hours = (row.deadline - datetime.utcnow()).total_seconds() / 3600
                
                # 计算紧急程度
                if remaining_hours < 0:
                    urgency = "overdue"
                    color = "red"
                elif remaining_hours <= 72:
                    urgency = "urgent"
                    color = "yellow"
                else:
                    urgency = "normal"
                    color = "green"
                
                todos.append({
                    "task_type": config["task_type"],
                    "task_id": row.id,
                    "deadline": row.deadline,
                    "remaining_hours": remaining_hours,
                    "urgency": urgency,
                    "color": color,
                    "link": config["link_pattern"].format(id=row.id)
                })
        
        # 按紧急程度排序
        return sorted(todos, key=lambda x: x["remaining_hours"])
```


#### 6. Notification Service (`app/services/notification_service.py`)

```python
class NotificationService:
    """通知服务"""
    
    @staticmethod
    async def send_notification(
        user_ids: List[int],
        title: str,
        content: str,
        notification_type: str,  # "workflow", "system", "alert"
        link: Optional[str] = None
    ):
        """发送站内信通知"""
        notifications = [
            Notification(
                user_id=user_id,
                title=title,
                content=content,
                type=notification_type,
                link=link,
                is_read=False,
                created_at=datetime.utcnow()
            )
            for user_id in user_ids
        ]
        
        await NotificationRepository.bulk_create(notifications)
        
        # 触发实时推送（WebSocket）
        await WebSocketManager.broadcast_to_users(user_ids, {
            "type": "new_notification",
            "data": {"title": title, "content": content}
        })
    
    @staticmethod
    async def mark_as_read(notification_id: int, user_id: int):
        """标记为已读"""
        notification = await NotificationRepository.get_by_id(notification_id)
        
        if notification.user_id != user_id:
            raise PermissionError("Cannot mark other user's notification")
        
        notification.is_read = True
        notification.read_at = datetime.utcnow()
        await NotificationRepository.update(notification)
    
    @staticmethod
    async def get_unread_count(user_id: int) -> int:
        """获取未读消息数量"""
        return await NotificationRepository.count_unread(user_id)
```


#### 7. Feature Flag Service (`app/services/feature_flag_service.py`)

```python
class FeatureFlagService:
    """功能特性开关服务"""
    
    @staticmethod
    async def is_feature_enabled(
        feature_key: str,
        user_id: Optional[int] = None,
        supplier_id: Optional[int] = None
    ) -> bool:
        """检查功能是否启用"""
        flag = await FeatureFlagRepository.get_by_key(feature_key)
        
        if not flag or not flag.is_enabled:
            return False
        
        # 全局启用
        if flag.scope == "global":
            return True
        
        # 白名单机制
        if flag.scope == "whitelist":
            if user_id and user_id in flag.whitelist_user_ids:
                return True
            if supplier_id and supplier_id in flag.whitelist_supplier_ids:
                return True
            return False
        
        return False
    
    @staticmethod
    async def update_feature_flag(
        feature_key: str,
        is_enabled: bool,
        scope: str = "global",
        whitelist_user_ids: Optional[List[int]] = None,
        whitelist_supplier_ids: Optional[List[int]] = None
    ):
        """更新功能开关配置"""
        flag = await FeatureFlagRepository.get_by_key(feature_key)
        
        if not flag:
            flag = FeatureFlag(feature_key=feature_key)
        
        flag.is_enabled = is_enabled
        flag.scope = scope
        flag.whitelist_user_ids = whitelist_user_ids or []
        flag.whitelist_supplier_ids = whitelist_supplier_ids or []
        flag.updated_at = datetime.utcnow()
        
        await FeatureFlagRepository.save(flag)
```


### 前端核心组件

#### 1. 认证模块 (`frontend/src/stores/auth.ts`)

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi } from '@/api/auth'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem('access_token'))
  const userInfo = ref<User | null>(null)
  
  const isAuthenticated = computed(() => !!token.value)
  const isSupplier = computed(() => userInfo.value?.user_type === 'supplier')
  const isInternal = computed(() => userInfo.value?.user_type === 'internal')
  
  async function login(username: string, password: string, userType: string) {
    const response = await authApi.login({ username, password, user_type: userType })
    
    token.value = response.access_token
    userInfo.value = response.user_info
    
    localStorage.setItem('access_token', response.access_token)
    localStorage.setItem('user_info', JSON.stringify(response.user_info))
  }
  
  function logout() {
    token.value = null
    userInfo.value = null
    localStorage.removeItem('access_token')
    localStorage.removeItem('user_info')
  }
  
  async function checkPermission(modulePath: string, operation: string): Promise<boolean> {
    // 调用后端权限检查 API
    return await authApi.checkPermission(modulePath, operation)
  }
  
  return {
    token,
    userInfo,
    isAuthenticated,
    isSupplier,
    isInternal,
    login,
    logout,
    checkPermission
  }
})
```


#### 2. 登录页面组件 (`frontend/src/views/Login.vue`)

```vue
<template>
  <div class="login-container">
    <!-- 桌面端布局 -->
    <div class="desktop-layout" v-if="!isMobile">
      <el-card class="login-card">
        <h2>质量管理系统</h2>
        
        <!-- 用户类型选择 -->
        <el-radio-group v-model="userType" class="user-type-selector">
          <el-radio-button label="internal">员工登录</el-radio-button>
          <el-radio-button label="supplier">供应商登录</el-radio-button>
        </el-radio-group>
        
        <!-- 登录表单 -->
        <el-form :model="loginForm" :rules="rules" ref="formRef">
          <el-form-item prop="username">
            <el-input v-model="loginForm.username" placeholder="用户名" />
          </el-form-item>
          
          <el-form-item prop="password">
            <el-input 
              v-model="loginForm.password" 
              type="password" 
              placeholder="密码" 
            />
          </el-form-item>
          
          <!-- 供应商登录需要验证码 -->
          <el-form-item v-if="userType === 'supplier'" prop="captcha">
            <div class="captcha-row">
              <el-input v-model="loginForm.captcha" placeholder="验证码" />
              <img :src="captchaUrl" @click="refreshCaptcha" class="captcha-img" />
            </div>
          </el-form-item>
          
          <el-button type="primary" @click="handleLogin" :loading="loading">
            登录
          </el-button>
          
          <!-- 预留 SSO 登录按钮（Phase 2） -->
          <el-button v-if="userType === 'internal'" disabled>
            SSO 单点登录（即将上线）
          </el-button>
        </el-form>
      </el-card>
    </div>
    
    <!-- 移动端布局（Tailwind CSS） -->
    <div class="mobile-layout" v-else>
      <div class="flex flex-col items-center justify-center min-h-screen p-4">
        <h2 class="text-2xl font-bold mb-6">质量管理系统</h2>
        <!-- 移动端表单 -->
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'

const authStore = useAuthStore()
const router = useRouter()

const isMobile = computed(() => window.innerWidth < 768)
const userType = ref('internal')
const loginForm = ref({ username: '', password: '', captcha: '' })
const loading = ref(false)

async function handleLogin() {
  loading.value = true
  try {
    await authStore.login(
      loginForm.value.username,
      loginForm.value.password,
      userType.value
    )
    router.push('/workbench')
  } catch (error) {
    ElMessage.error('登录失败：' + error.message)
  } finally {
    loading.value = false
  }
}
</script>
```


#### 3. 动态工作台组件 (`frontend/src/views/Workbench.vue`)

```vue
<template>
  <div class="workbench-container">
    <!-- 内部员工视图 -->
    <div v-if="authStore.isInternal" class="internal-workbench">
      <!-- 指标全景监控 -->
      <el-row :gutter="20">
        <el-col :span="6" v-for="metric in dashboardData.metrics" :key="metric.key">
          <el-card>
            <div class="metric-card">
              <h3>{{ metric.name }}</h3>
              <div class="metric-value" :class="metric.status">
                {{ metric.value }}
              </div>
              <el-progress 
                :percentage="metric.achievement" 
                :status="metric.status === 'good' ? 'success' : 'exception'"
              />
            </div>
          </el-card>
        </el-col>
      </el-row>
      
      <!-- 待办任务聚合 -->
      <el-card class="todo-section">
        <template #header>
          <span>待办任务 ({{ dashboardData.todos.length }})</span>
        </template>
        
        <el-table :data="dashboardData.todos">
          <el-table-column prop="task_type" label="任务类型" />
          <el-table-column prop="task_id" label="单据编号" />
          <el-table-column label="剩余时间">
            <template #default="{ row }">
              <el-tag :type="row.color">
                {{ formatRemainingTime(row.remaining_hours) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作">
            <template #default="{ row }">
              <el-button type="primary" size="small" @click="goToTask(row.link)">
                处理
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>
    
    <!-- 供应商视图 -->
    <div v-else-if="authStore.isSupplier" class="supplier-workbench">
      <!-- 绩效红绿灯 -->
      <el-card class="performance-card">
        <div class="performance-status">
          <div class="grade-badge" :class="'grade-' + dashboardData.performance_status.grade">
            {{ dashboardData.performance_status.grade }}
          </div>
          <div class="score-info">
            <p>当前得分: {{ dashboardData.performance_status.score }}</p>
            <p class="deduction">本月扣分: {{ dashboardData.performance_status.deduction_this_month }}</p>
          </div>
        </div>
      </el-card>
      
      <!-- 需要行动的任务 -->
      <el-card class="action-required">
        <template #header>
          <span>待处理任务</span>
        </template>
        
        <div v-for="task in dashboardData.action_required_tasks" :key="task.id" class="task-item">
          <el-alert :title="task.title" :type="task.urgency" show-icon>
            <template #default>
              <p>{{ task.description }}</p>
              <el-button type="primary" size="small" @click="goToTask(task.link)">
                立即处理
              </el-button>
            </template>
          </el-alert>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { workbenchApi } from '@/api/workbench'

const authStore = useAuthStore()
const dashboardData = ref({})

onMounted(async () => {
  dashboardData.value = await workbenchApi.getDashboardData()
})
</script>
```


## Data Models

### 核心数据表设计

#### 1. User（用户表）

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    user_type VARCHAR(20) NOT NULL,  -- 'internal' or 'supplier'
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending', 'active', 'frozen', 'rejected'
    
    -- 内部员工字段
    department VARCHAR(100),
    position VARCHAR(100),
    
    -- 供应商字段
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,

    -- 展示与环境字段
    avatar_image_path VARCHAR(255),
    allowed_environments VARCHAR(50) NOT NULL DEFAULT 'stable',
    digital_signature VARCHAR(255),
    
    -- 安全字段
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP,
    password_changed_at TIMESTAMP,
    last_login_at TIMESTAMP,

    -- 审计字段
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    updated_by INTEGER,
    
    CONSTRAINT check_user_type CHECK (user_type IN ('internal', 'supplier'))
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_supplier_id ON users(supplier_id);
CREATE INDEX idx_users_status ON users(status);
```

> 当前实现不在 `users` 表中直接保存固定角色字段，而是通过角色标签关系表维护一个账户可绑定多个角色标签。


#### 2. Permission（权限表）

```sql
CREATE TABLE permissions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module_path VARCHAR(255) NOT NULL,  -- 例如: "supplier.performance.monthly_score"
    operation_type VARCHAR(20) NOT NULL,  -- 'create', 'read', 'update', 'delete', 'export'
    is_granted BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    
    CONSTRAINT check_operation_type CHECK (
        operation_type IN ('create', 'read', 'update', 'delete', 'export')
    ),
    UNIQUE(user_id, module_path, operation_type)
);

CREATE INDEX idx_permissions_user_id ON permissions(user_id);
CREATE INDEX idx_permissions_module_path ON permissions(module_path);
```

#### 3. RoleTag（角色标签表）

```sql
CREATE TABLE role_tags (
    id SERIAL PRIMARY KEY,
    role_key VARCHAR(100) UNIQUE NOT NULL,
    role_name VARCHAR(100) NOT NULL,
    description VARCHAR(255),
    applicable_user_type VARCHAR(20),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    updated_by INTEGER
);

CREATE INDEX idx_role_tags_role_key ON role_tags(role_key);
CREATE INDEX idx_role_tags_user_type ON role_tags(applicable_user_type);
CREATE INDEX idx_role_tags_is_active ON role_tags(is_active);
```

#### 4. RolePermission（角色标签权限表）

```sql
CREATE TABLE role_permissions (
    id SERIAL PRIMARY KEY,
    role_tag_id INTEGER NOT NULL REFERENCES role_tags(id) ON DELETE CASCADE,
    module_path VARCHAR(255) NOT NULL,
    operation_type VARCHAR(20) NOT NULL,
    is_granted BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    updated_by INTEGER,

    CONSTRAINT check_role_permission_operation_type CHECK (
        operation_type IN ('create', 'read', 'update', 'delete', 'export')
    ),
    UNIQUE(role_tag_id, module_path, operation_type)
);

CREATE INDEX idx_role_permissions_role_tag_id ON role_permissions(role_tag_id);
CREATE INDEX idx_role_permissions_module_path ON role_permissions(module_path);
```

#### 5. UserRoleAssignment（用户角色分配表）

```sql
CREATE TABLE user_role_assignments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_tag_id INTEGER NOT NULL REFERENCES role_tags(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    assigned_by INTEGER,

    UNIQUE(user_id, role_tag_id)
);

CREATE INDEX idx_user_role_assignments_user_id ON user_role_assignments(user_id);
CREATE INDEX idx_user_role_assignments_role_tag_id ON user_role_assignments(role_tag_id);
```

#### 6. AuditLog（操作日志表）

```sql
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    operation_type VARCHAR(50) NOT NULL,  -- 'create', 'update', 'delete', 'login', 'logout'
    target_type VARCHAR(100) NOT NULL,    -- 'user', 'permission', 'config', 'scar', etc.
    target_id INTEGER,
    before_snapshot JSONB,
    after_snapshot JSONB,
    description TEXT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT check_operation_type CHECK (
        operation_type IN ('create', 'update', 'delete', 'login', 'logout', 'export', 'approve', 'reject')
    )
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_target_type ON audit_logs(target_type);
```


#### 4. Notification（通知表）

```sql
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    type VARCHAR(50) NOT NULL,  -- 'workflow', 'system', 'alert'
    link VARCHAR(500),
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT check_notification_type CHECK (
        type IN ('workflow', 'system', 'alert')
    )
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);
```

#### 5. Announcement（公告表）

```sql
CREATE TABLE announcements (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    type VARCHAR(50) NOT NULL,  -- 'system', 'quality_alert', 'document_update'
    importance VARCHAR(20) NOT NULL DEFAULT 'normal',  -- 'normal', 'important'
    is_published BOOLEAN DEFAULT FALSE,
    published_at TIMESTAMP,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT check_announcement_type CHECK (
        type IN ('system', 'quality_alert', 'document_update')
    ),
    CONSTRAINT check_importance CHECK (
        importance IN ('normal', 'important')
    )
);

CREATE INDEX idx_announcements_published_at ON announcements(published_at);
CREATE INDEX idx_announcements_importance ON announcements(importance);
```


#### 6. AnnouncementReadLog（公告阅读记录表）

```sql
CREATE TABLE announcement_read_logs (
    id SERIAL PRIMARY KEY,
    announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(announcement_id, user_id)
);

CREATE INDEX idx_announcement_read_logs_announcement_id ON announcement_read_logs(announcement_id);
CREATE INDEX idx_announcement_read_logs_user_id ON announcement_read_logs(user_id);
```

#### 7. FeatureFlag（功能特性开关表）

```sql
CREATE TABLE feature_flags (
    id SERIAL PRIMARY KEY,
    feature_key VARCHAR(100) UNIQUE NOT NULL,
    feature_name VARCHAR(255) NOT NULL,
    description TEXT,
    is_enabled BOOLEAN DEFAULT FALSE,
    scope VARCHAR(20) NOT NULL DEFAULT 'global',  -- 'global', 'whitelist'
    whitelist_user_ids INTEGER[],
    whitelist_supplier_ids INTEGER[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(id),
    
    CONSTRAINT check_scope CHECK (
        scope IN ('global', 'whitelist')
    )
);

CREATE INDEX idx_feature_flags_feature_key ON feature_flags(feature_key);
CREATE INDEX idx_feature_flags_is_enabled ON feature_flags(is_enabled);
```


#### 8. SystemConfig（系统配置表）

```sql
CREATE TABLE system_configs (
    id SERIAL PRIMARY KEY,
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value TEXT NOT NULL,
    value_type VARCHAR(20) NOT NULL,  -- 'string', 'integer', 'boolean', 'json'
    description TEXT,
    is_editable BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(id),
    
    CONSTRAINT check_value_type CHECK (
        value_type IN ('string', 'integer', 'boolean', 'json')
    )
);

CREATE INDEX idx_system_configs_config_key ON system_configs(config_key);

-- 预设配置项
INSERT INTO system_configs (config_key, config_value, value_type, description, is_editable) VALUES
('password_min_length', '8', 'integer', '密码最小长度', TRUE),
('password_expire_days', '90', 'integer', '密码过期天数', TRUE),
('login_max_attempts', '5', 'integer', '最大登录尝试次数', TRUE),
('login_lock_minutes', '30', 'integer', '账号锁定时长（分钟）', TRUE),
('jwt_expire_hours', '24', 'integer', 'JWT Token 有效期（小时）', TRUE),
('todo_urgent_threshold_hours', '72', 'integer', '待办任务紧急阈值（小时）', TRUE);
```


#### 9. NotificationRule（通知规则表）

```sql
CREATE TABLE notification_rules (
    id SERIAL PRIMARY KEY,
    rule_name VARCHAR(255) NOT NULL,
    business_object VARCHAR(100) NOT NULL,  -- 'scar', 'ppap', 'audit', etc.
    trigger_condition JSONB NOT NULL,  -- {"field": "status", "operator": "equals", "value": "rejected"}
    action_type VARCHAR(50) NOT NULL,  -- 'send_email', 'send_notification', 'send_webhook'
    action_config JSONB NOT NULL,  -- {"recipients": ["user_id"], "template": "rejection_notice"}
    escalation_enabled BOOLEAN DEFAULT FALSE,
    escalation_hours INTEGER,
    escalation_recipients INTEGER[],
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES users(id),
    
    CONSTRAINT check_action_type CHECK (
        action_type IN ('send_email', 'send_notification', 'send_webhook')
    )
);

CREATE INDEX idx_notification_rules_business_object ON notification_rules(business_object);
CREATE INDEX idx_notification_rules_is_active ON notification_rules(is_active);
```

#### 10. SMTPConfig（邮件服务器配置表）

```sql
CREATE TABLE smtp_configs (
    id SERIAL PRIMARY KEY,
    config_name VARCHAR(100) UNIQUE NOT NULL,
    smtp_host VARCHAR(255) NOT NULL,
    smtp_port INTEGER NOT NULL,
    smtp_user VARCHAR(255) NOT NULL,
    smtp_password_encrypted TEXT NOT NULL,
    use_tls BOOLEAN DEFAULT TRUE,
    from_email VARCHAR(255) NOT NULL,
    from_name VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    last_test_at TIMESTAMP,
    last_test_result VARCHAR(20),  -- 'success', 'failed'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```


#### 11. 预留功能表 - InstrumentCalibration（仪器校准表）

```sql
-- 预留功能：仪器与量具管理
CREATE TABLE instrument_calibrations (
    id SERIAL PRIMARY KEY,
    instrument_code VARCHAR(100),
    instrument_name VARCHAR(255),
    calibration_date DATE,
    next_calibration_date DATE,
    calibration_status VARCHAR(20),  -- 'valid', 'expired', 'frozen'
    calibration_certificate_path VARCHAR(500),
    responsible_user_id INTEGER,
    msa_report_path VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- 所有字段设置为 Nullable（预留功能）
    CONSTRAINT check_calibration_status CHECK (
        calibration_status IS NULL OR calibration_status IN ('valid', 'expired', 'frozen')
    )
);

CREATE INDEX idx_instrument_calibrations_next_date ON instrument_calibrations(next_calibration_date);
```

#### 12. 预留功能表 - QualityCost（质量成本表）

```sql
-- 预留功能：质量成本管理
CREATE TABLE quality_costs (
    id SERIAL PRIMARY KEY,
    cost_type VARCHAR(50),  -- 'internal_failure', 'external_failure', 'appraisal', 'prevention'
    cost_category VARCHAR(100),
    amount DECIMAL(15, 2),
    currency VARCHAR(10) DEFAULT 'CNY',
    related_business_type VARCHAR(50),  -- 'scar', 'customer_complaint', 'scrap', etc.
    related_business_id INTEGER,
    supplier_id INTEGER,
    product_id INTEGER,
    occurred_date DATE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- 所有字段设置为 Nullable（预留功能）
    CONSTRAINT check_cost_type CHECK (
        cost_type IS NULL OR cost_type IN ('internal_failure', 'external_failure', 'appraisal', 'prevention')
    )
);

CREATE INDEX idx_quality_costs_occurred_date ON quality_costs(occurred_date);
CREATE INDEX idx_quality_costs_supplier_id ON quality_costs(supplier_id);
```


### 数据库迁移策略

#### Alembic 非破坏性迁移原则

**允许的操作**：
- ✅ 新增表（CREATE TABLE）
- ✅ 新增字段（ALTER TABLE ADD COLUMN），必须设置为 `Nullable` 或带有 `DEFAULT` 值
- ✅ 新增索引（CREATE INDEX）
- ✅ 新增约束（ADD CONSTRAINT），仅限非空约束以外的约束

**禁止的操作**（直到正式环境代码同步更新）：
- ❌ 删除字段（DROP COLUMN）
- ❌ 重命名字段（RENAME COLUMN）
- ❌ 修改字段类型（ALTER COLUMN TYPE），除非完全兼容
- ❌ 删除表（DROP TABLE）

**迁移脚本示例**：

```python
# alembic/versions/001_add_signature_field.py
"""Add electronic signature field to users table

Revision ID: 001
Revises: 
Create Date: 2024-01-15 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

def upgrade():
    # ✅ 新增字段，设置为 Nullable
    op.add_column('users', sa.Column('signature_image_path', sa.String(255), nullable=True))

def downgrade():
    op.drop_column('users', 'signature_image_path')
```

**版本感知代码示例**：

```python
# 后端代码需判空处理
class User(Base):
    __tablename__ = "users"
    
    signature_image_path = Column(String(255), nullable=True)
    
    def get_signature(self):
        # 兼容旧版本数据
        if self.signature_image_path:
            return self.signature_image_path
        return None  # 返回默认签名或提示用户上传
```

