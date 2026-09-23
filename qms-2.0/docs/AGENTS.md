# 文档目录规则

## 作用范围

本文件适用于 `qms-2.0/docs/` 下的 Markdown 文档。

## 权威入口

- 文档导航：`README.md`
- 文档机器索引：`../governance/documentation-index.json`
- 开发治理：`DEVELOPMENT-GOVERNANCE.md`
- 能力状态：`CAPABILITY-STATUS.md`

## 必须遵守

- 业务描述、设计、计划、交接、验收和运维说明使用中文。
- 命令、路径、API 路径、代码标识和第三方产品名保留原文。
- 每个新 Markdown 文件必须加入 `README.md` 和 `governance/documentation-index.json`。
- 只有一个权威版本；翻译副本必须注明来源、同步日期和权威文件。
- 验收文档必须区分当前结果、历史结果、失败尝试和未覆盖范围。
- 不得把旧 PASS 作为新源码的验收证据，不得把配置检查描述为部署成功。

## 验证命令

```powershell
corepack pnpm check:governance
git diff --check
```
