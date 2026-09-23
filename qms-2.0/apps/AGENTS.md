# 应用目录规则

## 作用范围

本文件适用于 `apps/` 下的应用目录。API 和 Web 的具体规则见各自目录中的 `AGENTS.md`。

## 权威入口

- 应用架构：`../docs/DEVELOPMENT-GOVERNANCE.md`
- 当前状态：`../docs/CAPABILITY-STATUS.md`
- API 契约：`../packages/contracts/src/generated/api.ts`

## 必须遵守

- 应用之间通过明确的 API、契约或平台服务协作，不共享内部实现。
- 新增跨应用行为必须同时覆盖允许路径、拒绝路径和错误状态。
- 应用级变更必须在任务证据矩阵中记录 API、数据、权限和浏览器影响。

## 验证命令

```powershell
corepack pnpm --filter @qms/api test
corepack pnpm --filter @qms/web test
corepack pnpm --filter @qms/api build
corepack pnpm --filter @qms/web build
```
