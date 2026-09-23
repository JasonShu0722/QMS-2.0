# 治理资产规则

## 作用范围

本文件适用于 `qms-2.0/governance/`。

## 权威入口

- 文档索引：`documentation-index.json`
- 模块边界：`module-boundaries.json`
- 规则执行：`../scripts/check-governance.mjs`

## 必须遵守

- JSON 文件必须是机器可解析的 UTF-8 文本，并与对应 Markdown 规则保持一致。
- 目录、文档、模块依赖和状态变化必须先更新权威清单，再更新说明文档。
- 索引不能登记不存在的文件，也不能为同一类资产声明多个权威来源。

## 验证命令

```powershell
corepack pnpm check:governance
```
