# 治理脚本规则

## 作用范围

本文件适用于 `qms-2.0/scripts/`。

## 权威入口

- 治理检查：`check-governance.mjs`
- 契约生成：`generate-contracts.mjs`
- 契约检查：`check-openapi-sync.mjs`
- 归档隔离：`check-archive-isolation.mjs`

## 必须遵守

- 检查失败必须返回非零退出码，不能把缺少前置条件报告为通过。
- 脚本不能读取或打印仓库外的秘密、备份和原始验收凭据。
- 新检查必须有明确输入、输出、失败条件和对应文档入口。
- 脚本修改必须补充针对性测试或验证命令。

## 验证命令

```powershell
corepack pnpm check:governance
```
