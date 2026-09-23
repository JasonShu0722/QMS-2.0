# 共享包目录规则

## 作用范围

本文件适用于 `packages/` 下的共享包。具体生成契约规则见 `packages/contracts/AGENTS.md`。

## 权威入口

- API 契约流程：`../docs/OPENAPI.md`
- 项目治理：`../docs/DEVELOPMENT-GOVERNANCE.md`

## 必须遵守

- 共享包只承载稳定、可复用的公共能力，不复制业务模块内部模型。
- 公共类型变化必须检查所有消费者，并在证据矩阵中记录兼容性影响。
- 生成物必须标明生成来源和命令，不把临时构建产物纳入 Git。

## 验证命令

```powershell
corepack pnpm contracts:check
corepack pnpm --filter @qms/contracts test
```
