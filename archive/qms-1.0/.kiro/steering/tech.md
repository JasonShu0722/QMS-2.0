---
inclusion: always
---

# Technology Stack

## Build System

采用容器化方案，确保开发环境与生产环境（以及 IMS 内网环境）的一致性。

- **Orchestration (编排)**: Docker Compose
  - *用途*：一键启动前后端及数据库，新手必备。
- **Container Runtime (容器运行)**: Docker
- **Frontend Build (前端构建)**: Vite
  - *用途*：Vue 3 的官方构建工具，速度极快。
- **Backend Runtime (后端运行)**: Uvicorn
  - *用途*：高性能的 ASGI 服务器，用于运行 FastAPI。

## Tech Stack

### 1. Backend (后端 - 核心业务与 IMS 对接)
- **Language (语言)**: Python 3.10+
  - *理由*：数据处理领域的王者，方便编写 PPM/CPK 计算逻辑，代码可读性高。
- **Framework (框架)**: FastAPI
  - *理由*：现代、高性能。自动生成交互式 API 文档，对一期对接 IMS 至关重要。
- **IMS Integration (IMS集成核心)**: HTTPX (Async Client)
  - *理由*：**一期核心组件**。现代化的异步 HTTP 客户端，用于高性能地并发拉取 IMS 的入库数据和生产数据。
- **Task Queue (任务队列)**: Celery + Redis
  - *理由*：**一期核心组件**。用于处理“定时任务”（如：每晚 2:00 从 IMS 拉数据），防止阻塞主线程。
- **ORM (数据库交互)**: SQLAlchemy (Async)
  - *理由*：通过 Python 对象操作数据库，防止 SQL 注入。方便后期修改表结构（Alembic 迁移）。
- **Data Validation (数据校验)**: Pydantic
  - *理由*：强制数据类型校验。当 IMS 传回的数据格式异常时自动报错防呆。

### 2. Frontend (前端 - 交互界面)
- **Framework (框架)**: Vue.js 3 (Composition API)
  - *理由*：比 React 更容易上手，逻辑更清晰。
- **UI Component (组件库)**: Element Plus (Desktop) + Tailwind CSS (Mobile)
    * *理由*：Element Plus 用于复杂的 PC 端管理后台。Tailwind CSS 用于构建 **2.1.3 移动端/PDA 页面** 的响应式布局，确保扫码页面在手持设备上操作流畅。
- **State Management (状态管理)**: Pinia
  - *理由*：轻量级状态管理，用于存储“当前登录用户信息”和“权限配置”。
- **Visualization (图表)**: ECharts
  - *理由*：百度开源，处理复杂的质量图表（柏拉图、PPM趋势图、雷达图）能力最强。
- **Network (网络请求)**: Axios
  - *理由*：标准的前端 HTTP 库，用于前端与 Python 后端通信。

### 3. Database & Infrastructure (数据存储与设施)
- **Primary Database (主数据库)**: PostgreSQL 15+
  - *理由*：企业级标准。比 MySQL 更擅长处理复杂关联查询（如：计算 3MIS 这种涉及时间窗口的数据）。
- **Cache / Broker (缓存/消息中间件)**: Redis
  - *理由*：既作为缓存加速 API，也作为 Celery 任务队列的消息中间件。
- **Gateway (网关)**: Nginx
  - *理由*：反向代理服务器，处理静态文件，保护后端接口。
- **Migration Tool**: Alembic
  - *约束*：严格遵循 **2.10 版本管理** 策略。生产环境迁移脚本必须是“非破坏性”的（Add Column Only），禁止 Drop Column 操作。

### 4. Integration & AI (集成与智能)
- **AI SDK**: OpenAI API Client (Compatible with DeepSeek)
  - *理由*：用于调用大模型进行“异常归因诊断”和“8D 报告预审”。
- **File Storage (文件存储)**: Local File System (Phase 1)
  - *理由*：一期开发先将 8D 附件、图纸存储在服务器本地目录，简单高效。
  - ### 4. Integration & AI (集成与智能)
- **IMS Integration**: 
  - *Network Note*: 系统将部署在 DMZ 区。FastAPI 后端需具备同时访问外网（响应前端）和内网（请求 IMS）的网络权限。
- **Authentication**: Python-Jose + LDAP3
    - *理由*：实现 **2.1.1** 定义的双重认证：内部员工可走 LDAP/AD 验证，外部供应商走 JWT 令牌验证。

## Common Commands

### Docker Operations (Recommended)
```bash
# [构建并启动] 后台运行所有服务 (后端、前端、数据库、Redis)
docker compose up -d --build

# [停止] 停止所有服务
docker compose down

# [查看日志] 查看后端日志 (用于调试 IMS 接口报错)
docker compose logs -f backend

# [查看日志] 查看前端日志
docker compose logs -f frontend

