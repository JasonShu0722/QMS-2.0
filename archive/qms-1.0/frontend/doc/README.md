# Frontend README

`frontend` 是 QMS 的 Vue 3 前端应用，负责：

- 登录与注册界面
- 工作台与业务页面
- 权限驱动路由
- 调用后端 API

## 技术栈

- Vue 3
- Vite
- TypeScript
- Element Plus
- Pinia
- Vue Router
- Axios
- Vitest

## 目录结构

```text
frontend/
├─ src/
│  ├─ api/
│  ├─ components/
│  ├─ composables/
│  ├─ layouts/
│  ├─ router/
│  ├─ stores/
│  ├─ test/
│  ├─ types/
│  ├─ utils/
│  ├─ views/
│  ├─ App.vue
│  └─ main.ts
├─ doc/
├─ nginx.conf
├─ package.json
├─ vite.config.ts
└─ .env.development
```

## 环境切换规则

当前项目的“正式版 / 预览版”遵循两层规则，必须一起理解：

### 1. 入口域名

- 正式版入口：`qms.bigshuaibee.cn`
- 预览版入口：`preview.qms.bigshuaibee.cn`

线上部署时，当前访问的域名决定默认落到哪一套前后端容器。

### 2. 页面按钮

项目保留显式的“正式版 / 预览版”切换按钮。

- 在线上环境中，点击按钮会在正式版域名和预览版域名之间跳转
- 在本地开发环境中，没有双域名，按钮会退化为切换本地 `current_environment`

也就是说，按钮不是摆设，但线上切换的真实动作是“跳转到另一套入口域名”。

## 推荐启动方式

推荐配合本地后端一起启动：

1. 根目录启动 `postgres` 和 `redis`
2. 本地启动后端 `8000`
3. 本地启动前端 `5173`

## 本地启动

### 1. 安装依赖

```bash
cd frontend
npm install
```

### 2. 检查开发环境变量

开发环境配置文件：

```text
frontend/.env.development
```

当前推荐配置：

```env
VITE_API_BASE_URL=/api
VITE_ENVIRONMENT=stable
```

说明：

- `VITE_API_BASE_URL=/api`
  让浏览器通过 Vite 代理访问本地后端，避免直接请求 `http://localhost:8000` 造成跨域问题。
- `VITE_ENVIRONMENT=stable`
  只是本地前端的默认语义，不代表线上正式版和预览版的入口关系。
  在本地点击切换按钮时，前端会更新 `localStorage.current_environment` 来模拟环境切换。

### 3. 启动前端

```bash
cd frontend
npm run dev
```

启动后访问：

```text
http://localhost:5173
```

## 本地调试说明

当前 `vite.config.ts` 已配置代理：

- `/api` -> `http://localhost:8000`

所以本地调试时应保证：

- 后端运行在 `http://localhost:8000`
- 前端运行在 `http://localhost:5173`

## 常用命令

### 启动开发服务器

```bash
npm run dev
```

### 构建

```bash
npm run build
```

### 本地预览构建结果

```bash
npm run preview
```

### 运行测试

```bash
npm run test
```

## 登录调试

如果登录页出现：

- “网络连接失败”
- “登录失败，请检查用户名和密码”

优先检查：

1. 后端是否启动在 `8000`
2. `frontend/.env.development` 是否为 `VITE_API_BASE_URL=/api`
3. Vite 是否已重启并加载最新环境变量
4. 当前切换按钮对应的环境是否与本地测试目标一致

## 开发建议

- 页面入口主要在 `src/views`
- 公共逻辑优先看 `src/components`、`src/composables`
- 请求封装在 `src/utils/request.ts`
- 登录态与环境状态在 `src/stores/auth.ts`
- 路由守卫在 `src/router/index.ts`
- 测试目录统一在：
  - `src/test`
  - `src/components/test`
  - `src/views/test`
