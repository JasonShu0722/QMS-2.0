# API 目录规则

## 作用范围

本文件适用于 `apps/api/`。NestJS 模块的跨模块依赖还必须通过 `governance/module-boundaries.json` 检查。

## 权威入口

- 模块边界：`../../governance/module-boundaries.json`
- API 契约：`../../packages/contracts/src/generated/api.ts`
- 平台交接：`../../docs/PLATFORM-HANDOFF.md`
- 供应商交接：`../../docs/SUPPLIER-PLATFORM-HANDOFF.md`

## 必须遵守

- 业务模块不能直接读取其他模块的内部表；跨模块查询使用公开服务或读取模型。
- Controller 只负责 HTTP 适配和授权入口，领域规则位于服务或领域策略中。
- 事务内回调只能执行可回滚的数据库操作，不得发送网络请求、邮件或其他不可回滚副作用。
- 所有写操作明确处理权限、数据范围、流程权限、幂等、并发冲突和审计。
- 新增或修改 DTO、错误响应、参数和响应字段后必须重新生成并检查 OpenAPI 契约。
- 新迁移不得修改已有迁移文件；历史数据兼容和失败回滚必须有真实 PostgreSQL 证据。

## 验证命令

```powershell
corepack pnpm --filter @qms/api test
corepack pnpm --filter @qms/api test:integration
corepack pnpm --filter @qms/api build
corepack pnpm contracts:check
```
