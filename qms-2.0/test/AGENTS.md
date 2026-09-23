# 测试目录规则

## 作用范围

本文件适用于 `qms-2.0/test/` 以及 API/Web 测试目录的测试治理。

## 权威入口

- 分层门禁：`../docs/DEVELOPMENT-GOVERNANCE.md`
- 阶段验收：`phase-1-acceptance.mjs`、`phase-2-acceptance.mjs`
- 验收事实：`../docs/FOUNDATION.md`

## 必须遵守

- 关键数据库行为使用真实 PostgreSQL；不得用 SQLite 替代。
- 关键登录、权限隔离、附件、Worker 和业务主链使用真实服务或真实浏览器。
- 缺少必需配置必须失败，不得通过 Skip、Mock、放宽断言或复用已变更夹具隐藏失败。
- 测试必须同时覆盖允许和拒绝路径，以及重复请求、冲突、回滚和失败恢复。
- 验收脚本使用一次性资源，结束后销毁容器、卷、网络和进程；凭据与日志留在 Git 外。

## 验证命令

```powershell
corepack pnpm test
corepack pnpm acceptance:phase-1
corepack pnpm acceptance:phase-2
```
