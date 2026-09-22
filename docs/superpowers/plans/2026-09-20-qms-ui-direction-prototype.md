# QMS UI 方向样板实施计划

**目标：** 制作可体验的中文三页样板，验证统一视觉对多应用 QMS、图表分析及复杂流程的适配。

**架构：** 现有 Web 内独立 HTML 入口，内存演示数据与状态，不触及正式路由、认证、接口和数据库。

**技术栈：** React 19、Ant Design 6、lucide-react、CSS、SVG；复用现有 Vite。

## 文件

- `qms-2.0/apps/web/ui-prototype.html`：独立开发预览入口。
- `qms-2.0/apps/web/src/prototypes/ui-direction/main.tsx`：演示数据、共用外壳、三页内容与交互。
- `qms-2.0/apps/web/src/prototypes/ui-direction/prototype.css`：隔离视觉规范、布局和响应式。
- `qms-2.0/apps/web/src/prototypes/ui-direction/README.md`：启动方法、边界、实际验证和决策记录。

## 步骤

- [x] 核对原设计、现有依赖与用户已同意的三页范围。
- [x] 创建入口、应用导航、演示标识和统一视觉。
- [x] 实现工作台、分析筛选下钻和流程表单交互。
- [x] 执行类型检查、正式 Web 构建和浏览器验证。
- [x] 保留可交互预览并请求在 Codex 中打开，记录验证与剩余决策。

## 启动和验证

从 `qms-2.0/` 执行 `node apps/web/node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 18766 --strictPort`，访问 `/ui-prototype.html`。

复用本机 Node 22 环境，执行 `pnpm --filter @qms/web lint` 和 `pnpm --filter @qms/web build`。浏览器使用明确的桌面及窄屏尺寸验证布局，演示草稿和提交不产生任何真实业务记录。不新增镜像式单元测试、不执行数据库验收、不提交或推送。

## 实际结果

2026-09-20：类型检查、正式 Web 构建通过，构建产物没有 `ui-prototype.html`。现有 Ant Design 分包超过 900 kB 的警告仍存在。

浏览器在 1440 × 1040 和 390 × 844 下检查。验证了待办到期筛选、分析时间与来源切换、缺陷下钻与问题跳转、D4 必填拦截、草稿反馈、提交状态、报告/操作记录、专注模式及移动导航。窄屏三页未产生整页横向溢出。演示 CSV 内容可预览与手动复制；未将内嵌浏览器下载事件作为已通过项。

下一步由用户评价整体风格、字号与信息密度，再决定是否采购完整设计资源及逐步落地正式组件。示例指标及固定 D0–D8 流程只说明布局，不替代正式指标口径和动态流程定义。

## 离线分享补充

用户要求输出可离线浏览的 HTML 单文档。复用三页样板及现有依赖，以独立 Vite 构建将 JavaScript、CSS 和图标全部内联到 `qms-2.0/dist/share/QMS-UI-Preview.html`，不使用 CDN、不需要本地服务、不新增依赖，不改变正式 Web 构建。文件协议使用页内哈希切换页面，避免本地文件路径的历史记录限制。

- [x] 添加可重复执行的单文件导出脚本，生成分享文件。
- [x] 验证 HTML 无外部资源依赖并完成类型检查；本地文件浏览器实测受策略限制，未声称通过。
- [x] 记录验证结果，提供可分享文件链接。

运行 `node apps/web/scripts/build-ui-prototype-offline.mjs` 成功，文件为 720,522 字节。导出检查要求只有一个 JavaScript 包和一个 CSS 包且无外部导入；JavaScript 已通过 `vm.Script` 语法检查。HTML 内无外部资源标签，CSP 禁止网络连接，`pnpm --filter @qms/web lint` 通过。内嵌浏览器拒绝访问 `file:` URL，未绕过其安全策略，因此离线文件的浏览器运行仍需使用者在本机 Chrome / Edge 打开确认。原样板三页交互的浏览器验证结果保持适用范围，不冒充离线实测。
