# API 契约包规则

## 作用范围

本文件适用于 `packages/contracts/`。

## 权威入口

- 生成命令：`../../scripts/generate-contracts.mjs`
- API DTO 与 Swagger：`../../apps/api/`
- 契约说明：`../../docs/OPENAPI.md`

## 必须遵守

- `src/generated/api.ts` 只能由 Nest Swagger 和 `contracts:generate` 生成。
- 不得在 Web 中复制 API DTO 或手工修改生成类型。
- API 变化必须先修改 API DTO/Swagger，再生成契约，最后运行 `contracts:check`。

## 验证命令

```powershell
corepack pnpm contracts:generate
corepack pnpm contracts:check
```
